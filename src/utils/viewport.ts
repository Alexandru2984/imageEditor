import type { Canvas as FabricCanvas, TBBox, TMat2D } from "fabric";
import { findBackgroundImage, isLayerObject } from "./editorObjects";

export { findBackgroundImage } from "./editorObjects";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;
const FIT_MARGIN = 0.95;

export const clampZoom = (zoom: number): number =>
  parseFloat(Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM).toFixed(2));

function contentBounds(canvas: FabricCanvas): TBBox | null {
  const bg = findBackgroundImage(canvas);
  if (bg) return bg.getBoundingRect();

  const objects = canvas.getObjects().filter(isLayerObject);
  if (objects.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const obj of objects) {
    const r = obj.getBoundingRect();
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.left + r.width);
    bottom = Math.max(bottom, r.top + r.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * The viewport that centres the content at the largest zoom that fits (with a
 * small margin), or null when there is nothing to fit.
 */
export function fitTransform(canvas: FabricCanvas): TMat2D | null {
  const bounds = contentBounds(canvas);
  if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
  const zoom = clampZoom(
    Math.min(
      (canvas.width * FIT_MARGIN) / bounds.width,
      (canvas.height * FIT_MARGIN) / bounds.height
    )
  );
  return [
    zoom,
    0,
    0,
    zoom,
    canvas.width / 2 - zoom * (bounds.left + bounds.width / 2),
    canvas.height / 2 - zoom * (bounds.top + bounds.height / 2),
  ];
}

/** Whether the view is (still) exactly the fitted view. */
export function isFitted(canvas: FabricCanvas): boolean {
  const target = fitTransform(canvas);
  if (!target) return true;
  const current = canvas.viewportTransform;
  return (
    Math.abs(current[0] - target[0]) < 0.005 &&
    Math.abs(current[4] - target[4]) < 1 &&
    Math.abs(current[5] - target[5]) < 1
  );
}

/**
 * Center the content in the view at the largest zoom that fits (with a small
 * margin). Returns the zoom that was applied.
 */
export function fitToScreen(canvas: FabricCanvas): number {
  const target = fitTransform(canvas);
  canvas.setViewportTransform(target ?? [1, 0, 0, 1, 0, 0]);
  canvas.requestRenderAll();
  return target ? target[0] : 1;
}
