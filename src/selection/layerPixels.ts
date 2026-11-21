import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { withoutCompositing } from "@/compositing/compositor";
import { releaseSurface } from "@/raster/pixelLayer";
import { renderObjectsRegion } from "@/utils/flatten";
import { Mask, type SelectionMode } from "./mask";
import { documentGrid, sameGrid, selectionOf } from "./state";

type Styled = FabricObject & { layerStyle?: unknown };

/**
 * A layer's own pixels as a selection the document's size: as opaque as the
 * layer is, without its opacity, blend mode or layer style (Photoshop's
 * Ctrl+click on a layer thumbnail).
 */
export function layerPixelsMask(canvas: FabricCanvas, object: FabricObject): Mask | null {
  const grid = documentGrid(canvas);
  if (!grid) return null;
  const region = { left: grid.left, top: grid.top, width: grid.width / grid.scale, height: grid.height / grid.scale };
  const layer = object as Styled;
  const saved = {
    visible: layer.visible,
    opacity: layer.opacity,
    globalCompositeOperation: layer.globalCompositeOperation,
    layerStyle: layer.layerStyle,
  };
  Object.assign(layer, { visible: true, opacity: 1, globalCompositeOperation: "source-over", layerStyle: undefined });
  let element: HTMLCanvasElement;
  try {
    element = withoutCompositing(() => renderObjectsRegion(canvas, region, grid.scale, (candidate) => candidate === object).element);
  } finally {
    Object.assign(layer, saved);
  }
  try {
    const width = Math.min(element.width, grid.width);
    const height = Math.min(element.height, grid.height);
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The browser could not read the layer");
    const pixels = context.getImageData(0, 0, width, height).data;
    const mask = new Mask(grid.width, grid.height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) mask.data[y * grid.width + x] = pixels[(y * width + x) * 4 + 3]!;
    }
    return mask;
  } finally {
    releaseSurface(element);
  }
}

/** The selection modifiers of a Ctrl+click: Shift adds, Alt takes away, both intersect. */
export const selectionModeOf = (event: { shiftKey: boolean; altKey: boolean }): SelectionMode =>
  event.shiftKey && event.altKey ? "intersect" : event.shiftKey ? "add" : event.altKey ? "subtract" : "replace";

/** Select a layer's pixels, or combine them with the selection. False when there is nothing to select. */
export function selectLayerPixels(canvas: FabricCanvas, object: FabricObject, mode: SelectionMode = "replace"): boolean {
  const grid = documentGrid(canvas);
  const pixels = layerPixelsMask(canvas, object);
  if (!grid || !pixels) return false;
  const store = selectionOf(canvas);
  const current = store.current();
  const mask = mode !== "replace" && current && sameGrid(current.grid, grid) ? current.mask.combine(pixels, mode) : pixels;
  store.set(mask.isEmpty() ? null : mask, grid);
  return !mask.isEmpty();
}
