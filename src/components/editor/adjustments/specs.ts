import type { ComponentType } from "react";
import type { PixelJob } from "@/raster/pixelJobs";
import type { EmbossSettings, NoiseSettings, UnsharpSettings } from "@/raster/filters";
import {
  DEFAULT_BLACK_WHITE,
  brightnessContrastLut,
  curvesLuts,
  defaultColorBalance,
  defaultCurves,
  defaultLevels,
  exposureLut,
  gradientMapLuts,
  isDefaultCurves,
  isDefaultLevels,
  levelsLuts,
  posterizeLut,
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
import {
  AddNoiseControls,
  EmbossControls,
  GaussianBlurControls,
  HighPassControls,
  MosaicControls,
  MotionBlurControls,
  UnsharpMaskControls,
} from "./FilterControls";

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
  | "threshold"
  | "gaussianBlur"
  | "motionBlur"
  | "addNoise"
  | "mosaic"
  | "unsharpMask"
  | "emboss"
  | "highPass";

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
  /** What the settings do to pixels. */
  job: (settings: Settings) => PixelJob;
  Controls: ComponentType<ControlsProps<Settings>>;
}

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
    job: (settings) => ({ op: "luts", luts: uniformLuts(brightnessContrastLut(settings)) }),
    Controls: BrightnessContrastControls,
  }),
  levels: spec<LevelsSettings>({
    title: "Levels",
    description: "Set the black point, white point and midtones.",
    initial: defaultLevels,
    isIdentity: isDefaultLevels,
    job: (settings) => ({ op: "luts", luts: levelsLuts(settings) }),
    Controls: LevelsControls,
  }),
  curves: spec<CurvesSettings>({
    title: "Curves",
    description: "Map each input level to a new one along a curve.",
    initial: defaultCurves,
    isIdentity: isDefaultCurves,
    job: (settings) => ({ op: "luts", luts: curvesLuts(settings) }),
    Controls: CurvesControls,
  }),
  exposure: spec<ExposureSettings>({
    title: "Exposure",
    description: "Change the light as a camera exposure would, in stops.",
    initial: () => ({ exposure: 0, offset: 0, gamma: 1 }),
    isIdentity: (settings) => settings.exposure === 0 && settings.offset === 0 && settings.gamma === 1,
    job: (settings) => ({ op: "luts", luts: uniformLuts(exposureLut(settings)) }),
    Controls: ExposureControls,
  }),
  hueSaturation: spec<HueSaturationSettings>({
    title: "Hue/Saturation",
    description: "Shift colours round the colour wheel, or tint the image with one hue.",
    initial: () => ({ hue: 0, saturation: 0, lightness: 0, colorize: false }),
    isIdentity: (settings) =>
      !settings.colorize && settings.hue === 0 && settings.saturation === 0 && settings.lightness === 0,
    job: (settings) => ({ op: "hueSaturation", settings }),
    Controls: HueSaturationControls,
  }),
  colorBalance: spec<ColorBalanceSettings>({
    title: "Color Balance",
    description: "Push the shadows, midtones or highlights towards a colour.",
    initial: defaultColorBalance,
    isIdentity: (settings) =>
      JSON.stringify([settings.shadows, settings.midtones, settings.highlights]) ===
      JSON.stringify([NO_BALANCE.shadows, NO_BALANCE.midtones, NO_BALANCE.highlights]),
    job: (settings) => ({ op: "colorBalance", settings }),
    Controls: ColorBalanceControls,
  }),
  blackWhite: spec<BlackWhiteSettings>({
    title: "Black & White",
    description: "Turn the image grey, choosing how light each colour becomes.",
    initial: () => ({ ...DEFAULT_BLACK_WHITE }),
    // Even the defaults turn the image grey.
    isIdentity: () => false,
    job: (settings) => ({ op: "blackWhite", settings }),
    Controls: BlackWhiteControls,
  }),
  gradientMap: spec<GradientMapSettings>({
    title: "Gradient Map",
    description: "Map the image's tones onto a gradient, from shadows to highlights.",
    initial: ({ foreground, background }) => ({ from: foreground, to: background, reverse: false }),
    isIdentity: () => false,
    job: (settings) => ({ op: "gradientMap", luts: gradientMapLuts(settings) }),
    Controls: GradientMapControls,
  }),
  posterize: spec<{ levels: number }>({
    title: "Posterize",
    description: "Reduce each channel to a few levels.",
    initial: () => ({ levels: 4 }),
    isIdentity: sameAs({ levels: 256 }),
    job: (settings) => ({ op: "luts", luts: uniformLuts(posterizeLut(settings.levels)) }),
    Controls: PosterizeControls,
  }),
  threshold: spec<{ level: number }>({
    title: "Threshold",
    description: "Turn pixels lighter than the level white, and the rest black.",
    initial: () => ({ level: 128 }),
    isIdentity: () => false,
    job: (settings) => ({ op: "threshold", level: settings.level }),
    Controls: ThresholdControls,
  }),

  // ---------- Filter menu ----------
  gaussianBlur: spec<{ radius: number }>({
    title: "Gaussian Blur",
    description: "Soften the image, each pixel blended with its neighbours.",
    initial: () => ({ radius: 2 }),
    isIdentity: (settings) => settings.radius < 0.3,
    job: ({ radius }) => ({ op: "gaussianBlur", radius }),
    Controls: GaussianBlurControls,
  }),
  motionBlur: spec<{ angle: number; distance: number }>({
    title: "Motion Blur",
    description: "Blur along a line, as if the camera moved.",
    initial: () => ({ angle: 0, distance: 10 }),
    isIdentity: (settings) => settings.distance < 1,
    job: ({ angle, distance }) => ({ op: "motionBlur", angle, distance }),
    Controls: MotionBlurControls,
  }),
  addNoise: spec<NoiseSettings>({
    title: "Add Noise",
    description: "Scatter random grain over the image.",
    initial: () => ({ amount: 10, distribution: "uniform", monochromatic: false }),
    isIdentity: (settings) => settings.amount <= 0,
    job: (settings) => ({ op: "addNoise", settings }),
    Controls: AddNoiseControls,
  }),
  mosaic: spec<{ size: number }>({
    title: "Mosaic",
    description: "Turn the image into square cells of their average colour.",
    initial: () => ({ size: 10 }),
    isIdentity: (settings) => settings.size < 2,
    job: ({ size }) => ({ op: "mosaic", size }),
    Controls: MosaicControls,
  }),
  unsharpMask: spec<UnsharpSettings>({
    title: "Unsharp Mask",
    description: "Sharpen by raising contrast along edges.",
    initial: () => ({ amount: 100, radius: 1, threshold: 0 }),
    isIdentity: () => false,
    job: (settings) => ({ op: "unsharpMask", settings }),
    Controls: UnsharpMaskControls,
  }),
  emboss: spec<EmbossSettings>({
    title: "Emboss",
    description: "Turn the image into a grey relief lit from one side.",
    initial: () => ({ angle: 135, height: 3, amount: 100 }),
    isIdentity: () => false,
    job: (settings) => ({ op: "emboss", settings }),
    Controls: EmbossControls,
  }),
  highPass: spec<{ radius: number }>({
    title: "High Pass",
    description: "Keep only detail finer than the radius, over middle grey.",
    initial: () => ({ radius: 10 }),
    isIdentity: () => false,
    job: ({ radius }) => ({ op: "highPass", radius }),
    Controls: HighPassControls,
  }),
};
