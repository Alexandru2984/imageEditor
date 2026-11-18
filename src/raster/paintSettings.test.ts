import { describe, expect, it } from "vitest";
import { paintSizeToSlider, sliderToPaintSize, stepPaintSize } from "./paintSettings";

describe("paint size", () => {
  it("steps like Photoshop: by 1 to 10, by 10 to 100, then coarser", () => {
    expect(stepPaintSize(9, 1)).toBe(10);
    expect(stepPaintSize(10, 1)).toBe(20);
    expect(stepPaintSize(20, -1)).toBe(10);
    expect(stepPaintSize(10, -1)).toBe(9);
    expect(stepPaintSize(100, 1)).toBe(125);
    expect(stepPaintSize(125, -1)).toBe(100);
    expect(stepPaintSize(450, 1)).toBe(500);
    expect(stepPaintSize(500, 1)).toBe(600);
  });

  it("snaps odd sizes to the grid and stays in range", () => {
    expect(stepPaintSize(37, 1)).toBe(40);
    expect(stepPaintSize(37, -1)).toBe(30);
    expect(stepPaintSize(1, -1)).toBe(1);
    expect(stepPaintSize(1000, 1)).toBe(1000);
  });

  it("maps the slider logarithmically, both ways", () => {
    expect(sliderToPaintSize(0)).toBe(1);
    expect(sliderToPaintSize(1000)).toBe(1000);
    expect(sliderToPaintSize(500)).toBe(32);
    for (const size of [1, 5, 30, 100, 640, 1000]) {
      expect(Math.abs(sliderToPaintSize(paintSizeToSlider(size)) - size)).toBeLessThanOrEqual(size * 0.01 + 0.5);
    }
  });
});
