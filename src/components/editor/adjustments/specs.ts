import type { ComponentType } from "react";
import type { PixelProcess } from "@/raster/pixelPreview";
import {
  DEFAULT_BLACK_WHITE,
  applyLuts,
  blackWhite,
  brightnessContrastLut,
  colorBalance,
  curvesLuts,
  defaultColorBalance,
  defaultCurves,
  defaultLevels,
  exposureLut,
  gradientMap,
  gradientMapLuts,
  hueSaturation,
  isDefaultCurves,
  isDefaultLevels,
  levelsLuts,
  posterizeLut,
  threshold,
  uniformLuts,
  type BlackWhiteSettings,
  type BrightnessContrastSettings,
  type ColorBalanceSettings,
  type CurvesSettings,
  type ExposureSettings,
  type GradientMapSettings,
  type Histogram,
  type HueSaturationSettings,
  type LevelsSettings,
  type Luts,
} from "@/raster/adjustments";
import { LevelsControls } from "./LevelsControls";
import { CurvesControls } from "./CurvesControls";
import {
  BlackWhiteControls,
  BrightnessContrastControls,
  ColorBalanceControls,
  ExposureControls,
  GradientMapControls,
  HueSaturationControls,
  PosterizeControls,
  ThresholdControls,
} from "./ToneColorControls";

export type AdjustmentKind =
  | "brightnessContrast"
  | "levels"
  | "curves"
  | "exposure"
  | "hueSaturation"
  | "colorBalance"
  | "blackWhite"
  | "gradientMap"
  | "posterize"
  | "threshold";

export interface ControlsProps<Settings> {
  settings: Settings;
  onChange: (settings: Settings) => void;
  histogram: Histogram;
}

/** What an adjustment may start from besides its own defaults. */
export interface AdjustmentContext {
  foreground: string;
  background: string;
}

export interface AdjustmentSpec<Settings> {
  title: string;
  description: string;
  initial: (context: AdjustmentContext) => Settings;
  /** Settings that change nothing. */
  isIdentity: (settings: Settings) => boolean;
  process: (settings: Settings) => PixelProcess;
  Controls: ComponentType<ControlsProps<Settings>>;
}

const lutProcess =
  (luts: Luts): PixelProcess =>
  (source, target) =>
    applyLuts(source, target, luts);

const spec = <Settings>(definition: AdjustmentSpec<Settings>) => definition as unknown as AdjustmentSpec<unknown>;

const sameAs =
  <Settings>(identity: Settings) =>
  (settings: Settings) =>
    JSON.stringify(settings) === JSON.stringify(identity);

const NO_BALANCE = defaultColorBalance();

/** Image › Adjustments, each with its settings and how it changes pixels. */
export const ADJUSTMENTS: Record<AdjustmentKind, AdjustmentSpec<unknown>> = {
  brightnessContrast: spec<BrightnessContrastSettings>({
    title: "Brightness/Contrast",
    description: "Lighten or darken the image and spread or narrow its tones.",
    initial: () => ({ brightness: 0, contrast: 0 }),
    isIdentity: (settings) => settings.brightness === 0 && settings.contrast === 0,
    process: (settings) => lutProcess(uniformLuts(brightnessContrastLut(settings))),
    Controls: BrightnessContrastControls,
  }),
  levels: spec<LevelsSettings>({
    title: "Levels",
    description: "Set the black point, white point and midtones.",
    initial: defaultLevels,
    isIdentity: isDefaultLevels,
    process: (settings) => lutProcess(levelsLuts(settings)),
    Controls: LevelsControls,
  }),
  curves: spec<CurvesSettings>({
    title: "Curves",
    description: "Map each input level to a new one along a curve.",
    initial: defaultCurves,
    isIdentity: isDefaultCurves,
    process: (settings) => lutProcess(curvesLuts(settings)),
    Controls: CurvesControls,
  }),
  exposure: spec<ExposureSettings>({
    title: "Exposure",
    description: "Change the light as a camera exposure would, in stops.",
    initial: () => ({ exposure: 0, offset: 0, gamma: 1 }),
    isIdentity: (settings) => settings.exposure === 0 && settings.offset === 0 && settings.gamma === 1,
    process: (settings) => lutProcess(uniformLuts(exposureLut(settings))),
    Controls: ExposureControls,
  }),
  hueSaturation: spec<HueSaturationSettings>({
    title: "Hue/Saturation",
    description: "Shift colours round the colour wheel, or tint the image with one hue.",
    initial: () => ({ hue: 0, saturation: 0, lightness: 0, colorize: false }),
    isIdentity: (settings) =>
      !settings.colorize && settings.hue === 0 && settings.saturation === 0 && settings.lightness === 0,
    process: (settings) => (source, target) => hueSaturation(source, target, settings),
    Controls: HueSaturationControls,
  }),
  colorBalance: spec<ColorBalanceSettings>({
    title: "Color Balance",
    description: "Push the shadows, midtones or highlights towards a colour.",
    initial: defaultColorBalance,
    isIdentity: (settings) =>
      JSON.stringify([settings.shadows, settings.midtones, settings.highlights]) ===
      JSON.stringify([NO_BALANCE.shadows, NO_BALANCE.midtones, NO_BALANCE.highlights]),
    process: (settings) => (source, target) => colorBalance(source, target, settings),
    Controls: ColorBalanceControls,
  }),
  blackWhite: spec<BlackWhiteSettings>({
    title: "Black & White",
    description: "Turn the image grey, choosing how light each colour becomes.",
    initial: () => ({ ...DEFAULT_BLACK_WHITE }),
    // Even the defaults turn the image grey.
    isIdentity: () => false,
    process: (settings) => (source, target) => blackWhite(source, target, settings),
    Controls: BlackWhiteControls,
  }),
  gradientMap: spec<GradientMapSettings>({
    title: "Gradient Map",
    description: "Map the image's tones onto a gradient, from shadows to highlights.",
    initial: ({ foreground, background }) => ({ from: foreground, to: background, reverse: false }),
    isIdentity: () => false,
    process: (settings) => {
      const luts = gradientMapLuts(settings);
      return (source, target) => gradientMap(source, target, luts);
    },
    Controls: GradientMapControls,
  }),
  posterize: spec<{ levels: number }>({
    title: "Posterize",
    description: "Reduce each channel to a few levels.",
    initial: () => ({ levels: 4 }),
    isIdentity: sameAs({ levels: 256 }),
    process: (settings) => lutProcess(uniformLuts(posterizeLut(settings.levels))),
    Controls: PosterizeControls,
  }),
  threshold: spec<{ level: number }>({
    title: "Threshold",
    description: "Turn pixels lighter than the level white, and the rest black.",
    initial: () => ({ level: 128 }),
    isIdentity: () => false,
    process: (settings) => (source, target) => threshold(source, target, settings.level),
    Controls: ThresholdControls,
  }),
};
