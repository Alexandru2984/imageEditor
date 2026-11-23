/**
 * Select › Color Range, as in Photoshop: how much each pixel is selected,
 * by its likeness to colours sampled from the image (with Fuzziness), by a
 * colour family (Reds … Magentas), or by its tone (Highlights, Midtones,
 * Shadows). Pure, so the dialog's preview and the full-size result share
 * it: a table over every colour is worked out once, then each pixel is a
 * look-up.
 */

export type ColorRangeTarget =
  | "sampled"
  | "reds"
  | "yellows"
  | "greens"
  | "cyans"
  | "blues"
  | "magentas"
  | "highlights"
  | "midtones"
  | "shadows";

export type Rgb = readonly [number, number, number];

export interface ColorRangeSettings {
  target: ColorRangeTarget;
  /** 0–200: how far from a sampled colour (or outside a tone) pixels are still partly selected. */
  fuzziness: number;
  /** Colours to select, and colours to leave out. */
  samples: readonly Rgb[];
  excluded: readonly Rgb[];
  invert: boolean;
}

export const COLOR_RANGE_TARGETS: { value: ColorRangeTarget; label: string }[] = [
  { value: "sampled", label: "Sampled Colors" },
  { value: "reds", label: "Reds" },
  { value: "yellows", label: "Yellows" },
  { value: "greens", label: "Greens" },
  { value: "cyans", label: "Cyans" },
  { value: "blues", label: "Blues" },
  { value: "magentas", label: "Magentas" },
  { value: "highlights", label: "Highlights" },
  { value: "midtones", label: "Midtones" },
  { value: "shadows", label: "Shadows" },
];

export const DEFAULT_COLOR_RANGE: ColorRangeSettings = {
  target: "sampled",
  fuzziness: 40,
  samples: [],
  excluded: [],
  invert: false,
};

const HUES: Partial<Record<ColorRangeTarget, number>> = {
  reds: 0,
  yellows: 60,
  greens: 120,
  cyans: 180,
  blues: 240,
  magentas: 300,
};

/** The tones each range covers fully, in luminance (0–255). */
const TONES: Partial<Record<ColorRangeTarget, readonly [number, number]>> = {
  shadows: [0, 64],
  midtones: [96, 160],
  highlights: [192, 255],
};

export const usesFuzziness = (target: ColorRangeTarget): boolean => target === "sampled" || target in TONES;

const LEVELS = 64;
const STEP = 256 / LEVELS;
/** The colour a table cell stands for (its middle). */
const centre = (level: number) => level * STEP + STEP / 2 - 0.5;
const levelOf = (value: number) => Math.min(LEVELS - 1, Math.max(0, Math.floor(value / STEP)));
const clamp01 = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value);

/** Fully selected within half the fuzziness, fading out to none at the fuzziness. */
function falloff(distance: number, fuzziness: number): number {
  if (distance <= fuzziness / 2) return 1;
  if (distance >= fuzziness) return 0;
  return (fuzziness - distance) / (fuzziness / 2);
}

function hueWeight(r: number, g: number, b: number, hue: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma <= 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / chroma) * 60;
  else if (max === g) h = ((b - r) / chroma + 2) * 60;
  else h = ((r - g) / chroma + 4) * 60;
  const difference = Math.abs((((h - hue) % 360) + 540) % 360 - 180);
  // Fully within 15° of the hue, none past 45°; greys and near-greys are not a colour.
  return clamp01((45 - difference) / 30) * clamp01((chroma - 20) / 60);
}

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function toneWeight(level: number, range: readonly [number, number], fuzziness: number): number {
  const reach = Math.max(1, fuzziness / 2);
  if (level < range[0]) return clamp01(1 - (range[0] - level) / reach);
  if (level > range[1]) return clamp01(1 - (level - range[1]) / reach);
  return 1;
}

/**
 * How much each colour is selected (0–255), as a table of 64 levels per
 * channel, or null when nothing would be (no colour sampled yet).
 */
export function colorRangeTable(settings: ColorRangeSettings): Uint8Array | null {
  const { target, fuzziness, samples, excluded, invert } = settings;
  if (target === "sampled" && samples.length === 0) return null;
  const fuzz = Math.max(0, Math.min(200, fuzziness));
  const table = new Uint8Array(LEVELS * LEVELS * LEVELS);
  // Sampled colours are compared at their own cell's centre, so a colour
  // always matches itself, even with no fuzziness.
  const snap = (colour: Rgb) => colour.map((value) => centre(levelOf(value))) as unknown as Rgb;
  const wanted = samples.map(snap);
  const unwanted = excluded.map(snap);
  const hue = HUES[target];
  const tone = TONES[target];
  const nearest = (colours: readonly Rgb[], r: number, g: number, b: number) => {
    let best = 0;
    for (const [sr, sg, sb] of colours) {
      best = Math.max(best, falloff(Math.hypot(r - sr, g - sg, b - sb), fuzz));
      if (best === 1) break;
    }
    return best;
  };
  let index = 0;
  for (let red = 0; red < LEVELS; red += 1) {
    const r = centre(red);
    for (let green = 0; green < LEVELS; green += 1) {
      const g = centre(green);
      for (let blue = 0; blue < LEVELS; blue += 1, index += 1) {
        const b = centre(blue);
        let weight: number;
        if (hue !== undefined) weight = hueWeight(r, g, b, hue);
        else if (tone) weight = toneWeight(luminance(r, g, b), tone, fuzz);
        else weight = nearest(wanted, r, g, b);
        if (weight > 0 && unwanted.length > 0) weight = Math.max(0, weight - nearest(unwanted, r, g, b));
        if (invert) weight = 1 - weight;
        table[index] = Math.round(weight * 255);
      }
    }
  }
  return table;
}

/** How much each pixel of RGBA `pixels` is selected; transparent pixels are not. */
export function colorRangeMask(pixels: Uint8ClampedArray, table: Uint8Array): Uint8Array {
  const out = new Uint8Array(pixels.length / 4);
  for (let index = 0, offset = 0; index < out.length; index += 1, offset += 4) {
    const alpha = pixels[offset + 3]!;
    if (alpha === 0) continue;
    const cell =
      ((pixels[offset]! >> 2) << 12) | ((pixels[offset + 1]! >> 2) << 6) | (pixels[offset + 2]! >> 2);
    const value = table[cell]!;
    out[index] = alpha === 255 ? value : Math.round((value * alpha) / 255);
  }
  return out;
}
