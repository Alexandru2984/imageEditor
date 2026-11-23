import { Path as FabricPath, type Canvas as FabricCanvas } from "fabric";
import {
  beginPixelEdit,
  commitPixelEdit,
  discardPendingLayer,
  layerPixelsPerSceneUnit,
  refreshPixelLayer,
  sceneToLayerPixel,
} from "@/raster/pixelLayer";
import { StrokePainter } from "@/raster/painter";
import type { PaintOptions } from "@/raster/paintSettings";
import { editPixels, paintTarget } from "@/selection/edits";
import { Mask, type SelectionMode } from "@/selection/mask";
import { outlineSegments } from "@/selection/outline";
import { documentGrid, selectionOf, type DocumentGrid } from "@/selection/state";
import { ensureLayerId, type EditorFabricObject } from "@/utils/editorObjects";
import { nativeMultiplier } from "@/utils/flatten";
import { nameNextStep } from "@/utils/historySteps";
import { cornerAt, flattenSubpath, nextPathName, segmentsOf, svgPathData, WORK_PATH, type DocumentPath } from "./pathData";
import { pathsOf, pathViewOf, setPaths } from "./paths";
import { traceOutlines } from "./trace";

/**
 * What the Paths panel does with a path: make a selection of it, fill or
 * stroke it on the layer, make a shape layer of it; and a path made from
 * the selection. Each is one history step.
 */

/** A string is a refusal to show the person. */
export type PathResult = true | string;

function documentAndPath(canvas: FabricCanvas, index: number): { grid: DocumentGrid; path: DocumentPath } | string {
  const grid = documentGrid(canvas);
  if (!grid) return "Open a photo first";
  const path = pathsOf(canvas)[index];
  if (!path || path.subpaths.every((subpath) => subpath.anchors.length < 2)) return "Draw a path with the Pen first";
  return { grid, path };
}

/** The area a path encloses (open subpaths closed straight), anti-aliased, on the document grid. */
export function pathMask(path: DocumentPath, grid: DocumentGrid): Mask {
  const element = document.createElement("canvas");
  element.width = grid.width;
  element.height = grid.height;
  const context = element.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not prepare the path");
  try {
    context.setTransform(grid.scale, 0, 0, grid.scale, -grid.left * grid.scale, -grid.top * grid.scale);
    const shape = new Path2D();
    for (const subpath of path.subpaths) {
      const first = subpath.anchors[0];
      if (!first || subpath.anchors.length < 2) continue;
      shape.moveTo(first.x, first.y);
      for (const [from, to] of segmentsOf(subpath)) shape.bezierCurveTo(from.outX, from.outY, to.inX, to.inY, to.x, to.y);
      shape.closePath();
    }
    context.fillStyle = "#ffffff";
    context.fill(shape, "nonzero");
    const pixels = context.getImageData(0, 0, grid.width, grid.height).data;
    const data = new Uint8Array(grid.width * grid.height);
    for (let index = 0; index < data.length; index += 1) data[index] = pixels[index * 4 + 3]!;
    return new Mask(grid.width, grid.height, data);
  } finally {
    element.width = 0;
  }
}

/** Load a path as a selection (Ctrl+Enter, Make Selection), feathered by `feather` pixels. */
export function selectionFromPath(canvas: FabricCanvas, index: number, mode: SelectionMode = "replace", feather = 0): PathResult {
  const found = documentAndPath(canvas, index);
  if (typeof found === "string") return found;
  let shape = pathMask(found.path, found.grid);
  if (feather > 0) shape = shape.feathered(feather);
  const store = selectionOf(canvas);
  const current = store.current();
  const mask = mode === "replace" || !current ? (mode === "subtract" || mode === "intersect" ? null : shape) : current.mask.combine(shape, mode);
  store.set(mask, found.grid, "Make Selection");
  return true;
}

/** Fill Path: the area it encloses, in `color`, on the layer (a new one over the photo). */
export async function fillPath(canvas: FabricCanvas, index: number, color: string): Promise<PathResult> {
  const found = documentAndPath(canvas, index);
  if (typeof found === "string") return found;
  const target = paintTarget(canvas);
  if (typeof target === "string") return target;
  nameNextStep(canvas, "Fill Path");
  const committed = await editPixels(canvas, target, { grid: found.grid, mask: pathMask(found.path, found.grid) }, { kind: "fill", color });
  return committed ? true : "The path could not be filled";
}

/** Stroke Path: the brush, as set, along every subpath, on the layer (a new one over the photo). */
export async function strokePath(canvas: FabricCanvas, index: number, color: string, brush: PaintOptions): Promise<PathResult> {
  const found = documentAndPath(canvas, index);
  if (typeof found === "string") return found;
  const target = paintTarget(canvas);
  if (typeof target === "string") return target;
  const layer = target.layer;
  try {
    const session = beginPixelEdit(layer);
    const layerPerImagePixel = layerPixelsPerSceneUnit(layer) / nativeMultiplier(canvas);
    const diameter = Math.max(0.5, brush.size * layerPerImagePixel);
    // Fine enough for the brush's spacing at the layer's own scale.
    const tolerance = 0.25 / Math.max(layerPixelsPerSceneUnit(layer), 1e-6);
    for (const subpath of found.path.subpaths) {
      if (subpath.anchors.length < 2) continue;
      const painter = new StrokePainter(session.surface, {
        diameter,
        hardness: brush.hardness / 100,
        opacity: brush.opacity / 100,
        flow: brush.flow / 100,
        color,
        erase: false,
        clip: null,
      });
      for (const point of flattenSubpath(subpath, tolerance)) painter.add({ ...sceneToLayerPixel(layer, point), pressure: 1 });
      painter.finish();
    }
  } catch (error) {
    if (target.created) discardPendingLayer(canvas, layer);
    throw error;
  }
  refreshPixelLayer(layer, canvas);
  nameNextStep(canvas, "Stroke Path");
  const committed = await commitPixelEdit(canvas, layer);
  return committed ? true : "The path could not be stroked";
}

/** A shape layer filled with `color` in the path's outline, as the Pen's Shape mode makes. */
export function shapeFromPath(canvas: FabricCanvas, index: number, color: string): PathResult {
  const found = documentAndPath(canvas, index);
  if (typeof found === "string") return found;
  const data = svgPathData(found.path.subpaths.filter((subpath) => subpath.anchors.length > 1).map((subpath) => ({ ...subpath, closed: true })));
  const shape = new FabricPath(data, { fill: color, stroke: undefined, strokeWidth: 0 }) as FabricPath & EditorFabricObject & { name?: string };
  let highest = 0;
  for (const object of canvas.getObjects()) {
    const match = /^Shape (\d+)$/.exec((object as { name?: string }).name ?? "");
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  shape.name = `Shape ${highest + 1}`;
  ensureLayerId(shape, new Set(canvas.getObjects().map((object) => (object as EditorFabricObject).__layerId ?? "")));
  nameNextStep(canvas, "New Shape Layer");
  canvas.add(shape);
  canvas.setActiveObject(shape);
  canvas.requestRenderAll();
  return true;
}

/** Make Work Path: the selection's outline as a path of corners, within `tolerance` pixels. */
export function workPathFromSelection(canvas: FabricCanvas, tolerance = 2): PathResult {
  const selection = selectionOf(canvas).current();
  if (!selection) return "Make a selection first";
  // Too intricate an outline makes a path nobody could edit.
  if (outlineSegments(selection.mask, 200_000) === null) return "The selection is too intricate to make a path of";
  const { grid } = selection;
  const loops = traceOutlines(selection.mask, tolerance);
  if (loops.length === 0) return "Nothing is selected";
  const toScene = (x: number, y: number) => ({ x: grid.left + x / grid.scale, y: grid.top + y / grid.scale });
  const path: DocumentPath = {
    name: WORK_PATH,
    subpaths: loops.map((loop) => ({ closed: true, anchors: loop.map((point) => cornerAt(toScene(point.x, point.y))) })),
  };
  const paths = pathsOf(canvas).slice();
  const work = paths.findIndex((candidate) => candidate.name === WORK_PATH);
  if (work >= 0) paths[work] = path;
  else paths.push(path);
  setPaths(canvas, paths, "Make Work Path");
  pathViewOf(canvas).show(work >= 0 ? work : paths.length - 1);
  return true;
}

/** A new empty path, shown so the Pen draws into it. */
export function newPath(canvas: FabricCanvas): PathResult {
  if (!documentGrid(canvas)) return "Open a photo first";
  const paths = pathsOf(canvas).slice();
  paths.push({ name: nextPathName(paths), subpaths: [] });
  setPaths(canvas, paths, "New Path");
  pathViewOf(canvas).show(paths.length - 1);
  return true;
}

export function deletePath(canvas: FabricCanvas, index: number): void {
  const paths = pathsOf(canvas).slice();
  if (!paths[index]) return;
  paths.splice(index, 1);
  pathViewOf(canvas).show(null);
  setPaths(canvas, paths, "Delete Path");
}

/** Rename a path; the Work Path renamed is kept (Save Path). */
export function renamePath(canvas: FabricCanvas, index: number, name: string): void {
  const paths = pathsOf(canvas).slice();
  const trimmed = name.trim().slice(0, 256);
  if (!paths[index] || !trimmed || paths[index]!.name === trimmed) return;
  paths[index] = { ...paths[index]!, name: trimmed };
  setPaths(canvas, paths, "Rename Path");
}
