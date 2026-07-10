import type { Canvas as FabricCanvas, FabricObject, TBBox } from "fabric";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;
const FIT_MARGIN = 0.95;

export const clampZoom = (zoom: number): number =>
  parseFloat(Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM).toFixed(2));

/** The background photo: the non-selectable image at the back of the stack. */
export function findBackgroundImage(
  canvas: FabricCanvas
): FabricObject | undefined {
  return canvas
    .getObjects()
    .find((obj) => !obj.selectable && obj.type === "image");
}

function contentBounds(canvas: FabricCanvas): TBBox | null {
  const bg = findBackgroundImage(canvas);
  if (bg) return bg.getBoundingRect();

  const objects = canvas.getObjects();
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
 * Center the content in the view at the largest zoom that fits (with a small
 * margin). Returns the zoom that was applied.
 */
export function fitToScreen(canvas: FabricCanvas): number {
  const bounds = contentBounds(canvas);
  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.requestRenderAll();
    return 1;
  }

  const zoom = clampZoom(
    Math.min(
      (canvas.width * FIT_MARGIN) / bounds.width,
      (canvas.height * FIT_MARGIN) / bounds.height
    )
  );
  canvas.setViewportTransform([
    zoom,
    0,
    0,
    zoom,
    canvas.width / 2 - zoom * (bounds.left + bounds.width / 2),
    canvas.height / 2 - zoom * (bounds.top + bounds.height / 2),
  ]);
  canvas.requestRenderAll();
  return zoom;
}
