import {
  getCompositeImageData,
  getLayerImageData,
  getLayerMaskImageData,
  initializeCanvas,
  readPsd,
  writePsd,
  type BlendMode,
  type Layer,
  type LayerMaskData,
  type PixelData,
} from "ag-psd";
import type { AdjustmentData } from "@/adjustments/adjustmentData";
import type { FillContent } from "@/adjustments/fillData";
import { MAX_GROUP_DEPTH } from "@/layers/layerTree";
import { MAX_RASTER_PIXELS, MAX_RASTER_SIDE } from "@/utils/flatten";
import type { Guide } from "@/utils/guideData";
import type { LayerStyle } from "@/raster/layerStyleData";
import { effectsFromPsd, effectsToPsd } from "./psdEffects";
import { adjustmentFromPsd, adjustmentToPsd, fillFromPsd, fillToPsd } from "./psdLayerContent";

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
  kind: "layer";
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
  /** Clipped to the layer (or group) below it. */
  clipped: boolean;
  /** Fill opacity, 0–1. */
  fill: number;
  /** Its layer effects, drawn by the editor (not in `pixels`). */
  style?: LayerStyle;
}

/** What adjustment and fill layers have, besides what they show. */
interface DecodedDocumentLayerBase {
  name: string;
  opacity: number;
  visible: boolean;
  blend: GlobalCompositeOperation;
  clipped: boolean;
  fill: number;
  /** In document pixels; none when it shows everywhere. */
  mask?: DecodedMask;
}

/** An adjustment layer: no pixels, only what it does to those below. */
export interface DecodedAdjustment extends DecodedDocumentLayerBase {
  kind: "adjustment";
  adjustment: AdjustmentData;
}

/** A fill layer: a colour or gradient over the whole document. */
export interface DecodedFill extends DecodedDocumentLayerBase {
  kind: "fill";
  content: FillContent;
}

/** A group's header, above its layers (as the editor keeps groups). */
export interface DecodedGroup {
  kind: "group";
  name: string;
  opacity: number;
  visible: boolean;
  /** Its layers blend straight into what is below (Photoshop's default). */
  passThrough: boolean;
  blend: GlobalCompositeOperation;
  /** Folded shut in the Layers panel. */
  collapsed: boolean;
}

/** Where a group ends, below its layers. */
export interface DecodedGroupEnd {
  kind: "end";
}

export type DecodedEntry = DecodedLayer | DecodedAdjustment | DecodedFill | DecodedGroup | DecodedGroupEnd;

export interface DecodedPsd {
  width: number;
  height: number;
  /** Bottom to top; a group is its end, its layers, then its header. */
  layers: DecodedEntry[];
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
  // Blended by the editor's own compositor.
  dissolve: "dissolve" as GlobalCompositeOperation,
  "linear burn": "linear-burn" as GlobalCompositeOperation,
  "darker color": "darker-color" as GlobalCompositeOperation,
  "linear dodge": "linear-dodge" as GlobalCompositeOperation,
  "lighter color": "lighter-color" as GlobalCompositeOperation,
  "vivid light": "vivid-light" as GlobalCompositeOperation,
  "linear light": "linear-light" as GlobalCompositeOperation,
  "pin light": "pin-light" as GlobalCompositeOperation,
  "hard mix": "hard-mix" as GlobalCompositeOperation,
  subtract: "subtract" as GlobalCompositeOperation,
  divide: "divide" as GlobalCompositeOperation,
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

/**
 * A layer's pixel mask; `at` is where an empty one that hides everything
 * goes. None for a vector mask, or one that shows everything.
 */
function maskOf(layer: Layer, at: { left: number; top: number }): DecodedMask | undefined {
  const mask = layer.mask;
  if (!mask || mask.fromVectorData) return undefined;
  const grey = getLayerMaskImageData(layer);
  if (grey && fits(grey.width, grey.height)) {
    const rgba = bytesOf(grey, grey.width * grey.height * 4);
    const channel = new Uint8Array(grey.width * grey.height);
    for (let index = 0; index < channel.length; index += 1) channel[index] = rgba[index * 4]!;
    return {
      left: mask.left ?? 0,
      top: mask.top ?? 0,
      width: grey.width,
      height: grey.height,
      outside: mask.defaultColor ?? 0,
      enabled: !mask.disabled,
      grey: channel,
    };
  }
  // An empty mask that hides everything.
  if (!grey && mask.defaultColor === 0) return { ...at, width: 0, height: 0, outside: 0, enabled: !mask.disabled, grey: new Uint8Array(0) };
  return undefined;
}

/** A fill layer the editor keeps as one: no shape, stroke or pattern. */
const isPlainFill = (layer: Layer) => !!layer.vectorFill && !layer.vectorMask && !layer.vectorStroke && layer.vectorFill.type !== "pattern";

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

  const counts = { effects: 0, simplifiedEffects: 0, adjustments: 0, simplified: 0, blend: 0, deep: 0 };
  const layers: DecodedEntry[] = [];
  let seen = 0;
  let total = 0;

  // Groups deeper than the editor keeps them are flattened: their
  // visibility and opacity go into their layers.
  const walk = (children: Layer[] | undefined, depth: number, flattened: { visible: boolean; opacity: number } | null) => {
    for (const layer of children ?? []) {
      seen += 1;
      if (seen > MAX_PSD_LAYERS) throw new Error(`The document has more than ${MAX_PSD_LAYERS} layers`);
      const visible = (flattened?.visible ?? true) && !layer.hidden;
      const opacity = Math.min(1, Math.max(0, (flattened?.opacity ?? 1) * (layer.opacity ?? 1)));
      if (layer.children) {
        if (flattened || depth >= MAX_GROUP_DEPTH) {
          counts.deep += 1;
          walk(layer.children, depth + 1, { visible, opacity });
          continue;
        }
        const passThrough = layer.blendMode === undefined || layer.blendMode === "pass through";
        let blend = passThrough ? "source-over" : blendFromPsd(layer.blendMode);
        if (!blend) {
          counts.blend += 1;
          blend = "source-over";
        }
        layers.push({ kind: "end" });
        walk(layer.children, depth + 1, null);
        layers.push({
          kind: "group",
          name: (layer.name ?? "").slice(0, 200) || "Group",
          opacity,
          visible,
          passThrough,
          blend,
          collapsed: layer.opened === false,
        });
        continue;
      }
      if (layer.adjustment || isPlainFill(layer)) {
        const adjustment = layer.adjustment ? adjustmentFromPsd(layer.adjustment) : null;
        const fill = layer.adjustment ? null : fillFromPsd(layer.vectorFill);
        if (adjustment || fill) {
          let blend = blendFromPsd(layer.blendMode);
          if (!blend) {
            counts.blend += 1;
            blend = "source-over";
          }
          if ((adjustment ?? fill)!.simplified) counts.simplified += 1;
          if (layer.effects) counts.effects += 1;
          const mask = maskOf(layer, { left: 0, top: 0 });
          if (mask) {
            total += mask.width * mask.height;
            if (total > MAX_TOTAL_LAYER_PIXELS) throw new Error("The document's layers are too large to open together");
          }
          const fillOpacity = layer.fillOpacity;
          const base = {
            name: (layer.name ?? "").slice(0, 200) || (adjustment ? "Adjustment" : "Fill"),
            opacity,
            visible,
            blend,
            clipped: layer.clipping === true,
            fill: typeof fillOpacity === "number" && Number.isFinite(fillOpacity) ? Math.min(1, Math.max(0, fillOpacity)) : 1,
            ...(mask ? { mask } : {}),
          };
          layers.push(adjustment ? { kind: "adjustment", ...base, adjustment: adjustment.value } : { kind: "fill", ...base, content: fill!.value });
          continue;
        }
        // Ones the editor has nothing like; a fill of those still has its pixels.
        if (layer.adjustment) {
          counts.adjustments += 1;
          continue;
        }
      }
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
      const effects = layer.effects ? effectsFromPsd(layer.effects) : null;
      if (layer.effects && !effects) counts.effects += 1;
      if (effects?.simplified) counts.simplifiedEffects += 1;
      let blend = blendFromPsd(layer.blendMode);
      if (!blend) {
        counts.blend += 1;
        blend = "source-over";
      }
      const fill = layer.fillOpacity;
      const decoded: DecodedLayer = {
        kind: "layer",
        name: (layer.name ?? "").slice(0, 200) || `Layer ${layers.length + 1}`,
        left,
        top,
        width: layerWidth,
        height: layerHeight,
        opacity,
        visible,
        blend,
        pixels: bytesOf(data, layerWidth * layerHeight * 4),
        clipped: layer.clipping === true,
        fill: typeof fill === "number" && Number.isFinite(fill) ? Math.min(1, Math.max(0, fill)) : 1,
      };
      if (effects) decoded.style = effects.value;
      const mask = maskOf(layer, { left, top });
      if (mask) decoded.mask = mask;
      layers.push(decoded);
    }
  };
  walk(psd.children, 0, null);

  let composite: Uint8ClampedArray | undefined;
  if (!layers.some((layer) => layer.kind === "layer" || layer.kind === "adjustment" || layer.kind === "fill")) {
    const flat = getCompositeImageData(psd);
    if (flat && flat.width === width && flat.height === height) composite = bytesOf(flat, width * height * 4);
    else throw new Error("The document has no pixels the editor can open");
  }

  const guides: Guide[] = (psd.imageResources?.gridAndGuidesInformation?.guides ?? [])
    .filter((guide) => Number.isFinite(guide.location) && Math.abs(guide.location) <= 1e6)
    .slice(0, 200)
    .map((guide) => ({ axis: guide.direction === "vertical" ? "x" : "y", position: guide.location }));

  const notes: string[] = [];
  if (counts.effects) notes.push("layer effects the editor does not have were left out");
  if (counts.simplifiedEffects) notes.push("some layer effect settings were simplified");
  if (counts.adjustments) notes.push("adjustment layers of kinds the editor does not have were left out");
  if (counts.simplified) notes.push("some adjustment and fill layer settings were simplified");
  if (counts.blend) notes.push("some blend modes became Normal");
  if (counts.deep) notes.push(`groups nested more than ${MAX_GROUP_DEPTH} deep were flattened into their layers`);
  return { width, height, layers, composite, guides, notes };
}

/** A layer to write; one without pixels has no size. */
export type LayerToWrite = Omit<DecodedLayer, "mask">;

/** A fill layer to write, with its content drawn (unmasked) for other programs. */
export type FillToWrite = DecodedFill & { left: number; top: number; width: number; height: number; pixels: Uint8ClampedArray };

/** A document to write: its layers' pixels in document pixels, bottom to top. */
export interface PsdToWrite {
  width: number;
  height: number;
  /** Bottom to top, groups as the editor keeps them (end, layers, header). */
  layers: (LayerToWrite | DecodedAdjustment | FillToWrite | DecodedGroup | DecodedGroupEnd)[];
  /** The flattened document, what other programs show. */
  composite: Uint8ClampedArray;
  /** In document pixels from the top-left corner. */
  guides: Guide[];
}

const pixelData = (width: number, height: number, data: Uint8ClampedArray) =>
  ({ width, height, data, colorSpace: "srgb" }) as unknown as ImageData;

/** A mask as Photoshop keeps it: grey from the first channel, a colour outside. */
function maskData(mask: DecodedMask): LayerMaskData {
  const data: LayerMaskData = {
    left: mask.left,
    top: mask.top,
    right: mask.left + mask.width,
    bottom: mask.top + mask.height,
    defaultColor: mask.outside,
    disabled: !mask.enabled,
  };
  if (mask.width > 0 && mask.height > 0) {
    const rgba = new Uint8ClampedArray(mask.width * mask.height * 4);
    for (let index = 0; index < mask.grey.length; index += 1) {
      const value = mask.grey[index]!;
      rgba[index * 4] = value;
      rgba[index * 4 + 1] = value;
      rgba[index * 4 + 2] = value;
      rgba[index * 4 + 3] = 255;
    }
    data.imageData = pixelData(mask.width, mask.height, rgba);
  }
  return data;
}

/** The flat list (end, layers, header for a group) as Photoshop's nested one. */
export function nestLayers(entries: PsdToWrite["layers"]): Layer[] {
  const root: Layer[] = [];
  const open: Layer[][] = [root];
  for (const entry of entries) {
    if (entry.kind === "end") {
      open.push([]);
      continue;
    }
    if (entry.kind === "group") {
      // A header without its end (never from the editor) closes nothing.
      const children = open.length > 1 ? open.pop()! : [];
      open[open.length - 1]!.push({
        name: entry.name,
        opacity: entry.opacity,
        hidden: !entry.visible,
        blendMode: entry.passThrough ? "pass through" : blendToPsd(entry.blend),
        opened: !entry.collapsed,
        children,
      });
      continue;
    }
    if (entry.kind === "adjustment") {
      const layer: Layer = {
        name: entry.name,
        opacity: entry.opacity,
        hidden: !entry.visible,
        blendMode: blendToPsd(entry.blend),
        adjustment: adjustmentToPsd(entry.adjustment),
      };
      if (entry.mask) layer.mask = maskData(entry.mask);
      if (entry.clipped) layer.clipping = true;
      if (entry.fill < 1) layer.fillOpacity = entry.fill;
      open[open.length - 1]!.push(layer);
      continue;
    }
    const layer: Layer = {
      name: entry.name,
      left: entry.left,
      top: entry.top,
      right: entry.left + entry.width,
      bottom: entry.top + entry.height,
      opacity: entry.opacity,
      hidden: !entry.visible,
      blendMode: blendToPsd(entry.blend),
    };
    if (entry.width > 0 && entry.height > 0) layer.imageData = pixelData(entry.width, entry.height, entry.pixels);
    if (entry.kind === "layer" && entry.style) {
      const effects = effectsToPsd(entry.style);
      if (effects) layer.effects = effects;
    }
    if (entry.kind === "fill") {
      layer.vectorFill = fillToPsd(entry.content);
      if (entry.mask) layer.mask = maskData(entry.mask);
    }
    if (entry.clipped) layer.clipping = true;
    if (entry.fill < 1) layer.fillOpacity = entry.fill;
    open[open.length - 1]!.push(layer);
  }
  // Ends without a header (never from the editor) leave their layers in place.
  while (open.length > 1) {
    const children = open.pop()!;
    open[open.length - 1]!.push(...children);
  }
  return root;
}

export function encodePsd(document: PsdToWrite): ArrayBuffer {
  initialize();
  return writePsd(
    {
      width: document.width,
      height: document.height,
      imageData: pixelData(document.width, document.height, document.composite),
      children: nestLayers(document.layers),
      ...(document.guides.length
        ? {
            imageResources: {
              gridAndGuidesInformation: {
                guides: document.guides.map((guide) => ({
                  location: guide.position,
                  direction: guide.axis === "x" ? ("vertical" as const) : ("horizontal" as const),
                })),
              },
            },
          }
        : {}),
    },
    // Even an opaque bottom layer stays a layer, as the editor has it.
    { generateThumbnail: false, noBackground: true }
  );
}
