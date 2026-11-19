import { describe, expect, it } from "vitest";
import { addNoise, cropInto, emboss, findEdges, gaussBoxes, gaussianBlur, highPass, horizontalBlur, mosaic, unsharpMask, type Area } from "./filters";

const solid = (width: number, height: number, rgba: number[]): Area => ({
  width,
  height,
  data: new Uint8ClampedArray(Array.from({ length: width * height }, () => rgba).flat()),
});

/** A white square in the middle of black. */
const square = (size: number, inner: number): Area => {
  const area = solid(size, size, [0, 0, 0, 255]);
  const from = (size - inner) / 2;
  for (let y = from; y < from + inner; y += 1) {
    for (let x = from; x < from + inner; x += 1) area.data.fill(255, (y * size + x) * 4, (y * size + x) * 4 + 3);
  }
  return area;
};

const at = (data: Uint8ClampedArray, width: number, x: number, y: number) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe("blurs", () => {
  it("approximate a Gaussian with three boxes", () => {
    expect(gaussBoxes(1).every((box) => box >= 0)).toBe(true);
    const [a, b, c] = gaussBoxes(10);
    const variance = [a, b, c].reduce((sum, r) => sum + ((2 * r + 1) ** 2 - 1) / 12, 0);
    expect(Math.sqrt(variance)).toBeGreaterThan(9);
    expect(Math.sqrt(variance)).toBeLessThan(11);
  });

  it("leave flat colour alone and keep its level", () => {
    const area = solid(20, 10, [100, 150, 200, 255]);
    expect([...gaussianBlur(area, 4)]).toEqual([...area.data]);
    expect([...horizontalBlur(area, 5)]).toEqual([...area.data]);
  });

  it("soften an edge symmetrically and keep the average", () => {
    const area = square(40, 10);
    const blurred = gaussianBlur(area, 3);
    expect(at(blurred, 40, 20, 20)[0]!).toBeLessThan(255);
    expect(at(blurred, 40, 12, 20)[0]!).toBeGreaterThan(0);
    expect(at(blurred, 40, 12, 20)[0]).toBe(at(blurred, 40, 27, 20)[0]);
    const sum = (data: Uint8ClampedArray) => data.reduce((total, value, index) => (index % 4 === 0 ? total + value : total), 0);
    expect(Math.abs(sum(blurred) - sum(area.data)) / sum(area.data)).toBeLessThan(0.02);
  });

  it("does not bleed the colour of transparent pixels", () => {
    const area = solid(10, 1, [255, 0, 0, 0]);
    area.data.set([0, 0, 255, 255], 5 * 4);
    const blurred = gaussianBlur(area, 2);
    const near = at(blurred, 10, 4, 0);
    expect(near[3]!).toBeGreaterThan(0);
    expect(near[0]).toBe(0);
    expect(near[2]).toBe(255);
  });

  it("only blurs along rows for motion blur", () => {
    const area = square(20, 6);
    const blurred = horizontalBlur(area, 3);
    // Above the square nothing changes; beside it, it smears.
    expect(at(blurred, 20, 10, 3)[0]).toBe(0);
    expect(at(blurred, 20, 5, 10)[0]!).toBeGreaterThan(0);
  });
});

describe("sharpening and detail", () => {
  it("unsharp mask boosts an edge but not flat colour or small differences", () => {
    const flat = solid(10, 10, [90, 90, 90, 255]);
    expect([...unsharpMask(flat, { amount: 200, radius: 2, threshold: 0 })]).toEqual([...flat.data]);
    const area = square(30, 10);
    const sharp = unsharpMask(area, { amount: 100, radius: 2, threshold: 0 });
    expect(at(sharp, 30, 9, 15)[0]).toBe(0);
    const outside = at(sharp, 30, 9, 15);
    expect(outside[0]).toBeLessThanOrEqual(at(area.data, 30, 9, 15)[0]!);
    const ignored = unsharpMask(area, { amount: 100, radius: 2, threshold: 255 });
    expect([...ignored]).toEqual([...area.data]);
  });

  it("high pass turns flat colour middle grey", () => {
    expect(at(highPass(solid(8, 8, [10, 200, 90, 255]), 3), 8, 4, 4)).toEqual([128, 128, 128, 255]);
  });
});

describe("noise, mosaic and stylize", () => {
  it("adds the same noise for the same settings, none at 0%", () => {
    const area = solid(16, 16, [128, 128, 128, 255]);
    const settings = { amount: 50, distribution: "gaussian" as const, monochromatic: true };
    const once = addNoise(area, settings);
    expect([...once]).toEqual([...addNoise(area, settings)]);
    expect([...once]).not.toEqual([...area.data]);
    const pixel = at(once, 16, 3, 3);
    expect(pixel[0]).toBe(pixel[1]);
    expect([...addNoise(area, { ...settings, amount: 0 })]).toEqual([...area.data]);
  });

  it("averages cells aligned to the layer", () => {
    const area: Area = { width: 4, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 200, 0, 0, 255, 0, 0, 0, 255]) };
    expect([...mosaic(area, 2)]).toEqual([50, 50, 50, 255, 50, 50, 50, 255, 100, 0, 0, 255, 100, 0, 0, 255]);
    // Starting one pixel into the layer, the first cell is cut short.
    expect(at(mosaic(area, 2, { x: 1, y: 0 }), 4, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("embosses flat colour to grey and lights edges facing the light", () => {
    expect(at(emboss(solid(6, 6, [40, 90, 200, 255]), { angle: 0, height: 1, amount: 100 }), 6, 3, 3)).toEqual([128, 128, 128, 255]);
    const area = square(20, 8);
    const relief = emboss(area, { angle: 0, height: 1, amount: 100 });
    // With light from the right, the square's left edge is lit, its right edge dark.
    expect(at(relief, 20, 5, 10)[0]!).toBeGreaterThan(128);
    expect(at(relief, 20, 14, 10)[0]!).toBeLessThan(128);
  });

  it("finds edges as dark lines on white", () => {
    const edges = findEdges(square(20, 8));
    expect(at(edges, 20, 1, 1)).toEqual([255, 255, 255, 255]);
    expect(at(edges, 20, 6, 10)[0]!).toBeLessThan(100);
  });

  it("crops a region out of a larger result", () => {
    const full = new Uint8ClampedArray(Array.from({ length: 3 * 3 * 4 }, (_, index) => index));
    const target = new Uint8ClampedArray(4);
    cropInto(full, { width: 3 }, 1, 2, target, 1, 1);
    expect([...target]).toEqual([28, 29, 30, 31]);
  });
});
