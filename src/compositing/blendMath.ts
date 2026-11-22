import { runJob, type PixelJob } from "@/raster/pixelJobs";

/**
 * Blend modes as the W3C compositing spec defines them (what a 2D canvas's
 * globalCompositeOperation does), and Photoshop's that a canvas does not
 * have (Linear Burn, Vivid Light, Divide, Dissolve…), on colours from 0 to 1.
 * The GPU shaders in adjustGpu.ts follow the same formulas; these are their
 * reference and the fallback when there is no WebGL2.
 */

/** The blend modes, numbered as the shader knows them. */
export const BLEND_IDS: Record<string, number> = {
  "source-over": 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  "color-dodge": 6,
  "color-burn": 7,
  "hard-light": 8,
  "soft-light": 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
  // Photoshop's own, which the canvas cannot do.
  "linear-burn": 16,
  "linear-dodge": 17,
  "vivid-light": 18,
  "linear-light": 19,
  "pin-light": 20,
  "hard-mix": 21,
  subtract: 22,
  divide: 23,
  "darker-color": 24,
  "lighter-color": 25,
  dissolve: 26,
};

/** The blend modes the compositor does itself, on the GPU: those a canvas has not. */
export const CUSTOM_BLENDS: ReadonlySet<string> = new Set(Object.keys(BLEND_IDS).filter((mode) => BLEND_IDS[mode]! >= 16));

export const isCustomBlend = (mode: string | undefined): boolean => !!mode && CUSTOM_BLENDS.has(mode);

/** Dissolve's id: a pixel shows wholly or not at all, by its alpha. */
export const DISSOLVE = 26;

export const blendId = (mode: string | undefined): number => BLEND_IDS[mode ?? "source-over"] ?? 0;

type Rgb = [number, number, number];

const hardLight = (cb: number, cs: number) => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const colorDodge = (cb: number, cs: number) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs)));
const colorBurn = (cb: number, cs: number) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs));
const vividLight = (cb: number, cs: number) => (cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * cs - 1));

function separable(id: number, cb: number, cs: number): number {
  switch (id) {
    case 1:
      return cb * cs;
    case 2:
      return cb + cs - cb * cs;
    case 3:
      return hardLight(cs, cb);
    case 4:
      return Math.min(cb, cs);
    case 5:
      return Math.max(cb, cs);
    case 6:
      return colorDodge(cb, cs);
    case 7:
      return colorBurn(cb, cs);
    case 8:
      return hardLight(cb, cs);
    case 9: {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 10:
      return Math.abs(cb - cs);
    case 11:
      return cb + cs - 2 * cb * cs;
    case 16:
      return Math.max(0, cb + cs - 1);
    case 17:
      return Math.min(1, cb + cs);
    case 18:
      return vividLight(cb, cs);
    case 19:
      return clamp01(cb + 2 * cs - 1);
    case 20:
      return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case 21:
      return cb + cs >= 1 ? 1 : 0;
    case 22:
      return Math.max(0, cb - cs);
    case 23:
      return cs <= 0 ? (cb <= 0 ? 0 : 1) : Math.min(1, cb / cs);
    default:
      return cs;
  }
}

const lum = ([r, g, b]: Rgb) => 0.3 * r + 0.59 * g + 0.11 * b;

function clipColor(color: Rgb): Rgb {
  const l = lum(color);
  const n = Math.min(...color);
  const x = Math.max(...color);
  let out = color;
  if (n < 0) out = out.map((c) => l + ((c - l) * l) / (l - n)) as Rgb;
  if (x > 1) out = out.map((c) => l + ((c - l) * (1 - l)) / (x - l)) as Rgb;
  return out;
}

const setLum = (color: Rgb, l: number): Rgb => {
  const d = l - lum(color);
  return clipColor([color[0] + d, color[1] + d, color[2] + d]);
};

const sat = (color: Rgb) => Math.max(...color) - Math.min(...color);

function setSat(color: Rgb, s: number): Rgb {
  const max = Math.max(...color);
  const min = Math.min(...color);
  if (max <= min) return [0, 0, 0];
  return color.map((c) => ((c - min) * s) / (max - min)) as Rgb;
}

/** B(Cb, Cs): the backdrop and source colours blended, before any alpha. */
export function blendColors(id: number, backdrop: Rgb, source: Rgb): Rgb {
  switch (id) {
    case 12:
      return setLum(setSat(source, sat(backdrop)), lum(backdrop));
    case 13:
      return setLum(setSat(backdrop, sat(source)), lum(backdrop));
    case 14:
      return setLum(source, lum(backdrop));
    case 15:
      return setLum(backdrop, lum(source));
    // Darker and Lighter Color pick the whole colour with the lower or higher sum.
    case 24:
      return source[0] + source[1] + source[2] < backdrop[0] + backdrop[1] + backdrop[2] ? source : backdrop;
    case 25:
      return source[0] + source[1] + source[2] > backdrop[0] + backdrop[1] + backdrop[2] ? source : backdrop;
    case DISSOLVE:
      return source;
    default:
      return [separable(id, backdrop[0], source[0]), separable(id, backdrop[1], source[1]), separable(id, backdrop[2], source[2])];
  }
}

const toByte = (value: number) => (value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255));

const tables = new Map<number, Uint8Array>();

/**
 * A separable blend mode (one channel at a time) for every pair of bytes,
 * at [backdrop << 8 | source]: worked out once, so blending a frame on the
 * CPU is a look-up a channel. Null for the modes that need the whole colour.
 */
function separableTable(id: number): Uint8Array | null {
  if (!((id >= 1 && id <= 11) || (id >= 16 && id <= 23))) return null;
  let table = tables.get(id);
  if (!table) {
    table = new Uint8Array(65536);
    for (let below = 0; below < 256; below += 1) {
      for (let layer = 0; layer < 256; layer += 1) table[(below << 8) | layer] = toByte(separable(id, below / 255, layer / 255));
    }
    tables.set(id, table);
  }
  return table;
}

/**
 * Dissolve's noise: a number from 0 to 1 for each pixel, the same on the
 * GPU (adjustGpu.ts hashes the same way) and for every render of a size.
 */
export function dissolveNoise(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65536;
}

/**
 * A layer's pixels (`source`) over what is below (`backdrop`), both RGBA
 * and not premultiplied, the same size, in `blend` at `opacity`: the result
 * goes into `backdrop`. The W3C's source-over with blending, which a canvas
 * does for its own modes.
 */
export function composePixels(
  backdrop: Uint8ClampedArray,
  source: Uint8ClampedArray,
  width: number,
  blend: string,
  opacity: number
): void {
  const id = blendId(blend);
  const table = separableTable(id);
  const generic = id !== 0 && id !== DISSOLVE && !table;
  const cb: Rgb = [0, 0, 0];
  const cs: Rgb = [0, 0, 0];
  for (let pixel = 0, offset = 0; offset < backdrop.length; pixel += 1, offset += 4) {
    let as = (source[offset + 3]! / 255) * opacity;
    if (id === DISSOLVE) as = dissolveNoise(pixel % width, Math.floor(pixel / width)) < as ? 1 : 0;
    if (as <= 0) continue;
    const ab = backdrop[offset + 3]! / 255;
    const ao = as + ab * (1 - as);
    if (generic) {
      for (let channel = 0; channel < 3; channel += 1) {
        cb[channel] = backdrop[offset + channel]! / 255;
        cs[channel] = source[offset + channel]! / 255;
      }
      const blended = blendColors(id, cb, cs);
      for (let channel = 0; channel < 3; channel += 1) {
        const mixed = (1 - ab) * cs[channel]! + ab * blended[channel]!;
        backdrop[offset + channel] = toByte((as * mixed + (1 - as) * ab * cb[channel]!) / ao);
      }
    } else {
      // In bytes; the array rounds and clamps.
      for (let channel = 0; channel < 3; channel += 1) {
        const below = backdrop[offset + channel]!;
        const layer = source[offset + channel]!;
        const blended = table ? table[(below << 8) | layer]! : layer;
        const mixed = (1 - ab) * layer + ab * blended;
        backdrop[offset + channel] = (as * mixed + (1 - as) * ab * below) / ao;
      }
    }
    backdrop[offset + 3] = toByte(ao);
  }
}

export function adjustPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  job: PixelJob,
  strength: number,
  blend: string,
  mask?: Uint8Array | null
): void {
  const adjusted = runJob(job, { data, width, height, x: 0, y: 0 }, width, height, { x: 0, y: 0 });
  const id = blendId(blend);
  const table = separableTable(id);
  const generic = id !== 0 && id !== DISSOLVE && !table;
  const backdrop: Rgb = [0, 0, 0];
  const source: Rgb = [0, 0, 0];
  for (let pixel = 0, offset = 0; offset < data.length; pixel += 1, offset += 4) {
    if (data[offset + 3] === 0) continue;
    let amount = mask ? (strength * mask[pixel]!) / 255 : strength;
    if (id === DISSOLVE) amount = dissolveNoise(pixel % width, Math.floor(pixel / width)) < amount ? 1 : 0;
    if (amount <= 0) continue;
    if (generic) {
      for (let channel = 0; channel < 3; channel += 1) {
        backdrop[channel] = data[offset + channel]! / 255;
        source[channel] = adjusted[offset + channel]! / 255;
      }
      const blended = blendColors(id, backdrop, source);
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = toByte(backdrop[channel]! + (blended[channel]! - backdrop[channel]!) * amount);
      }
      continue;
    }
    // In bytes; the array rounds and clamps.
    for (let channel = 0; channel < 3; channel += 1) {
      const below = data[offset + channel]!;
      const result = adjusted[offset + channel]!;
      const blended = table ? table[(below << 8) | result]! : result;
      data[offset + channel] = amount >= 1 ? blended : below + (blended - below) * amount;
    }
  }
}
