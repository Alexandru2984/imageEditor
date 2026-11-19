import { describe, expect, it } from "vitest";
import { axisFactors, fitsLimits } from "./documentSize";

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
