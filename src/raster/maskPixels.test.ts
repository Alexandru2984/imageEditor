import { describe, expect, it } from "vitest";
import { greyOf, greyToAlpha } from "./maskPixels";

const convert = (...pixels: number[][]) => {
  const data = new Uint8ClampedArray(pixels.flat());
  greyToAlpha(data);
  return Array.from({ length: pixels.length }, (_, index) => [...data.subarray(index * 4, index * 4 + 4)]);
};

describe("greyToAlpha", () => {
  it("turns white into opaque and black into clear", () => {
    expect(convert([255, 255, 255, 255], [0, 0, 0, 255])).toEqual([
      [255, 255, 255, 255],
      [255, 255, 255, 0],
    ]);
  });

  it("keeps greys as partial opacity", () => {
    expect(convert([128, 128, 128, 255])[0]![3]).toBe(128);
  });

  it("reads erased pixels as white", () => {
    expect(convert([0, 0, 0, 0])[0]![3]).toBe(255);
    expect(convert([0, 0, 0, 128])[0]![3]).toBe(127);
  });

  it("uses the brightness of colours", () => {
    expect(convert([255, 0, 0, 255])[0]![3]).toBe(77);
    expect(convert([0, 255, 0, 255])[0]![3]).toBe(149);
  });
});

describe("greyOf", () => {
  it("maps colours to their grey", () => {
    expect(greyOf("#ffffff")).toBe("#ffffff");
    expect(greyOf("#000000")).toBe("#000000");
    expect(greyOf("#ff0000")).toBe("#4d4d4d");
    expect(greyOf("nonsense")).toBe("#000000");
  });
});
