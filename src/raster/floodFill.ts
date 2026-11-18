export interface FloodFillOptions {
  /** 0–255: how far a channel may differ from the clicked pixel. */
  tolerance: number;
  /** Only pixels connected to the clicked one, or every similar pixel. */
  contiguous: boolean;
}

/**
 * Which pixels a paint bucket click at (seedX, seedY) fills, as 255 in a mask
 * of width × height, or null when the click is outside the pixels.
 *
 * Colours are compared premultiplied by alpha, so every fully transparent
 * pixel counts as the same colour whatever RGB it happens to store, and a
 * faint pixel is close to transparent.
 */
export function floodFillMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  { tolerance, contiguous }: FloodFillOptions
): Uint8Array | null {
  const startX = Math.floor(seedX);
  const startY = Math.floor(seedY);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return null;

  const seed = (startY * width + startX) * 4;
  const seedAlpha = pixels[seed + 3]!;
  const seedR = pixels[seed]! * seedAlpha;
  const seedG = pixels[seed + 1]! * seedAlpha;
  const seedB = pixels[seed + 2]! * seedAlpha;
  // Compare in premultiplied units (channel × alpha), i.e. 255 × tolerance.
  const limit = Math.max(0, Math.min(255, tolerance)) * 255;
  const alphaLimit = Math.max(0, Math.min(255, tolerance));

  const matches = (index: number): boolean => {
    const offset = index * 4;
    const alpha = pixels[offset + 3]!;
    return (
      Math.abs(alpha - seedAlpha) <= alphaLimit &&
      Math.abs(pixels[offset]! * alpha - seedR) <= limit &&
      Math.abs(pixels[offset + 1]! * alpha - seedG) <= limit &&
      Math.abs(pixels[offset + 2]! * alpha - seedB) <= limit
    );
  };

  const mask = new Uint8Array(width * height);
  if (!contiguous) {
    for (let index = 0; index < mask.length; index += 1) {
      if (matches(index)) mask[index] = 255;
    }
    return mask;
  }

  // Scanline fill: fill a whole run of the row, then queue the runs above and
  // below it, so the stack stays small even for huge areas.
  const open = (index: number) => mask[index] === 0 && matches(index);
  const stack: number[] = [startX, startY];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const row = y * width;
    if (!open(row + x)) continue;
    let left = x;
    while (left > 0 && open(row + left - 1)) left -= 1;
    let right = x;
    while (right < width - 1 && open(row + right + 1)) right += 1;
    mask.fill(255, row + left, row + right + 1);
    for (const nextY of [y - 1, y + 1]) {
      if (nextY < 0 || nextY >= height) continue;
      const nextRow = nextY * width;
      let inRun = false;
      for (let nextX = left; nextX <= right; nextX += 1) {
        if (open(nextRow + nextX)) {
          if (!inRun) stack.push(nextX, nextY);
          inRun = true;
        } else {
          inRun = false;
        }
      }
    }
  }
  return mask;
}
