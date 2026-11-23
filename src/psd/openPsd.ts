import { version as fabricVersion } from "fabric";
import { encodePng } from "@/raster/pngEncoder";
import { releaseSurface } from "@/raster/pixelLayer";
import type { CanvasSnapshot } from "@/utils/canvasSnapshot";
import { validateProjectSnapshot } from "@/utils/projectFile";
import { throwIfAborted } from "@/utils/abort";
import type { DecodedLayer, DecodedMask, DecodedPsd } from "./psdDocument";
import { runPsdWorker } from "./psdWorkerClient";

/** Photoshop files larger than this are not read at all. */
const MAX_PSD_BYTES = 300 * 1024 * 1024;
/** A file that takes longer than this to read is given up on. */
const READ_TIMEOUT_MS = 120_000;

/** Whether a file is a Photoshop document, by its name or its first bytes. */
export async function isPsdFile(file: File): Promise<boolean> {
  if (/\.ps[db]$/i.test(file.name) || file.type === "image/vnd.adobe.photoshop") return true;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x38 && head[1] === 0x42 && head[2] === 0x50 && head[3] === 0x53; // "8BPS"
}

const decodeInWorker = (buffer: ArrayBuffer, signal?: AbortSignal) =>
  runPsdWorker<DecodedPsd>({ type: "read", buffer }, [buffer], {
    signal,
    timeoutMs: READ_TIMEOUT_MS,
    failure: "The Photoshop file could not be read",
  });

const readDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read"));
    reader.readAsDataURL(blob);
  });

/** RGBA pixels as a PNG data URL. */
async function pngOf(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): Promise<string> {
  const surface = document.createElement("canvas");
  surface.width = Math.max(1, width);
  surface.height = Math.max(1, height);
  try {
    const context = surface.getContext("2d");
    if (!context) throw new Error("The browser could not prepare the layer");
    draw(context);
    return await readDataUrl(await encodePng(surface));
  } finally {
    releaseSurface(surface);
  }
}

const pixelsPng = (width: number, height: number, pixels: Uint8ClampedArray) =>
  pngOf(width, height, (context) => context.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0));

/**
 * A layer mask over `box` (in document pixels): the size of its layer for a
 * pixel layer, of the document for an adjustment or fill layer, as the
 * editor keeps them.
 */
function maskPng(mask: DecodedMask, box: { left: number; top: number; width: number; height: number }) {
  return pngOf(box.width, box.height, (context) => {
    context.fillStyle = `rgb(${mask.outside}, ${mask.outside}, ${mask.outside})`;
    context.fillRect(0, 0, box.width, box.height);
    if (mask.width === 0 || mask.height === 0) return;
    const rgba = new Uint8ClampedArray(mask.width * mask.height * 4);
    for (let index = 0; index < mask.grey.length; index += 1) {
      const value = mask.grey[index]!;
      rgba[index * 4] = value;
      rgba[index * 4 + 1] = value;
      rgba[index * 4 + 2] = value;
      rgba[index * 4 + 3] = 255;
    }
    context.putImageData(new ImageData(rgba, mask.width, mask.height), mask.left - box.left, mask.top - box.top);
  });
}

export interface OpenedPsd {
  snapshot: CanvasSnapshot;
  /** What could not be brought over. */
  notes: string[];
}

/**
 * A Photoshop file as an editor document: its bottom layer (when it fills
 * the canvas) or a transparent canvas as the photo, every other pixel,
 * adjustment and fill layer above it in place, with its name, opacity, Fill,
 * blend mode, visibility, mask and clipping, its groups, and the file's
 * guides.
 */
export async function readPsdFile(file: File, signal?: AbortSignal): Promise<OpenedPsd> {
  if (file.size > MAX_PSD_BYTES) throw new Error(`Photoshop files can be at most ${MAX_PSD_BYTES / 1024 / 1024} MB`);
  const buffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const psd = await decodeInWorker(buffer, signal);
  throwIfAborted(signal);

  const srcs: string[] = [];
  const source = (src: string) => {
    srcs.push(src);
    return `__snapshot_src_${srcs.length - 1}`;
  };
  const objectOf = (layer: { left: number; top: number; width: number; height: number }) => ({
    type: "Image",
    version: fabricVersion,
    originX: "left",
    originY: "top",
    left: layer.left,
    top: layer.top,
    width: layer.width,
    height: layer.height,
    scaleX: 1,
    scaleY: 1,
  });

  const layers = [...psd.layers];
  const bottom = layers[0];
  const fillsCanvas =
    bottom?.kind === "layer" &&
    bottom.left === 0 &&
    bottom.top === 0 &&
    bottom.width === psd.width &&
    bottom.height === psd.height &&
    !bottom.mask &&
    !bottom.style &&
    bottom.fill === 1 &&
    bottom.blend === "source-over";
  const photoLayer = fillsCanvas ? (layers.shift() as DecodedLayer) : null;

  let photoSrc: string;
  if (photoLayer) photoSrc = await pixelsPng(psd.width, psd.height, photoLayer.pixels);
  else if (psd.composite) photoSrc = await pixelsPng(psd.width, psd.height, psd.composite);
  else photoSrc = await pngOf(psd.width, psd.height, () => {});
  throwIfAborted(signal);

  const objects: Record<string, unknown>[] = [
    {
      ...objectOf({ left: 0, top: 0, width: psd.width, height: psd.height }),
      src: source(photoSrc),
      __isBackground: true,
      name: photoLayer?.name ?? "Background",
      opacity: photoLayer?.opacity ?? 1,
      visible: photoLayer?.visible ?? true,
      selectable: false,
      evented: false,
      hasControls: false,
      erasable: false,
      ...(psd.guides.length ? { guides: psd.guides } : {}),
    },
  ];
  for (const layer of layers) {
    if (layer.kind === "end") {
      objects.push({ type: "LayerGroupEnd", version: fabricVersion });
      continue;
    }
    if (layer.kind === "group") {
      objects.push({
        type: "LayerGroup",
        version: fabricVersion,
        name: layer.name,
        opacity: layer.opacity,
        visible: layer.visible,
        globalCompositeOperation: layer.blend,
        passThrough: layer.passThrough,
        collapsed: layer.collapsed,
      });
      continue;
    }
    if (layer.kind === "adjustment" || layer.kind === "fill") {
      // Over the document, whose pixels are the scene's here; so is its mask.
      const object: Record<string, unknown> = {
        type: layer.kind === "adjustment" ? "AdjustmentLayer" : "FillLayer",
        version: fabricVersion,
        name: layer.name,
        opacity: layer.opacity,
        visible: layer.visible,
        globalCompositeOperation: layer.blend,
        ...(layer.kind === "adjustment" ? { adjustment: layer.adjustment } : { fillContent: layer.content }),
      };
      if (layer.mask) {
        const src = await maskPng(layer.mask, { left: 0, top: 0, width: psd.width, height: psd.height });
        object.layerMask = { src: source(src), enabled: layer.mask.enabled };
      }
      if (layer.clipped) object.__clipped = true;
      if (layer.fill < 1) object.__fill = layer.fill;
      objects.push(object);
      throwIfAborted(signal);
      continue;
    }
    const object: Record<string, unknown> = {
      ...objectOf(layer),
      src: source(await pixelsPng(layer.width, layer.height, layer.pixels)),
      name: layer.name,
      opacity: layer.opacity,
      visible: layer.visible,
      globalCompositeOperation: layer.blend,
    };
    if (layer.mask) object.layerMask = { src: source(await maskPng(layer.mask, layer)), enabled: layer.mask.enabled };
    if (layer.style) object.layerStyle = layer.style;
    if (layer.clipped) object.__clipped = true;
    if (layer.fill < 1) object.__fill = layer.fill;
    objects.push(object);
    throwIfAborted(signal);
  }

  const snapshot = validateProjectSnapshot({ json: JSON.stringify({ version: fabricVersion, objects }), srcs });
  return { snapshot, notes: psd.notes };
}
