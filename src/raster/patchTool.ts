import type { Canvas as FabricCanvas, FabricImage } from "fabric";
import { Mask } from "@/selection/mask";
import { documentGrid, selectionOf, type PixelSelection } from "@/selection/state";
import { nameNextStep } from "@/utils/historySteps";
import { sceneToLayerMatrix } from "./fill";
import type { PixelJob } from "./pixelJobs";
import { PixelPreview, adjustTarget } from "./pixelPreview";
import type { RedEyeSettings } from "./redEye";

/**
 * Patch, Content-Aware Move and Red Eye on the selected layer (or the
 * photo): each worked out in the pixel-job worker and recorded as one step.
 * A string is a refusal to show the person.
 */
export type Refusal = string;

const working = new WeakSet<FabricCanvas>();

/** A move of the selection on the document grid as whole pixels of the layer. */
function layerOffset(layer: FabricImage, selection: PixelSelection, dx: number, dy: number) {
  const matrix = sceneToLayerMatrix(layer);
  const sx = dx / selection.grid.scale;
  const sy = dy / selection.grid.scale;
  return { x: Math.round(matrix[0] * sx + matrix[2] * sy), y: Math.round(matrix[1] * sx + matrix[3] * sy) };
}

/** Open a preview over `selection`, run `job` on it and record it as `step`. */
async function run(
  canvas: FabricCanvas,
  selection: PixelSelection,
  step: string,
  job: (preview: PixelPreview, offset: (dx: number, dy: number) => { x: number; y: number }) => PixelJob | Refusal,
  unchanged?: Refusal
): Promise<true | Refusal> {
  if (working.has(canvas)) return "Wait for the last change to finish";
  const target = adjustTarget(canvas);
  if (typeof target === "string") return target;
  const preview = PixelPreview.open(canvas, target, selection);
  if (typeof preview === "string") return preview;
  working.add(canvas);
  try {
    const chosen = job(preview, (dx, dy) => layerOffset(target.pixels, selection, dx, dy));
    if (typeof chosen === "string") {
      preview.cancel();
      return chosen;
    }
    const result = await preview.compute(chosen);
    if (unchanged && result.every((value, index) => value === preview.original.data[index])) {
      preview.cancel();
      return unchanged;
    }
    preview.present(result);
    nameNextStep(canvas, step);
    await preview.commit();
    return true;
  } catch (error) {
    preview.cancel();
    throw error;
  } finally {
    working.delete(canvas);
  }
}

/**
 * The Patch tool, on dragging the selection `dx`, `dy` grid pixels: in
 * Source mode the selected area is replaced by what the selection was dragged
 * over; in Destination mode it is copied to where it was dragged. Either way
 * the copy is healed into its surroundings.
 */
export function applyPatch(
  canvas: FabricCanvas,
  selection: PixelSelection,
  dx: number,
  dy: number,
  mode: "source" | "destination"
): Promise<true | Refusal> {
  const patched = mode === "source" ? selection : { grid: selection.grid, mask: selection.mask.translated(dx, dy) };
  return run(canvas, patched, "Patch", (preview, offset) => {
    const moved = offset(dx, dy);
    const source = mode === "source" ? moved : { x: -moved.x, y: -moved.y };
    if (source.x === 0 && source.y === 0) return "Drag the selection further";
    const covered = preview.weights ?? new Uint8Array(preview.width * preview.height).fill(255);
    return {
      op: "patch",
      covered,
      sourceX: source.x,
      sourceY: source.y,
      reach: Math.max(Math.abs(source.x), Math.abs(source.y)) + 4,
    };
  });
}

/**
 * Content-Aware Move, on dragging the selection `dx`, `dy` grid pixels: what
 * is selected goes there, healed in, and where it was fills in from around
 * it (with `extend`, it stays, so it is copied). The selection follows.
 */
export async function applyContentAwareMove(
  canvas: FabricCanvas,
  selection: PixelSelection,
  dx: number,
  dy: number,
  extend: boolean
): Promise<true | Refusal> {
  const landed = selection.mask.translated(dx, dy);
  const both: PixelSelection = { grid: selection.grid, mask: selection.mask.combine(landed, "add") };
  const result = await run(canvas, both, "Content-Aware Move", (preview, offset) => {
    const moved = offset(dx, dy);
    if (moved.x === 0 && moved.y === 0) return "Drag the selection further";
    const { width, height } = preview;
    // The fill copies from around: as far again as its size, within reason for memory.
    let reach = Math.max(48, Math.min(512, Math.max(width, height)));
    while (reach > 48 && (width + reach * 2) * (height + reach * 2) > 8_000_000) reach = Math.floor(reach * 0.8);
    return {
      op: "contentAwareMove",
      moved: preview.coverage(selection),
      offsetX: moved.x,
      offsetY: moved.y,
      extend,
      reach,
      seed: 1,
    };
  });
  if (result === true) selectionOf(canvas).set(landed, selection.grid, "Content-Aware Move");
  return result;
}

/**
 * The Red Eye tool over a box of the document grid (a click makes one around
 * itself): the red pupil nearest its middle made grey and dark.
 */
export function applyRedEye(
  canvas: FabricCanvas,
  box: { x0: number; y0: number; x1: number; y1: number },
  settings: RedEyeSettings
): Promise<true | Refusal> {
  const grid = documentGrid(canvas);
  if (!grid) return Promise.resolve("Open a photo first");
  const x0 = Math.max(0, Math.floor(Math.min(box.x0, box.x1)));
  const y0 = Math.max(0, Math.floor(Math.min(box.y0, box.y1)));
  const x1 = Math.min(grid.width, Math.ceil(Math.max(box.x0, box.x1)));
  const y1 = Math.min(grid.height, Math.ceil(Math.max(box.y0, box.y1)));
  if (x1 - x0 < 2 || y1 - y0 < 2) return Promise.resolve("Click on the photo, in the red of the eye");
  const selection: PixelSelection = { grid, mask: Mask.rect(grid.width, grid.height, x0, y0, x1, y1) };
  return run(
    canvas,
    selection,
    "Red Eye",
    () => ({ op: "redEye", pupilSize: settings.pupilSize, darken: settings.darken }),
    "No red eye found there; click in the red of the pupil"
  );
}
