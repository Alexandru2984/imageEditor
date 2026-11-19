import {
  getCompositeImageData,
  getLayerImageData,
  getLayerMaskImageData,
  initializeCanvas,
  readPsd,
  type BlendMode,
  type Layer,
  type PixelData,
} from "ag-psd";
import { MAX_RASTER_PIXELS, MAX_RASTER_SIDE } from "@/utils/flatten";
import type { Guide } from "@/utils/guideData";

/**
 * Photoshop documents, read from untrusted files: the structure first, then
 * each layer's pixels one at a time, within the editor's limits. Runs in a
 * worker (see psd.worker.ts) and returns plain data.
 */

export const MAX_PSD_LAYERS = 200;
/** All the layers' pixels together, so a file cannot ask for unbounded memory. */
const MAX_TOTAL_LAYER_PIXELS = 4 * MAX_RASTER_PIXELS;
/** What ag-psd itself may use while decoding. */
const DECODE_MEMORY_LIMIT = 1024 * 1024 * 1024;

export interface DecodedMask {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Grey outside the mask's rectangle: 0 hides, 255 shows. */
  outside: number;
  enabled: boolean;
  /** One byte a pixel. */
  grey: Uint8Array;
}

export interface DecodedLayer {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  blend: GlobalCompositeOperation;
  /** RGBA, not premultiplied. */
  pixels: Uint8ClampedArray;
  mask?: DecodedMask;
}

export interface DecodedPsd {
  width: number;
  height: number;
  /** Bottom to top. */
  layers: DecodedLayer[];
  /** The flattened image, for files without layers. */
  composite?: Uint8ClampedArray;
  guides: Guide[];
  /** What could not be brought over, worded for the user. */
  notes: string[];
}

const BLEND_MODES: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: "source-over",
  "pass through": "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  "hard light": "hard-light",
  "soft light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

/** The editor's blend mode for a Photoshop one, or null when it has none like it. */
export const blendFromPsd = (mode: BlendMode | undefined): GlobalCompositeOperation | null =>
  mode === undefined ? "source-over" : (BLEND_MODES[mode] ?? null);

/** Photoshop's name for one of the editor's blend modes. */
export function blendToPsd(operation: string): BlendMode {
  for (const [mode, op] of Object.entries(BLEND_MODES) as [BlendMode, GlobalCompositeOperation][]) {
    if (op === operation && mode !== "pass through") return mode;
  }
  return "normal";
}

/** Any bit depth, as 8-bit RGBA. */
function bytesOf(data: PixelData, length: number): Uint8ClampedArray {
  const values = data.data;
  if (values instanceof Uint8ClampedArray) return values.length === length ? values : values.slice(0, length);
  const out = new Uint8ClampedArray(length);
  if (values instanceof Uint16Array) for (let index = 0; index < length; index += 1) out[index] = values[index]! / 257;
  else if (values instanceof Float32Array) for (let index = 0; index < length; index += 1) out[index] = values[index]! * 255;
  else out.set(values.subarray(0, length));
  return out;
}

let initialized = false;
function initialize() {
  if (initialized) return;
  initialized = true;
  // Pixels only: no canvas in a worker, and none needed with raw data.
  initializeCanvas(
    () => {
      throw new Error("Canvas is not available here");
    },
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" }) as ImageData
  );
}

const fits = (width: number, height: number) =>
  width > 0 && height > 0 && width <= MAX_RASTER_SIDE && height <= MAX_RASTER_SIDE && width * height <= MAX_RASTER_PIXELS;

export function decodePsd(buffer: ArrayBuffer): DecodedPsd {
  initialize();
  const psd = readPsd(buffer, {
    useRawData: true,
    useRawThumbnail: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    imageResourcesWhitelist: ["gridAndGuidesInformation"],
    totalMemoryLimit: DECODE_MEMORY_LIMIT,
  });
  const { width, height } = psd;
  if (!fits(width, height)) {
    throw new Error(`The document is too large: at most ${MAX_RASTER_SIDE} pixels a side and ${MAX_RASTER_PIXELS / 1e6} megapixels`);
  }

  const counts = { effects: 0, adjustments: 0, clipping: 0, blend: 0, groupBlend: 0 };
  const layers: DecodedLayer[] = [];
  let seen = 0;
  let total = 0;

  const walk = (children: Layer[] | undefined, group: { visible: boolean; opacity: number }) => {
    for (const layer of children ?? []) {
      seen += 1;
      if (seen > MAX_PSD_LAYERS) throw new Error(`The document has more than ${MAX_PSD_LAYERS} layers`);
      const visible = group.visible && !layer.hidden;
      const opacity = group.opacity * (layer.opacity ?? 1);
      if (layer.children) {
        if (layer.blendMode && layer.blendMode !== "pass through" && layer.blendMode !== "normal") counts.groupBlend += 1;
        walk(layer.children, { visible, opacity });
        continue;
      }
      if (layer.adjustment) counts.adjustments += 1;
      const left = layer.left ?? 0;
      const top = layer.top ?? 0;
      const layerWidth = (layer.right ?? 0) - left;
      const layerHeight = (layer.bottom ?? 0) - top;
      if (layerWidth <= 0 || layerHeight <= 0) continue;
      if (!fits(layerWidth, layerHeight)) throw new Error(`The layer “${layer.name ?? ""}” is too large to open`);
      total += layerWidth * layerHeight;
      if (total > MAX_TOTAL_LAYER_PIXELS) throw new Error("The document's layers are too large to open together");
      const data = getLayerImageData(layer);
      if (!data || data.width !== layerWidth || data.height !== layerHeight) continue;
      if (layer.effects) counts.effects += 1;
      if (layer.clipping) counts.clipping += 1;
      let blend = blendFromPsd(layer.blendMode);
      if (!blend) {
        counts.blend += 1;
        blend = "source-over";
      }
      const decoded: DecodedLayer = {
        name: (layer.name ?? "").slice(0, 200) || `Layer ${layers.length + 1}`,
        left,
        top,
        width: layerWidth,
        height: layerHeight,
        opacity: Math.min(1, Math.max(0, opacity)),
        visible,
        blend,
        pixels: bytesOf(data, layerWidth * layerHeight * 4),
      };
      const mask = layer.mask;
      if (mask && !mask.fromVectorData) {
        const grey = getLayerMaskImageData(layer);
        const maskLeft = mask.left ?? 0;
        const maskTop = mask.top ?? 0;
        if (grey && fits(grey.width, grey.height)) {
          const rgba = bytesOf(grey, grey.width * grey.height * 4);
          const channel = new Uint8Array(grey.width * grey.height);
          for (let index = 0; index < channel.length; index += 1) channel[index] = rgba[index * 4]!;
          decoded.mask = {
            left: maskLeft,
            top: maskTop,
            width: grey.width,
            height: grey.height,
            outside: mask.defaultColor ?? 0,
            enabled: !mask.disabled,
            grey: channel,
          };
        } else if (!grey && mask.defaultColor === 0) {
          // An empty mask that hides everything.
          decoded.mask = { left, top, width: 0, height: 0, outside: 0, enabled: !mask.disabled, grey: new Uint8Array(0) };
        }
      }
      layers.push(decoded);
    }
  };
  walk(psd.children, { visible: true, opacity: 1 });

  let composite: Uint8ClampedArray | undefined;
  if (layers.length === 0) {
    const flat = getCompositeImageData(psd);
    if (flat && flat.width === width && flat.height === height) composite = bytesOf(flat, width * height * 4);
    else throw new Error("The document has no pixels the editor can open");
  }

  const guides: Guide[] = (psd.imageResources?.gridAndGuidesInformation?.guides ?? [])
    .filter((guide) => Number.isFinite(guide.location) && Math.abs(guide.location) <= 1e6)
    .slice(0, 200)
    .map((guide) => ({ axis: guide.direction === "vertical" ? "x" : "y", position: guide.location }));

  const notes: string[] = [];
  if (counts.effects) notes.push("layer effects were left out");
  if (counts.adjustments) notes.push("adjustment layers were left out");
  if (counts.clipping) notes.push("clipping masks were left out");
  if (counts.blend) notes.push("some blend modes became Normal");
  if (counts.groupBlend) notes.push("groups were flattened into their layers");
  return { width, height, layers, composite, guides, notes };
}
