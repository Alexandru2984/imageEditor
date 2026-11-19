import { describe, expect, it } from "vitest";
import { anchoredRect, axisFactors, fitsLimits, trimBounds } from "./documentSize";

describe("document size", () => {
  it("scales an object's own axes with the document", () => {
    // Upright: x follows the width, y the height.
    expect(axisFactors([2, 0, 0, 3, 10, 20], 0.5, 2)).toEqual({ x: 0.5, y: 2 });
    // Turned a quarter: its x runs down the document.
    const turned = axisFactors([0, 1, -1, 0, 0, 0], 0.5, 2);
    expect(turned.x).toBeCloseTo(2);
    expect(turned.y).toBeCloseTo(0.5);
    // At 45°, halfway in between.
    const r = Math.SQRT1_2;
    expect(axisFactors([r, r, -r, r, 0, 0], 1, 1).x).toBeCloseTo(1);
    expect(axisFactors([r, r, -r, r, 0, 0], 2, 2).y).toBeCloseTo(2);
  });

  it("keeps documents within what the browser can hold", () => {
    expect(fitsLimits(4000, 3000)).toBe(true);
    expect(fitsLimits(8192, 1)).toBe(true);
    expect(fitsLimits(8193, 1)).toBe(false);
    expect(fitsLimits(5000, 5000)).toBe(false);
    expect(fitsLimits(0, 10)).toBe(false);
    expect(fitsLimits(10.5, 10)).toBe(false);
  });
});

describe("canvas size and trim", () => {
  it("places the old document by the anchor", () => {
    const current = { width: 100, height: 50 };
    expect(anchoredRect(current, { width: 140, height: 90 }, { x: 0, y: 0 })).toEqual({ left: -0, top: -0, width: 140, height: 90 });
    expect(anchoredRect(current, { width: 140, height: 90 }, { x: 0.5, y: 1 })).toEqual({ left: -20, top: -40, width: 140, height: 90 });
    // Smaller: the anchor says which part stays.
    expect(anchoredRect(current, { width: 60, height: 50 }, { x: 1, y: 0.5 })).toEqual({ left: 40, top: -0, width: 60, height: 50 });
  });

  const picture = (width: number, height: number, paint: (x: number, y: number) => number[]) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4);
    return data;
  };

  it("finds what is not transparent, or not the corner's colour", () => {
    const transparent = picture(10, 8, (x, y) => (x >= 2 && x < 7 && y >= 3 && y < 5 ? [9, 9, 9, 255] : [0, 0, 0, 0]));
    expect(trimBounds(transparent, 10, 8, "transparent")).toEqual({ left: 2, top: 3, width: 5, height: 2 });

    // White border on the left and top, black elsewhere.
    const framed = picture(10, 8, (x, y) => (x < 3 || y < 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(trimBounds(framed, 10, 8, "topLeft")).toEqual({ left: 3, top: 1, width: 7, height: 7 });
    // The bottom-right corner is black: everything white stays.
    expect(trimBounds(framed, 10, 8, "bottomRight")).toEqual({ left: 0, top: 0, width: 10, height: 8 });
  });

  it("finds nothing in an empty picture", () => {
    expect(trimBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4, "transparent")).toBeNull();
  });
});
