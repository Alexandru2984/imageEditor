/**
 * The Red Eye tool: within a box around an eye, the red patch of the pupil
 * nearest the middle (the flash's reflection) is made grey and darkened, its
 * edge eased into the iris. Plain data, for the pixel-job worker.
 */

export interface RedEyeSettings {
  /** 1–100: how far towards orange-red the pupil reaches (Photoshop's Pupil Size). */
  pupilSize: number;
  /** 1–100: how dark the pupil becomes. */
  darken: number;
}

export const DEFAULT_RED_EYE: RedEyeSettings = { pupilSize: 50, darken: 50 };

/** How red a pixel is: 0 for grey or any other hue, up to 1 for pure red. */
export function redness(red: number, green: number, blue: number): number {
  if (red <= 40) return 0;
  const other = Math.max(green, blue);
  return Math.max(0, (red - other) / red);
}

/**
 * Fix the red eye in `pixels` (`width` × `height` RGBA, not changed);
 * returns the fixed pixels, or null when there is no red pupil to fix.
 */
export function fixRedEye(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  settings: RedEyeSettings = DEFAULT_RED_EYE
): Uint8ClampedArray | null {
  const count = width * height;
  // A bigger pupil takes in less vivid reds.
  const threshold = 0.55 - (Math.min(100, Math.max(1, settings.pupilSize)) / 100) * 0.35;
  const red = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    red[index] = pixels[at + 3]! < 16 ? 0 : redness(pixels[at]!, pixels[at + 1]!, pixels[at + 2]!);
  }

  // The red patch nearest the middle of the box.
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  let seed = -1;
  let nearest = Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (red[index]! < threshold) continue;
      const distance = (x - cx) ** 2 + (y - cy) ** 2;
      if (distance < nearest) {
        nearest = distance;
        seed = index;
      }
    }
  }
  if (seed < 0) return null;
  const patch = new Uint8Array(count);
  const stack = [seed];
  patch[seed] = 1;
  let size = 0;
  while (stack.length > 0) {
    const index = stack.pop()!;
    size += 1;
    const x = index % width;
    const y = (index - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (patch[next] || red[next]! < threshold) continue;
        patch[next] = 1;
        stack.push(next);
      }
    }
  }
  // A speck is noise, not a pupil.
  if (size < 4) return null;

  const out = new Uint8ClampedArray(pixels);
  const dark = 1 - (Math.min(100, Math.max(1, settings.darken)) / 100) * 0.8;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      // The patch, and its rim a pixel out where it is still reddish.
      let weight = 0;
      if (patch[index]) weight = 1;
      else if (red[index]! > threshold * 0.5) {
        for (let dy = -1; dy <= 1 && !weight; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || !patch[ny * width + nx]) continue;
            weight = Math.min(1, (red[index]! - threshold * 0.5) / (threshold * 0.5));
            break;
          }
        }
      }
      if (weight <= 0) continue;
      const at = index * 4;
      const r = pixels[at]!;
      const g = pixels[at + 1]!;
      const b = pixels[at + 2]!;
      // The red channel from the others, then darker.
      const grey = (g + b) / 2;
      const fixed = [grey * dark, g * dark, b * dark];
      out[at] = r + (fixed[0]! - r) * weight;
      out[at + 1] = g + (fixed[1]! - g) * weight;
      out[at + 2] = b + (fixed[2]! - b) * weight;
    }
  }
  return out;
}
