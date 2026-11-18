export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The smallest box containing all of them. */
export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.left + box.width);
    bottom = Math.max(bottom, box.top + box.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export const growBox = (box: Box, margin: number): Box => ({
  left: box.left - margin,
  top: box.top - margin,
  width: box.width + 2 * margin,
  height: box.height + 2 * margin,
});

// Coordinates a hair off a whole pixel are treated as that pixel.
const EPSILON = 1e-6;

/**
 * Grow a scene box outwards to whole pixels of the document's pixel grid
 * (`multiplier` pixels per scene unit, with a pixel corner at `origin`), so
 * merged layers line up with the photo's pixels instead of being resampled
 * by a fraction of a pixel.
 */
export function snapToPixelGrid(box: Box, origin: { x: number; y: number }, multiplier: number): Box {
  const down = (value: number, from: number) =>
    from + Math.floor((value - from) * multiplier + EPSILON) / multiplier;
  const up = (value: number, from: number) =>
    from + Math.ceil((value - from) * multiplier - EPSILON) / multiplier;
  const left = down(box.left, origin.x);
  const top = down(box.top, origin.y);
  return {
    left,
    top,
    width: up(box.left + box.width, origin.x) - left,
    height: up(box.top + box.height, origin.y) - top,
  };
}
