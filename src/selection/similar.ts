import { Mask, SELECTED } from "./mask";

/**
 * Select › Grow and Select › Similar: the pixels whose colour is within the
 * magic wand's tolerance of a colour already selected, either reached from
 * the selection without crossing other colours (Grow) or anywhere (Similar).
 *
 * Colours are compared as the magic wand compares them, premultiplied by
 * alpha and channel by channel, on a table of 64 levels per channel and 4
 * of alpha, so every selected colour is looked at once.
 */

const LEVELS = 64;
const ALPHA_LEVELS = 4;
const STEP = 256 / LEVELS;

const binOf = (pixels: Uint8ClampedArray, offset: number): number => {
  const alpha = pixels[offset + 3]!;
  const r = (pixels[offset]! * alpha) / 255;
  const g = (pixels[offset + 1]! * alpha) / 255;
  const b = (pixels[offset + 2]! * alpha) / 255;
  return (
    (((alpha >> 6) * LEVELS + Math.floor(r / STEP)) * LEVELS + Math.floor(g / STEP)) * LEVELS + Math.floor(b / STEP)
  );
};

/** Spread every marked cell `reach` cells along one axis of the table. */
function spread(table: Uint8Array, length: number, stride: number, reach: number) {
  if (reach <= 0) return;
  const line = new Uint8Array(length);
  const lines = table.length / length;
  for (let index = 0; index < lines; index += 1) {
    // The first cell of the line: the axis's stride splits the index.
    const outer = Math.floor(index / stride);
    const inner = index % stride;
    const start = outer * stride * length + inner;
    let last = -Infinity;
    for (let at = 0; at < length; at += 1) {
      line[at] = 0;
      if (table[start + at * stride]) last = at;
      if (at - last <= reach) line[at] = 1;
    }
    let next = Infinity;
    for (let at = length - 1; at >= 0; at -= 1) {
      if (table[start + at * stride]) next = at;
      if (next - at <= reach) line[at] = 1;
    }
    for (let at = 0; at < length; at += 1) table[start + at * stride] = line[at]!;
  }
}

/** Which colour cells count as like the selected colours. */
export function similarColorTable(pixels: Uint8ClampedArray, mask: Mask, tolerance: number): Uint8Array {
  const table = new Uint8Array(ALPHA_LEVELS * LEVELS * LEVELS * LEVELS);
  const data = mask.data;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index]! >= SELECTED) table[binOf(pixels, index * 4)] = 1;
  }
  const limit = Math.max(0, Math.min(255, tolerance));
  const reach = Math.ceil(limit / STEP);
  spread(table, LEVELS, 1, reach);
  spread(table, LEVELS, LEVELS, reach);
  spread(table, LEVELS, LEVELS * LEVELS, reach);
  spread(table, ALPHA_LEVELS, LEVELS * LEVELS * LEVELS, Math.ceil(limit / 64));
  return table;
}

/** The selection with the pixels like it added; null when nothing is selected. */
export function grownSelection(
  pixels: Uint8ClampedArray,
  mask: Mask,
  tolerance: number,
  contiguous: boolean
): Mask | null {
  const { width, height } = mask;
  if (pixels.length !== width * height * 4) throw new RangeError("The pixels do not fit the selection");
  if (mask.isEmpty()) return null;
  const table = similarColorTable(pixels, mask, tolerance);
  const out = mask.clone();
  const data = out.data;
  const like = (index: number) => table[binOf(pixels, index * 4)] === 1;
  if (!contiguous) {
    for (let index = 0; index < data.length; index += 1) if (data[index]! < SELECTED && like(index)) data[index] = 255;
    return out;
  }
  // From the selection's edge outwards, through like pixels only.
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const selected = (index: number) => data[index]! >= SELECTED;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!selected(index)) continue;
      const edge =
        (x > 0 && !selected(index - 1)) ||
        (x < width - 1 && !selected(index + 1)) ||
        (y > 0 && !selected(index - width)) ||
        (y < height - 1 && !selected(index + width));
      if (edge) queue[tail++] = index;
    }
  }
  const visit = (index: number) => {
    if (selected(index) || !like(index)) return;
    data[index] = 255;
    queue[tail++] = index;
  };
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index + width < data.length) visit(index + width);
  }
  return out;
}
