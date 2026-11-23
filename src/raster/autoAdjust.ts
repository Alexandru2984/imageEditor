import { autoLevels, defaultLevels, GAMMA_RANGE, histogramRange, type Histogram, type LevelsSettings } from "./adjustments";

/**
 * Image › Auto Tone, Auto Contrast and Auto Color, with Photoshop's classic
 * algorithms, as Levels settings:
 * - Auto Tone (Enhance Per Channel Contrast): each channel stretched to the
 *   full range on its own, which also shifts the colours;
 * - Auto Contrast (Enhance Monochromatic Contrast): all channels stretched
 *   alike, the colours kept;
 * - Auto Color (Find Dark & Light Colors, Snap Neutral Midtones): the
 *   darkest colours made black and the lightest white, then the nearly
 *   grey midtones made grey.
 * Each ignores the darkest and lightest 0.1% of the pixels, as Photoshop's
 * default clipping does.
 */

const CLIP = 0.001;

export const autoToneLevels = (histogram: Histogram): LevelsSettings => autoLevels(histogram);

export function autoContrastLevels(histogram: Histogram): LevelsSettings {
  const levels = defaultLevels();
  const all = new Uint32Array(256);
  for (let level = 0; level < 256; level += 1) all[level] = histogram.red[level]! + histogram.green[level]! + histogram.blue[level]!;
  const range = histogramRange(all, CLIP);
  if (!range || range.high - range.low < 2) return levels;
  levels.rgb.inBlack = range.low;
  levels.rgb.inWhite = range.high;
  return levels;
}

const luminosity = (r: number, g: number, b: number) => (r * 77 + g * 150 + b * 29 + 128) >> 8;

/** Midtones this close to grey (largest channel difference) count as nearly neutral. */
const NEUTRAL_SPREAD = 32;
/** Gamma moves no further than this either way when snapping midtones. */
const GAMMA_LIMIT = { min: 0.5, max: 2 };

/**
 * Auto Color for RGBA pixels; with `weights` (one byte per pixel), only
 * those at least half selected count, as in the histogram.
 */
export function autoColorLevels(data: Uint8ClampedArray, weights?: Uint8Array | null): LevelsSettings {
  const levels = defaultLevels();
  const counts = (index: number) => data[index * 4 + 3] !== 0 && (!weights || weights[index]! >= 128);
  const pixels = data.length / 4;

  // The darkest and lightest 0.1% by lightness, and their average colours.
  const byLightness = new Uint32Array(256);
  let total = 0;
  for (let index = 0; index < pixels; index += 1) {
    if (!counts(index)) continue;
    byLightness[luminosity(data[index * 4]!, data[index * 4 + 1]!, data[index * 4 + 2]!)]! += 1;
    total += 1;
  }
  const range = histogramRange(byLightness, CLIP);
  if (!range || total === 0) return levels;
  const dark = [0, 0, 0, 0];
  const light = [0, 0, 0, 0];
  for (let index = 0; index < pixels; index += 1) {
    if (!counts(index)) continue;
    const offset = index * 4;
    const lightness = luminosity(data[offset]!, data[offset + 1]!, data[offset + 2]!);
    const into = lightness <= range.low ? dark : lightness >= range.high ? light : null;
    if (!into) continue;
    for (let channel = 0; channel < 3; channel += 1) into[channel]! += data[offset + channel]!;
    into[3]! += 1;
  }
  if (dark[3] === 0 || light[3] === 0) return levels;
  const channels = ["red", "green", "blue"] as const;
  const stretch: { low: number; span: number }[] = [];
  channels.forEach((name, channel) => {
    const low = Math.round(dark[channel]! / dark[3]!);
    const high = Math.round(light[channel]! / light[3]!);
    if (high - low < 2) {
      stretch.push({ low: 0, span: 255 });
      return;
    }
    levels[name].inBlack = low;
    levels[name].inWhite = high;
    stretch.push({ low, span: high - low });
  });

  // The average nearly grey midtone, once stretched; each channel's gamma brings it to grey.
  let [sumR, sumG, sumB] = [0, 0, 0];
  let neutral = 0;
  for (let index = 0; index < pixels; index += 1) {
    if (!counts(index)) continue;
    const offset = index * 4;
    const value = stretch.map(({ low, span }, channel) => Math.min(255, Math.max(0, ((data[offset + channel]! - low) / span) * 255)));
    const [r, g, b] = value as [number, number, number];
    const lightness = luminosity(r, g, b);
    if (lightness < 64 || lightness > 192 || Math.max(r, g, b) - Math.min(r, g, b) > NEUTRAL_SPREAD) continue;
    sumR += r;
    sumG += g;
    sumB += b;
    neutral += 1;
  }
  if (neutral < Math.max(16, total * 0.005)) return levels;
  const means = [sumR / neutral, sumG / neutral, sumB / neutral];
  const grey = (means[0]! + means[1]! + means[2]!) / 3;
  channels.forEach((name, channel) => {
    // Levels draws position^(1/gamma): this gamma takes the channel's mean to the grey.
    const gamma = Math.log(means[channel]! / 255) / Math.log(grey / 255);
    if (!Number.isFinite(gamma)) return;
    const limited = Math.min(GAMMA_LIMIT.max, Math.max(GAMMA_LIMIT.min, gamma));
    levels[name].gamma = Math.min(GAMMA_RANGE.max, Math.max(GAMMA_RANGE.min, Math.round(limited * 100) / 100));
  });
  return levels;
}
