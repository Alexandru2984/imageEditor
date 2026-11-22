import { runJob, type PixelJob } from "@/raster/pixelJobs";

/**
 * Blend modes as the W3C compositing spec defines them (what a 2D canvas's
 * globalCompositeOperation does), on colours from 0 to 1. The GPU shader in
 * adjustGpu.ts follows the same formulas; these are its reference and the
 * fallback when there is no WebGL2.
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
};

export const blendId = (mode: string | undefined): number => BLEND_IDS[mode ?? "source-over"] ?? 0;

type Rgb = [number, number, number];

const hardLight = (cb: number, cs: number) => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));

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
      return cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 7:
      return cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
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
    default:
      return [separable(id, backdrop[0], source[0]), separable(id, backdrop[1], source[1]), separable(id, backdrop[2], source[2])];
  }
}

const toByte = (value: number) => (value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255));

/**
 * An adjustment layer on pixels (RGBA, not premultiplied), in place: each
 * pixel's colour moves towards the adjusted one, blended in `blend`, by
 * `strength` (the layer's opacity) times `mask` (0–255 a pixel, when given).
 * Alpha is left as it is: an adjustment changes colours, not coverage.
 */
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
  for (let pixel = 0, offset = 0; offset < data.length; pixel += 1, offset += 4) {
    if (data[offset + 3] === 0) continue;
    const amount = mask ? (strength * mask[pixel]!) / 255 : strength;
    if (amount <= 0) continue;
    const backdrop: Rgb = [data[offset]! / 255, data[offset + 1]! / 255, data[offset + 2]! / 255];
    const source: Rgb = [adjusted[offset]! / 255, adjusted[offset + 1]! / 255, adjusted[offset + 2]! / 255];
    const blended = id === 0 ? source : blendColors(id, backdrop, source);
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = toByte(backdrop[channel]! + (blended[channel]! - backdrop[channel]!) * amount);
    }
  }
}
