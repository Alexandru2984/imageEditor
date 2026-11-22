import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { ensureLayerId, findBackgroundImage, isEditorChrome, type EditorFabricObject } from "@/utils/editorObjects";
import { histogramOf, type Histogram } from "@/raster/adjustments";
import { renderObjectsRegion, nativeMultiplier } from "@/utils/flatten";
import { releaseSurface } from "@/raster/pixelLayer";
import { hiddenByGroups } from "@/compositing/compositor";
import { pickedGroups, selectedLayerObjects, selectLayers } from "@/layers/layerGroups";
import { ADJUSTMENT_TITLES, type AdjustmentData } from "./adjustmentData";
import { AdjustmentLayer } from "./adjustmentLayer";

/** Layer › New Adjustment Layer and the rest the editor does with them. */

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

/** A new adjustment layer above the selection, picked in the Layers panel. */
export function addAdjustmentLayer(canvas: FabricCanvas, adjustment: AdjustmentData): AdjustmentLayer {
  const layer = new AdjustmentLayer({ adjustment, name: nextName(canvas, ADJUSTMENT_TITLES[adjustment.kind]) });
  ensureLayerId(layer, new Set(canvas.getObjects().map((object) => (object as Named).__layerId ?? "")));
  canvas.insertAt(insertionIndex(canvas), layer);
  selectLayers(canvas, [(layer as Named).__layerId!]);
  canvas.requestRenderAll();
  return layer;
}

/** Layer › Duplicate on an adjustment layer: a copy just above it. */
export function duplicateAdjustmentLayer(canvas: FabricCanvas, layer: AdjustmentLayer): AdjustmentLayer | null {
  const index = canvas.getObjects().indexOf(layer);
  if (index < 0) return null;
  const copy = new AdjustmentLayer({
    ...layer.toObject(["__clipped", "__fill"]),
    adjustment: structuredClone(layer.adjustment),
    name: `${layer.name ?? ADJUSTMENT_TITLES[layer.adjustment.kind]} copy`.slice(0, 256),
  });
  ensureLayerId(copy, new Set(canvas.getObjects().map((object) => (object as Named).__layerId ?? "")));
  canvas.insertAt(index + 1, copy);
  selectLayers(canvas, [(copy as Named).__layerId!]);
  return copy;
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
