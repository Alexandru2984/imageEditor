import { describe, it, expect } from "vitest";
import { clampZoom, MIN_ZOOM, MAX_ZOOM } from "./viewport";

describe("clampZoom", () => {
  it("keeps values within range untouched (rounded to 2 decimals)", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it("clamps below the minimum", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
  });

  it("clamps above the maximum", () => {
    expect(clampZoom(999)).toBe(MAX_ZOOM);
  });

  it("rounds to two decimal places to keep the percentage label stable", () => {
    expect(clampZoom(1.23456)).toBe(1.23);
    expect(clampZoom(0.999 ** 30)).toBeCloseTo(0.97, 2);
  });
});
