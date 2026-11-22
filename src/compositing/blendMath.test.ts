import { describe, expect, it } from "vitest";
import { adjustPixels, BLEND_IDS, blendColors, composePixels, dissolveNoise, isCustomBlend } from "./blendMath";
import { invertLut, uniformLuts } from "@/raster/adjustments";
import type { PixelJob } from "@/raster/pixelJobs";

const invert: PixelJob = { op: "luts", luts: uniformLuts(invertLut()) };
const pixels = (...values: number[][]) => new Uint8ClampedArray(values.flat());

describe("blend modes", () => {
  it("follow the W3C formulas", () => {
    const b = (mode: string, cb: number, cs: number) => blendColors(BLEND_IDS[mode]!, [cb, cb, cb], [cs, cs, cs])[0];
    expect(b("multiply", 0.5, 0.5)).toBeCloseTo(0.25);
    expect(b("screen", 0.5, 0.5)).toBeCloseTo(0.75);
    expect(b("overlay", 0.25, 1)).toBeCloseTo(0.5);
    expect(b("darken", 0.3, 0.6)).toBeCloseTo(0.3);
    expect(b("lighten", 0.3, 0.6)).toBeCloseTo(0.6);
    expect(b("color-dodge", 0.5, 0.5)).toBeCloseTo(1);
    expect(b("color-burn", 0.5, 0.5)).toBeCloseTo(0);
    expect(b("hard-light", 0.5, 0.75)).toBeCloseTo(0.75);
    expect(b("soft-light", 0.5, 0.5)).toBeCloseTo(0.5);
    expect(b("difference", 0.2, 0.7)).toBeCloseTo(0.5);
    expect(b("exclusion", 0.5, 0.5)).toBeCloseTo(0.5);
    // Luminosity keeps the backdrop's hue and takes the source's lightness.
    const lum = blendColors(BLEND_IDS.luminosity!, [1, 0, 0], [0.5, 0.5, 0.5]);
    expect(0.3 * lum[0] + 0.59 * lum[1] + 0.11 * lum[2]).toBeCloseTo(0.5);
    expect(lum[0]).toBeGreaterThan(lum[1]);
    // Colour on grey keeps the grey's lightness.
    const color = blendColors(BLEND_IDS.color!, [0.5, 0.5, 0.5], [1, 0, 0]);
    expect(0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2]).toBeCloseTo(0.5);
  });
});

describe("adjustPixels", () => {
  it("applies the adjustment by its strength and mask, leaving alpha and empty pixels alone", () => {
    const data = pixels([200, 100, 0, 255], [10, 20, 30, 128], [50, 50, 50, 0]);
    adjustPixels(data, 3, 1, invert, 1, "source-over");
    expect([...data]).toEqual([55, 155, 255, 255, 245, 235, 225, 128, 50, 50, 50, 0]);

    const half = pixels([200, 100, 0, 255]);
    adjustPixels(half, 1, 1, invert, 0.5, "source-over");
    expect([...half]).toEqual([128, 128, 128, 255]);

    const masked = pixels([200, 0, 0, 255], [200, 0, 0, 255]);
    adjustPixels(masked, 2, 1, invert, 1, "source-over", new Uint8Array([0, 255]));
    expect([...masked]).toEqual([200, 0, 0, 255, 55, 255, 255, 255]);
  });

  it("blends the adjusted colours in the layer's mode", () => {
    // Inverted grey multiplied onto itself.
    const data = pixels([128, 128, 128, 255]);
    adjustPixels(data, 1, 1, invert, 1, "multiply");
    expect(data[0]).toBe(Math.round((128 / 255) * (127 / 255) * 255));
  });
});

describe("Photoshop's own blend modes", () => {
  const one = (mode: string, cb: number, cs: number) => blendColors(BLEND_IDS[mode]!, [cb, cb, cb], [cs, cs, cs])[0];

  it("follow Photoshop's formulas", () => {
    expect(one("linear-burn", 0.75, 0.5)).toBeCloseTo(0.25);
    expect(one("linear-burn", 0.25, 0.5)).toBe(0);
    expect(one("linear-dodge", 0.25, 0.5)).toBeCloseTo(0.75);
    expect(one("linear-dodge", 0.75, 0.5)).toBe(1);
    expect(one("linear-light", 0.5, 0.75)).toBeCloseTo(1);
    expect(one("linear-light", 0.5, 0.25)).toBeCloseTo(0);
    expect(one("linear-light", 0.4, 0.5)).toBeCloseTo(0.4);
    // Vivid Light: Color Burn below the middle, Color Dodge above.
    expect(one("vivid-light", 0.5, 0.25)).toBeCloseTo(0);
    expect(one("vivid-light", 0.5, 0.75)).toBeCloseTo(1);
    expect(one("vivid-light", 0.8, 0.4)).toBeCloseTo(1 - 0.2 / 0.8);
    expect(one("pin-light", 0.8, 0.25)).toBeCloseTo(0.5);
    expect(one("pin-light", 0.2, 0.75)).toBeCloseTo(0.5);
    expect(one("pin-light", 0.4, 0.5)).toBeCloseTo(0.4);
    expect(one("hard-mix", 0.6, 0.5)).toBe(1);
    expect(one("hard-mix", 0.4, 0.5)).toBe(0);
    expect(one("subtract", 0.75, 0.25)).toBeCloseTo(0.5);
    expect(one("subtract", 0.25, 0.75)).toBe(0);
    expect(one("divide", 0.25, 0.5)).toBeCloseTo(0.5);
    expect(one("divide", 0.75, 0.5)).toBe(1);
    expect(one("divide", 0.5, 0)).toBe(1);
    expect(one("divide", 0, 0)).toBe(0);
  });

  it("pick whole colours for Darker and Lighter Color", () => {
    expect(blendColors(BLEND_IDS["darker-color"]!, [0.9, 0.1, 0.1], [0.4, 0.4, 0.4])).toEqual([0.9, 0.1, 0.1]);
    expect(blendColors(BLEND_IDS["darker-color"]!, [0.9, 0.5, 0.1], [0.4, 0.4, 0.4])).toEqual([0.4, 0.4, 0.4]);
    expect(blendColors(BLEND_IDS["lighter-color"]!, [0.9, 0.5, 0.1], [0.4, 0.4, 0.4])).toEqual([0.9, 0.5, 0.1]);
  });

  it("are the ones the compositor blends itself", () => {
    for (const mode of ["dissolve", "linear-burn", "darker-color", "linear-dodge", "lighter-color", "vivid-light", "linear-light", "pin-light", "hard-mix", "subtract", "divide"]) {
      expect(isCustomBlend(mode), mode).toBe(true);
    }
    for (const mode of ["source-over", "multiply", "luminosity", undefined, "bogus"]) expect(isCustomBlend(mode), String(mode)).toBe(false);
  });
});

describe("composePixels", () => {
  it("is source-over with blending, by the layer's alpha and opacity", () => {
    // Opaque over opaque: the blend itself.
    const below = pixels([192, 192, 192, 255]);
    composePixels(below, pixels([128, 128, 128, 255]), 1, "linear-burn", 1);
    expect([...below]).toEqual([Math.round((192 / 255 + 128 / 255 - 1) * 255), Math.round((192 / 255 + 128 / 255 - 1) * 255), Math.round((192 / 255 + 128 / 255 - 1) * 255), 255]);
    // Half opacity: half way there.
    const half = pixels([200, 0, 0, 255]);
    composePixels(half, pixels([0, 0, 200, 255]), 1, "linear-dodge", 0.5);
    expect([...half]).toEqual([200, 0, 100, 255]);
    // Over nothing, the layer's own colour, whatever the mode.
    const empty = pixels([0, 0, 0, 0]);
    composePixels(empty, pixels([10, 20, 30, 128]), 1, "subtract", 1);
    expect([...empty]).toEqual([10, 20, 30, 128]);
    // Nothing of the layer: nothing changes.
    const kept = pixels([1, 2, 3, 255]);
    composePixels(kept, pixels([200, 200, 200, 0]), 1, "divide", 1);
    expect([...kept]).toEqual([1, 2, 3, 255]);
  });

  it("dissolves by noise: each pixel wholly the layer's or not at all", () => {
    const count = 64 * 64;
    const below = new Uint8ClampedArray(count * 4).fill(0);
    const layer = new Uint8ClampedArray(count * 4);
    for (let pixel = 0; pixel < count; pixel += 1) layer.set([255, 255, 255, 255], pixel * 4);
    for (let pixel = 0; pixel < count; pixel += 1) below.set([0, 0, 0, 255], pixel * 4);
    composePixels(below, layer, 64, "dissolve", 0.25);
    let shown = 0;
    for (let pixel = 0; pixel < count; pixel += 1) {
      expect([0, 255]).toContain(below[pixel * 4]);
      if (below[pixel * 4] === 255) shown += 1;
    }
    expect(shown / count).toBeGreaterThan(0.2);
    expect(shown / count).toBeLessThan(0.3);
    // The same noise each time.
    expect(dissolveNoise(10, 20)).toBe(dissolveNoise(10, 20));
    expect(dissolveNoise(10, 20)).not.toBe(dissolveNoise(20, 10));
  });
});
