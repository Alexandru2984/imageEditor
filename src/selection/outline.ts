import { SELECTED, type Mask } from "./mask";

/** Beyond this many edge segments the outline is too costly to animate. */
export const MAX_OUTLINE_SEGMENTS = 400_000;

/**
 * The selection's outline as line segments along pixel edges
 * ([x0, y0, x1, y1] repeated, in pixel-corner coordinates), with straight
 * runs merged. Null when the outline is too intricate to draw.
 */
export function outlineSegments(mask: Mask, limit = MAX_OUTLINE_SEGMENTS): Float32Array | null {
  const box = mask.bounds();
  if (!box) return new Float32Array(0);
  const { width, height, data } = mask;
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x]! >= SELECTED;

  const segments: number[] = [];
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;

  // Horizontal edges: between row y - 1 and row y.
  for (let y = top; y <= bottom; y += 1) {
    let start = -1;
    for (let x = left; x <= right; x += 1) {
      const edge = x < right && inside(x, y - 1) !== inside(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        segments.push(start, y, x, y);
        start = -1;
        if (segments.length / 4 > limit) return null;
      }
    }
  }
  // Vertical edges: between column x - 1 and column x.
  for (let x = left; x <= right; x += 1) {
    let start = -1;
    for (let y = top; y <= bottom; y += 1) {
      const edge = y < bottom && inside(x - 1, y) !== inside(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        segments.push(x, start, x, y);
        start = -1;
        if (segments.length / 4 > limit) return null;
      }
    }
  }
  return Float32Array.from(segments);
}
