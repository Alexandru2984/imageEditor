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

// ---------- Tone ----------

/** Same table for every channel. */
export const uniformLuts = (lut: Lut): Luts => ({ r: lut, g: lut, b: lut });

export interface BrightnessContrastSettings {
  /** −150 to 150, as in Photoshop. */
  brightness: number;
  /** −50 to 100, as in Photoshop. */
  contrast: number;
}

export function brightnessContrastLut({ brightness, contrast }: BrightnessContrastSettings): Lut {
  const lift = Math.max(-1, Math.min(1, brightness / 150)) * 0.5;
  // Contrast turns the line about middle grey; 100 is close to a threshold.
  const slope = Math.tan((Math.max(-0.5, Math.min(0.98, contrast / 100)) + 1) * (Math.PI / 4));
  return Uint8Array.from({ length: 256 }, (_, level) => {
    let value = level / 255;
    value = lift < 0 ? value * (1 + lift) : value + (1 - value) * lift;
    value = (value - 0.5) * slope + 0.5;
    return clampByte(value * 255);
  });
}

export interface ExposureSettings {
  /** Stops of light. */
  exposure: number;
  /** Added to every level (−0.5 to 0.5), in linear light. */
  offset: number;
  gamma: number;
}

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
const toSrgb = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055);

/** Exposure works on light, not on the sRGB levels the pixels are stored in. */
export function exposureLut({ exposure, offset, gamma }: ExposureSettings): Lut {
  const gain = Math.pow(2, exposure);
  const power = 1 / Math.max(0.01, gamma);
  return Uint8Array.from({ length: 256 }, (_, level) => {
    const light = Math.max(0, toLinear(level / 255) * gain + offset);
    return clampByte(toSrgb(Math.min(1, Math.pow(light, power))) * 255);
  });
}

export const posterizeLut = (levels: number): Lut => {
  const steps = Math.max(1, Math.round(levels) - 1);
  return Uint8Array.from({ length: 256 }, (_, level) => clampByte((Math.round((level / 255) * steps) / steps) * 255));
};

export const invertLut = (): Lut => Uint8Array.from({ length: 256 }, (_, level) => 255 - level);

// ---------- Colour, pixel by pixel ----------

/** Rec. 601 luminosity of a pixel, as Photoshop's Threshold and Gradient Map see it. */
const luminosity = (r: number, g: number, b: number) => (r * 77 + g * 150 + b * 29 + 128) >> 8;

/** Every pixel black or white, split at `level`. */
export function threshold(source: Uint8ClampedArray, target: Uint8ClampedArray, level: number): void {
  for (let offset = 0; offset < source.length; offset += 4) {
    const value = luminosity(source[offset]!, source[offset + 1]!, source[offset + 2]!) >= level ? 255 : 0;
    target[offset] = value;
    target[offset + 1] = value;
    target[offset + 2] = value;
    target[offset + 3] = source[offset + 3]!;
  }
}

/** Photoshop's Desaturate: each pixel's HSL lightness. */
export function desaturate(source: Uint8ClampedArray, target: Uint8ClampedArray): void {
  for (let offset = 0; offset < source.length; offset += 4) {
    const r = source[offset]!;
    const g = source[offset + 1]!;
    const b = source[offset + 2]!;
    const value = (Math.max(r, g, b) + Math.min(r, g, b) + 1) >> 1;
    target[offset] = value;
    target[offset + 1] = value;
    target[offset + 2] = value;
    target[offset + 3] = source[offset + 3]!;
  }
}

export interface GradientMapSettings {
  /** The colour shadows map to. */
  from: string;
  /** The colour highlights map to. */
  to: string;
  reverse: boolean;
}

const rgbOf = (hex: string): [number, number, number] => {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** Each pixel's luminosity, looked up along a two-colour gradient. */
export function gradientMapLuts({ from, to, reverse }: GradientMapSettings): Luts {
  const [start, end] = reverse ? [rgbOf(to), rgbOf(from)] : [rgbOf(from), rgbOf(to)];
  const table = (channel: 0 | 1 | 2) =>
    Uint8Array.from({ length: 256 }, (_, level) => clampByte(start[channel] + ((end[channel] - start[channel]) * level) / 255));
  return { r: table(0), g: table(1), b: table(2) };
}

export function gradientMap(source: Uint8ClampedArray, target: Uint8ClampedArray, luts: Luts): void {
  for (let offset = 0; offset < source.length; offset += 4) {
    const level = luminosity(source[offset]!, source[offset + 1]!, source[offset + 2]!);
    target[offset] = luts.r[level]!;
    target[offset + 1] = luts.g[level]!;
    target[offset + 2] = luts.b[level]!;
    target[offset + 3] = source[offset + 3]!;
  }
}

export interface BlackWhiteSettings {
  /** How light each colour turns, in percent (−200 to 300), as in Photoshop. */
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
}

export const DEFAULT_BLACK_WHITE: BlackWhiteSettings = {
  reds: 40,
  yellows: 60,
  greens: 40,
  cyans: 60,
  blues: 20,
  magentas: 80,
};

/**
 * Photoshop's Black & White: a pixel's grey is its weakest channel plus its
 * colour, weighed by the primary (strongest channel) and the secondary
 * (strongest two) colour it is made of.
 */
export function blackWhite(source: Uint8ClampedArray, target: Uint8ClampedArray, weights: BlackWhiteSettings): void {
  const w = {
    reds: weights.reds / 100,
    yellows: weights.yellows / 100,
    greens: weights.greens / 100,
    cyans: weights.cyans / 100,
    blues: weights.blues / 100,
    magentas: weights.magentas / 100,
  };
  for (let offset = 0; offset < source.length; offset += 4) {
    const r = source[offset]!;
    const g = source[offset + 1]!;
    const b = source[offset + 2]!;
    let primary: number;
    let secondary: number;
    let max: number;
    let mid: number;
    let min: number;
    if (r >= g && r >= b) {
      max = r;
      primary = w.reds;
      if (g >= b) [mid, min, secondary] = [g, b, w.yellows];
      else [mid, min, secondary] = [b, g, w.magentas];
    } else if (g >= r && g >= b) {
      max = g;
      primary = w.greens;
      if (r >= b) [mid, min, secondary] = [r, b, w.yellows];
      else [mid, min, secondary] = [b, r, w.cyans];
    } else {
      max = b;
      primary = w.blues;
      if (g >= r) [mid, min, secondary] = [g, r, w.cyans];
      else [mid, min, secondary] = [r, g, w.magentas];
    }
    const value = clampByte(min + (max - mid) * primary + (mid - min) * secondary);
    target[offset] = value;
    target[offset + 1] = value;
    target[offset + 2] = value;
    target[offset + 3] = source[offset + 3]!;
  }
}

/** RGB (0–255) to HSL (hue 0–1, saturation 0–1, lightness 0–1), into `out`. */
function toHsl(r: number, g: number, b: number, out: Float64Array) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;
  const delta = max - min;
  if (delta > 0) {
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
  }
  out[0] = hue;
  out[1] = saturation;
  out[2] = lightness;
}

const hueChannel = (p: number, q: number, t: number) => {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
};

/** HSL back to RGB bytes at `offset` of `target`. */
function fromHsl(hue: number, saturation: number, lightness: number, target: Uint8ClampedArray, offset: number) {
  if (saturation <= 0) {
    const value = clampByte(lightness * 255);
    target[offset] = value;
    target[offset + 1] = value;
    target[offset + 2] = value;
    return;
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  target[offset] = clampByte(hueChannel(p, q, hue + 1 / 3) * 255);
  target[offset + 1] = clampByte(hueChannel(p, q, hue) * 255);
  target[offset + 2] = clampByte(hueChannel(p, q, hue - 1 / 3) * 255);
}

export interface HueSaturationSettings {
  /** Degrees (−180 to 180); with colorize, the hue itself (0 to 360). */
  hue: number;
  /** −100 to 100; with colorize, 0 to 100. */
  saturation: number;
  /** −100 to 100. */
  lightness: number;
  /** Tint the image with one hue, keeping its tones. */
  colorize: boolean;
}

export function hueSaturation(source: Uint8ClampedArray, target: Uint8ClampedArray, settings: HueSaturationSettings): void {
  const hsl = new Float64Array(3);
  const shift = settings.hue / 360;
  const saturate = settings.saturation / 100;
  const lighten = settings.lightness / 100;
  for (let offset = 0; offset < source.length; offset += 4) {
    toHsl(source[offset]!, source[offset + 1]!, source[offset + 2]!, hsl);
    let [hue, saturation, lightness] = [hsl[0]!, hsl[1]!, hsl[2]!];
    if (settings.colorize) {
      hue = shift - Math.floor(shift);
      saturation = Math.max(0, Math.min(1, saturate));
    } else {
      hue = hue + shift;
      hue -= Math.floor(hue);
      saturation = Math.max(0, Math.min(1, saturation * (1 + saturate)));
    }
    lightness = lighten < 0 ? lightness * (1 + lighten) : lightness + (1 - lightness) * lighten;
    fromHsl(hue, saturation, lightness, target, offset);
    target[offset + 3] = source[offset + 3]!;
  }
}

export type ToneRange = "shadows" | "midtones" | "highlights";

/** Cyan–red, magenta–green and yellow–blue shifts, −100 to 100 each. */
export type ColorShift = [number, number, number];

export interface ColorBalanceSettings {
  shadows: ColorShift;
  midtones: ColorShift;
  highlights: ColorShift;
  preserveLuminosity: boolean;
}

export const defaultColorBalance = (): ColorBalanceSettings => ({
  shadows: [0, 0, 0],
  midtones: [0, 0, 0],
  highlights: [0, 0, 0],
  preserveLuminosity: true,
});

const clampUnit = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value);

/**
 * Shift each channel by tonal range, weighed by how far into that range the
 * pixel's lightness lies (the approach GIMP takes for Photoshop's tool).
 */
export function colorBalance(source: Uint8ClampedArray, target: Uint8ClampedArray, settings: ColorBalanceSettings): void {
  const a = 0.25;
  const b = 0.333;
  const scale = 0.7;
  const hsl = new Float64Array(3);
  for (let offset = 0; offset < source.length; offset += 4) {
    const r = source[offset]!;
    const g = source[offset + 1]!;
    const bl = source[offset + 2]!;
    toHsl(r, g, bl, hsl);
    const lightness = hsl[2]!;
    const shadowWeight = clampUnit((lightness - b) / -a + 0.5) * scale;
    const midWeight = clampUnit((lightness - b) / a + 0.5) * clampUnit((lightness + b - 1) / -a + 0.5) * scale;
    const highWeight = clampUnit((lightness + b - 1) / a + 0.5) * scale;
    const channels = [r, g, bl];
    for (let channel = 0; channel < 3; channel += 1) {
      const shift =
        (settings.shadows[channel]! * shadowWeight +
          settings.midtones[channel]! * midWeight +
          settings.highlights[channel]! * highWeight) /
        100;
      target[offset + channel] = clampByte(clampUnit(channels[channel]! / 255 + shift) * 255);
    }
    if (settings.preserveLuminosity) {
      toHsl(target[offset]!, target[offset + 1]!, target[offset + 2]!, hsl);
      fromHsl(hsl[0]!, hsl[1]!, lightness, target, offset);
    }
    target[offset + 3] = source[offset + 3]!;
  }
}
