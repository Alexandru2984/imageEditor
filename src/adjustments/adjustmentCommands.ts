import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { ensureLayerId, findBackgroundImage, isEditorChrome, type EditorFabricObject } from "@/utils/editorObjects";
import { histogramOf, type Histogram } from "@/raster/adjustments";
import { renderObjectsRegion, nativeMultiplier } from "@/utils/flatten";
import { releaseSurface } from "@/raster/pixelLayer";
import { hiddenByGroups } from "@/compositing/compositor";
import { pickedGroups, selectedLayerObjects, selectLayers } from "@/layers/layerGroups";
import { maskNewAdjustmentLayer } from "@/raster/layerMask";
import { selectionOf } from "@/selection/state";
import { ADJUSTMENT_TITLES, type AdjustmentData } from "./adjustmentData";
import { AdjustmentLayer } from "./adjustmentLayer";
import type { DocumentLayer } from "./documentLayer";
import { FILL_TITLES, FillLayer, isFillLayer, type FillContent } from "./fillLayer";

/** Layer › New Adjustment Layer, New Fill Layer, and the rest the editor does with them. */

type Named = FabricObject & EditorFabricObject & { name?: string };

/** "Levels 1", "Levels 2", … after the highest number in use, as Photoshop names them. */
function nextName(canvas: FabricCanvas, title: string): string {
  const pattern = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} (\\d+)$`);
  let highest = 0;
  for (const object of canvas.getObjects()) {
    const match = pattern.exec((object as Named).name ?? "");
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${title} ${highest + 1}`;
}

/** Where a new layer goes: just above the top selected layer (in its group), else on top. */
function insertionIndex(canvas: FabricCanvas): number {
  const objects = canvas.getObjects();
  const selected = new Set<FabricObject>([...selectedLayerObjects(canvas), ...pickedGroups(canvas)]);
  let index = -1;
  objects.forEach((object, at) => {
    if (selected.has(object)) index = at;
  });
  if (index >= 0) return index + 1;
  // Editor helpers stay on top.
  let top = 0;
  objects.forEach((object, at) => {
    if (!isEditorChrome(object)) top = at + 1;
  });
  return top;
}

/**
 * A new adjustment layer above the selection, picked in the Layers panel. As
 * in Photoshop, a pixel selection becomes its mask (and is dropped), so the
 * adjustment applies only there. Resolves null when the document changed
 * meanwhile.
 */
export async function addAdjustmentLayer(canvas: FabricCanvas, adjustment: AdjustmentData): Promise<AdjustmentLayer | null> {
  return addDocumentLayer(canvas, new AdjustmentLayer({ adjustment }), ADJUSTMENT_TITLES[adjustment.kind]);
}

/** Layer › New Fill Layer: a colour or gradient over the document, as a new adjustment layer goes in. */
export async function addFillLayer(canvas: FabricCanvas, content: FillContent): Promise<FillLayer | null> {
  return addDocumentLayer(canvas, new FillLayer({ fillContent: content }), FILL_TITLES[content.kind]);
}

async function addDocumentLayer<T extends DocumentLayer>(canvas: FabricCanvas, layer: T, title: string): Promise<T | null> {
  const store = selectionOf(canvas);
  const selection = store.current();
  const photo = findBackgroundImage(canvas);
  if (selection) {
    await maskNewAdjustmentLayer(canvas, layer, { selection });
    if (findBackgroundImage(canvas) !== photo || store.current() !== selection) return null;
  }
  layer.name = nextName(canvas, title);
  ensureLayerId(layer, new Set(canvas.getObjects().map((object) => (object as Named).__layerId ?? "")));
  canvas.insertAt(insertionIndex(canvas), layer);
  if (selection) store.set(null);
  selectLayers(canvas, [(layer as Named).__layerId!]);
  canvas.requestRenderAll();
  return layer;
}

/** Layer › Duplicate on an adjustment or fill layer: a copy just above it. */
export function duplicateDocumentLayer(canvas: FabricCanvas, layer: DocumentLayer): DocumentLayer | null {
  const index = canvas.getObjects().indexOf(layer);
  if (index < 0) return null;
  const options = layer.toObject(["__clipped", "__fill", "layerMask"]) as Record<string, unknown>;
  let copy: DocumentLayer;
  if (isFillLayer(layer)) {
    const name = `${layer.name ?? FILL_TITLES[layer.fillContent.kind]} copy`.slice(0, 256);
    copy = new FillLayer({ ...options, fillContent: structuredClone(layer.fillContent), name });
  } else {
    const adjustment = (layer as AdjustmentLayer).adjustment;
    const name = `${layer.name ?? ADJUSTMENT_TITLES[adjustment.kind]} copy`.slice(0, 256);
    copy = new AdjustmentLayer({ ...options, adjustment: structuredClone(adjustment), name });
  }
  ensureLayerId(copy, new Set(canvas.getObjects().map((object) => (object as Named).__layerId ?? "")));
  canvas.insertAt(index + 1, copy);
  selectLayers(canvas, [(copy as Named).__layerId!]);
  return copy;
}

/** A fill layer's new colour or gradient, shown at once (the caller makes the history step). */
export function setFill(canvas: FabricCanvas, layer: FillLayer, content: FillContent): void {
  layer.fillContent = content;
  canvas.requestRenderAll();
}

/** New settings for an adjustment layer, shown at once (the caller makes the history step). */
export function setAdjustment(canvas: FabricCanvas, layer: AdjustmentLayer, adjustment: AdjustmentData): void {
  // A new object each time: the compositor works the job out again.
  layer.adjustment = adjustment;
  canvas.requestRenderAll();
}

/** The longest side of the image a histogram is taken from. */
const HISTOGRAM_SIDE = 512;

/**
 * The histogram of what shows under an adjustment layer (all the layers
 * below it, as composed), for Levels and Curves.
 */
export function histogramBelow(canvas: FabricCanvas, layer: AdjustmentLayer): Histogram {
  const objects = canvas.getObjects();
  const index = objects.indexOf(layer);
  const photo = findBackgroundImage(canvas);
  const empty = histogramOf(new Uint8ClampedArray(0));
  if (index < 0 || !photo) return empty;
  const region = photo.getBoundingRect();
  const hidden = hiddenByGroups(objects);
  const below = new Set(objects.slice(0, index).filter((object) => object.visible !== false && !hidden.has(object)));
  const scale = Math.min(nativeMultiplier(canvas), HISTOGRAM_SIDE / Math.max(region.width, region.height, 1));
  let element: HTMLCanvasElement | null = null;
  try {
    element = renderObjectsRegion(canvas, region, scale, (object) => below.has(object)).element;
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) return empty;
    return histogramOf(context.getImageData(0, 0, element.width, element.height).data);
  } catch {
    return empty;
  } finally {
    if (element) releaseSurface(element);
  }
}
