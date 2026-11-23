import { membraneFill } from "./heal";
import { inpaint } from "./inpaint";

/**
 * The Patch tool and Content-Aware Move, as plain data for the pixel-job
 * worker. Both copy pixels from one place to another and heal the copy in:
 * the difference between where it lands and the copy is known just around
 * it and spread smoothly across it (a membrane fill), so the copy takes on
 * the colour and light of its new place.
 */

/** Pixels around a region of interest, which starts at `x`, `y` in them. */
export interface AreaPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  x: number;
  y: number;
}

/** Pixels beyond the region the membrane learns the surroundings from. */
const RING = 2;

/**
 * Heal a copy into `base` (the area's pixels, changed in place) where
 * `covered` (area-sized, 0–255) is non-zero: each such pixel gets the
 * `copy` pixel at its place minus `offset`… plus the smoothed difference
 * known around it. Pixels whose copy falls outside the area stay as they are.
 */
function healCopy(
  base: Uint8ClampedArray,
  copy: Uint8ClampedArray,
  width: number,
  height: number,
  covered: Uint8Array,
  offset: { x: number; y: number }
): void {
  // Only the box of what is covered, and a ring around it.
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!covered[y * width + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return;
  left = Math.max(0, left - RING);
  top = Math.max(0, top - RING);
  right = Math.min(width - 1, right + RING);
  bottom = Math.min(height - 1, bottom + RING);
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const sourceOf = (x: number, y: number) => {
    const sx = x - offset.x;
    const sy = y - offset.y;
    return sx < 0 || sy < 0 || sx >= width || sy >= height ? -1 : (sy * width + sx) * 4;
  };
  const difference = new Float32Array(boxWidth * boxHeight * 4);
  const known = new Uint8Array(boxWidth * boxHeight);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const index = y * width + x;
      if (covered[index]) continue;
      const source = sourceOf(x, y);
      if (source < 0) continue;
      const local = (y - top) * boxWidth + (x - left);
      known[local] = 1;
      for (let channel = 0; channel < 4; channel += 1) {
        difference[local * 4 + channel] = base[index * 4 + channel]! - copy[source + channel]!;
      }
    }
  }
  // Nothing known around it (it covers everything): a plain copy.
  const healed = membraneFill(difference, known, boxWidth, boxHeight, 4);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const index = y * width + x;
      const weight = covered[index]! / 255;
      const source = sourceOf(x, y);
      if (weight <= 0 || source < 0) continue;
      const local = (y - top) * boxWidth + (x - left);
      const at = index * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = copy[source + channel]! + (healed ? difference[local * 4 + channel]! : 0);
        const before = base[at + channel]!;
        base[at + channel] = before + (Math.min(255, Math.max(0, value)) - before) * weight;
      }
    }
  }
}

/** The region's part of area-sized pixels. */
function crop(data: Uint8ClampedArray, area: AreaPixels, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((area.y + y) * area.width + area.x) * 4;
    out.set(data.subarray(from, from + width * 4), y * width * 4);
  }
  return out;
}

/** A region-sized mask placed in an area-sized one. */
function place(mask: Uint8Array, area: AreaPixels, width: number, height: number): Uint8Array {
  const out = new Uint8Array(area.width * area.height);
  for (let y = 0; y < height; y += 1) out.set(mask.subarray(y * width, (y + 1) * width), (area.y + y) * area.width + area.x);
  return out;
}

/**
 * Patch: the region's pixels where `covered` (region-sized, 0–255) is set
 * are replaced by the pixels `source` away (in layer pixels), healed in.
 */
export function patchPixels(
  area: AreaPixels,
  width: number,
  height: number,
  covered: Uint8Array,
  source: { x: number; y: number }
): Uint8ClampedArray {
  const base = area.data.slice();
  healCopy(base, area.data, area.width, area.height, place(covered, area, width, height), { x: -source.x, y: -source.y });
  return crop(base, area, width, height);
}

/**
 * Content-Aware Move: what `moved` covers (region-sized, 0–255) goes
 * `offset` layer pixels away, healed into where it lands; unless
 * `extend`, where it was is filled in from its surroundings.
 */
export function contentAwareMovePixels(
  area: AreaPixels,
  width: number,
  height: number,
  moved: Uint8Array,
  offset: { x: number; y: number },
  extend: boolean,
  seed = 1
): Uint8ClampedArray {
  const from = place(moved, area, width, height);
  const filled = extend ? area.data.slice() : inpaint(area.data, area.width, area.height, from, seed);
  // Where it lands: the moved mask, shifted.
  const to = new Uint8Array(from.length);
  for (let y = 0; y < area.height; y += 1) {
    const ty = y + offset.y;
    if (ty < 0 || ty >= area.height) continue;
    for (let x = 0; x < area.width; x += 1) {
      const tx = x + offset.x;
      if (tx < 0 || tx >= area.width) continue;
      const value = from[y * area.width + x]!;
      if (value) to[ty * area.width + tx] = value;
    }
  }
  healCopy(filled, area.data, area.width, area.height, to, offset);
  return crop(filled, area, width, height);
}
