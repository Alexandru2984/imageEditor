import { describe, expect, it } from "vitest";
import {
  CURVE_PRESETS,
  applyLuts,
  autoLevels,
  curveLut,
  curvesLuts,
  defaultCurves,
  defaultLevels,
  histogramOf,
  histogramRange,
  identityLut,
  isDefaultCurves,
  isDefaultLevels,
  levelsLut,
  levelsLuts,
  DEFAULT_LEVELS_CHANNEL,
  DEFAULT_BLACK_WHITE,
  blackWhite,
  brightnessContrastLut,
  colorBalance,
  defaultColorBalance,
  desaturate,
  exposureLut,
  gradientMap,
  gradientMapLuts,
  hueSaturation,
  invertLut,
  posterizeLut,
  threshold,
  histogramStats,
} from "./adjustments";

const pixels = (...values: number[][]) => new Uint8ClampedArray(values.flat());

describe("levels", () => {
  it("leaves the image alone by default", () => {
    expect(levelsLut(DEFAULT_LEVELS_CHANNEL)).toEqual(identityLut());
    expect(isDefaultLevels(defaultLevels())).toBe(true);
  });

  it("moves the black and white points and the midtones", () => {
    const lut = levelsLut({ ...DEFAULT_LEVELS_CHANNEL, inBlack: 50, inWhite: 200 });
    expect(lut[0]).toBe(0);
    expect(lut[50]).toBe(0);
    expect(lut[125]).toBe(128);
    expect(lut[200]).toBe(255);
    expect(lut[255]).toBe(255);
    const lighter = levelsLut({ ...DEFAULT_LEVELS_CHANNEL, gamma: 2 });
    expect(lighter[64]).toBeGreaterThan(64);
    expect(lighter[0]).toBe(0);
    expect(lighter[255]).toBe(255);
    const output = levelsLut({ ...DEFAULT_LEVELS_CHANNEL, outBlack: 20, outWhite: 220 });
    expect([output[0], output[255]]).toEqual([20, 220]);
    // Output levels may be swapped, which inverts.
    expect(levelsLut({ ...DEFAULT_LEVELS_CHANNEL, outBlack: 255, outWhite: 0 })[0]).toBe(255);
  });

  it("applies a channel's own levels before the composite", () => {
    const levels = defaultLevels();
    levels.red.inWhite = 128;
    levels.rgb.outWhite = 128;
    const out = new Uint8ClampedArray(4);
    applyLuts(pixels([128, 128, 128, 77]), out, levelsLuts(levels));
    expect([...out]).toEqual([128, 64, 64, 77]);
  });

  it("stretches each channel for Auto", () => {
    const data = pixels(...Array.from({ length: 100 }, (_, index) => [60 + index, 100, 30 + index * 2, 255]));
    const auto = autoLevels(histogramOf(data));
    expect(auto.red.inBlack).toBe(60);
    expect(auto.red.inWhite).toBe(159);
    expect(auto.blue.inBlack).toBe(30);
    // A flat channel is left alone.
    expect(auto.green).toEqual(DEFAULT_LEVELS_CHANNEL);
  });
});

describe("histograms", () => {
  it("counts visible, selected pixels", () => {
    const data = pixels([255, 0, 0, 255], [0, 0, 255, 255], [9, 9, 9, 0], [0, 255, 0, 255]);
    const all = histogramOf(data);
    expect(all.count).toBe(3);
    expect(all.red[255]).toBe(1);
    expect(all.rgb[77]).toBe(1);
    const selected = histogramOf(data, Uint8Array.from([255, 0, 255, 127]));
    expect(selected.count).toBe(1);
    expect(histogramRange(new Uint32Array(256))).toBeNull();
  });
});

describe("curves", () => {
  it("is the identity when straight", () => {
    expect(curveLut(defaultCurves().rgb)).toEqual(identityLut());
    expect(isDefaultCurves(defaultCurves())).toBe(true);
  });

  it("passes through its points without overshooting", () => {
    const points = CURVE_PRESETS.find((preset) => preset.id === "strong")!.points;
    const lut = curveLut(points);
    for (const [x, y] of points) expect(lut[x]).toBe(y);
    for (let x = 1; x < 256; x += 1) expect(lut[x]!).toBeGreaterThanOrEqual(lut[x - 1]!);
    // A spike stays within the neighbouring points' levels.
    const spike = curveLut([[0, 0], [100, 200], [110, 200], [255, 255]]);
    expect(Math.max(...spike)).toBe(255);
    expect(spike[105]).toBe(200);
  });

  it("is flat beyond the end points, and inverts for Negative", () => {
    const clipped = curveLut([[40, 0], [200, 255]]);
    expect([clipped[0], clipped[40], clipped[200], clipped[255]]).toEqual([0, 0, 255, 255]);
    const curves = defaultCurves();
    curves.rgb = CURVE_PRESETS.find((preset) => preset.id === "negative")!.points;
    const out = new Uint8ClampedArray(4);
    applyLuts(pixels([0x33, 0x66, 0x99, 255]), out, curvesLuts(curves));
    expect([...out]).toEqual([0xcc, 0x99, 0x66, 255]);
  });
});

describe("tone adjustments", () => {
  it("brightness and contrast keep the identity at zero and move the right way", () => {
    expect(brightnessContrastLut({ brightness: 0, contrast: 0 })).toEqual(identityLut());
    expect(brightnessContrastLut({ brightness: 100, contrast: 0 })[128]!).toBeGreaterThan(128);
    expect(brightnessContrastLut({ brightness: -100, contrast: 0 })[128]!).toBeLessThan(128);
    const contrast = brightnessContrastLut({ brightness: 0, contrast: 60 });
    expect(contrast[64]!).toBeLessThan(64);
    expect(contrast[192]!).toBeGreaterThan(192);
  });

  it("exposure doubles the light per stop", () => {
    expect(exposureLut({ exposure: 0, offset: 0, gamma: 1 })).toEqual(identityLut());
    const brighter = exposureLut({ exposure: 1, offset: 0, gamma: 1 });
    // sRGB 128 is about 21.6% light; twice that is about sRGB 175.
    expect(brighter[128]).toBeGreaterThanOrEqual(174);
    expect(brighter[128]).toBeLessThanOrEqual(176);
    expect(brighter[255]).toBe(255);
  });

  it("posterizes, inverts and thresholds", () => {
    const poster = posterizeLut(2);
    expect([poster[0], poster[127], poster[128], poster[255]]).toEqual([0, 0, 255, 255]);
    expect(invertLut()[0x33]).toBe(0xcc);
    const out = new Uint8ClampedArray(8);
    threshold(pixels([100, 100, 100, 9], [200, 200, 200, 255]), out, 128);
    expect([...out]).toEqual([0, 0, 0, 9, 255, 255, 255, 255]);
  });
});

describe("colour adjustments", () => {
  it("desaturates to HSL lightness", () => {
    const out = new Uint8ClampedArray(4);
    desaturate(pixels([255, 0, 0, 255]), out);
    expect([...out]).toEqual([128, 128, 128, 255]);
  });

  it("maps luminosity onto a gradient", () => {
    const out = new Uint8ClampedArray(8);
    const luts = gradientMapLuts({ from: "#000000", to: "#ff0000", reverse: false });
    gradientMap(pixels([0, 0, 0, 255], [255, 255, 255, 255]), out, luts);
    expect([...out]).toEqual([0, 0, 0, 255, 255, 0, 0, 255]);
    gradientMap(pixels([0, 0, 0, 255]), out, gradientMapLuts({ from: "#000000", to: "#ff0000", reverse: true }));
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it("turns colours grey by their own weights in Black & White", () => {
    const out = new Uint8ClampedArray(12);
    blackWhite(pixels([255, 0, 0, 255], [0, 0, 255, 255], [128, 128, 128, 255]), out, DEFAULT_BLACK_WHITE);
    // Pure red at 40%, pure blue at 20%, greys stay as they are.
    expect([out[0], out[4], out[8]]).toEqual([102, 51, 128]);
    blackWhite(pixels([255, 255, 0, 255]), out, { ...DEFAULT_BLACK_WHITE, yellows: 100 });
    expect(out[0]).toBe(255);
  });

  it("shifts hue, saturation and lightness, and colorizes", () => {
    const out = new Uint8ClampedArray(4);
    const red = pixels([255, 0, 0, 255]);
    hueSaturation(red, out, { hue: 120, saturation: 0, lightness: 0, colorize: false });
    expect([...out]).toEqual([0, 255, 0, 255]);
    hueSaturation(red, out, { hue: 0, saturation: -100, lightness: 0, colorize: false });
    expect([...out]).toEqual([128, 128, 128, 255]);
    hueSaturation(red, out, { hue: 0, saturation: 0, lightness: 100, colorize: false });
    expect([...out]).toEqual([255, 255, 255, 255]);
    hueSaturation(pixels([128, 128, 128, 255]), out, { hue: 240, saturation: 100, lightness: 0, colorize: true });
    expect(out[2]!).toBeGreaterThan(out[0]!);
  });

  it("balances colour by tonal range, keeping luminosity when asked", () => {
    const out = new Uint8ClampedArray(8);
    const settings = defaultColorBalance();
    colorBalance(pixels([128, 128, 128, 255], [20, 20, 20, 255]), out, settings);
    expect([...out]).toEqual([128, 128, 128, 255, 20, 20, 20, 255]);
    settings.midtones = [100, 0, 0];
    settings.preserveLuminosity = false;
    colorBalance(pixels([128, 128, 128, 255], [10, 10, 10, 255]), out, settings);
    // Midtones turn red; the deep shadow barely moves.
    expect(out[0]!).toBeGreaterThan(200);
    expect(out[4]!).toBeLessThan(20);
    settings.preserveLuminosity = true;
    colorBalance(pixels([128, 128, 128, 255]), out, settings);
    const lightness = (Math.max(out[0]!, out[1]!, out[2]!) + Math.min(out[0]!, out[1]!, out[2]!)) / 2;
    expect(Math.abs(lightness - 128)).toBeLessThanOrEqual(1);
  });
});

describe("histogram figures", () => {
  it("gives the mean, spread and median", () => {
    const bins = new Uint32Array(256);
    bins[0] = 2;
    bins[100] = 1;
    bins[200] = 1;
    const stats = histogramStats(bins);
    expect(stats.count).toBe(4);
    expect(stats.mean).toBe(75);
    expect(stats.median).toBe(0);
    expect(stats.stdDev).toBeCloseTo(Math.sqrt((2 * 75 ** 2 + 25 ** 2 + 125 ** 2) / 4));
    expect(histogramStats(new Uint32Array(256)).count).toBe(0);
  });
});
