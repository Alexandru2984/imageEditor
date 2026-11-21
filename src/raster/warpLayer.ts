import { ActiveSelection, FabricImage, Point, util, type Canvas as FabricCanvas } from "fabric";
import { isBackgroundObject, isEditorChrome, isMoveLocked, isObjectLocked, isPixelsLocked } from "@/utils/editorObjects";
import { MAX_RASTER_PIXELS, MAX_RASTER_SIDE } from "@/utils/flatten";
import { shownRect, sourceOf, type SourceRect } from "./documentSize";
import { hasLayerMask, hydrateLayerMask, type MaskedImage } from "./layerMask";
import { runPixelJob } from "./pixelJobClient";
import { editSession, layerPixelsPerSceneUnit, releaseSurface, surfaceToImage } from "./pixelLayer";
import { invert, isConvex, multiply, rectToQuad, type Homography, type Quad } from "./warp";

/**
 * Edit › Transform › Distort and Perspective on an image layer: its corners
 * move freely (or in pairs), and the layer's pixels are resampled onto the
 * new shape in the worker when the change is applied, as one undo step.
 */

export type WarpMode = "distort" | "perspective";

/** Why a layer cannot be distorted, worded for the user. */
export type Refusal = string;

/** The layer Distort and Perspective work on: the selected image layer. */
export function warpTarget(canvas: FabricCanvas): FabricImage | Refusal {
  const active = canvas.getActiveObject();
  if (!active || isEditorChrome(active)) return "Select an image layer to distort";
  if (active instanceof ActiveSelection) return "Select a single layer";
  if (!(active instanceof FabricImage) || isBackgroundObject(active)) return "Rasterize the layer first";
  if (isObjectLocked(active)) return "Unlock the layer first";
  if (isMoveLocked(active)) return "The layer's position is locked";
  if (isPixelsLocked(active)) return "The layer's pixels are locked";
  if (editSession(active)) return "Finish painting first";
  return active;
}

/** The layer's corners in the scene: its own top left, top right, bottom right, bottom left. */
export function layerQuad(image: FabricImage): Quad {
  const matrix = image.calcTransformMatrix();
  const halfWidth = image.width / 2;
  const halfHeight = image.height / 2;
  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ].map(([x, y]) => {
    const point = util.transformPoint(new Point(x!, y!), matrix);
    return { x: point.x, y: point.y };
  }) as unknown as Quad;
}

const sameQuad = (a: Quad, b: Quad) => a.every((corner, index) => corner.x === b[index]!.x && corner.y === b[index]!.y);

/** The pixels of `from` in `source`, as an image's data. */
function readPixels(source: CanvasImageSource, from: SourceRect): ImageData {
  const surface = document.createElement("canvas");
  surface.width = from.width;
  surface.height = from.height;
  try {
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The browser could not read the layer");
    context.drawImage(source, from.x, from.y, from.width, from.height, 0, 0, from.width, from.height);
    return context.getImageData(0, 0, from.width, from.height);
  } finally {
    releaseSurface(surface);
  }
}

async function warped(
  source: CanvasImageSource,
  from: SourceRect,
  inverse: Homography,
  width: number,
  height: number
): Promise<HTMLImageElement> {
  const pixels = readPixels(source, from);
  const result = await runPixelJob(
    { op: "warp", inverse },
    { data: pixels.data, width: from.width, height: from.height, x: 0, y: 0 },
    width,
    height,
    { x: 0, y: 0 }
  );
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the distorted layer");
  context.putImageData(new ImageData(new Uint8ClampedArray(result), width, height), 0, 0);
  try {
    return await surfaceToImage(surface);
  } finally {
    releaseSurface(surface);
  }
}

/**
 * Resample the layer onto `quad` (in the scene). Resolves false when the
 * layer went away meanwhile, or with why it could not be done.
 */
export async function applyWarp(canvas: FabricCanvas, image: FabricImage, quad: Quad): Promise<boolean | Refusal> {
  if (sameQuad(quad, layerQuad(image))) return true;
  if (!isConvex(quad)) return "The corners cross over: pull them apart first";
  const xs = quad.map((corner) => corner.x);
  const ys = quad.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const spanX = Math.max(...xs) - left;
  const spanY = Math.max(...ys) - top;
  if (!(spanX > 0 && spanY > 0)) return "The shape is too thin";
  // As many pixels per scene unit as the layer had, within the editor's limits.
  let scale = layerPixelsPerSceneUnit(image);
  scale *= Math.min(
    1,
    MAX_RASTER_SIDE / (spanX * scale),
    MAX_RASTER_SIDE / (spanY * scale),
    Math.sqrt(MAX_RASTER_PIXELS / (spanX * spanY * scale * scale))
  );
  const width = Math.max(1, Math.ceil(spanX * scale - 1e-6));
  const height = Math.max(1, Math.ceil(spanY * scale - 1e-6));

  const from = shownRect(image);
  // Result pixels → scene → the layer's own pixels.
  const toScene: Homography = [1 / scale, 0, left, 0, 1 / scale, top, 0, 0, 1];
  const inverse = multiply(invert(rectToQuad(from.width, from.height, quad)), toScene);
  const element = await warped(sourceOf(image), from, inverse, width, height);
  let mask: string | undefined;
  if (hasLayerMask(image)) {
    const grey = new Image();
    grey.src = image.layerMask.src;
    await grey.decode();
    mask = (await warped(grey, from, inverse, width, height)).src;
  }
  if (!canvas.getObjects().includes(image)) return false;

  image.set({ cropX: 0, cropY: 0, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false });
  image.setElement(element, { width, height });
  image.set({ scaleX: 1 / scale, scaleY: 1 / scale });
  const masked = image as MaskedImage;
  if (mask && masked.layerMask) {
    masked.layerMask = { src: mask, enabled: masked.layerMask.enabled };
    void hydrateLayerMask(image).then(() => canvas.requestRenderAll());
  }
  image.setPositionByOrigin(new Point(left + width / scale / 2, top + height / scale / 2), "center", "center");
  image.setCoords();
  image.dirty = true;
  canvas.fire("object:modified", { target: image });
  canvas.requestRenderAll();
  return true;
}
