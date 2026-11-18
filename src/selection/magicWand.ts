import { ActiveSelection, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import { findBackgroundImage, isEditorChrome } from "@/utils/editorObjects";
import { renderObjectsRegion } from "@/utils/flatten";
import { floodFillMask } from "@/raster/floodFill";
import { releaseSurface } from "@/raster/pixelLayer";
import { Mask } from "./mask";
import { sceneToGrid, type DocumentGrid } from "./state";

export interface WandOptions {
  /** 0–255: how far a channel may differ from the clicked pixel. */
  tolerance: number;
  /** Only pixels connected to the clicked one, or every similar pixel. */
  contiguous: boolean;
  /** Judge by what is seen (all layers) rather than the selected layer. */
  sampleAll: boolean;
}

export const DEFAULT_WAND_OPTIONS: WandOptions = {
  tolerance: 32,
  contiguous: true,
  sampleAll: true,
};

/** The layer the wand samples when it does not look at all of them. */
function sampledLayer(canvas: FabricCanvas): FabricObject | null {
  const active = canvas.getActiveObject();
  if (active && !(active instanceof ActiveSelection) && !isEditorChrome(active)) return active;
  return findBackgroundImage(canvas) ?? null;
}

/**
 * Magic wand: the pixels of the document that look like the one under a
 * scene point, or null when the point is outside the document.
 */
export function wandSelect(
  canvas: FabricCanvas,
  grid: DocumentGrid,
  point: { x: number; y: number },
  options: WandOptions
): Mask | null {
  const seed = sceneToGrid(grid, point.x, point.y);
  if (seed.x < 0 || seed.y < 0 || seed.x >= grid.width || seed.y >= grid.height) return null;

  const layer = options.sampleAll ? null : sampledLayer(canvas);
  if (!options.sampleAll && !layer) return null;
  const include = layer
    ? (object: FabricObject) => object === layer
    : (object: FabricObject) => !isEditorChrome(object) && object.visible !== false;
  const region = {
    left: grid.left,
    top: grid.top,
    width: grid.width / grid.scale,
    height: grid.height / grid.scale,
  };

  // Alone, a layer is judged by its own pixels, not how it is blended.
  const kept = layer
    ? { opacity: layer.opacity, globalCompositeOperation: layer.globalCompositeOperation, visible: layer.visible }
    : null;
  layer?.set({ opacity: 1, globalCompositeOperation: "source-over", visible: true });
  let rendered: ReturnType<typeof renderObjectsRegion>;
  try {
    rendered = renderObjectsRegion(canvas, region, grid.scale, include);
  } finally {
    if (layer && kept) layer.set(kept);
  }

  const { element } = rendered;
  try {
    if (element.width !== grid.width || element.height !== grid.height) {
      throw new Error("The document could not be sampled at its own size");
    }
    const context = element.getContext("2d");
    if (!context) throw new Error("The browser could not read the pixels to select");
    const pixels = context.getImageData(0, 0, grid.width, grid.height).data;
    const data = floodFillMask(pixels, grid.width, grid.height, seed.x, seed.y, options);
    return data ? new Mask(grid.width, grid.height, data) : null;
  } finally {
    releaseSurface(element);
  }
}
