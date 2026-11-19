import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { releaseSurface } from "@/raster/pixelLayer";
import { documentGrid } from "@/selection/state";
import { isEditorChrome } from "@/utils/editorObjects";
import { renderObjectsRegion } from "@/utils/flatten";
import { guidesOf } from "@/utils/guides";
import type { DecodedLayer, PsdToWrite } from "./psdDocument";
import { runPsdWorker } from "./psdWorkerClient";

const WRITE_TIMEOUT_MS = 120_000;

type Layer = Omit<DecodedLayer, "mask">;

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

/**
 * The document as a Photoshop file: every layer as a pixel layer at the
 * document's resolution (text, shapes, masks and styles drawn into it), with
 * its name, opacity, blend mode and visibility; the flattened image; and the
 * guides.
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

  const layers: Layer[] = [];
  for (const object of objects) {
    signal?.throwIfAborted();
    // Drawn plainly: its opacity, blend and visibility go into the file as settings.
    const settings = { visible: object.visible, opacity: object.opacity, blend: object.globalCompositeOperation };
    let surface: HTMLCanvasElement;
    object.visible = true;
    object.opacity = 1;
    object.globalCompositeOperation = "source-over";
    try {
      surface = render((candidate) => candidate === object);
    } finally {
      object.visible = settings.visible;
      object.opacity = settings.opacity;
      object.globalCompositeOperation = settings.blend;
    }
    try {
      const area = trimmed(surface);
      if (area) {
        layers.push({
          ...area,
          name: ((object as FabricObject & { name?: string }).name ?? "").slice(0, 200) || `Layer ${layers.length + 1}`,
          opacity: settings.opacity ?? 1,
          visible: settings.visible !== false,
          blend: (settings.blend ?? "source-over") as GlobalCompositeOperation,
        });
      }
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
  const transfer = [composite.buffer as ArrayBuffer, ...layers.map((layer) => layer.pixels.buffer as ArrayBuffer)];
  const buffer = await runPsdWorker<ArrayBuffer>({ type: "write", document }, transfer, {
    signal,
    timeoutMs: WRITE_TIMEOUT_MS,
    failure: "The Photoshop file could not be written",
  });
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" });
}
