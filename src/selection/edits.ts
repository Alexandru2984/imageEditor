import { ActiveSelection, FabricImage, type Canvas as FabricCanvas } from "fabric";
import { findBackgroundImage, isEditorChrome, isObjectLocked } from "@/utils/editorObjects";
import {
  beginPixelEdit,
  commitPixelEdit,
  createPendingLayer,
  discardPendingLayer,
  isPaintableLayer,
  refreshPixelLayer,
} from "@/raster/pixelLayer";
import { releaseCanvas, selectionClip } from "./clip";
import { Mask } from "./mask";
import type { PixelSelection } from "./state";

/**
 * Edit › Clear, Fill and Stroke on the selected pixels of a layer, each one
 * undo step. Without a selection they act on the whole layer.
 */

/** Why an edit cannot run, worded for the user. */
export type Refusal = string;

export interface EditTarget {
  layer: FabricImage;
  /** Made for this edit; dropped again if the edit fails. */
  created: boolean;
}

const refusalFor = (object: unknown): Refusal | null => {
  if (object instanceof ActiveSelection) return "Select a single layer first";
  if (!(object instanceof FabricImage)) return "Rasterize the layer first (Layer › Rasterize)";
  if (isObjectLocked(object)) return "Unlock the layer first";
  if (object.visible === false) return "Show the layer first";
  return null;
};

/**
 * The layer whose pixels Delete or Cut removes: the selected image layer, or
 * else the photo.
 */
export function clearTarget(canvas: FabricCanvas): EditTarget | Refusal {
  const active = canvas.getActiveObject();
  const layer = active && !isEditorChrome(active) ? active : findBackgroundImage(canvas);
  if (!layer) return "Open a photo first";
  const refusal = refusalFor(layer);
  return refusal ?? { layer: layer as FabricImage, created: false };
}

/**
 * The layer Fill and Stroke paint on: the selected pixel layer, or a new
 * layer, as the brush does.
 */
export function paintTarget(canvas: FabricCanvas): EditTarget | Refusal {
  const active = canvas.getActiveObject();
  if (active && !isEditorChrome(active)) {
    if (isPaintableLayer(active)) {
      return active.visible === false ? "Show the layer first" : { layer: active, created: false };
    }
    // Text, shapes and several layers cannot take pixels; the photo and
    // locked images get a new layer over them, as with the brush.
    if (!(active instanceof FabricImage)) return refusalFor(active)!;
  }
  const created = createPendingLayer(canvas);
  return created ? { layer: created, created: true } : "Open a photo first";
}

export type StrokeLocation = "inside" | "center" | "outside";

/** The band a stroke of `width` pixels paints along the selection's edge. */
export function strokeBand(mask: Mask, width: number, location: StrokeLocation): Mask {
  if (location === "inside") return mask.combine(mask.contracted(width), "subtract");
  if (location === "outside") return mask.expanded(width).combine(mask, "subtract");
  const outer = Math.floor(width / 2);
  const inner = width - outer;
  const grown = outer > 0 ? mask.expanded(outer) : mask;
  return grown.combine(mask.contracted(inner), "subtract");
}

type PixelEdit = { kind: "clear" } | { kind: "fill"; color: string };

/** Change the target's pixels where `selection` says (everywhere without one). */
function applyEdit(target: FabricImage, selection: PixelSelection | null, edit: PixelEdit) {
  const { surface, context } = beginPixelEdit(target);
  const clip = selection ? selectionClip(target, selection, surface.width, surface.height) : null;
  context.save();
  if (edit.kind === "clear") {
    if (clip) {
      context.globalCompositeOperation = "destination-out";
      context.drawImage(clip, 0, 0);
    } else {
      context.clearRect(0, 0, surface.width, surface.height);
    }
  } else if (clip) {
    const paint = document.createElement("canvas");
    paint.width = surface.width;
    paint.height = surface.height;
    const paintContext = paint.getContext("2d");
    try {
      if (!paintContext) throw new Error("The browser could not prepare the fill");
      paintContext.fillStyle = edit.color;
      paintContext.fillRect(0, 0, paint.width, paint.height);
      paintContext.globalCompositeOperation = "destination-in";
      paintContext.drawImage(clip, 0, 0);
      context.drawImage(paint, 0, 0);
    } finally {
      releaseCanvas(paint);
    }
  } else {
    context.fillStyle = edit.color;
    context.fillRect(0, 0, surface.width, surface.height);
  }
  context.restore();
}

/** Run an edit on a target and record it; the layer ends up selected. */
export async function editPixels(
  canvas: FabricCanvas,
  target: EditTarget,
  selection: PixelSelection | null,
  edit: PixelEdit,
  { select = true }: { select?: boolean } = {}
): Promise<boolean> {
  try {
    applyEdit(target.layer, selection, edit);
  } catch (error) {
    if (target.created) discardPendingLayer(canvas, target.layer);
    throw error;
  }
  refreshPixelLayer(target.layer, canvas);
  const committed = await commitPixelEdit(canvas, target.layer);
  if (select && committed && target.layer !== findBackgroundImage(canvas) && canvas.getObjects().includes(target.layer)) {
    canvas.setActiveObject(target.layer);
    canvas.requestRenderAll();
  }
  return committed;
}

/** Edit › Stroke: paint a band of `width` pixels along the selection's edge. */
export function strokeSelection(
  canvas: FabricCanvas,
  target: EditTarget,
  selection: PixelSelection,
  color: string,
  width: number,
  location: StrokeLocation
): Promise<boolean> {
  const band = strokeBand(selection.mask, width, location);
  return editPixels(canvas, target, { grid: selection.grid, mask: band }, { kind: "fill", color });
}
