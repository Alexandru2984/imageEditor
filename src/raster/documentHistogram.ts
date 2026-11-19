import type { Canvas as FabricCanvas, FabricObject, TBBox } from "fabric";
import { exportRegion } from "@/utils/exportImage";
import { nativeMultiplier } from "@/utils/flatten";
import { isEditorChrome } from "@/utils/editorObjects";
import { selectionOf } from "@/selection/state";
import { SELECTED } from "@/selection/mask";
import { histogramOf, type Histogram } from "./adjustments";

/** The document is measured at about this many pixels: plenty for a histogram. */
const SAMPLE_PIXELS = 512 * 512;

/** What the histogram counts: the image as it exports, or one layer alone. */
export type HistogramSource = "document" | "layer";

export interface DocumentHistogram {
  histogram: Histogram;
  /** Only the selected pixels were counted. */
  selection: boolean;
}

/**
 * Render a scene area at `scale` pixels per unit, without touching the view:
 * Fabric's own offscreen render, with the view's zoom and pan undone.
 */
function renderArea(canvas: FabricCanvas, area: TBBox, scale: number, include: (object: FabricObject) => boolean) {
  const view = canvas.viewportTransform;
  const zoom = view[0];
  const multiplier = scale / zoom;
  const width = Math.max(1, Math.round(area.width * scale));
  const height = Math.max(1, Math.round(area.height * scale));
  // Fabric sizes the canvas by width × multiplier; a quarter pixel more keeps
  // rounding from losing a column.
  return canvas.toCanvasElement(multiplier, {
    left: area.left * zoom + view[4],
    top: area.top * zoom + view[5],
    width: (width + 0.25) / multiplier,
    height: (height + 0.25) / multiplier,
    filter: (object) => include(object as FabricObject),
  });
}

/**
 * The colours of the document (or of the selected layer) from a reduced
 * copy, counting only the selected pixels when there is a selection. Null
 * when there is nothing to measure.
 */
export function documentHistogram(canvas: FabricCanvas, source: HistogramSource): DocumentHistogram | null {
  let include = (object: FabricObject) => !isEditorChrome(object) && !object.excludeFromExport;
  if (source === "layer") {
    const active = canvas.getActiveObjects().filter((object) => !isEditorChrome(object));
    if (active.length === 0) return null;
    // A group counts through its members, which render as part of it.
    const layers = new Set<FabricObject>(active.map((object) => (object.group as FabricObject | undefined) ?? object));
    include = (object) => layers.has(object);
  }

  const selection = selectionOf(canvas).current();
  let area: TBBox | null;
  let full: number;
  if (selection) {
    const { grid } = selection;
    area = { left: grid.left, top: grid.top, width: grid.width / grid.scale, height: grid.height / grid.scale };
    full = grid.scale;
  } else {
    area = exportRegion(canvas);
    if (!area) return null;
    try {
      full = nativeMultiplier(canvas);
    } catch {
      full = 1;
    }
  }
  if (!(area.width > 0 && area.height > 0)) return null;
  const scale = Math.min(full, Math.sqrt(SAMPLE_PIXELS / (area.width * area.height)));

  const element = renderArea(canvas, area, scale, include);
  try {
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let weights: Uint8Array | null = null;
    if (selection) {
      // Each sample takes the selection pixel under its centre.
      const { grid, mask } = selection;
      weights = new Uint8Array(element.width * element.height);
      const step = grid.scale / scale;
      for (let y = 0; y < element.height; y += 1) {
        const row = Math.min(grid.height - 1, Math.floor((y + 0.5) * step)) * grid.width;
        for (let x = 0; x < element.width; x += 1) {
          const value = mask.data[row + Math.min(grid.width - 1, Math.floor((x + 0.5) * step))]!;
          weights[y * element.width + x] = value >= SELECTED ? 255 : 0;
        }
      }
    }
    return { histogram: histogramOf(data, weights), selection: selection !== null };
  } finally {
    element.width = 0;
    element.height = 0;
  }
}
