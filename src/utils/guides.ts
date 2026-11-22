import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { isDocumentLayer } from "@/adjustments/documentLayer";
import { documentGrid } from "@/selection/state";
import { findBackgroundImage, isLayerObject } from "@/utils/editorObjects";
import { isGuideList, mapGuides, MAX_GUIDES, nearestLines, type GridSettings, type Guide, type SceneMatrix } from "./guideData";
import type { Box } from "./snapping";

/**
 * The document's guides live on the photo, so they are saved with it, come
 * back with it on undo and are carried along when it turns or flips.
 */
type GuidedObject = FabricObject & { guides?: unknown };

export function guidesOf(canvas: FabricCanvas): Guide[] {
  const photo = findBackgroundImage(canvas) as GuidedObject | undefined;
  return photo && isGuideList(photo.guides) ? photo.guides : [];
}

/** Replace the document's guides, as one undo step. False without a document. */
export function setGuides(canvas: FabricCanvas, guides: readonly Guide[]): boolean {
  const photo = findBackgroundImage(canvas) as GuidedObject | undefined;
  if (!photo) return false;
  photo.guides = guides.length ? guides.slice(0, MAX_GUIDES) : undefined;
  canvas.fire("object:modified", { target: photo });
  canvas.requestRenderAll();
  return true;
}

/** Carry the guides through a change of the whole scene, inside that change's undo step. */
export function transformGuides(canvas: FabricCanvas, matrix: SceneMatrix): void {
  const photo = findBackgroundImage(canvas) as GuidedObject | undefined;
  if (photo && isGuideList(photo.guides) && photo.guides.length) photo.guides = mapGuides(photo.guides, matrix);
}

/** A guide being dragged out of a ruler or moved: drawn in place of the one it replaces. */
export interface GuideDraft {
  guide: Guide;
  /** The index of the guide being moved; none for a new one. */
  replacing?: number;
}

const drafts = new WeakMap<FabricCanvas, GuideDraft>();

export const guideDraft = (canvas: FabricCanvas): GuideDraft | null => drafts.get(canvas) ?? null;

export function setGuideDraft(canvas: FabricCanvas, draft: GuideDraft | null): void {
  if (draft) drafts.set(canvas, draft);
  else drafts.delete(canvas);
  canvas.requestRenderAll();
}

/** Edges and centres a guide or a layer can line up with, on one axis. */
function layerStops(canvas: FabricCanvas, axis: "x" | "y"): number[] {
  const stops: number[] = [];
  for (const object of canvas.getObjects()) {
    // Adjustment layers take no room to line up with.
    if (!object.visible || !isLayerObject(object) || isDocumentLayer(object)) continue;
    const { left, top, width, height } = object.getBoundingRect();
    if (axis === "x") stops.push(left, left + width / 2, left + width);
    else stops.push(top, top + height / 2, top + height);
  }
  return stops;
}

/**
 * Where a guide dragged to `position` lands: on the nearest layer or
 * document edge or centre within `threshold` (scene units) when snapping,
 * otherwise on a whole document pixel.
 */
export function placeGuide(canvas: FabricCanvas, axis: "x" | "y", position: number, snap: boolean, threshold: number): number {
  if (snap) {
    let best: number | null = null;
    for (const stop of layerStops(canvas, axis)) {
      if (Math.abs(stop - position) <= threshold && (best === null || Math.abs(stop - position) < Math.abs(best - position))) best = stop;
    }
    if (best !== null) return best;
  }
  const grid = documentGrid(canvas);
  if (!grid) return position;
  const origin = axis === "x" ? grid.left : grid.top;
  return origin + Math.round((position - origin) * grid.scale) / grid.scale;
}

/** Scene units between the grid's finest lines, with the grid's corner. */
export function gridGeometry(canvas: FabricCanvas, settings: GridSettings) {
  const grid = documentGrid(canvas);
  if (!grid) return null;
  return {
    left: grid.left,
    top: grid.top,
    right: grid.left + grid.width / grid.scale,
    bottom: grid.top + grid.height / grid.scale,
    /** Document pixels per scene unit. */
    scale: grid.scale,
    step: settings.spacing / settings.subdivisions / grid.scale,
  };
}

/** What a moving layer snaps to besides other layers: the visible guides and the grid's nearest lines. */
export function snapLines(
  canvas: FabricCanvas,
  moving: Box,
  options: { guides: boolean; grid: GridSettings | null }
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  if (options.guides) {
    for (const guide of guidesOf(canvas)) (guide.axis === "x" ? x : y).push(guide.position);
  }
  const grid = options.grid ? gridGeometry(canvas, options.grid) : null;
  if (grid) {
    x.push(...nearestLines([moving.left, moving.left + moving.width / 2, moving.left + moving.width], grid.left, grid.step));
    y.push(...nearestLines([moving.top, moving.top + moving.height / 2, moving.top + moving.height], grid.top, grid.step));
  }
  return { x, y };
}
