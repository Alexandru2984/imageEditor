import {
  ActiveSelection,
  FabricImage,
  Rect,
  filters,
  type Canvas as FabricCanvas,
  type FabricObject,
} from "fabric";
import {
  ensureLayerId,
  findBackgroundImage,
  isBackgroundObject,
  isEditorChrome,
  isObjectLocked,
  type EditorFabricObject,
} from "@/utils/editorObjects";
import { renderObjectsRegion } from "@/utils/flatten";
import { nextLayerName, releaseSurface, surfaceToImage } from "@/raster/pixelLayer";
import type { PixelBounds } from "./mask";
import { gridBoxToScene, type PixelSelection } from "./state";

/**
 * What can be done with a pixel selection: copy it to a layer (Layer via
 * Copy), redact it, or clip a layer to it. Each change is one undo step.
 */

export const OUTSIDE_PHOTO = "The selection is outside the photo";

export interface RenderedSelection {
  element: HTMLCanvasElement;
  /** The scene area the element covers. */
  region: { left: number; top: number; width: number; height: number };
  /** Pixels per scene unit of the element. */
  scale: number;
  limited: boolean;
}

/** Fade the pixels of a render covering `box` of the grid by the selection. */
export function applySelectionAlpha(element: HTMLCanvasElement, selection: PixelSelection, box: PixelBounds): void {
  const context = element.getContext("2d");
  if (!context) throw new Error("The browser could not read the selected pixels");
  const width = Math.min(element.width, box.width);
  const height = Math.min(element.height, box.height);
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;
  const { mask } = selection;
  for (let y = 0; y < height; y += 1) {
    const row = (box.y + y) * mask.width + box.x;
    for (let x = 0; x < width; x += 1) {
      const coverage = mask.data[row + x]!;
      if (coverage === 255) continue;
      const offset = (y * width + x) * 4 + 3;
      data[offset] = Math.round((data[offset]! * coverage) / 255);
    }
  }
  context.putImageData(image, 0, 0);
}

/**
 * Render what `include` accepts inside the selection, at the document's
 * resolution and cut to the selection's shape.
 */
export function renderSelection(
  canvas: FabricCanvas,
  selection: PixelSelection,
  include: (object: FabricObject) => boolean
): RenderedSelection {
  const box = selection.mask.bounds();
  if (!box) throw new Error(OUTSIDE_PHOTO);
  const region = gridBoxToScene(selection.grid, box);
  const { element, plan } = renderObjectsRegion(canvas, region, selection.grid.scale, include);
  try {
    if (!selection.mask.isRectangle()) applySelectionAlpha(element, selection, box);
  } catch (error) {
    releaseSurface(element);
    throw error;
  }
  return { element, region, scale: plan.multiplier, limited: plan.limited };
}

const isLayer = (object: FabricObject) => !isEditorChrome(object);
const isShown = (object: FabricObject) => isLayer(object) && object.visible !== false;

/** The layer Layer via Copy reads: the selected one, or else the photo. */
export function copySource(canvas: FabricCanvas): FabricObject | null {
  const active = canvas.getActiveObject();
  if (active && !(active instanceof ActiveSelection) && isLayer(active)) return active;
  return findBackgroundImage(canvas) ?? null;
}

/** An image layer of the rendered pixels, placed where they were. */
async function layerFromRender(rendered: RenderedSelection): Promise<FabricImage> {
  let element: HTMLImageElement;
  try {
    element = await surfaceToImage(rendered.element);
  } finally {
    releaseSurface(rendered.element);
  }
  const scale = 1 / rendered.scale;
  const layer = new FabricImage(element, {
    left: rendered.region.left,
    top: rendered.region.top,
    originX: "left",
    originY: "top",
    scaleX: scale,
    scaleY: scale,
  }) as FabricImage & EditorFabricObject;
  layer.erasable = true;
  ensureLayerId(layer);
  return layer;
}

export type RedactEffect = "pixelate" | "blur";

export interface CopyResult {
  layer: FabricImage;
  limited: boolean;
}

/**
 * Layer via Copy: the selected pixels of the selected layer (or the photo) on
 * a new layer above it. A redaction copies what is seen instead, with the
 * effect baked into the copy's filters, on top of everything.
 */
export async function copySelectionToLayer(
  canvas: FabricCanvas,
  selection: PixelSelection,
  effect?: RedactEffect
): Promise<CopyResult | null> {
  const source = effect ? null : copySource(canvas);
  if (!effect && !source) throw new Error("Open a photo first");
  const copy = await selectionLayer(canvas, selection, source);
  const { layer } = copy;
  const objects = canvas.getObjects();
  if (source && !objects.includes(source)) return null;

  const named = layer as FabricImage & EditorFabricObject;
  if (effect) {
    // Blocks scale with the copy so a face stays unreadable at any size.
    const side = Math.max(layer.width, layer.height);
    layer.filters = [
      effect === "pixelate"
        ? new filters.Pixelate({ blocksize: Math.min(64, Math.max(8, Math.round(side / 14))) })
        : new filters.Blur({ blur: 0.6 }),
    ];
    layer.applyFilters();
    named.name = effect === "pixelate" ? "Pixelated" : "Blurred";
  } else {
    named.name = nextLayerName(canvas);
  }

  canvas.discardActiveObject();
  if (source) canvas.insertAt(objects.indexOf(source) + 1, layer);
  else canvas.add(layer);
  canvas.setActiveObject(layer);
  canvas.requestRenderAll();
  return copy;
}

/**
 * The selected pixels of `source` (or of everything seen, without one) as an
 * image layer in their place, not yet added to the document. The copy keeps
 * the source's opacity and blending.
 */
export async function selectionLayer(
  canvas: FabricCanvas,
  selection: PixelSelection,
  source: FabricObject | null
): Promise<CopyResult> {
  let rendered: RenderedSelection;
  if (source) {
    // The pixels themselves; the copy keeps the layer's opacity and blending.
    const kept = {
      opacity: source.opacity,
      globalCompositeOperation: source.globalCompositeOperation,
      visible: source.visible,
    };
    source.set({ opacity: 1, globalCompositeOperation: "source-over", visible: true });
    try {
      rendered = renderSelection(canvas, selection, (object) => object === source);
    } finally {
      source.set(kept);
    }
  } else {
    rendered = renderSelection(canvas, selection, isShown);
  }

  const layer = await layerFromRender(rendered);
  if (source) layer.set({ opacity: source.opacity, globalCompositeOperation: source.globalCompositeOperation });
  return { layer, limited: rendered.limited };
}

/**
 * Cover the selection in black: a box you can still move for a rectangle,
 * pixels in the selection's shape otherwise.
 */
export async function blackOutSelection(canvas: FabricCanvas, selection: PixelSelection): Promise<FabricObject> {
  const box = selection.mask.bounds();
  if (!box) throw new Error(OUTSIDE_PHOTO);
  let redaction: FabricObject;
  if (selection.mask.isRectangle()) {
    const region = gridBoxToScene(selection.grid, box);
    redaction = new Rect({ ...region, fill: "#000000", strokeWidth: 0 });
  } else {
    const surface = document.createElement("canvas");
    surface.width = box.width;
    surface.height = box.height;
    const context = surface.getContext("2d");
    if (!context) throw new Error("The browser could not draw the redaction");
    context.fillStyle = "#000000";
    context.fillRect(0, 0, box.width, box.height);
    applySelectionAlpha(surface, selection, box);
    redaction = await layerFromRender({
      element: surface,
      region: gridBoxToScene(selection.grid, box),
      scale: selection.grid.scale,
      limited: false,
    });
  }
  (redaction as EditorFabricObject).name = "Redaction";
  ensureLayerId(redaction);
  canvas.discardActiveObject();
  canvas.add(redaction);
  canvas.setActiveObject(redaction);
  canvas.requestRenderAll();
  return redaction;
}

/** The image layer a mask from the selection would clip, if any. */
export function maskTarget(canvas: FabricCanvas): FabricImage | null {
  const active = canvas.getActiveObject();
  return active instanceof FabricImage && !isBackgroundObject(active) && !isObjectLocked(active)
    ? active
    : null;
}

/**
 * Clip a layer to a rectangular selection without touching its pixels (the
 * clip can be released from the Properties panel).
 */
export function maskToSelection(canvas: FabricCanvas, selection: PixelSelection, target: FabricImage): void {
  const box = selection.mask.bounds();
  if (!box) throw new Error(OUTSIDE_PHOTO);
  if (!selection.mask.isRectangle()) throw new Error("Only a rectangular selection can mask a layer for now");
  target.clipPath = new Rect({ ...gridBoxToScene(selection.grid, box), absolutePositioned: true });
  canvas.setActiveObject(target);
  canvas.fire("object:modified", { target });
  canvas.requestRenderAll();
}
