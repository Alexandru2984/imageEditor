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
