import { FabricImage, Point, util, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import {
  ensureLayerId,
  findBackgroundImage,
  isBackgroundObject,
  isEditorChrome,
  isObjectLocked,
  type EditorFabricObject,
} from "@/utils/editorObjects";
import { MAX_RASTER_PIXELS, MAX_RASTER_SIDE } from "@/utils/flatten";

/**
 * Pixel layers are ordinary image layers. While a tool paints, the layer shows
 * a working canvas; when the stroke ends the canvas is encoded to PNG off the
 * main thread and swapped back for an image, so history and autosave keep
 * sharing one source string per state instead of re-encoding every time.
 */

type PaintableImage = FabricImage & EditorFabricObject;

interface EditSession {
  surface: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  /** Bumped by every stroke; an encode for an older stroke is discarded. */
  generation: number;
  /** A layer that does not join the document until its first stroke lands. */
  pending: boolean;
}

const sessions = new WeakMap<FabricImage, EditSession>();

const originalElement = (image: FabricImage): CanvasImageSource =>
  (image as unknown as { _originalElement?: CanvasImageSource })._originalElement ??
  image.getElement();

/** An image layer the user may paint on: unlocked, and not the photo itself. */
export const isPaintableLayer = (object: FabricObject | undefined | null): object is FabricImage =>
  !!object &&
  object instanceof FabricImage &&
  !isEditorChrome(object) &&
  !isBackgroundObject(object) &&
  !isObjectLocked(object);

/** A layer still waiting for its first stroke to be committed. */
export const isPendingLayer = (image: FabricImage): boolean => sessions.get(image)?.pending === true;

/** The layer pixel under a scene point (may fall outside the layer). */
export function sceneToLayerPixel(image: FabricImage, point: { x: number; y: number }) {
  const inverse = util.invertTransform(image.calcTransformMatrix());
  const local = util.transformPoint(new Point(point.x, point.y), inverse);
  return {
    x: local.x + image.width / 2 + (image.cropX ?? 0),
    y: local.y + image.height / 2 + (image.cropY ?? 0),
  };
}

/** How many layer pixels one scene unit spans (averaged over both axes). */
export function layerPixelsPerSceneUnit(image: FabricImage): number {
  const [a, b, c, d] = image.calcTransformMatrix();
  const area = Math.abs(a * d - b * c);
  return area > 0 ? 1 / Math.sqrt(area) : 1;
}

function createSurface(width: number, height: number) {
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d");
  if (!context) throw new Error("The browser could not prepare a paint surface");
  return { surface, context };
}

/** Show a paint surface on the layer, keeping its crop, and its filters current. */
function showSurface(image: FabricImage, surface: HTMLCanvasElement) {
  image.setElement(surface, { width: image.width, height: image.height });
}

/**
 * Start (or continue) painting on a layer: its pixels move onto a canvas the
 * caller draws on. Nothing is recorded until {@link commitPixelEdit}.
 */
export function beginPixelEdit(image: FabricImage): EditSession {
  const existing = sessions.get(image);
  if (existing && originalElement(image) === existing.surface) {
    existing.generation += 1;
    return existing;
  }
  const source = originalElement(image);
  const { width, height } = image.getOriginalSize();
  const { surface, context } = createSurface(Math.round(width), Math.round(height));
  context.drawImage(source, 0, 0);
  const session: EditSession = { surface, context, generation: 1, pending: false };
  sessions.set(image, session);
  showSurface(image, surface);
  return session;
}

/** Redraw the layer after its surface changed. */
export function refreshPixelLayer(image: FabricImage, canvas: FabricCanvas): void {
  if (image.filters.length > 0) {
    // The filter backend caches the source texture by key.
    image.removeTexture(image.cacheKey);
    image.applyFilters();
  }
  image.dirty = true;
  canvas.requestRenderAll();
}

const encodePng = (surface: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    surface.toBlob((blob) => {
      if (blob && blob.size > 0) resolve(blob);
      else reject(new Error("The browser could not encode the painted layer"));
    }, "image/png");
  });

const readDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the painted layer"));
    reader.readAsDataURL(blob);
  });

async function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  const element = new Image();
  element.src = dataUrl;
  await element.decode();
  return element;
}

/**
 * Encode the layer's surface and make it the layer's image, as one history
 * step. Resolves false when a newer stroke or an undo overtook this one.
 */
export async function commitPixelEdit(canvas: FabricCanvas, image: FabricImage): Promise<boolean> {
  const session = sessions.get(image);
  if (!session) return false;
  const generation = session.generation;
  const element = await decodeImage(await readDataUrl(await encodePng(session.surface)));
  const current =
    sessions.get(image) === session &&
    session.generation === generation &&
    originalElement(image) === session.surface &&
    canvas.getObjects().includes(image);
  if (!current) return false;

  sessions.delete(image);
  const layer = image as PaintableImage;
  if (session.pending) {
    layer.__isPreview = undefined;
    layer.excludeFromExport = false;
    layer.erasable = true;
  }
  image.setElement(element, { width: image.width, height: image.height });
  image.dirty = true;
  session.surface.width = 0;
  session.surface.height = 0;
  canvas.requestRenderAll();
  canvas.fire("object:modified", { target: image });
  return true;
}

/** "Layer 1", "Layer 2", … after the highest number in use. */
export function nextLayerName(canvas: FabricCanvas): string {
  let highest = 0;
  for (const object of canvas.getObjects()) {
    const match = /^Layer (\d+)$/.exec((object as EditorFabricObject).name ?? "");
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Layer ${highest + 1}`;
}

/** Pixel size for a layer covering the photo at the photo's own resolution. */
export function documentPixelSize(width: number, height: number) {
  const limit = Math.min(
    1,
    MAX_RASTER_SIDE / width,
    MAX_RASTER_SIDE / height,
    Math.sqrt(MAX_RASTER_PIXELS / (width * height))
  );
  return {
    width: Math.max(1, Math.round(width * limit)),
    height: Math.max(1, Math.round(height * limit)),
  };
}

/**
 * A transparent layer exactly over the photo, at the photo's resolution, on
 * top of the stack. It stays out of history and the Layers panel until its
 * first stroke is committed, so an empty click leaves nothing behind.
 */
export function createPendingLayer(canvas: FabricCanvas): FabricImage | null {
  const photo = findBackgroundImage(canvas);
  if (!photo || photo.width <= 0 || photo.height <= 0) return null;
  const size = documentPixelSize(photo.width, photo.height);
  const { surface, context } = createSurface(size.width, size.height);
  const layer = new FabricImage(surface, {
    left: photo.left,
    top: photo.top,
    angle: photo.angle,
    skewX: photo.skewX,
    skewY: photo.skewY,
    flipX: photo.flipX,
    flipY: photo.flipY,
    originX: photo.originX,
    originY: photo.originY,
    scaleX: (photo.scaleX * photo.width) / size.width,
    scaleY: (photo.scaleY * photo.height) / size.height,
  }) as PaintableImage;
  layer.name = nextLayerName(canvas);
  layer.__isPreview = true;
  layer.excludeFromExport = true;
  ensureLayerId(layer);
  sessions.set(layer, { surface, context, generation: 1, pending: true });
  canvas.add(layer);
  return layer;
}

/** Drop a layer whose first stroke never happened. */
export function discardPendingLayer(canvas: FabricCanvas, image: FabricImage): void {
  const session = sessions.get(image);
  if (!session?.pending) return;
  sessions.delete(image);
  canvas.remove(image);
  session.surface.width = 0;
  session.surface.height = 0;
}

export function editSession(image: FabricImage): EditSession | undefined {
  return sessions.get(image);
}
