import type { Canvas as FabricCanvas } from "fabric";
import { documentGrid, selectionOf } from "@/selection/state";
import { isEditorChrome } from "@/utils/editorObjects";
import { renderObjectsRegion } from "@/utils/flatten";
import { tipFromPixels, type BrushTip } from "./brushEngine";
import { releaseSurface } from "./pixelLayer";

/** The largest area read for a brush, a side; Photoshop's limit is 5000. */
const MAX_SOURCE_SIDE = 2500;

/**
 * Edit › Define Brush Preset: a brush tip from what is visible in the
 * selection (or the whole document): dark pixels paint, white and clear ones
 * do not. A string is a refusal to show.
 */
export function brushTipFromDocument(canvas: FabricCanvas): { tip: BrushTip; size: number } | string {
  const grid = documentGrid(canvas);
  if (!grid) return "Open a photo first";
  const selection = selectionOf(canvas).current();
  const box = selection ? selection.mask.bounds() : { x: 0, y: 0, width: grid.width, height: grid.height };
  if (!box) return "The selection is empty";
  const bounds = { left: box.x, top: box.y };
  const { width, height } = box;
  if (width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE) {
    return `Select at most ${MAX_SOURCE_SIDE} × ${MAX_SOURCE_SIDE} pixels to make a brush from`;
  }
  const region = {
    left: grid.left + bounds.left / grid.scale,
    top: grid.top + bounds.top / grid.scale,
    width: width / grid.scale,
    height: height / grid.scale,
  };
  const { element } = renderObjectsRegion(canvas, region, grid.scale, (object) => !isEditorChrome(object) && object.visible !== false);
  let pixels: Uint8ClampedArray;
  try {
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The browser could not read the document");
    pixels = new Uint8ClampedArray(width * height * 4);
    const read = context.getImageData(0, 0, Math.min(width, element.width), Math.min(height, element.height));
    for (let y = 0; y < read.height; y += 1) {
      pixels.set(read.data.subarray(y * read.width * 4, (y + 1) * read.width * 4), y * width * 4);
    }
  } finally {
    releaseSurface(element);
  }
  let coverage: Uint8Array | undefined;
  if (selection) {
    coverage = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const from = (bounds.top + y) * grid.width + bounds.left;
      coverage.set(selection.mask.data.subarray(from, from + width), y * width);
    }
  }
  return tipFromPixels(pixels, width, height, coverage) ?? "There is nothing dark there to paint with; brushes paint where the pixels are dark";
}
