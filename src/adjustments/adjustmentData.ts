import {
  brightnessContrastLut,
  CHANNELS,
  curvesLuts,
  DEFAULT_BLACK_WHITE,
  defaultColorBalance,
  defaultCurves,
  defaultLevels,
  exposureLut,
  gradientMapLuts,
  invertLut,
  levelsLuts,
  MAX_CURVE_POINTS,
  posterizeLut,
  uniformLuts,
  type BlackWhiteSettings,
  type BrightnessContrastSettings,
  type ColorBalanceSettings,
  type CurvePoint,
  type CurvesSettings,
  type ExposureSettings,
  type GradientMapSettings,
  type HueSaturationSettings,
  type LevelsChannel,
  type LevelsSettings,
} from "@/raster/adjustments";
import type { PixelJob } from "@/raster/pixelJobs";

/**
 * What an adjustment layer does, as plain data: saved with the project, kept
 * in the history and validated like everything read from a file.
 */

export const ADJUSTMENT_LAYER_KINDS = [
  "brightnessContrast",
  "levels",
  "curves",
  "exposure",
  "hueSaturation",
  "colorBalance",
  "blackWhite",
  "gradientMap",
  "posterize",
  "threshold",
  "invert",
] as const;

export type AdjustmentLayerKind = (typeof ADJUSTMENT_LAYER_KINDS)[number];

interface SettingsOf {
  brightnessContrast: BrightnessContrastSettings;
  levels: LevelsSettings;
  curves: CurvesSettings;
  exposure: ExposureSettings;
  hueSaturation: HueSaturationSettings;
  colorBalance: ColorBalanceSettings;
  blackWhite: BlackWhiteSettings;
  gradientMap: GradientMapSettings;
  posterize: { levels: number };
  threshold: { level: number };
  invert: Record<string, never>;
}

export type AdjustmentData = { [Kind in AdjustmentLayerKind]: { kind: Kind; settings: SettingsOf[Kind] } }[AdjustmentLayerKind];

/** The names Photoshop gives them, in its New Adjustment Layer menu. */
export const ADJUSTMENT_TITLES: Record<AdjustmentLayerKind, string> = {
  brightnessContrast: "Brightness/Contrast",
  levels: "Levels",
  curves: "Curves",
  exposure: "Exposure",
  hueSaturation: "Hue/Saturation",
  colorBalance: "Color Balance",
  blackWhite: "Black & White",
  gradientMap: "Gradient Map",
  posterize: "Posterize",
  threshold: "Threshold",
  invert: "Invert",
};

export const isAdjustmentLayerKind = (value: unknown): value is AdjustmentLayerKind =>
  typeof value === "string" && (ADJUSTMENT_LAYER_KINDS as readonly string[]).includes(value);

/** A new adjustment's settings; Gradient Map starts from the colour wells. */
export function initialAdjustment(kind: AdjustmentLayerKind, colors: { foreground: string; background: string }): AdjustmentData {
  switch (kind) {
    case "brightnessContrast":
      return { kind, settings: { brightness: 0, contrast: 0 } };
    case "levels":
      return { kind, settings: defaultLevels() };
    case "curves":
      return { kind, settings: defaultCurves() };
    case "exposure":
      return { kind, settings: { exposure: 0, offset: 0, gamma: 1 } };
    case "hueSaturation":
      return { kind, settings: { hue: 0, saturation: 0, lightness: 0, colorize: false } };
    case "colorBalance":
      return { kind, settings: defaultColorBalance() };
    case "blackWhite":
      return { kind, settings: { ...DEFAULT_BLACK_WHITE } };
    case "gradientMap":
      return { kind, settings: { from: colors.foreground, to: colors.background, reverse: false } };
    case "posterize":
      return { kind, settings: { levels: 4 } };
    case "threshold":
      return { kind, settings: { level: 128 } };
    case "invert":
      return { kind, settings: {} };
  }
}

/** What an adjustment does to each pixel, as a job the CPU or the GPU runs. */
export function adjustmentJob(adjustment: AdjustmentData): PixelJob {
  switch (adjustment.kind) {
    case "brightnessContrast":
      return { op: "luts", luts: uniformLuts(brightnessContrastLut(adjustment.settings)) };
    case "levels":
      return { op: "luts", luts: levelsLuts(adjustment.settings) };
    case "curves":
      return { op: "luts", luts: curvesLuts(adjustment.settings) };
    case "exposure":
      return { op: "luts", luts: uniformLuts(exposureLut(adjustment.settings)) };
    case "hueSaturation":
      return { op: "hueSaturation", settings: adjustment.settings };
    case "colorBalance":
      return { op: "colorBalance", settings: adjustment.settings };
    case "blackWhite":
      return { op: "blackWhite", settings: adjustment.settings };
    case "gradientMap":
      return { op: "gradientMap", luts: gradientMapLuts(adjustment.settings) };
    case "posterize":
      return { op: "luts", luts: uniformLuts(posterizeLut(adjustment.settings.levels)) };
    case "threshold":
      return { op: "threshold", level: adjustment.settings.level };
    case "invert":
      return { op: "luts", luts: uniformLuts(invertLut()) };
  }
}

// ---------- Reading untrusted data ----------

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const HEX = /^#[0-9a-f]{6}$/i;

function levelsChannel(value: unknown): LevelsChannel | null {
  if (!isRecord(value)) return null;
  const { inBlack, inWhite, gamma, outBlack, outWhite } = value;
  if (!inRange(inBlack, 0, 255) || !inRange(inWhite, 0, 255) || inBlack >= inWhite) return null;
  if (!inRange(gamma, 0.1, 9.99) || !inRange(outBlack, 0, 255) || !inRange(outWhite, 0, 255)) return null;
  return { inBlack, inWhite, gamma, outBlack, outWhite };
}

function curve(value: unknown): CurvePoint[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CURVE_POINTS) return null;
  const points: CurvePoint[] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length !== 2 || !inRange(point[0], 0, 255) || !inRange(point[1], 0, 255)) return null;
    points.push([point[0], point[1]]);
  }
  return points;
}

const shift = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) && value.length === 3 && value.every((part) => inRange(part, -100, 100))
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;

function settingsOf(kind: AdjustmentLayerKind, value: Record_): AdjustmentData | null {
  switch (kind) {
    case "brightnessContrast": {
      const { brightness, contrast } = value;
      return inRange(brightness, -150, 150) && inRange(contrast, -50, 100) ? { kind, settings: { brightness, contrast } } : null;
    }
    case "levels": {
      const settings = {} as LevelsSettings;
      for (const channel of CHANNELS) {
        const parsed = levelsChannel(value[channel]);
        if (!parsed) return null;
        settings[channel] = parsed;
      }
      return { kind, settings };
    }
    case "curves": {
      const settings = {} as CurvesSettings;
      for (const channel of CHANNELS) {
        const parsed = curve(value[channel]);
        if (!parsed) return null;
        settings[channel] = parsed;
      }
      return { kind, settings };
    }
    case "exposure": {
      const { exposure, offset, gamma } = value;
      return inRange(exposure, -20, 20) && inRange(offset, -0.5, 0.5) && inRange(gamma, 0.01, 9.99)
        ? { kind, settings: { exposure, offset, gamma } }
        : null;
    }
    case "hueSaturation": {
      const { hue, saturation, lightness, colorize } = value;
      return inRange(hue, -180, 360) && inRange(saturation, -100, 100) && inRange(lightness, -100, 100) && typeof colorize === "boolean"
        ? { kind, settings: { hue, saturation, lightness, colorize } }
        : null;
    }
    case "colorBalance": {
      const shadows = shift(value.shadows);
      const midtones = shift(value.midtones);
      const highlights = shift(value.highlights);
      const { preserveLuminosity } = value;
      return shadows && midtones && highlights && typeof preserveLuminosity === "boolean"
        ? { kind, settings: { shadows, midtones, highlights, preserveLuminosity } }
        : null;
    }
    case "blackWhite": {
      const names = ["reds", "yellows", "greens", "cyans", "blues", "magentas"] as const;
      const settings = {} as BlackWhiteSettings;
      for (const name of names) {
        if (!inRange(value[name], -200, 300)) return null;
        settings[name] = value[name];
      }
      return { kind, settings };
    }
    case "gradientMap": {
      const { from, to, reverse } = value;
      return typeof from === "string" && HEX.test(from) && typeof to === "string" && HEX.test(to) && typeof reverse === "boolean"
        ? { kind, settings: { from, to, reverse } }
        : null;
    }
    case "posterize":
      return inRange(value.levels, 2, 255) ? { kind, settings: { levels: Math.round(value.levels) } } : null;
    case "threshold":
      return inRange(value.level, 1, 255) ? { kind, settings: { level: value.level } } : null;
    case "invert":
      return { kind, settings: {} };
  }
}

/** An adjustment read from a file, or null when it is not one the editor makes. */
export function readAdjustment(value: unknown): AdjustmentData | null {
  if (!isRecord(value) || !isAdjustmentLayerKind(value.kind) || !isRecord(value.settings)) return null;
  return settingsOf(value.kind, value.settings);
}
