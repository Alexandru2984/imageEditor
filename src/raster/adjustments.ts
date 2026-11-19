/**
 * Image › Adjustments as pixel arithmetic, as Photoshop applies them to a
 * layer: pure functions over RGBA bytes (straight alpha, which they leave
 * alone). Most are lookup tables per channel; a few look at a whole pixel.
 */

export type Lut = Uint8Array;

/** A lookup table for each colour channel. */
export interface Luts {
  r: Lut;
  g: Lut;
  b: Lut;
}

export type Channel = "rgb" | "red" | "green" | "blue";
export const CHANNELS: readonly Channel[] = ["rgb", "red", "green", "blue"];

const clampByte = (value: number) => (value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value));

export const identityLut = (): Lut => Uint8Array.from({ length: 256 }, (_, index) => index);

/** `inner` then `outer`. */
export const composeLut = (inner: Lut, outer: Lut): Lut => Uint8Array.from(inner, (value) => outer[value]!);

/**
 * Channel tables applied before a composite one, as Photoshop applies a
 * channel's own levels or curve before the RGB one.
 */
export const channelLuts = (rgb: Lut, red: Lut, green: Lut, blue: Lut): Luts => ({
  r: composeLut(red, rgb),
  g: composeLut(green, rgb),
  b: composeLut(blue, rgb),
});

/** Map every pixel's colour through the tables; alpha is kept. */
export function applyLuts(source: Uint8ClampedArray, target: Uint8ClampedArray, { r, g, b }: Luts): void {
  for (let offset = 0; offset < source.length; offset += 4) {
    target[offset] = r[source[offset]!]!;
    target[offset + 1] = g[source[offset + 1]!]!;
    target[offset + 2] = b[source[offset + 2]!]!;
    target[offset + 3] = source[offset + 3]!;
  }
}

// ---------- Levels ----------

export interface LevelsChannel {
  inBlack: number;
  inWhite: number;
  /** Midtones: above 1 lightens, below 1 darkens. */
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export type LevelsSettings = Record<Channel, LevelsChannel>;

export const DEFAULT_LEVELS_CHANNEL: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };

export const defaultLevels = (): LevelsSettings => ({
  rgb: { ...DEFAULT_LEVELS_CHANNEL },
  red: { ...DEFAULT_LEVELS_CHANNEL },
  green: { ...DEFAULT_LEVELS_CHANNEL },
  blue: { ...DEFAULT_LEVELS_CHANNEL },
});

export const GAMMA_RANGE = { min: 0.1, max: 9.99 } as const;

export function levelsLut({ inBlack, inWhite, gamma, outBlack, outWhite }: LevelsChannel): Lut {
  const low = Math.min(inBlack, inWhite - 1);
  const span = Math.max(1, inWhite - low);
  const power = 1 / Math.min(GAMMA_RANGE.max, Math.max(GAMMA_RANGE.min, gamma));
  return Uint8Array.from({ length: 256 }, (_, value) => {
    const position = Math.min(1, Math.max(0, (value - low) / span));
    return clampByte(outBlack + Math.pow(position, power) * (outWhite - outBlack));
  });
}

export const levelsLuts = (levels: LevelsSettings): Luts =>
  channelLuts(levelsLut(levels.rgb), levelsLut(levels.red), levelsLut(levels.green), levelsLut(levels.blue));

export const isDefaultLevels = (levels: LevelsSettings): boolean =>
  CHANNELS.every((channel) =>
    (Object.keys(DEFAULT_LEVELS_CHANNEL) as (keyof LevelsChannel)[]).every(
      (key) => levels[channel][key] === DEFAULT_LEVELS_CHANNEL[key]
    )
  );

// ---------- Histograms ----------

export interface Histogram {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  /** Luminosity (Rec. 601, as Photoshop's histogram). */
  rgb: Uint32Array;
  /** Pixels counted. */
  count: number;
}

/**
 * Count the colours of the visible pixels; with `weights` (one byte per
 * pixel), only those at least half selected.
 */
export function histogramOf(data: Uint8ClampedArray, weights?: Uint8Array | null): Histogram {
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  const rgb = new Uint32Array(256);
  let count = 0;
  for (let offset = 0, index = 0; offset < data.length; offset += 4, index += 1) {
    if (data[offset + 3] === 0) continue;
    if (weights && weights[index]! < 128) continue;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    red[r]! += 1;
    green[g]! += 1;
    blue[b]! += 1;
    rgb[(r * 77 + g * 150 + b * 29 + 128) >> 8]! += 1;
    count += 1;
  }
  return { red, green, blue, rgb, count };
}

/** The darkest and lightest levels once `clip` of the pixels on each end are ignored. */
export function histogramRange(bins: Uint32Array, clip = 0.001): { low: number; high: number } | null {
  let total = 0;
  for (const bin of bins) total += bin;
  if (total === 0) return null;
  const skip = total * clip;
  let low = 0;
  for (let seen = 0; low < 255; low += 1) {
    seen += bins[low]!;
    if (seen > skip) break;
  }
  let high = 255;
  for (let seen = 0; high > 0; high -= 1) {
    seen += bins[high]!;
    if (seen > skip) break;
  }
  return { low, high: Math.max(high, low + 1) };
}

/** Photoshop's Auto (Enhance Per Channel Contrast): stretch each channel to full range. */
export function autoLevels(histogram: Histogram): LevelsSettings {
  const levels = defaultLevels();
  for (const channel of ["red", "green", "blue"] as const) {
    const range = histogramRange(histogram[channel]);
    if (!range || range.high - range.low < 2) continue;
    levels[channel].inBlack = range.low;
    levels[channel].inWhite = range.high;
  }
  return levels;
}

// ---------- Curves ----------

/** A curve's control point: input level, output level (0–255). */
export type CurvePoint = readonly [number, number];
export type CurvesSettings = Record<Channel, CurvePoint[]>;

export const LINEAR_CURVE: CurvePoint[] = [
  [0, 0],
  [255, 255],
];

export const defaultCurves = (): CurvesSettings => ({
  rgb: [...LINEAR_CURVE],
  red: [...LINEAR_CURVE],
  green: [...LINEAR_CURVE],
  blue: [...LINEAR_CURVE],
});

/** At most this many points on one curve, as in Photoshop. */
export const MAX_CURVE_POINTS = 16;

/**
 * The curve through the points as a table: a smooth monotone cubic between
 * them (it never overshoots a point), flat beyond the first and last.
 */
export function curveLut(input: readonly CurvePoint[]): Lut {
  const points = [...input].sort((a, b) => a[0] - b[0]).filter((point, index, all) => index === 0 || point[0] !== all[index - 1]![0]);
  if (points.length === 0) return identityLut();
  if (points.length === 1) return new Uint8Array(256).fill(clampByte(points[0]![1]));
  const count = points.length;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    slopes.push((ys[index + 1]! - ys[index]!) / (xs[index + 1]! - xs[index]!));
  }
  // Fritsch–Carlson tangents.
  const tangents = new Array<number>(count);
  tangents[0] = slopes[0]!;
  tangents[count - 1] = slopes[count - 2]!;
  for (let index = 1; index < count - 1; index += 1) {
    const before = slopes[index - 1]!;
    const after = slopes[index]!;
    tangents[index] = before * after <= 0 ? 0 : (before + after) / 2;
  }
  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index]!;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = tangents[index]! / slope;
    const b = tangents[index + 1]! / slope;
    const length = a * a + b * b;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }
  const lut = new Uint8Array(256);
  let segment = 0;
  for (let x = 0; x < 256; x += 1) {
    if (x <= xs[0]!) {
      lut[x] = clampByte(ys[0]!);
      continue;
    }
    if (x >= xs[count - 1]!) {
      lut[x] = clampByte(ys[count - 1]!);
      continue;
    }
    while (x > xs[segment + 1]!) segment += 1;
    const x0 = xs[segment]!;
    const width = xs[segment + 1]! - x0;
    const t = (x - x0) / width;
    const t2 = t * t;
    const t3 = t2 * t;
    const value =
      (2 * t3 - 3 * t2 + 1) * ys[segment]! +
      (t3 - 2 * t2 + t) * width * tangents[segment]! +
      (-2 * t3 + 3 * t2) * ys[segment + 1]! +
      (t3 - t2) * width * tangents[segment + 1]!;
    lut[x] = clampByte(value);
  }
  return lut;
}

export const curvesLuts = (curves: CurvesSettings): Luts =>
  channelLuts(curveLut(curves.rgb), curveLut(curves.red), curveLut(curves.green), curveLut(curves.blue));

export const isLinearCurve = (points: readonly CurvePoint[]): boolean =>
  points.length === 2 && points[0]![0] === 0 && points[0]![1] === 0 && points[1]![0] === 255 && points[1]![1] === 255;

export const isDefaultCurves = (curves: CurvesSettings): boolean => CHANNELS.every((channel) => isLinearCurve(curves[channel]));

/** Curves presets, as in Photoshop's list (on the composite channel). */
export const CURVE_PRESETS: { id: string; label: string; points: CurvePoint[] }[] = [
  { id: "default", label: "Default", points: [...LINEAR_CURVE] },
  { id: "contrast", label: "Increase contrast", points: [[0, 0], [64, 52], [192, 204], [255, 255]] },
  { id: "strong", label: "Strong contrast", points: [[0, 0], [64, 40], [192, 216], [255, 255]] },
  { id: "lighter", label: "Lighter", points: [[0, 0], [114, 144], [255, 255]] },
  { id: "darker", label: "Darker", points: [[0, 0], [144, 114], [255, 255]] },
  { id: "negative", label: "Negative", points: [[0, 255], [255, 0]] },
];
