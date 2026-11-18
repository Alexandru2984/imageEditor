import { ActiveSelection, FabricImage, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import {
  ensureLayerId,
  findBackgroundImage,
  isBackgroundObject,
  isEditorChrome,
  isObjectLocked,
  markBackgroundObject,
  type EditorFabricObject,
} from "@/utils/editorObjects";
import { nativeMultiplier, renderObjectsRegion } from "@/utils/flatten";
import {
  documentPixelSize,
  nextLayerName,
  overPhoto,
  releaseSurface,
  surfaceToImage,
} from "./pixelLayer";
import { hasLayerMask } from "./layerMask";
import { hasEffects, layerStyleMargin, type LayerStyle } from "./layerStyleData";
import { growBox, snapToPixelGrid, unionBoxes, type Box } from "./regions";

/**
 * Photoshop's layer commands that produce pixels: New layer, Rasterize,
 * Merge down / Merge layers, Merge visible and Flatten image. Each renders
 * the layers at the photo's resolution and swaps them for one image layer in
 * a single step, so it is one undo step.
 */

/** Why a layer command cannot run, worded for the user. */
export type Refusal = string;

export interface MergePlan {
  /** Rendered into the result, bottom to top; the first one is merged into. */
  layers: FabricObject[];
  /** Removed without being rendered (hidden layers when flattening). */
  discard: FabricObject[];
}

export interface LayerOpResult {
  layer: FabricImage;
  /** The result was rendered below full resolution to stay within limits. */
  limited: boolean;
}

const busy = new WeakSet<FabricCanvas>();

const documentLayers = (canvas: FabricCanvas): FabricObject[] =>
  canvas.getObjects().filter((object) => !isEditorChrome(object));

const isShown = (object: FabricObject) => object.visible !== false;

/** The selected layers, bottom to top. */
function selectedLayers(canvas: FabricCanvas): FabricObject[] {
  const active = canvas.getActiveObject();
  if (!active || isEditorChrome(active)) return [];
  const chosen = new Set(active instanceof ActiveSelection ? active.getObjects() : [active]);
  return documentLayers(canvas).filter((object) => chosen.has(object));
}

function checkMergeable(layers: FabricObject[]): MergePlan | Refusal {
  if (layers.some((layer) => !isShown(layer))) return "Show the layers before merging them";
  if (layers.some((layer) => !isBackgroundObject(layer) && isObjectLocked(layer))) {
    return "Unlock the layers before merging them";
  }
  return { layers, discard: [] };
}

/** Merge down (one layer selected) or Merge layers (several). */
export function planMergeDown(canvas: FabricCanvas): MergePlan | Refusal {
  const selected = selectedLayers(canvas);
  if (selected.length === 0) return "Select a layer to merge down";
  if (selected.length > 1) return checkMergeable(selected);
  const layer = selected[0]!;
  const layers = documentLayers(canvas);
  const below = layers[layers.indexOf(layer) - 1];
  if (!below) return "There is no layer below to merge into";
  return checkMergeable([below, layer]);
}

export function planMergeVisible(canvas: FabricCanvas): MergePlan | Refusal {
  const visible = documentLayers(canvas).filter(isShown);
  if (visible.length < 2) return "Show at least two layers to merge them";
  return checkMergeable(visible);
}

/** Everything into the photo; hidden layers are discarded, as in Photoshop. */
export function planFlatten(canvas: FabricCanvas): MergePlan | Refusal {
  const layers = documentLayers(canvas);
  const photo = layers.find(isBackgroundObject);
  if (!photo) return "Open a photo first";
  if (layers.length < 2) return "There are no layers to flatten";
  return {
    layers: layers.filter((layer) => layer === photo || isShown(layer)),
    discard: layers.filter((layer) => layer !== photo && !isShown(layer)),
  };
}

/** Text, shapes, drawings, and images with adjustments, masks or effects. */
export function planRasterize(canvas: FabricCanvas): MergePlan | Refusal {
  const selected = selectedLayers(canvas);
  if (selected.length !== 1) return "Select one layer to rasterize";
  const layer = selected[0]!;
  if (isBackgroundObject(layer)) return "The photo is already pixels";
  if (isObjectLocked(layer)) return "Unlock the layer before rasterizing it";
  if (
    layer instanceof FabricImage &&
    layer.filters.length === 0 &&
    !layer.clipPath &&
    !layer.shadow &&
    !hasLayerMask(layer) &&
    !hasEffects((layer as FabricObject & { layerStyle?: LayerStyle }).layerStyle)
  ) {
    return "This layer is already pixels";
  }
  return { layers: [layer], discard: [] };
}

/** How far a layer's effects reach past its box, in scene units. */
function effectMargin(object: FabricObject): number {
  // Layer styles are in document pixels.
  const style = (object as FabricObject & { layerStyle?: LayerStyle }).layerStyle;
  const styled = object.canvas
    ? layerStyleMargin(style) / nativeMultiplier(object.canvas as FabricCanvas)
    : 0;
  return styled + shadowMargin(object);
}

/** How far a shadow (also used for soft marker strokes) reaches past the box. */
function shadowMargin(object: FabricObject): number {
  const shadow = object.shadow;
  if (!shadow) return 0;
  const scale = shadow.nonScaling
    ? 1
    : Math.max(Math.abs(object.scaleX ?? 1), Math.abs(object.scaleY ?? 1));
  return (shadow.blur + Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY))) * scale + 2;
}

function sceneBox(object: FabricObject): Box {
  object.setCoords();
  return growBox(object.getBoundingRect(), effectMargin(object));
}

/** The area the layers cover, on whole pixels of the document. */
export function documentPixelRegion(canvas: FabricCanvas, layers: FabricObject[], multiplier: number): Box {
  const union = unionBoxes(layers.map(sceneBox))!;
  const photo = findBackgroundImage(canvas);
  const corner = photo ? photo.getBoundingRect() : { left: 0, top: 0 };
  return snapToPixelGrid(union, { x: corner.left, y: corner.top }, multiplier);
}

/** Run a planned merge (a rasterize is a merge of one layer). */
export async function runMerge(canvas: FabricCanvas, plan: MergePlan): Promise<LayerOpResult | null> {
  if (busy.has(canvas)) return null;
  busy.add(canvas);
  try {
    // Layers inside a multiple selection are positioned relative to it.
    if (canvas.getActiveObject() instanceof ActiveSelection) canvas.discardActiveObject();
    const base = plan.layers[0]!;
    const intoPhoto = isBackgroundObject(base);
    const multiplier = nativeMultiplier(canvas);
    base.setCoords();
    // Merging into the photo keeps the photo's frame; anything outside it is
    // cut off, as with Photoshop's background layer.
    const region = intoPhoto ? base.getBoundingRect() : documentPixelRegion(canvas, plan.layers, multiplier);

    // The bottom layer's opacity and blend mode stay settings of the result
    // instead of being baked into its pixels, as Photoshop merges.
    const kept = {
      opacity: base.opacity,
      globalCompositeOperation: base.globalCompositeOperation,
      visible: base.visible,
    };
    const included = new Set(plan.layers);
    base.set({ opacity: 1, globalCompositeOperation: "source-over", visible: true });
    let rendered: ReturnType<typeof renderObjectsRegion>;
    try {
      rendered = renderObjectsRegion(canvas, region, multiplier, (object) => included.has(object));
    } finally {
      base.set(kept);
    }
    let element: HTMLImageElement;
    try {
      element = await surfaceToImage(rendered.element);
    } finally {
      releaseSurface(rendered.element);
    }

    // The document changed while the pixels were being encoded.
    const objects = canvas.getObjects();
    const removed = new Set([...plan.layers, ...plan.discard]);
    if ([...removed].some((object) => !objects.includes(object))) return null;

    const scale = 1 / rendered.plan.multiplier;
    const result = new FabricImage(element, {
      left: region.left,
      top: region.top,
      originX: "left",
      originY: "top",
      scaleX: scale,
      scaleY: scale,
      ...kept,
    });
    const source = base as EditorFabricObject;
    const layer = result as FabricImage & EditorFabricObject;
    layer.name = source.name;
    layer.__layerId = source.__layerId;
    if (intoPhoto) markBackgroundObject(result);
    else layer.erasable = true;
    ensureLayerId(result);

    const position = objects
      .slice(0, objects.indexOf(base))
      .filter((object) => !removed.has(object)).length;
    canvas.discardActiveObject();
    canvas.remove(...removed);
    canvas.insertAt(position, result);
    if (!intoPhoto) canvas.setActiveObject(result);
    canvas.requestRenderAll();
    return { layer: result, limited: rendered.plan.limited };
  } finally {
    busy.delete(canvas);
  }
}

/**
 * An empty layer over the photo at its resolution, above the selected layer
 * (or on top), selected so the brush paints on it.
 */
export async function addEmptyLayer(canvas: FabricCanvas): Promise<FabricImage | null> {
  const photo = findBackgroundImage(canvas);
  if (!photo || photo.width <= 0 || photo.height <= 0) throw new Error("Open a photo first");
  const size = documentPixelSize(photo.width, photo.height);
  const surface = document.createElement("canvas");
  surface.width = size.width;
  surface.height = size.height;
  let element: HTMLImageElement;
  try {
    element = await surfaceToImage(surface);
  } finally {
    releaseSurface(surface);
  }
  if (!canvas.getObjects().includes(photo)) return null;

  const layer = new FabricImage(element, overPhoto(photo, size)) as FabricImage & EditorFabricObject;
  layer.name = nextLayerName(canvas);
  layer.erasable = true;
  ensureLayerId(layer);
  const anchor = selectedLayers(canvas).at(-1) ?? documentLayers(canvas).at(-1);
  const objects = canvas.getObjects();
  canvas.insertAt(anchor ? objects.indexOf(anchor) + 1 : objects.length, layer);
  canvas.setActiveObject(layer);
  canvas.requestRenderAll();
  return layer;
}
