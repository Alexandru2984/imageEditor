import { util, type FabricImage, type TMat2D } from "fabric";
import { sceneToLayerMatrix } from "@/raster/fill";
import type { Mask } from "./mask";
import type { PixelSelection } from "./state";

/**
 * Limiting pixel edits to the selection. A layer has its own pixel grid
 * (moved, scaled or rotated over the document), so the selection is first
 * drawn into the layer's pixels as a "clip": a canvas whose alpha says how
 * much of each layer pixel may change.
 */

function newCanvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the selection");
  return { element, context };
}

export function releaseCanvas(element: HTMLCanvasElement): void {
  element.width = 0;
  element.height = 0;
}

/** The selected part of the mask as an image: white, with the mask as alpha. */
function maskImage(mask: Mask, box: { x: number; y: number; width: number; height: number }) {
  const { element, context } = newCanvas(box.width, box.height);
  const image = context.createImageData(box.width, box.height);
  const { data } = image;
  for (let y = 0; y < box.height; y += 1) {
    const row = (box.y + y) * mask.width + box.x;
    for (let x = 0; x < box.width; x += 1) {
      const offset = (y * box.width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = mask.data[row + x]!;
    }
  }
  context.putImageData(image, 0, 0);
  return element;
}

let cached: { mask: Mask; key: string; clip: HTMLCanvasElement } | null = null;

/**
 * The selection drawn into a layer's pixels (width × height of its surface).
 * The last one made is kept, so stroke after stroke on a layer reuses it.
 */
export function selectionClip(
  layer: FabricImage,
  selection: PixelSelection,
  width: number,
  height: number
): HTMLCanvasElement {
  const { grid, mask } = selection;
  const gridToScene: TMat2D = [1 / grid.scale, 0, 0, 1 / grid.scale, grid.left, grid.top];
  const matrix = util.multiplyTransformMatrices(sceneToLayerMatrix(layer), gridToScene);
  const key = [...matrix.map((value) => value.toFixed(6)), width, height].join(",");
  if (cached && cached.mask === mask && cached.key === key) return cached.clip;

  const { element, context } = newCanvas(width, height);
  const box = mask.bounds();
  if (box) {
    const source = maskImage(mask, box);
    try {
      context.setTransform(...matrix);
      context.drawImage(source, box.x, box.y);
    } finally {
      releaseCanvas(source);
    }
  }
  if (cached) releaseCanvas(cached.clip);
  cached = { mask, key, clip: element };
  return element;
}

/** A copy of a surface, to compare a change against. */
export function snapshotSurface(surface: HTMLCanvasElement): HTMLCanvasElement {
  const { element, context } = newCanvas(surface.width, surface.height);
  context.drawImage(surface, 0, 0);
  return element;
}

/**
 * Keep a change to `surface` only inside the clip: where the clip is clear
 * the pixels from `before` come back, and partly selected pixels blend the
 * two (in premultiplied colour, so it is exact).
 */
export function restrictToClip(
  surface: HTMLCanvasElement,
  before: HTMLCanvasElement,
  clip: HTMLCanvasElement
): void {
  const context = surface.getContext("2d");
  if (!context) throw new Error("The browser could not limit the change to the selection");
  const changed = snapshotSurface(surface);
  try {
    const changedContext = changed.getContext("2d")!;
    changedContext.globalCompositeOperation = "destination-in";
    changedContext.drawImage(clip, 0, 0);

    context.save();
    context.globalCompositeOperation = "copy";
    context.drawImage(before, 0, 0);
    context.globalCompositeOperation = "destination-out";
    context.drawImage(clip, 0, 0);
    context.globalCompositeOperation = "lighter";
    context.drawImage(changed, 0, 0);
    context.restore();
  } finally {
    releaseCanvas(changed);
  }
}
