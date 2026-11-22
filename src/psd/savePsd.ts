import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { releaseSurface } from "@/raster/pixelLayer";
import { documentGrid } from "@/selection/state";
import { withoutCompositing } from "@/compositing/compositor";
import { isAdjustmentLayer } from "@/adjustments/adjustmentLayer";
import { isDocumentLayer, type DocumentLayer } from "@/adjustments/documentLayer";
import { isFillLayer } from "@/adjustments/fillLayer";
import { isGroupEnd, isGroupHeader } from "@/layers/groupMarkers";
import { fillOf } from "@/raster/layerStyle";
import { hasEffects, type LayerStyle } from "@/raster/layerStyleData";
import { documentMaskGrey } from "@/raster/layerMask";
import { isEditorChrome } from "@/utils/editorObjects";
import { renderObjectsRegion } from "@/utils/flatten";
import { guidesOf } from "@/utils/guides";
import type { DecodedMask, PsdToWrite } from "./psdDocument";
import { runPsdWorker } from "./psdWorkerClient";

const WRITE_TIMEOUT_MS = 120_000;

type Entry = PsdToWrite["layers"][number];
type Layered = FabricObject & { name?: string; __clipped?: boolean; __fill?: number; layerStyle?: LayerStyle };

/** The pixels of a rendered surface that are not transparent, and where they start. */
function trimmed(surface: HTMLCanvasElement): { left: number; top: number; width: number; height: number; pixels: Uint8ClampedArray } | null {
  const context = surface.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not read the layer");
  const { width, height } = surface;
  const { data } = context.getImageData(0, 0, width, height);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    let row = y * width * 4 + 3;
    for (let x = 0; x < width; x += 1, row += 4) {
      if (data[row] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  if (right < 0) return null;
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const pixels = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    const from = ((top + y) * width + left) * 4;
    pixels.set(data.subarray(from, from + cropWidth * 4), y * cropWidth * 4);
  }
  return { left, top, width: cropWidth, height: cropHeight, pixels };
}

const nextFrame = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

/** An adjustment or fill layer as Photoshop's own, its mask in document pixels. */
async function documentLayerEntry(
  canvas: FabricCanvas,
  layer: DocumentLayer,
  render: (include: (object: FabricObject) => boolean) => HTMLCanvasElement
): Promise<Entry | null> {
  const grey = await documentMaskGrey(canvas, layer);
  const mask: DecodedMask | undefined = grey ? { ...grey, outside: 255 } : undefined;
  const base = {
    name: (layer.name ?? "").slice(0, 200) || (isFillLayer(layer) ? "Fill" : "Adjustment"),
    opacity: layer.opacity ?? 1,
    visible: layer.visible !== false,
    blend: (layer.globalCompositeOperation ?? "source-over") as GlobalCompositeOperation,
    clipped: layer.__clipped === true,
    fill: fillOf(layer),
    ...(mask ? { mask } : {}),
  };
  if (isAdjustmentLayer(layer)) return { kind: "adjustment", ...base, adjustment: layer.adjustment };
  if (!isFillLayer(layer)) return null;
  // Its content as other programs show it: drawn plainly, without its mask
  // (the file has that on its own).
  const item = layer as DocumentLayer & { __fill?: number };
  const saved = { visible: layer.visible, opacity: layer.opacity, blend: layer.globalCompositeOperation, fill: item.__fill, mask: layer.layerMask };
  layer.visible = true;
  layer.opacity = 1;
  layer.globalCompositeOperation = "source-over";
  item.__fill = undefined;
  if (saved.mask) layer.layerMask = { ...saved.mask, enabled: false };
  let surface: HTMLCanvasElement;
  try {
    surface = withoutCompositing(() => render((candidate) => candidate === layer));
  } finally {
    layer.visible = saved.visible;
    layer.opacity = saved.opacity;
    layer.globalCompositeOperation = saved.blend;
    item.__fill = saved.fill;
    layer.layerMask = saved.mask;
  }
  try {
    const area = trimmed(surface) ?? { left: 0, top: 0, width: 0, height: 0, pixels: new Uint8ClampedArray(0) };
    return { kind: "fill", ...base, content: layer.fillContent, ...area };
  } finally {
    releaseSurface(surface);
  }
}

/**
 * The document as a Photoshop file: every layer as a pixel layer at the
 * document's resolution (text, shapes, masks and styles drawn into it), with
 * its name, opacity, Fill, blend mode, visibility and clipping; adjustment
 * and fill layers as Photoshop's own, with their masks; the groups; the
 * flattened image; and the guides.
 */
export async function documentAsPsd(canvas: FabricCanvas, signal?: AbortSignal): Promise<Blob> {
  const grid = documentGrid(canvas);
  if (!grid) throw new Error("Open a photo first");
  const region = { left: grid.left, top: grid.top, width: grid.width / grid.scale, height: grid.height / grid.scale };
  const objects = canvas.getObjects().filter((object) => !isEditorChrome(object));

  const render = (include: (object: FabricObject) => boolean) => {
    const { element } = renderObjectsRegion(canvas, region, grid.scale, include);
    if (element.width !== grid.width || element.height !== grid.height) {
      releaseSurface(element);
      throw new Error("The document could not be drawn at its own size");
    }
    return element;
  };

  const layers: Entry[] = [];
  for (const object of objects) {
    signal?.throwIfAborted();
    const item = object as Layered;
    if (isGroupEnd(object)) {
      layers.push({ kind: "end" });
      continue;
    }
    if (isDocumentLayer(object)) {
      const entry = await documentLayerEntry(canvas, object, render);
      if (entry) layers.push(entry);
      continue;
    }
    if (isGroupHeader(object)) {
      layers.push({
        kind: "group",
        name: (item.name ?? "").slice(0, 200) || "Group",
        opacity: object.opacity ?? 1,
        visible: object.visible !== false,
        passThrough: object.passThrough !== false,
        blend: (object.globalCompositeOperation ?? "source-over") as GlobalCompositeOperation,
        collapsed: object.collapsed === true,
      });
      continue;
    }
    // Drawn plainly: its opacity, blend and visibility go into the file as
    // settings. Fill does too, unless effects are drawn into the pixels (the
    // file's Fill would fade them as well).
    const fill = fillOf(object);
    const fillAsSetting = !hasEffects(item.layerStyle);
    const settings = { visible: object.visible, opacity: object.opacity, blend: object.globalCompositeOperation, fill: item.__fill };
    let surface: HTMLCanvasElement;
    object.visible = true;
    object.opacity = 1;
    object.globalCompositeOperation = "source-over";
    if (fillAsSetting) item.__fill = undefined;
    try {
      // The layer's own pixels: its group and clipping are settings in the file.
      surface = withoutCompositing(() => render((candidate) => candidate === object));
    } finally {
      object.visible = settings.visible;
      object.opacity = settings.opacity;
      object.globalCompositeOperation = settings.blend;
      item.__fill = settings.fill;
    }
    try {
      // A layer without pixels stays, as what a clipped layer above it clips to.
      const area = trimmed(surface) ?? { left: 0, top: 0, width: 0, height: 0, pixels: new Uint8ClampedArray(0) };
      layers.push({
        kind: "layer",
        ...area,
        name: (item.name ?? "").slice(0, 200) || `Layer ${layers.length + 1}`,
        opacity: settings.opacity ?? 1,
        visible: settings.visible !== false,
        blend: (settings.blend ?? "source-over") as GlobalCompositeOperation,
        clipped: item.__clipped === true,
        fill: fillAsSetting ? fill : 1,
      });
    } finally {
      releaseSurface(surface);
    }
    // Let the page breathe between layers.
    await nextFrame();
  }

  const flat = render((object) => objects.includes(object));
  let composite: Uint8ClampedArray;
  try {
    const context = flat.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The browser could not read the document");
    composite = context.getImageData(0, 0, grid.width, grid.height).data;
  } finally {
    releaseSurface(flat);
  }

  const document: PsdToWrite = {
    width: grid.width,
    height: grid.height,
    layers,
    composite,
    guides: guidesOf(canvas).map((guide) => ({
      axis: guide.axis,
      position: (guide.position - (guide.axis === "x" ? grid.left : grid.top)) * grid.scale,
    })),
  };
  const transfer = [
    composite.buffer as ArrayBuffer,
    ...layers.flatMap((layer) => ("pixels" in layer && layer.pixels.byteLength ? [layer.pixels.buffer as ArrayBuffer] : [])),
    ...layers.flatMap((layer) => ("mask" in layer && layer.mask?.grey.byteLength ? [layer.mask.grey.buffer as ArrayBuffer] : [])),
  ];
  const buffer = await runPsdWorker<ArrayBuffer>({ type: "write", document }, transfer, {
    signal,
    timeoutMs: WRITE_TIMEOUT_MS,
    failure: "The Photoshop file could not be written",
  });
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" });
}
