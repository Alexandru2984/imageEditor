import { FabricImage, util, type Canvas as FabricCanvas, type FabricObject, type TMat2D } from "fabric";
import { findBackgroundImage, isEditorChrome } from "@/utils/editorObjects";
import { MAX_RASTER_PIXELS, MAX_RASTER_SIDE } from "@/utils/flatten";
import { documentGrid, selectionOf } from "@/selection/state";
import { hasLayerMask, hydrateLayerMask, type MaskedImage } from "./layerMask";
import { editSession, releaseSurface, surfaceToImage } from "./pixelLayer";

/**
 * Photoshop's document-wide Image commands. The document is the photo's
 * frame: Image Size resamples every pixel layer (and its mask) so the
 * document has a new number of pixels; vector layers keep their shapes.
 * Everything changes in one synchronous step, so it is one undo step.
 */

export type ResampleMethod = "bicubic" | "bilinear" | "nearest";

/** Why a command cannot run, worded for the user. */
export type Refusal = string;

/** Whether a document of this size fits what the editor can hold. */
export const fitsLimits = (width: number, height: number): boolean =>
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  width >= 1 &&
  height >= 1 &&
  width <= MAX_RASTER_SIDE &&
  height <= MAX_RASTER_SIDE &&
  width * height <= MAX_RASTER_PIXELS;

/** The document's size in pixels, or null without a photo. */
export function documentSize(canvas: FabricCanvas): { width: number; height: number } | null {
  const grid = documentGrid(canvas);
  return grid ? { width: grid.width, height: grid.height } : null;
}

/**
 * How much an object's own x and y axes lengthen when the document is
 * stretched by `sx` across and `sy` down.
 */
export function axisFactors(matrix: TMat2D, sx: number, sy: number): { x: number; y: number } {
  const [a, b, c, d] = matrix;
  const along = (x: number, y: number) => {
    const length = Math.hypot(x, y);
    return length > 0 ? Math.hypot(x * sx, y * sy) / length : 1;
  };
  return { x: along(a, b), y: along(c, d) };
}

/** A part of an image, in its pixels. */
interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Draw `from` of `source` into a new canvas of `width`×`height`. */
function resample(
  source: CanvasImageSource,
  from: SourceRect,
  width: number,
  height: number,
  method: ResampleMethod
): HTMLCanvasElement {
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the resized image");
  context.imageSmoothingEnabled = method !== "nearest";
  context.imageSmoothingQuality = method === "bicubic" ? "high" : "low";
  context.drawImage(source, from.x, from.y, from.width, from.height, 0, 0, width, height);
  return surface;
}

async function encode(surface: HTMLCanvasElement): Promise<HTMLImageElement> {
  try {
    return await surfaceToImage(surface);
  } finally {
    releaseSurface(surface);
  }
}

async function decode(src: string): Promise<HTMLImageElement> {
  const element = new Image();
  element.src = src;
  await element.decode();
  return element;
}

type ImageInternals = FabricImage & { _originalElement?: CanvasImageSource };

const sourceOf = (image: FabricImage): CanvasImageSource =>
  (image as ImageInternals)._originalElement ?? image.getElement();

/** Images drawn from vector sources stay sharp at any size; they are not resampled. */
function isRaster(image: FabricImage): boolean {
  const source = sourceOf(image);
  if (source instanceof HTMLImageElement) {
    const src = source.currentSrc || source.src;
    return !/^data:image\/svg/i.test(src) && !/\.svg(?:[?#]|$)/i.test(src);
  }
  return source instanceof HTMLCanvasElement || source instanceof ImageBitmap;
}

/** The part of an image's source it shows (its crop), in source pixels. */
const shownRect = (image: FabricImage): SourceRect => ({
  x: image.cropX ?? 0,
  y: image.cropY ?? 0,
  width: image.width,
  height: image.height,
});

interface Change {
  object: FabricObject;
  /** Where the object goes, or null to keep its transform (but `scale` it). */
  matrix: TMat2D | null;
  /** Multiplies the object's own scale, keeping its box on screen. */
  scale?: { x: number; y: number };
  /** New pixels for an image layer, and its mask's. */
  pixels?: { element: HTMLImageElement; width: number; height: number; mask?: string };
}

const busy = new WeakSet<FabricCanvas>();

const documentObjects = (canvas: FabricCanvas): FabricObject[] =>
  canvas.getObjects().filter((object) => !isEditorChrome(object));

/** Anything that stops the document from being changed as a whole. */
function refusal(canvas: FabricCanvas): Refusal | null {
  if (!findBackgroundImage(canvas) || !documentGrid(canvas)) return "Open a photo first";
  if (busy.has(canvas)) return "Wait for the last change to finish";
  const painting = documentObjects(canvas).some(
    (object) => object instanceof FabricImage && editSession(object) !== undefined
  );
  return painting ? "Finish painting first" : null;
}

/** Apply prepared changes at once (one history step) and show the document whole. */
function applyChanges(canvas: FabricCanvas, changes: Change[]) {
  for (const { object, matrix, scale, pixels } of changes) {
    if (pixels && object instanceof FabricImage) {
      object.set({ cropX: 0, cropY: 0 });
      object.setElement(pixels.element, { width: pixels.width, height: pixels.height });
      const masked = object as MaskedImage;
      if (pixels.mask && masked.layerMask) {
        masked.layerMask = { src: pixels.mask, enabled: masked.layerMask.enabled };
        void hydrateLayerMask(object).then(() => canvas.requestRenderAll());
      }
    }
    if (matrix) util.applyTransformToObject(object, matrix);
    else if (scale) object.set({ scaleX: object.scaleX * scale.x, scaleY: object.scaleY * scale.y });
    object.setCoords();
    object.dirty = true;
  }
  // The selection was drawn on the old pixel grid.
  selectionOf(canvas).set(null);
  const photo = findBackgroundImage(canvas);
  canvas.fire("object:modified", photo ? { target: photo } : undefined);
  canvas.requestRenderAll();
}

/** Whether every object a plan was made from is still there, and nothing else. */
function unchanged(canvas: FabricCanvas, objects: FabricObject[]): boolean {
  const now = documentObjects(canvas);
  return now.length === objects.length && now.every((object, index) => object === objects[index]);
}

/**
 * Image › Image Size: give the document `width`×`height` pixels. Pixel layers
 * are resampled by `method`; the document keeps its place on screen.
 * Resolves false when the document changed meanwhile.
 */
export async function resizeImage(
  canvas: FabricCanvas,
  request: { width: number; height: number; method: ResampleMethod }
): Promise<boolean | Refusal> {
  const refused = refusal(canvas);
  if (refused) return refused;
  if (!fitsLimits(request.width, request.height)) return "That size is too big for the editor";
  const grid = documentGrid(canvas)!;
  const sx = request.width / grid.width;
  const sy = request.height / grid.height;
  busy.add(canvas);
  try {
    // Layers inside a multiple selection are positioned relative to it.
    canvas.discardActiveObject();
    const objects = documentObjects(canvas);
    // On screen the document keeps its width and stretches down by sy/sx.
    const stretch = sy / sx;
    const toScene: TMat2D = [1, 0, 0, stretch, 0, grid.top * (1 - stretch)];
    const stretched = Math.abs(stretch - 1) > 1e-9;
    const changes: Change[] = [];
    for (const object of objects) {
      const before = object.calcTransformMatrix();
      let matrix = util.multiplyTransformMatrices(toScene, before);
      let scale: Change["scale"];
      let pixels: Change["pixels"];
      if (object instanceof FabricImage && isRaster(object)) {
        const factors = axisFactors(before, sx, sy);
        const from = shownRect(object);
        const width = Math.max(1, Math.min(MAX_RASTER_SIDE, Math.round(from.width * factors.x)));
        const height = Math.max(1, Math.min(MAX_RASTER_SIDE, Math.round(from.height * factors.y)));
        const element = await encode(resample(sourceOf(object), from, width, height, request.method));
        let mask: string | undefined;
        if (hasLayerMask(object)) {
          const grey = await decode(object.layerMask.src);
          mask = (await encode(resample(grey, from, width, height, request.method === "nearest" ? "nearest" : "bicubic"))).src;
        }
        pixels = { element, width, height, mask };
        // The same size on screen from the new number of pixels.
        scale = { x: from.width / width, y: from.height / height };
        matrix = util.multiplyTransformMatrices(matrix, [scale.x, 0, 0, scale.y, 0, 0]);
      }
      // Unstretched, a transform stays as it is (flips stay flips), unless a
      // skew would make scaling it apart from its shape.
      const kept = !stretched && !object.skewX && !object.skewY;
      if (kept && !pixels) continue;
      changes.push(kept ? { object, matrix: null, scale, pixels } : { object, matrix, pixels });
    }
    if (!unchanged(canvas, objects)) return false;
    applyChanges(canvas, changes);
    return true;
  } finally {
    busy.delete(canvas);
  }
}
