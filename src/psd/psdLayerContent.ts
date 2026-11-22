import type { AdjustmentLayer as PsdAdjustment, Color, ColorStop, OpacityStop, VectorContent } from "ag-psd";
import { readAdjustment, type AdjustmentData } from "@/adjustments/adjustmentData";
import { MAX_GRADIENT_SCALE, MIN_GRADIENT_SCALE, readFill, type FillContent, type GradientStyle } from "@/adjustments/fillData";
import {
  CHANNELS,
  DEFAULT_BLACK_WHITE,
  DEFAULT_LEVELS_CHANNEL,
  LINEAR_CURVE,
  MAX_CURVE_POINTS,
  type CurvePoint,
  type CurvesSettings,
  type LevelsChannel,
  type LevelsSettings,
} from "@/raster/adjustments";

/**
 * Adjustment and fill layers between Photoshop's files (as ag-psd reads and
 * writes them) and the editor. What comes from a file is untrusted: every
 * value is brought into the editor's ranges, and the result is checked as a
 * project file's would be. Runs in the PSD worker, so nothing here needs the
 * page.
 */

/** What was read, and whether some of it had to be left out or changed. */
export interface Read<T> {
  value: T;
  simplified: boolean;
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A value in a range, and whether it had to be moved into it. */
function within(value: unknown, fallback: number, min: number, max: number): [number, boolean] {
  const number = finite(value, fallback);
  const kept = clamp(number, min, max);
  return [kept, kept !== number];
}

// ---------- Colours ----------

const hexOf = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((part) => Math.round(clamp(finite(part, 0), 0, 255)).toString(16).padStart(2, "0")).join("");

function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = (((h % 1) + 1) % 1) * 6;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const [r, g, b] =
    hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = v - chroma;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** CIE Lab (D50, as Photoshop keeps it) to sRGB. */
function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (116 * t - 16) / 903.3);
  const [x, y, z] = [0.9642 * inverse(fx), 1 * inverse(fy), 0.8251 * inverse(fz)];
  // XYZ (D50) to linear sRGB, with Bradford adaptation to D65.
  const lr = 3.1338561 * x - 1.6168667 * y - 0.4906146 * z;
  const lg = -0.9787684 * x + 1.9161415 * y + 0.033454 * z;
  const lb = 0.0719453 * x - 0.2289914 * y + 1.4052427 * z;
  const gamma = (value: number) => 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(Math.max(0, value), 1 / 2.4) - 0.055);
  return [gamma(lr), gamma(lg), gamma(lb)];
}

/** A colour from a file as #rrggbb, or null when it is not one. */
export function hexOfPsdColor(color: Color | undefined): string | null {
  if (!color || typeof color !== "object") return null;
  const value = color as Record<string, unknown>;
  const n = (key: string) => finite(value[key], Number.NaN);
  if ("r" in value) return [n("r"), n("g"), n("b")].every(Number.isFinite) ? hexOf(n("r"), n("g"), n("b")) : null;
  if ("fr" in value) return [n("fr"), n("fg"), n("fb")].every(Number.isFinite) ? hexOf(n("fr") * 255, n("fg") * 255, n("fb") * 255) : null;
  if ("h" in value) {
    if (![n("h"), n("s"), n("b")].every(Number.isFinite)) return null;
    return hexOf(...hsbToRgb(n("h"), clamp(n("s"), 0, 1), clamp(n("b"), 0, 1)));
  }
  if ("c" in value) {
    if (![n("c"), n("m"), n("y"), n("k")].every(Number.isFinite)) return null;
    const ink = (part: number) => 1 - clamp(part, 0, 255) / 255;
    const black = ink(n("k"));
    return hexOf(255 * ink(n("c")) * black, 255 * ink(n("m")) * black, 255 * ink(n("y")) * black);
  }
  if ("l" in value) {
    if (![n("l"), n("a"), n("b")].every(Number.isFinite)) return null;
    // ag-psd keeps L from 0 to 1 and a and b from −1 to 1.
    return hexOf(...labToRgb(clamp(n("l"), 0, 1) * 100, clamp(n("a"), -1, 1) * 128, clamp(n("b"), -1, 1) * 128));
  }
  if ("k" in value) {
    if (!Number.isFinite(n("k"))) return null;
    const grey = 255 - clamp(n("k"), 0, 255);
    return hexOf(grey, grey, grey);
  }
  return null;
}

const rgbOfHex = (hex: string) => {
  const value = parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
};

/** A gradient's two ends from its stops, and whether it had more than that. */
function endsOf(colorStops: ColorStop[] | undefined, opacityStops: OpacityStop[] | undefined): Read<[string, string]> | null {
  const stops = (Array.isArray(colorStops) ? colorStops : []).filter((stop) => stop && typeof stop === "object");
  if (!stops.length) return null;
  const sorted = [...stops].sort((a, b) => finite(a.location, 0) - finite(b.location, 0));
  const from = hexOfPsdColor(sorted[0]!.color);
  const to = hexOfPsdColor(sorted[sorted.length - 1]!.color);
  if (!from || !to) return null;
  const evenMidpoint = (stop: { midpoint?: number }) => Math.abs(finite(stop.midpoint, 0.5) - 0.5) < 0.01;
  const opaque = (Array.isArray(opacityStops) ? opacityStops : []).every((stop) => finite(stop?.opacity, 1) >= 0.999);
  const simplified =
    stops.length > 2 ||
    !evenMidpoint(sorted[0]!) ||
    !opaque ||
    finite(sorted[0]!.location, 0) > 0.001 ||
    finite(sorted[sorted.length - 1]!.location, 1) < 0.999;
  return { value: [from, to], simplified };
}

const twoStops = (from: string, to: string) => ({
  colorStops: [
    { color: rgbOfHex(from), location: 0, midpoint: 0.5 },
    { color: rgbOfHex(to), location: 1, midpoint: 0.5 },
  ],
  opacityStops: [
    { opacity: 1, location: 0, midpoint: 0.5 },
    { opacity: 1, location: 1, midpoint: 0.5 },
  ],
});

// ---------- Adjustments ----------

function levelsChannelOf(value: unknown): Read<LevelsChannel> {
  if (!value || typeof value !== "object") return { value: { ...DEFAULT_LEVELS_CHANNEL }, simplified: false };
  const channel = value as Record<string, unknown>;
  const [inBlack, a] = within(channel.shadowInput, 0, 0, 253);
  const [inWhite, b] = within(channel.highlightInput, 255, inBlack + 2, 255);
  const [gamma, c] = within(channel.midtoneInput, 1, 0.1, 9.99);
  const [outBlack, d] = within(channel.shadowOutput, 0, 0, 255);
  const [outWhite, e] = within(channel.highlightOutput, 255, 0, 255);
  return { value: { inBlack, inWhite, gamma, outBlack, outWhite }, simplified: a || b || c || d || e };
}

/** Points through a curve, at most as many as the editor keeps. */
function curveOf(value: unknown): Read<CurvePoint[]> {
  if (!Array.isArray(value) || value.length === 0) return { value: [...LINEAR_CURVE], simplified: false };
  let simplified = false;
  const points: CurvePoint[] = [];
  for (const point of value) {
    if (!point || typeof point !== "object") continue;
    const [input, a] = within((point as Record<string, unknown>).input, Number.NaN, 0, 255);
    const [output, b] = within((point as Record<string, unknown>).output, Number.NaN, 0, 255);
    if (!Number.isFinite(input) || !Number.isFinite(output)) {
      simplified = true;
      continue;
    }
    simplified ||= a || b;
    points.push([input, output]);
  }
  points.sort((a, b) => a[0] - b[0]);
  if (!points.length) return { value: [...LINEAR_CURVE], simplified: true };
  if (points.length <= MAX_CURVE_POINTS) return { value: points, simplified };
  const step = (points.length - 1) / (MAX_CURVE_POINTS - 1);
  return { value: Array.from({ length: MAX_CURVE_POINTS }, (_, index) => points[Math.round(index * step)]!), simplified: true };
}

/** A curve drawn with Photoshop's pencil (a table of 256 values) as points through it. */
function curveOfTable(value: unknown): Read<CurvePoint[]> {
  if (!Array.isArray(value) || value.length < 2) return { value: [...LINEAR_CURVE], simplified: value !== undefined };
  const last = value.length - 1;
  const points: CurvePoint[] = Array.from({ length: MAX_CURVE_POINTS }, (_, index) => {
    const at = Math.round((index * last) / (MAX_CURVE_POINTS - 1));
    return [(at * 255) / last, clamp(finite(value[at], at), 0, 255)];
  });
  return { value: points, simplified: true };
}

const hueShift = (value: unknown) => {
  const channel = (value ?? {}) as Record<string, unknown>;
  return finite(channel.hue, 0) !== 0 || finite(channel.saturation, 0) !== 0 || finite(channel.lightness, 0) !== 0;
};

const shiftOf = (value: unknown): Read<[number, number, number]> => {
  const balance = (value ?? {}) as Record<string, unknown>;
  const [r, a] = within(balance.cyanRed, 0, -100, 100);
  const [g, b] = within(balance.magentaGreen, 0, -100, 100);
  const [bl, c] = within(balance.yellowBlue, 0, -100, 100);
  return { value: [r, g, bl], simplified: a || b || c };
};

function readPsdAdjustment(adjustment: PsdAdjustment): Read<unknown> | null {
  switch (adjustment.type) {
    case "brightness/contrast": {
      const [brightness, a] = within(adjustment.brightness, 0, -150, 150);
      const [contrast, b] = within(adjustment.contrast, 0, -50, 100);
      // The legacy one shifts levels in a straight line; the editor's is today's.
      return { value: { kind: "brightnessContrast", settings: { brightness, contrast } }, simplified: a || b || !!adjustment.useLegacy };
    }
    case "levels": {
      const channels = Array.isArray(adjustment.channels) ? adjustment.channels : [];
      let simplified = channels.length > CHANNELS.length;
      const settings = {} as LevelsSettings;
      CHANNELS.forEach((channel, index) => {
        const read = levelsChannelOf(channels[index]);
        settings[channel] = read.value;
        simplified ||= read.simplified;
      });
      return { value: { kind: "levels", settings }, simplified };
    }
    case "curves": {
      const table = Array.isArray(adjustment.values);
      const channels = (table ? adjustment.values : adjustment.channels) ?? [];
      let simplified = Array.isArray(channels) && channels.slice(CHANNELS.length).some((channel) => Array.isArray(channel) && channel.length > 0);
      const settings = {} as CurvesSettings;
      CHANNELS.forEach((channel, index) => {
        const read = table ? curveOfTable(channels[index]) : curveOf(channels[index]);
        settings[channel] = read.value;
        simplified ||= read.simplified;
      });
      return { value: { kind: "curves", settings }, simplified };
    }
    case "exposure": {
      const [exposure, a] = within(adjustment.exposure, 0, -20, 20);
      const [offset, b] = within(adjustment.offset, 0, -0.5, 0.5);
      const [gamma, c] = within(adjustment.gamma, 1, 0.01, 9.99);
      return { value: { kind: "exposure", settings: { exposure, offset, gamma } }, simplified: a || b || c };
    }
    case "hue/saturation": {
      const colorize = !!adjustment.colorize;
      const source = (colorize ? adjustment.colorization : adjustment.master) ?? { hue: 0, saturation: colorize ? 25 : 0, lightness: 0 };
      const [hue, a] = colorize ? within(source.hue, 0, 0, 360) : within(source.hue, 0, -180, 180);
      const [saturation, b] = colorize ? within(source.saturation, 25, 0, 100) : within(source.saturation, 0, -100, 100);
      const [lightness, c] = within(source.lightness, 0, -100, 100);
      // The editor changes every colour alike, not each range on its own.
      const ranges = [adjustment.reds, adjustment.yellows, adjustment.greens, adjustment.cyans, adjustment.blues, adjustment.magentas].some(hueShift);
      return { value: { kind: "hueSaturation", settings: { hue, saturation, lightness, colorize } }, simplified: a || b || c || ranges };
    }
    case "color balance": {
      const shadows = shiftOf(adjustment.shadows);
      const midtones = shiftOf(adjustment.midtones);
      const highlights = shiftOf(adjustment.highlights);
      return {
        value: {
          kind: "colorBalance",
          settings: { shadows: shadows.value, midtones: midtones.value, highlights: highlights.value, preserveLuminosity: !!adjustment.preserveLuminosity },
        },
        simplified: shadows.simplified || midtones.simplified || highlights.simplified,
      };
    }
    case "black & white": {
      let simplified = !!adjustment.useTint;
      const settings = { ...DEFAULT_BLACK_WHITE };
      for (const name of Object.keys(DEFAULT_BLACK_WHITE) as (keyof typeof DEFAULT_BLACK_WHITE)[]) {
        const [value, moved] = within(adjustment[name], DEFAULT_BLACK_WHITE[name], -200, 300);
        settings[name] = value;
        simplified ||= moved;
      }
      return { value: { kind: "blackWhite", settings }, simplified };
    }
    case "gradient map": {
      if (adjustment.gradientType === "noise") return null;
      const ends = endsOf(adjustment.colorStops, adjustment.opacityStops);
      if (!ends) return null;
      const [from, to] = ends.value;
      return { value: { kind: "gradientMap", settings: { from, to, reverse: !!adjustment.reverse } }, simplified: ends.simplified };
    }
    case "posterize": {
      const [levels, moved] = within(adjustment.levels, 4, 2, 255);
      return { value: { kind: "posterize", settings: { levels: Math.round(levels) } }, simplified: moved };
    }
    case "threshold": {
      const [level, moved] = within(adjustment.level, 128, 1, 255);
      return { value: { kind: "threshold", settings: { level } }, simplified: moved };
    }
    case "invert":
      return { value: { kind: "invert", settings: {} }, simplified: false };
    default:
      // Vibrance, Photo Filter, Channel Mixer, Color Lookup, Selective Color.
      return null;
  }
}

/** An adjustment layer's settings from a file, or null when the editor has nothing like it. */
export function adjustmentFromPsd(adjustment: PsdAdjustment | undefined): Read<AdjustmentData> | null {
  if (!adjustment || typeof adjustment !== "object") return null;
  const read = readPsdAdjustment(adjustment);
  const value = read ? readAdjustment(read.value) : null;
  return read && value ? { value, simplified: read.simplified } : null;
}

const levelsChannelToPsd = (channel: LevelsChannel) => ({
  shadowInput: Math.round(channel.inBlack),
  highlightInput: Math.round(channel.inWhite),
  shadowOutput: Math.round(channel.outBlack),
  highlightOutput: Math.round(channel.outWhite),
  midtoneInput: channel.gamma,
});

/** An adjustment layer's settings as Photoshop keeps them. */
export function adjustmentToPsd(adjustment: AdjustmentData): PsdAdjustment {
  switch (adjustment.kind) {
    case "brightnessContrast":
      return {
        type: "brightness/contrast",
        brightness: Math.round(adjustment.settings.brightness),
        contrast: Math.round(adjustment.settings.contrast),
        useLegacy: false,
      };
    case "levels":
      return { type: "levels", channels: CHANNELS.map((channel) => levelsChannelToPsd(adjustment.settings[channel])) };
    case "curves":
      return {
        type: "curves",
        channels: CHANNELS.map((channel) =>
          [...adjustment.settings[channel]]
            .sort((a, b) => a[0] - b[0])
            .map(([input, output]) => ({ input: Math.round(input), output: Math.round(output) }))
        ),
      };
    case "exposure":
      return { type: "exposure", ...adjustment.settings };
    case "hueSaturation": {
      const { hue, saturation, lightness, colorize } = adjustment.settings;
      const values = { hue: Math.round(hue), saturation: Math.round(saturation), lightness: Math.round(lightness) };
      return {
        type: "hue/saturation",
        colorize,
        colorization: colorize ? values : { hue: 0, saturation: 25, lightness: 0 },
        master: colorize ? { hue: 0, saturation: 0, lightness: 0 } : values,
      };
    }
    case "colorBalance": {
      const balance = ([cyanRed, magentaGreen, yellowBlue]: readonly number[]) => ({
        cyanRed: Math.round(cyanRed!),
        magentaGreen: Math.round(magentaGreen!),
        yellowBlue: Math.round(yellowBlue!),
      });
      const { shadows, midtones, highlights, preserveLuminosity } = adjustment.settings;
      return { type: "color balance", shadows: balance(shadows), midtones: balance(midtones), highlights: balance(highlights), preserveLuminosity };
    }
    case "blackWhite": {
      const { reds, yellows, greens, cyans, blues, magentas } = adjustment.settings;
      return { type: "black & white", reds, yellows, greens, cyans, blues, magentas, useTint: false };
    }
    case "gradientMap":
      return {
        type: "gradient map",
        name: "Custom",
        gradientType: "solid",
        reverse: adjustment.settings.reverse,
        smoothness: 1,
        ...twoStops(adjustment.settings.from, adjustment.settings.to),
      };
    case "posterize":
      return { type: "posterize", levels: adjustment.settings.levels };
    case "threshold":
      return { type: "threshold", level: Math.round(adjustment.settings.level) };
    case "invert":
      return { type: "invert" };
  }
}

// ---------- Fills ----------

const STYLES: Partial<Record<string, GradientStyle>> = { linear: "linear", radial: "radial", reflected: "reflected" };

/** A fill layer's content from a file, or null when the editor has nothing like it (patterns, noise). */
export function fillFromPsd(fill: VectorContent | undefined): Read<FillContent> | null {
  if (!fill || typeof fill !== "object") return null;
  let read: Read<unknown> | null = null;
  if (fill.type === "color") {
    const color = hexOfPsdColor(fill.color);
    read = color ? { value: { kind: "solid", color }, simplified: false } : null;
  } else if (fill.type === "solid") {
    const ends = endsOf(fill.colorStops, fill.opacityStops);
    if (!ends) return null;
    const style = STYLES[fill.style ?? "linear"];
    // Photoshop's angles run −180 to 180, counter-clockwise from pointing right.
    let angle = ((finite(fill.angle, 90) % 360) + 360) % 360;
    if (angle > 180) angle -= 360;
    const [scale, scaled] = within(finite(fill.scale, 1) * 100, 100, MIN_GRADIENT_SCALE, MAX_GRADIENT_SCALE);
    const offset = Math.abs(finite(fill.offset?.x, 0)) > 0.001 || Math.abs(finite(fill.offset?.y, 0)) > 0.001;
    read = {
      value: { kind: "gradient", from: ends.value[0], to: ends.value[1], style: style ?? "linear", angle, scale, reverse: !!fill.reverse },
      simplified: ends.simplified || !style || scaled || offset,
    };
  }
  const value = read ? readFill(read.value) : null;
  return read && value ? { value, simplified: read.simplified } : null;
}

/** A fill layer's content as Photoshop keeps it. */
export function fillToPsd(content: FillContent): VectorContent {
  if (content.kind === "solid") return { type: "color", color: rgbOfHex(content.color) };
  return {
    type: "solid",
    name: "Custom",
    style: content.style,
    angle: content.angle,
    scale: content.scale / 100,
    reverse: content.reverse,
    align: true,
    ...twoStops(content.from, content.to),
  };
}
