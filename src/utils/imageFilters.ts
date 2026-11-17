import * as fabric from "fabric";
import type { FabricImage } from "fabric";

// Non-destructive image adjustments. Fabric stores these as a filter stack on
// the image object and re-applies them on demand, so nothing is baked into the
// pixels: the values can always be read back and re-edited.

export const LOOKS = [
  "none",
  "blackwhite",
  "sepia",
  "vintage",
  "kodachrome",
  "technicolor",
  "polaroid",
  "brownie",
] as const;
export type FilterLook = (typeof LOOKS)[number];

export interface FilterValues {
  look: FilterLook;
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  vibrance: number; // -100..100
  warmth: number; // -100..100
  hue: number; // -100..100
  sharpen: number; // 0..100
  blur: number; // 0..100
  noise: number; // 0..100
  pixelate: number; // 0..64 (block size in pixels; below 2 is off)
}

export type NumericFilterKey = Exclude<keyof FilterValues, "look">;

export const DEFAULT_FILTERS: FilterValues = {
  look: "none",
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  warmth: 0,
  hue: 0,
  sharpen: 0,
  blur: 0,
  noise: 0,
  pixelate: 0,
};

export const FILTER_RANGES: Record<NumericFilterKey, { min: number; max: number }> = {
  brightness: { min: -100, max: 100 },
  contrast: { min: -100, max: 100 },
  saturation: { min: -100, max: 100 },
  vibrance: { min: -100, max: 100 },
  warmth: { min: -100, max: 100 },
  hue: { min: -100, max: 100 },
  sharpen: { min: 0, max: 100 },
  blur: { min: 0, max: 100 },
  noise: { min: 0, max: 100 },
  pixelate: { min: 0, max: 64 },
};

const LOOK_TYPES: Record<Exclude<FilterLook, "none">, string> = {
  blackwhite: "BlackWhite",
  sepia: "Sepia",
  vintage: "Vintage",
  kodachrome: "Kodachrome",
  technicolor: "Technicolor",
  polaroid: "Polaroid",
  brownie: "Brownie",
};

const LOOK_BY_TYPE = new Map<string, FilterLook>(
  Object.entries(LOOK_TYPES).map(([look, type]) => [type.toLowerCase(), look as FilterLook])
);

/** Warmth scales red up and blue down by at most this fraction. */
const WARMTH_STRENGTH = 0.15;
/** Sharpen kernel centre weight at 100%. */
const SHARPEN_STRENGTH = 1;
/** Fabric's noise amount at 100%. */
const NOISE_STRENGTH = 3;

const warmthMatrix = (warmth: number): number[] => {
  const w = (warmth / 100) * WARMTH_STRENGTH;
  // prettier-ignore
  return [
    1 + w, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1 - w, 0, 0,
    0, 0, 0, 1, 0,
  ];
};

const sharpenMatrix = (sharpen: number): number[] => {
  const a = (sharpen / 100) * SHARPEN_STRENGTH;
  // prettier-ignore
  return [
    0, -a, 0,
    -a, 1 + 4 * a, -a,
    0, -a, 0,
  ];
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const hasAdjustments = (v: FilterValues): boolean =>
  v.look !== "none" ||
  (Object.keys(FILTER_RANGES) as NumericFilterKey[]).some((key) =>
    key === "pixelate" ? v.pixelate >= 2 : v[key] !== 0
  );

/** Build the Fabric filter stack for slider values (fixed, stable order). */
export function buildFilters(v: FilterValues): fabric.filters.BaseFilter<string, object>[] {
  // Identity filters still cost a full image pass, so only active ones are
  // instantiated. Colour looks go first so sliders fine-tune their result.
  const next: fabric.filters.BaseFilter<string, object>[] = [];
  const f = fabric.filters;
  if (v.look !== "none") {
    const Look = (f as unknown as Record<string, new () => fabric.filters.BaseFilter<string, object>>)[
      LOOK_TYPES[v.look]
    ];
    if (Look) next.push(new Look());
  }
  if (v.brightness !== 0) next.push(new f.Brightness({ brightness: v.brightness / 100 }));
  if (v.contrast !== 0) next.push(new f.Contrast({ contrast: v.contrast / 100 }));
  if (v.saturation !== 0) next.push(new f.Saturation({ saturation: v.saturation / 100 }));
  if (v.vibrance !== 0) next.push(new f.Vibrance({ vibrance: v.vibrance / 100 }));
  if (v.warmth !== 0) next.push(new f.ColorMatrix({ matrix: warmthMatrix(v.warmth) }));
  if (v.hue !== 0) next.push(new f.HueRotation({ rotation: v.hue / 100 }));
  if (v.sharpen !== 0) next.push(new f.Convolute({ matrix: sharpenMatrix(v.sharpen) }));
  if (v.blur !== 0) next.push(new f.Blur({ blur: v.blur / 100 }));
  if (v.noise !== 0) next.push(new f.Noise({ noise: v.noise * NOISE_STRENGTH }));
  if (v.pixelate >= 2) next.push(new f.Pixelate({ blocksize: Math.round(v.pixelate) }));
  return next;
}

/** Rebuild the image's filter stack from slider values. */
export function applyFilterValues(image: FabricImage, v: FilterValues): void {
  image.filters = buildFilters(v);
  image.applyFilters();
}

type FilterLike = {
  type?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  vibrance?: number;
  blur?: number;
  rotation?: number;
  noise?: number;
  blocksize?: number;
  matrix?: number[];
};

/** Read slider values back out of an image's current filter stack. */
export function readFilterValues(filters: readonly FilterLike[] | undefined): FilterValues {
  const out: FilterValues = { ...DEFAULT_FILTERS };
  for (const filter of filters ?? []) {
    const type = typeof filter.type === "string" ? filter.type.toLowerCase() : "";
    const look = LOOK_BY_TYPE.get(type);
    if (look) {
      out.look = look;
      continue;
    }
    switch (type) {
      case "brightness":
        if (typeof filter.brightness === "number") out.brightness = Math.round(filter.brightness * 100);
        break;
      case "contrast":
        if (typeof filter.contrast === "number") out.contrast = Math.round(filter.contrast * 100);
        break;
      case "saturation":
        if (typeof filter.saturation === "number") out.saturation = Math.round(filter.saturation * 100);
        break;
      case "vibrance":
        if (typeof filter.vibrance === "number") out.vibrance = Math.round(filter.vibrance * 100);
        break;
      case "huerotation":
        if (typeof filter.rotation === "number") out.hue = Math.round(filter.rotation * 100);
        break;
      case "blur":
        if (typeof filter.blur === "number") out.blur = Math.round(filter.blur * 100);
        break;
      case "noise":
        if (typeof filter.noise === "number") out.noise = Math.round(filter.noise / NOISE_STRENGTH);
        break;
      case "pixelate":
        if (typeof filter.blocksize === "number") out.pixelate = Math.round(filter.blocksize);
        break;
      case "colormatrix":
        if (Array.isArray(filter.matrix) && typeof filter.matrix[0] === "number") {
          out.warmth = Math.round(((filter.matrix[0] - 1) / WARMTH_STRENGTH) * 100);
        }
        break;
      case "convolute":
        if (Array.isArray(filter.matrix) && typeof filter.matrix[1] === "number") {
          out.sharpen = Math.round((-filter.matrix[1] / SHARPEN_STRENGTH) * 100);
        }
        break;
    }
  }
  for (const key of Object.keys(FILTER_RANGES) as NumericFilterKey[]) {
    out[key] = clamp(out[key], FILTER_RANGES[key].min, FILTER_RANGES[key].max);
  }
  return out;
}

export interface FilterPreset {
  id: string;
  label: string;
  values: Partial<FilterValues>;
}

/** One-click looks. Each replaces every adjustment, so they never stack up. */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: "original", label: "Original", values: {} },
  { id: "vivid", label: "Vivid", values: { contrast: 15, saturation: 20, vibrance: 25, sharpen: 15 } },
  { id: "pop", label: "Pop", values: { contrast: 22, saturation: 40, brightness: 3 } },
  { id: "warm", label: "Warm", values: { warmth: 40, saturation: 8, brightness: 3 } },
  { id: "cool", label: "Cool", values: { warmth: -40, brightness: 4, contrast: 6 } },
  { id: "fade", label: "Fade", values: { contrast: -28, brightness: 8, saturation: -22 } },
  { id: "drama", label: "Drama", values: { contrast: 38, saturation: -12, sharpen: 30, brightness: -6 } },
  { id: "mono", label: "Mono", values: { look: "blackwhite", contrast: 12 } },
  { id: "noir", label: "Noir", values: { look: "blackwhite", contrast: 45, brightness: -10, noise: 10 } },
  { id: "sepia", label: "Sepia", values: { look: "sepia", contrast: 6 } },
  { id: "vintage", label: "Vintage", values: { look: "vintage", contrast: -8, noise: 12 } },
  { id: "kodachrome", label: "Kodachrome", values: { look: "kodachrome" } },
  { id: "technicolor", label: "Technicolor", values: { look: "technicolor" } },
  { id: "polaroid", label: "Polaroid", values: { look: "polaroid", brightness: 4 } },
  { id: "brownie", label: "Brownie", values: { look: "brownie" } },
  { id: "lofi", label: "Lo-fi", values: { contrast: 30, saturation: 30, noise: 18, warmth: 12 } },
];

export const presetValues = (preset: FilterPreset): FilterValues => ({
  ...DEFAULT_FILTERS,
  ...preset.values,
});

export const sameFilterValues = (a: FilterValues, b: FilterValues): boolean =>
  (Object.keys(DEFAULT_FILTERS) as (keyof FilterValues)[]).every((key) => a[key] === b[key]);

export interface ImageStats {
  /** Mean luminance, 0..1. */
  mean: number;
  /** 1st and 99th luminance percentiles, 0..1. */
  low: number;
  high: number;
  /** Mean chroma (max channel − min channel), 0..1. */
  chroma: number;
  /** Mean (red − blue), −1..1: positive is a warm cast. */
  cast: number;
}

/** Luminance histogram statistics of RGBA pixels, ignoring transparent ones. */
export function analyzePixels(data: ArrayLike<number>): ImageStats | null {
  const histogram = new Uint32Array(256);
  let count = 0;
  let lumaSum = 0;
  let chromaSum = 0;
  let castSum = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 16) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    histogram[luma] = (histogram[luma] ?? 0) + 1;
    lumaSum += luma;
    chromaSum += Math.max(r, g, b) - Math.min(r, g, b);
    castSum += r - b;
    count += 1;
  }
  if (count === 0) return null;
  const percentile = (fraction: number) => {
    const target = fraction * count;
    let seen = 0;
    for (let level = 0; level < 256; level += 1) {
      seen += histogram[level]!;
      if (seen >= target) return level / 255;
    }
    return 1;
  };
  return {
    mean: lumaSum / count / 255,
    low: percentile(0.01),
    high: percentile(0.99),
    chroma: chromaSum / count / 255,
    cast: castSum / count / 255,
  };
}

/**
 * Conservative automatic correction: centre exposure, stretch a flat
 * histogram, lift dull colour and neutralise a strong colour cast.
 */
export function autoEnhanceValues(stats: ImageStats): FilterValues {
  const round = (value: number) => Math.round(value);
  const range = Math.max(0.01, stats.high - stats.low);
  return {
    ...DEFAULT_FILTERS,
    brightness: round(clamp((0.5 - stats.mean) * 70, -25, 25)),
    contrast: round(clamp((0.92 - range) * 60, 0, 35)),
    vibrance: round(clamp((0.3 - stats.chroma) * 120, 0, 35)),
    warmth: round(clamp(-stats.cast * 160, -30, 30)),
    sharpen: 12,
  };
}
