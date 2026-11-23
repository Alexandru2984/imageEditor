import { describe, expect, it } from "vitest";
import { applyLuts, histogramOf, levelsLuts, type LevelsSettings } from "./adjustments";
import { autoColorLevels, autoContrastLevels, autoToneLevels } from "./autoAdjust";

/** RGBA pixels from [r, g, b] colours, opaque. */
const pixels = (colors: readonly (readonly [number, number, number])[]) =>
  Uint8ClampedArray.from(colors.flatMap(([r, g, b]) => [r, g, b, 255]));

const apply = (data: Uint8ClampedArray, levels: LevelsSettings) => {
  const out = new Uint8ClampedArray(data.length);
  applyLuts(data, out, levelsLuts(levels));
  return out;
};

/** A grey ramp from 40 to 200 with a warm cast: red raised, blue lowered. */
const warmRamp = () =>
  pixels(
    Array.from({ length: 2000 }, (_, index) => {
      const grey = 40 + (index / 1999) * 160;
      return [Math.min(255, grey * 1.1 + 12), grey, grey * 0.82] as const;
    })
  );

describe("Auto Tone, Auto Contrast, Auto Color", () => {
  it("Auto Tone stretches each channel to the full range on its own", () => {
    const data = warmRamp();
    const levels = autoToneLevels(histogramOf(data));
    expect(levels.rgb.inBlack).toBe(0);
    expect(levels.red.inBlack).toBeGreaterThan(levels.blue.inBlack);
    const out = apply(data, levels);
    for (const channel of [0, 1, 2]) {
      const values = Array.from({ length: out.length / 4 }, (_, index) => out[index * 4 + channel]!);
      expect(Math.min(...values)).toBeLessThanOrEqual(1);
      expect(Math.max(...values)).toBeGreaterThanOrEqual(254);
    }
  });

  it("Auto Contrast stretches all channels alike and keeps the colours' order", () => {
    const data = warmRamp();
    const levels = autoContrastLevels(histogramOf(data));
    expect(levels.red.inBlack).toBe(0);
    expect(levels.rgb.inBlack).toBeGreaterThan(20);
    expect(levels.rgb.inWhite).toBeGreaterThan(200);
    const out = apply(data, levels);
    // Still warm: red above blue in the middle of the ramp.
    const middle = (out.length / 8) * 4;
    expect(out[middle]!).toBeGreaterThan(out[middle + 2]! + 20);
  });

  it("Auto Color makes the darkest black, the lightest white and the midtones grey", () => {
    const data = warmRamp();
    const out = apply(data, autoColorLevels(data));
    const at = (fraction: number) => {
      const offset = Math.round((out.length / 4 - 1) * fraction) * 4;
      return [out[offset]!, out[offset + 1]!, out[offset + 2]!];
    };
    for (const channel of at(0)) expect(channel).toBeLessThanOrEqual(3);
    for (const channel of at(1)) expect(channel).toBeGreaterThanOrEqual(252);
    const [r, g, b] = at(0.5);
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThanOrEqual(4);
  });

  it("Auto Color leaves a picture with nothing to go on as it is, and counts only selected, visible pixels", () => {
    expect(autoColorLevels(pixels([[90, 90, 90]]))).toEqual(autoContrastLevels(histogramOf(pixels([]))));
    const data = warmRamp();
    // Selected nowhere: unchanged.
    expect(autoColorLevels(data, new Uint8Array(data.length / 4))).toEqual(autoContrastLevels(histogramOf(pixels([]))));
    // Transparent pixels don't count.
    const hidden = data.slice();
    for (let offset = 3; offset < hidden.length; offset += 4) hidden[offset] = 0;
    expect(autoColorLevels(hidden).red.inBlack).toBe(0);
  });
});
