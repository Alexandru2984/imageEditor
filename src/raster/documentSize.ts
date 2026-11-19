import { FabricImage, Point, util, type Canvas as FabricCanvas, type FabricObject, type TMat2D } from "fabric";
import { findBackgroundImage, isEditorChrome } from "@/utils/editorObjects";
import { MAX_RASTER_PIXELS, MAX_RASTER_SIDE, renderObjectsRegion } from "@/utils/flatten";
import { documentGrid, selectionOf } from "@/selection/state";
import { hasLayerMask, hydrateLayerMask, type MaskedImage } from "./layerMask";
import { editSession, releaseSurface, surfaceToImage } from "./pixelLayer";

/**
 * Photoshop's document-wide Image commands. The document is the photo's
 * frame: Image Size resamples every pixel layer (and its mask) so the
 * document has a new number of pixels; vector layers keep their shapes.
 * Canvas Size, Trim and Reveal All move the frame's edges instead: the photo
 * gains or loses pixels there and the other layers stay where they are.
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

// ---------- Canvas Size, Trim, Reveal All ----------

/** A rectangle in document pixels; it may reach past the document. */
export interface DocumentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the old document sits in a new canvas: 0 at the start, 1 at the end. */
export type Anchor = { x: 0 | 0.5 | 1; y: 0 | 0.5 | 1 };

/** The new canvas, around the old document, for Canvas Size. */
export function anchoredRect(
  current: { width: number; height: number },
  size: { width: number; height: number },
  anchor: Anchor
): DocumentRect {
  return {
    left: -Math.round((size.width - current.width) * anchor.x),
    top: -Math.round((size.height - current.height) * anchor.y),
    width: size.width,
    height: size.height,
  };
}

export type TrimBasis = "transparent" | "topLeft" | "bottomRight";

/**
 * What Trim keeps: the smallest rectangle around every pixel that is not
 * transparent (or not the colour of the chosen corner). Null when nothing is
 * left.
 */
export function trimBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  basis: TrimBasis
): DocumentRect | null {
  const corner = basis === "bottomRight" ? (width * height - 1) * 4 : 0;
  const reference = data.slice(corner, corner + 4);
  const kept =
    basis === "transparent"
      ? (at: number) => data[at + 3]! > 0
      : (at: number) =>
          data[at] !== reference[0] ||
          data[at + 1] !== reference[1] ||
          data[at + 2] !== reference[2] ||
          data[at + 3] !== reference[3];
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    let at = y * width * 4;
    for (let x = 0; x < width; x += 1, at += 4) {
      if (!kept(at)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  return right < 0 ? null : { left, top, width: right + 1 - left, height: bottom + 1 - top };
}

/**
 * Make `rect` (in the current document's pixels) the document: the photo is
 * cut down or extended there, the new area filled with `fill` (or left
 * transparent), and every other layer stays put.
 */
export async function recanvas(
  canvas: FabricCanvas,
  rect: DocumentRect,
  fill: string | null
): Promise<boolean | Refusal> {
  const refused = refusal(canvas);
  if (refused) return refused;
  if (!fitsLimits(rect.width, rect.height)) return "That size is too big for the editor";
  const photo = findBackgroundImage(canvas)!;
  const grid = documentGrid(canvas)!;
  if ((photo.angle ?? 0) % 90 !== 0 || photo.skewX || photo.skewY) return "Straighten the photo first";
  busy.add(canvas);
  try {
    canvas.discardActiveObject();
    const objects = documentObjects(canvas);
    // The rectangle in the photo's own pixels, counted from its crop.
    const matrix = photo.calcTransformMatrix();
    const inverse = util.invertTransform(matrix);
    const toPhoto = (x: number, y: number) => {
      const local = util.transformPoint(new Point(grid.left + x / grid.scale, grid.top + y / grid.scale), inverse);
      return { x: local.x + photo.width / 2, y: local.y + photo.height / 2 };
    };
    const corners = [
      toPhoto(rect.left, rect.top),
      toPhoto(rect.left + rect.width, rect.top + rect.height),
    ];
    const left = Math.round(Math.min(corners[0]!.x, corners[1]!.x));
    const top = Math.round(Math.min(corners[0]!.y, corners[1]!.y));
    const width = Math.max(1, Math.round(Math.abs(corners[1]!.x - corners[0]!.x)));
    const height = Math.max(1, Math.round(Math.abs(corners[1]!.y - corners[0]!.y)));
    const from = shownRect(photo);

    const extend = (source: CanvasImageSource, colour: string | null) => {
      const surface = document.createElement("canvas");
      surface.width = width;
      surface.height = height;
      const context = surface.getContext("2d");
      if (!context) throw new Error("The browser could not prepare the new canvas");
      if (colour) {
        context.fillStyle = colour;
        context.fillRect(0, 0, width, height);
        // Only the new area: the photo's own transparency stays.
        context.clearRect(-left, -top, from.width, from.height);
      }
      context.drawImage(source, from.x, from.y, from.width, from.height, -left, -top, from.width, from.height);
      return surface;
    };
    const element = await encode(extend(sourceOf(photo), fill));
    let mask: string | undefined;
    if (hasLayerMask(photo)) {
      // New area shows: a mask grows with white.
      mask = (await encode(extend(await decode(photo.layerMask.src), "#ffffff"))).src;
    }
    if (!unchanged(canvas, objects)) return false;

    const centre = util.transformPoint(
      new Point(left + width / 2 - photo.width / 2, top + height / 2 - photo.height / 2),
      matrix
    );
    photo.set({ cropX: 0, cropY: 0 });
    photo.setElement(element, { width, height });
    const masked = photo as MaskedImage;
    if (mask && masked.layerMask) {
      masked.layerMask = { src: mask, enabled: masked.layerMask.enabled };
      void hydrateLayerMask(photo).then(() => canvas.requestRenderAll());
    }
    photo.setPositionByOrigin(centre, "center", "center");
    photo.setCoords();
    photo.dirty = true;
    selectionOf(canvas).set(null);
    canvas.fire("object:modified", { target: photo });
    canvas.requestRenderAll();
    return true;
  } finally {
    busy.delete(canvas);
  }
}

/** The document as it shows, at its own pixels. */
function renderDocument(canvas: FabricCanvas): ImageData {
  const grid = documentGrid(canvas)!;
  const { element } = renderObjectsRegion(
    canvas,
    { left: grid.left, top: grid.top, width: grid.width / grid.scale, height: grid.height / grid.scale },
    grid.scale,
    (object) => !isEditorChrome(object) && object.visible !== false
  );
  try {
    const context = element.getContext("2d");
    if (!context) throw new Error("The browser could not read the document");
    return context.getImageData(0, 0, element.width, element.height);
  } finally {
    releaseSurface(element);
  }
}

/** Image › Trim: cut the document down to what is not transparent (or a corner's colour). */
export async function trim(canvas: FabricCanvas, basis: TrimBasis): Promise<boolean | Refusal> {
  const refused = refusal(canvas);
  if (refused) return refused;
  const image = renderDocument(canvas);
  const kept = trimBounds(image.data, image.width, image.height, basis);
  if (!kept) return "Nothing would be left";
  if (kept.left === 0 && kept.top === 0 && kept.width === image.width && kept.height === image.height) {
    return "There is nothing to trim";
  }
  return recanvas(canvas, kept, null);
}

/** Image › Reveal All: grow the document to show every layer whole. */
export async function revealAll(canvas: FabricCanvas, fill: string | null): Promise<boolean | Refusal> {
  const refused = refusal(canvas);
  if (refused) return refused;
  const grid = documentGrid(canvas)!;
  let left = 0;
  let top = 0;
  let right = grid.width;
  let bottom = grid.height;
  for (const object of documentObjects(canvas)) {
    if (object.visible === false) continue;
    object.setCoords();
    const box = object.getBoundingRect();
    left = Math.min(left, Math.floor((box.left - grid.left) * grid.scale + 1e-6));
    top = Math.min(top, Math.floor((box.top - grid.top) * grid.scale + 1e-6));
    right = Math.max(right, Math.ceil((box.left + box.width - grid.left) * grid.scale - 1e-6));
    bottom = Math.max(bottom, Math.ceil((box.top + box.height - grid.top) * grid.scale - 1e-6));
  }
  if (left === 0 && top === 0 && right === grid.width && bottom === grid.height) {
    return "Every layer already shows whole";
  }
  return recanvas(canvas, { left, top, width: right - left, height: bottom - top }, fill);
}

// ---------- Rotate Canvas ----------

/**
 * Image › Rotate Canvas by any angle (clockwise for positive degrees): every
 * layer turns around the photo's centre, and the photo's pixels are turned
 * onto an upright canvas big enough for them, its corners filled with `fill`
 * (or left transparent), so the document stays a rectangle.
 */
export async function rotateDocument(
  canvas: FabricCanvas,
  degrees: number,
  fill: string | null
): Promise<boolean | Refusal> {
  const refused = refusal(canvas);
  if (refused) return refused;
  if (!Number.isFinite(degrees) || degrees % 360 === 0) return "Choose an angle to rotate by";
  const photo = findBackgroundImage(canvas)!;
  busy.add(canvas);
  try {
    canvas.discardActiveObject();
    const objects = documentObjects(canvas);
    const pivot = photo.getCenterPoint();
    const radians = (degrees * Math.PI) / 180;
    const turn: TMat2D = [
      Math.cos(radians),
      Math.sin(radians),
      -Math.sin(radians),
      Math.cos(radians),
      pivot.x - pivot.x * Math.cos(radians) + pivot.y * Math.sin(radians),
      pivot.y - pivot.x * Math.sin(radians) - pivot.y * Math.cos(radians),
    ];

    // The photo's pixels, turned as they will show, onto an upright canvas.
    const after = util.multiplyTransformMatrices(turn, photo.calcTransformMatrix());
    const scale = Math.sqrt(Math.abs(after[0] * after[3] - after[1] * after[2]));
    // Quarter turns land exactly on whole pixels.
    const exact = (value: number) => (Math.abs(value - Math.round(value)) < 1e-9 ? Math.round(value) : value);
    const linear: TMat2D = [
      exact(after[0] / scale),
      exact(after[1] / scale),
      exact(after[2] / scale),
      exact(after[3] / scale),
      0,
      0,
    ];
    const from = shownRect(photo);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => util.transformPoint(new Point((x! * from.width) / 2, (y! * from.height) / 2), linear));
    const spanX = Math.max(...corners.map((point) => Math.abs(point.x))) * 2;
    const spanY = Math.max(...corners.map((point) => Math.abs(point.y))) * 2;
    const width = Math.max(1, Math.ceil(spanX - 1e-6));
    const height = Math.max(1, Math.ceil(spanY - 1e-6));
    if (!fitsLimits(width, height)) return "The rotated photo would be too big for the editor";

    const turned = (source: CanvasImageSource, colour: string | null, cornersOnly: boolean) => {
      const surface = document.createElement("canvas");
      surface.width = width;
      surface.height = height;
      const context = surface.getContext("2d");
      if (!context) throw new Error("The browser could not prepare the rotated photo");
      // Bilinear: Chrome's "high" filter softens even pixels that land
      // exactly on pixels.
      context.imageSmoothingQuality = "low";
      if (colour) {
        context.fillStyle = colour;
        context.beginPath();
        context.rect(0, 0, width, height);
        if (cornersOnly) {
          // Leave out the photo (less half a pixel, which the photo covers
          // again), so its own transparency stays.
          const inset = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([x, y]) =>
            util.transformPoint(new Point(x! * (from.width / 2 - 0.5), y! * (from.height / 2 - 0.5)), linear)
          );
          context.moveTo(width / 2 + inset[0]!.x, height / 2 + inset[0]!.y);
          for (const point of inset.slice(1)) context.lineTo(width / 2 + point.x, height / 2 + point.y);
          context.closePath();
        }
        context.fill("evenodd");
      }
      context.setTransform(linear[0], linear[1], linear[2], linear[3], width / 2, height / 2);
      context.drawImage(
        source,
        from.x,
        from.y,
        from.width,
        from.height,
        -from.width / 2,
        -from.height / 2,
        from.width,
        from.height
      );
      return surface;
    };
    const element = await encode(turned(sourceOf(photo), fill, true));
    let mask: string | undefined;
    if (hasLayerMask(photo)) {
      // The new corners show.
      mask = (await encode(turned(await decode(photo.layerMask.src), "#ffffff", false))).src;
    }
    if (!unchanged(canvas, objects)) return false;

    for (const object of objects) {
      if (object === photo) continue;
      const centre = util.transformPoint(object.getCenterPoint(), turn);
      object.rotate((((object.angle ?? 0) + degrees) % 360 + 360) % 360);
      object.setPositionByOrigin(centre, "center", "center");
      object.setCoords();
    }
    photo.set({ angle: 0, flipX: false, flipY: false, skewX: 0, skewY: 0, cropX: 0, cropY: 0, scaleX: scale, scaleY: scale });
    photo.setElement(element, { width, height });
    const masked = photo as MaskedImage;
    if (mask && masked.layerMask) {
      masked.layerMask = { src: mask, enabled: masked.layerMask.enabled };
      void hydrateLayerMask(photo).then(() => canvas.requestRenderAll());
    }
    photo.setPositionByOrigin(pivot, "center", "center");
    photo.setCoords();
    photo.dirty = true;
    selectionOf(canvas).set(null);
    canvas.fire("object:modified", { target: photo });
    canvas.requestRenderAll();
    return true;
  } finally {
    busy.delete(canvas);
  }
}
