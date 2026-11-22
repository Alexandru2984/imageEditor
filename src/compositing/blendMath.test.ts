import { describe, expect, it } from "vitest";
import { adjustPixels, BLEND_IDS, blendColors } from "./blendMath";
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
