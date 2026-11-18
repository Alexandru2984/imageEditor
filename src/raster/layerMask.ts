import { ActiveSelection, FabricImage, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import {
  ensureLayerId,
  findBackgroundImage,
  isEditorChrome,
  isObjectLocked,
  type EditorFabricObject,
} from "@/utils/editorObjects";
import { selectionClip } from "@/selection/clip";
import type { PixelSelection } from "@/selection/state";
import { greyToAlpha } from "./maskPixels";
import {
  beginPixelEdit,
  commitPixelEdit,
  linkPixelOwner,
  refreshPixelLayer,
  releaseSurface,
  surfaceToImage,
  type PixelRect,
} from "./pixelLayer";

/**
 * Layer masks, as in Photoshop: a grey image over a layer where white shows
 * the layer and black hides it. The document keeps it as `layerMask` (a PNG
 * and whether it is on), so history, autosave and project files carry it like
 * any image. While editing, the grey pixels live on a stand-in image laid
 * exactly over the layer, which the paint tools paint on like on any layer.
 *
 * Drawing a masked layer composites it with the mask at the resolution it is
 * drawn at (screen or export), so it stays as sharp as an unmasked layer;
 * Fabric's own clipPath would go through an object cache capped at a few
 * megapixels.
 */

export interface LayerMaskData {
  /** The grey mask as a PNG data URL. */
  src: string;
  enabled: boolean;
}

export type MaskedImage = FabricImage & { layerMask?: LayerMaskData };

/** Why a mask command cannot run, worded for the user. */
export type Refusal = string;

export const hasLayerMask = (object: unknown): object is MaskedImage & { layerMask: LayerMaskData } =>
  object instanceof FabricImage && typeof (object as MaskedImage).layerMask?.src === "string";

type ImageInternals = FabricImage & {
  _renderFill(ctx: CanvasRenderingContext2D): void;
  _originalElement?: HTMLImageElement | HTMLCanvasElement;
};

const sizeOf = (image: FabricImage) => {
  const element = (image as ImageInternals)._originalElement ?? image.getElement();
  const source = element as HTMLImageElement | HTMLCanvasElement | undefined;
  return {
    width: (source as HTMLImageElement | undefined)?.naturalWidth || source?.width || 0,
    height: (source as HTMLImageElement | undefined)?.naturalHeight || source?.height || 0,
  };
};

// ---------- The mask while the editor runs ----------

interface MaskRuntime {
  src: string;
  /** The grey pixels, laid over the layer, for the paint tools. */
  pixels: FabricImage;
  /** The mask as alpha, for drawing; made from the grey pixels. */
  alpha: HTMLCanvasElement | null;
  /** The grey image `alpha` was made from. */
  alphaFrom: CanvasImageSource | null;
  /** What of `alpha` is out of date. */
  stale: PixelRect | "all" | null;
}

const runtimes = new WeakMap<FabricImage, MaskRuntime>();
const loading = new WeakMap<FabricImage, Promise<void>>();

const union = (a: PixelRect | "all" | null, b: PixelRect | undefined): PixelRect | "all" => {
  if (!b || a === "all") return "all";
  if (!a) return b;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
};

function createRuntime(layer: MaskedImage, element: HTMLImageElement): MaskRuntime {
  const pixels = new FabricImage(element, { originX: "left", originY: "top" });
  const runtime: MaskRuntime = { src: element.src, pixels, alpha: null, alphaFrom: null, stale: "all" };
  linkPixelOwner(pixels, {
    owner: layer,
    // The working copy shows the same mask, so the alpha stays valid.
    began: (surface) => {
      runtime.alphaFrom = surface;
    },
    changed: (rect) => {
      runtime.stale = union(runtime.stale, rect);
    },
    committed: (committed) => {
      runtime.alphaFrom = committed;
      runtime.src = committed.src;
      layer.layerMask = { src: committed.src, enabled: layer.layerMask?.enabled ?? true };
    },
  });
  runtimes.set(layer, runtime);
  return runtime;
}

async function decodeImage(src: string): Promise<HTMLImageElement> {
  const element = new Image();
  element.src = src;
  await element.decode();
  return element;
}

/** Load a layer's mask for drawing and editing (once per mask image). */
export function hydrateLayerMask(layer: FabricImage): Promise<void> {
  const data = (layer as MaskedImage).layerMask;
  if (!data?.src || runtimes.get(layer)?.src === data.src) return Promise.resolve();
  const pending = loading.get(layer);
  if (pending) return pending;
  const promise = decodeImage(data.src)
    .then((element) => {
      if ((layer as MaskedImage).layerMask?.src !== data.src) return;
      createRuntime(layer, element);
      layer.dirty = true;
      layer.canvas?.requestRenderAll();
    })
    .catch((error) => {
      // The layer stays hidden rather than showing what the mask covers.
      console.error("Could not load a layer mask:", error);
    })
    .finally(() => loading.delete(layer));
  loading.set(layer, promise);
  return promise;
}

function newCanvas(width: number, height: number, options?: CanvasRenderingContext2DSettings) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d", options);
  if (!context) throw new Error("The browser could not prepare the layer mask");
  return { element, context };
}

/** Bring a part of the alpha up to date from the grey pixels. */
function convert(alpha: HTMLCanvasElement, source: CanvasImageSource, rect: PixelRect) {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return;
  let pixels: ImageData;
  if (source instanceof HTMLCanvasElement) {
    const context = source.getContext("2d");
    if (!context) return;
    pixels = context.getImageData(rect.left, rect.top, width, height);
  } else {
    const { element, context } = newCanvas(width, height, { willReadFrequently: true });
    try {
      context.drawImage(source, rect.left, rect.top, width, height, 0, 0, width, height);
      pixels = context.getImageData(0, 0, width, height);
    } finally {
      releaseSurface(element);
    }
  }
  greyToAlpha(pixels.data);
  alpha.getContext("2d")?.putImageData(pixels, rect.left, rect.top);
}

function alphaOf(runtime: MaskRuntime): HTMLCanvasElement {
  const source = ((runtime.pixels as ImageInternals)._originalElement ??
    runtime.pixels.getElement()) as CanvasImageSource;
  const { width, height } = sizeOf(runtime.pixels);
  if (!runtime.alpha || runtime.alpha.width !== width || runtime.alpha.height !== height) {
    if (runtime.alpha) releaseSurface(runtime.alpha);
    runtime.alpha = newCanvas(width, height).element;
    runtime.stale = "all";
  } else if (runtime.alphaFrom !== source) {
    runtime.stale = "all";
  }
  runtime.alphaFrom = source;
  if (runtime.stale) {
    const rect = runtime.stale === "all" ? { left: 0, top: 0, right: width, bottom: height } : runtime.stale;
    runtime.stale = null;
    convert(runtime.alpha, source, {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(width, rect.right),
      bottom: Math.min(height, rect.bottom),
    });
  }
  return runtime.alpha;
}

/** The mask to draw a layer through: none, not loaded yet, or its alpha. */
function maskToDraw(image: FabricImage): HTMLCanvasElement | "none" | "loading" {
  const data = (image as MaskedImage).layerMask;
  if (!data?.src || !data.enabled) return "none";
  const runtime = runtimes.get(image);
  if (!runtime || runtime.src !== data.src) {
    void hydrateLayerMask(image);
    return "loading";
  }
  return alphaOf(runtime);
}

// ---------- Drawing ----------

/** Above this many pixels the work canvas is freed after each use. */
const KEEP_SCRATCH_PIXELS = 4_000_000;
let scratch: HTMLCanvasElement | null = null;

function scratchFor(width: number, height: number) {
  if (width * height > KEEP_SCRATCH_PIXELS) return { element: newCanvas(width, height).element, temporary: true };
  scratch ??= document.createElement("canvas");
  if (scratch.width < width || scratch.height < height) {
    scratch.width = Math.max(scratch.width, width);
    scratch.height = Math.max(scratch.height, height);
  }
  return { element: scratch, temporary: false };
}

/**
 * Draw an image through its mask: the image and the mask go onto a work
 * canvas at the target's resolution, covering only the part in view, and the
 * result is drawn with the target's opacity, blending and shadow.
 */
function drawMasked(
  image: FabricImage,
  ctx: CanvasRenderingContext2D,
  alpha: HTMLCanvasElement,
  drawImage: (target: CanvasRenderingContext2D) => void
) {
  const m = ctx.getTransform();
  const halfWidth = image.width / 2;
  const halfHeight = image.height / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ] as const) {
    xs.push(m.a * x + m.c * y + m.e);
    ys.push(m.b * x + m.d * y + m.f);
  }
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return;

  const work = scratchFor(width, height);
  const context = work.element.getContext("2d");
  if (!context) return;
  try {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.setTransform(m.a, m.b, m.c, m.d, m.e - left, m.f - top);
    context.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
    context.imageSmoothingQuality = ctx.imageSmoothingQuality;
    drawImage(context);
    // The mask spans the whole original image, crop or not.
    const size = sizeOf(image);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(alpha, -halfWidth - (image.cropX ?? 0), -halfHeight - (image.cropY ?? 0), size.width, size.height);
    context.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(work.element, 0, 0, width, height, left, top, width, height);
    ctx.restore();
  } finally {
    if (work.temporary) releaseSurface(work.element);
  }
}

let installed = false;

/** Teach Fabric's images to draw through their masks and load them. */
export function installLayerMasks(): void {
  if (installed) return;
  installed = true;
  const prototype = FabricImage.prototype as unknown as ImageInternals;
  const renderFill = prototype._renderFill;
  prototype._renderFill = function (this: FabricImage, ctx: CanvasRenderingContext2D) {
    const mask = maskToDraw(this);
    if (mask === "none") {
      renderFill.call(this, ctx);
      return;
    }
    // Until the mask is loaded nothing shows, rather than what it hides.
    if (mask === "loading") return;
    drawMasked(this, ctx, mask, (target) => renderFill.call(this, target));
  };

  // Documents, undo steps and copies all come back through fromObject: the
  // mask is loaded before the layer joins the canvas.
  const images = FabricImage as unknown as { fromObject: (...args: unknown[]) => Promise<FabricImage> };
  const fromObject = images.fromObject;
  images.fromObject = async function (this: unknown, ...args: unknown[]) {
    const image = await fromObject.apply(this, args);
    await hydrateLayerMask(image);
    return image;
  };
}

// ---------- Commands ----------

/** The layer mask commands act on: the selected image layer, else the photo. */
export function maskLayer(canvas: FabricCanvas): MaskedImage | Refusal {
  const active = canvas.getActiveObject();
  const layer = active && !isEditorChrome(active) ? active : findBackgroundImage(canvas);
  if (!layer) return "Open a photo first";
  if (layer instanceof ActiveSelection) return "Select a single layer first";
  if (!(layer instanceof FabricImage)) return "Rasterize the layer first (Layer › Rasterize)";
  if (isObjectLocked(layer)) return "Unlock the layer first";
  return layer;
}

export type MaskContent = "reveal" | "hide" | { selection: PixelSelection; hide?: boolean };

/** Give a layer a new mask: all white, all black, or from a selection. */
export async function addLayerMask(canvas: FabricCanvas, layer: MaskedImage, content: MaskContent): Promise<boolean> {
  const { width, height } = sizeOf(layer);
  if (width <= 0 || height <= 0) throw new Error("This layer has no pixels to mask");
  const { element: surface, context } = newCanvas(width, height);
  let element: HTMLImageElement;
  try {
    if (typeof content === "string") {
      context.fillStyle = content === "reveal" ? "#ffffff" : "#000000";
      context.fillRect(0, 0, width, height);
    } else {
      // The selection, drawn into the layer's pixels, as white with alpha.
      const clip = selectionClip(layer, content.selection, width, height);
      context.fillStyle = content.hide ? "#ffffff" : "#000000";
      context.fillRect(0, 0, width, height);
      if (content.hide) {
        context.globalCompositeOperation = "destination-out";
        context.drawImage(clip, 0, 0);
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "#000000";
        context.fillRect(0, 0, width, height);
      } else {
        context.drawImage(clip, 0, 0);
      }
    }
    element = await surfaceToImage(surface);
  } finally {
    releaseSurface(surface);
  }
  if (!canvas.getObjects().includes(layer)) return false;
  layer.layerMask = { src: element.src, enabled: true };
  createRuntime(layer, element);
  layer.dirty = true;
  canvas.requestRenderAll();
  canvas.fire("object:modified", { target: layer });
  return true;
}

/** Turn a layer's mask off (the layer shows whole) or back on. */
export function setLayerMaskEnabled(canvas: FabricCanvas, layer: MaskedImage, enabled: boolean): void {
  if (!layer.layerMask || layer.layerMask.enabled === enabled) return;
  layer.layerMask = { ...layer.layerMask, enabled };
  layer.dirty = true;
  canvas.requestRenderAll();
  canvas.fire("object:modified", { target: layer });
}

function forgetMask(canvas: FabricCanvas, layer: MaskedImage) {
  const runtime = runtimes.get(layer);
  if (runtime?.alpha) releaseSurface(runtime.alpha);
  runtimes.delete(layer);
  layer.layerMask = undefined;
  if (maskTargetOf(canvas).isTarget(layer)) maskTargetOf(canvas).set(null);
}

/** Throw a layer's mask away; the layer shows whole again. */
export function deleteLayerMask(canvas: FabricCanvas, layer: MaskedImage): void {
  if (!layer.layerMask) return;
  forgetMask(canvas, layer);
  layer.dirty = true;
  canvas.requestRenderAll();
  canvas.fire("object:modified", { target: layer });
}

/** Make the mask permanent: hidden pixels are erased and the mask goes. */
export async function applyLayerMask(canvas: FabricCanvas, layer: MaskedImage): Promise<boolean> {
  if (!hasLayerMask(layer)) return false;
  await hydrateLayerMask(layer);
  const runtime = runtimes.get(layer);
  if (!runtime) throw new Error("The layer mask could not be loaded");
  const enabled = layer.layerMask.enabled;
  if (enabled) {
    const alpha = alphaOf(runtime);
    const { surface, context } = beginPixelEdit(layer);
    context.save();
    context.globalCompositeOperation = "destination-in";
    context.drawImage(alpha, 0, 0, surface.width, surface.height);
    context.restore();
  }
  forgetMask(canvas, layer);
  if (!enabled) {
    // A mask that is off changes nothing when applied.
    layer.dirty = true;
    canvas.requestRenderAll();
    canvas.fire("object:modified", { target: layer });
    return true;
  }
  refreshPixelLayer(layer, canvas);
  return commitPixelEdit(canvas, layer);
}

/** Swap what a mask shows and hides. */
export async function invertLayerMask(canvas: FabricCanvas, layer: MaskedImage): Promise<boolean> {
  const pixels = await layerMaskPixels(layer);
  if (!pixels) return false;
  const { surface, context } = beginPixelEdit(pixels);
  context.save();
  // Erased mask pixels count as white; settle them first.
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, surface.width, surface.height);
  context.globalCompositeOperation = "difference";
  context.fillRect(0, 0, surface.width, surface.height);
  context.restore();
  refreshPixelLayer(pixels, canvas);
  return commitPixelEdit(canvas, pixels);
}

/**
 * The mask's grey pixels laid exactly over the layer, for the paint tools:
 * scene points map to mask pixels as they map to the layer's.
 */
export async function layerMaskPixels(layer: FabricImage): Promise<FabricImage | null> {
  if (!hasLayerMask(layer)) return null;
  await hydrateLayerMask(layer);
  return currentMaskPixels(layer);
}

/** {@link layerMaskPixels} for a mask that is already loaded. */
export function currentMaskPixels(layer: FabricImage): FabricImage | null {
  if (!hasLayerMask(layer)) return null;
  const runtime = runtimes.get(layer);
  if (!runtime || runtime.src !== layer.layerMask.src) {
    void hydrateLayerMask(layer);
    return null;
  }
  const { pixels } = runtime;
  const layerSize = sizeOf(layer);
  const maskSize = sizeOf(pixels);
  const rx = layerSize.width > 0 ? maskSize.width / layerSize.width : 1;
  const ry = layerSize.height > 0 ? maskSize.height / layerSize.height : 1;
  pixels.set({
    left: layer.left,
    top: layer.top,
    originX: layer.originX,
    originY: layer.originY,
    angle: layer.angle,
    skewX: layer.skewX,
    skewY: layer.skewY,
    flipX: layer.flipX,
    flipY: layer.flipY,
    width: layer.width * rx,
    height: layer.height * ry,
    cropX: (layer.cropX ?? 0) * rx,
    cropY: (layer.cropY ?? 0) * ry,
    scaleX: layer.scaleX / rx,
    scaleY: layer.scaleY / ry,
  });
  pixels.setCoords();
  return pixels;
}

const thumbnails = new Map<string, string>();
const MAX_THUMBNAILS = 64;

/** A small picture of a layer's mask, black and white, for the Layers panel. */
export function layerMaskThumbnail(layer: FabricImage, size = 40): string {
  if (!hasLayerMask(layer)) return "";
  const runtime = runtimes.get(layer);
  if (!runtime || runtime.src !== layer.layerMask.src) return "";
  const cached = thumbnails.get(runtime.src);
  if (cached !== undefined) return cached;
  const alpha = alphaOf(runtime);
  const scale = Math.min(1, size / Math.max(alpha.width, alpha.height, 1));
  const width = Math.max(1, Math.round(alpha.width * scale));
  const height = Math.max(1, Math.round(alpha.height * scale));
  const { element, context } = newCanvas(width, height);
  try {
    context.fillStyle = "#000000";
    context.fillRect(0, 0, width, height);
    context.drawImage(alpha, 0, 0, width, height);
    const url = element.toDataURL("image/png");
    thumbnails.set(runtime.src, url);
    if (thumbnails.size > MAX_THUMBNAILS) thumbnails.delete(thumbnails.keys().next().value!);
    return url;
  } finally {
    releaseSurface(element);
  }
}

// ---------- Painting on the mask ----------

/**
 * Which layer's mask the paint tools work on, as clicking a mask thumbnail
 * picks it in Photoshop. Choosing another layer goes back to its pixels.
 */
export class MaskTarget {
  private layerId: string | null = null;
  private readonly listeners = new Set<() => void>();
  version = 0;

  constructor(private readonly canvas: FabricCanvas) {
    const onSelection = () => {
      const active = canvas.getActiveObject() as EditorFabricObject | undefined;
      if (active && active.__layerId !== this.layerId) this.set(null);
    };
    canvas.on("selection:created", onSelection);
    canvas.on("selection:updated", onSelection);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The layer whose mask is being painted, if it still has one. */
  layer(): MaskedImage | null {
    if (!this.layerId) return null;
    const layer = this.canvas
      .getObjects()
      .find((object) => (object as EditorFabricObject).__layerId === this.layerId);
    return hasLayerMask(layer) ? layer : null;
  }

  isTarget(layer: FabricObject | null | undefined): boolean {
    return !!layer && this.layer() === layer;
  }

  set(layer: FabricObject | null): void {
    const id = layer && hasLayerMask(layer) ? ensureLayerId(layer) : null;
    if (id === this.layerId) return;
    this.layerId = id;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

const targets = new WeakMap<FabricCanvas, MaskTarget>();

export function maskTargetOf(canvas: FabricCanvas): MaskTarget {
  let target = targets.get(canvas);
  if (!target) {
    target = new MaskTarget(canvas);
    targets.set(canvas, target);
  }
  return target;
}
