import { describe, expect, it } from "vitest";
import { cropGuides, isGridSettings, isGuideList, mapGuides, nearestLines, rulerStep, type Guide } from "./guideData";

describe("guide data", () => {
  it("accepts only guides the editor writes", () => {
    expect(isGuideList([])).toBe(true);
    expect(isGuideList([{ axis: "x", position: 12.5 }, { axis: "y", position: -3 }])).toBe(true);
    expect(isGuideList([{ axis: "z", position: 1 }])).toBe(false);
    expect(isGuideList([{ axis: "x", position: Infinity }])).toBe(false);
    expect(isGuideList([{ axis: "x", position: "1" }])).toBe(false);
    expect(isGuideList([{ axis: "x", position: 1, onload: "x" }])).toBe(false);
    expect(isGuideList([null])).toBe(false);
    expect(isGuideList({ axis: "x", position: 1 })).toBe(false);
    expect(isGuideList(Array.from({ length: 201 }, () => ({ axis: "x", position: 0 })))).toBe(false);
  });

  it("turns, flips and stretches guides with the document; tilted ones stay", () => {
    const guides: Guide[] = [
      { axis: "x", position: 30 },
      { axis: "y", position: 10 },
    ];
    // A quarter turn clockwise about (50, 50): x = 30 becomes y = 30, y = 10 becomes x = 90.
    expect(mapGuides(guides, [0, 1, -1, 0, 100, 0])).toEqual([
      { axis: "y", position: 30 },
      { axis: "x", position: 90 },
    ]);
    // Mirrored across x = 50.
    expect(mapGuides(guides, [-1, 0, 0, 1, 100, 0])).toEqual([
      { axis: "x", position: 70 },
      { axis: "y", position: 10 },
    ]);
    // Stretched down by 2 from y = 0.
    expect(mapGuides(guides, [1, 0, 0, 2, 0, 0])).toEqual([
      { axis: "x", position: 30 },
      { axis: "y", position: 20 },
    ]);
    const tilt = Math.SQRT1_2;
    expect(mapGuides(guides, [tilt, tilt, -tilt, tilt, 0, 0])).toEqual(guides);
  });

  it("numbers the ruler in 1, 2 and 5 steps far enough apart", () => {
    expect(rulerStep(1)).toEqual({ step: 100, divisions: 10 });
    expect(rulerStep(0.25)).toEqual({ step: 500, divisions: 10 });
    expect(rulerStep(0.04)).toEqual({ step: 2000, divisions: 4 });
    expect(rulerStep(8)).toEqual({ step: 10, divisions: 10 });
    expect(rulerStep(3)).toEqual({ step: 20, divisions: 4 });
    expect(rulerStep(0.06)).toEqual({ step: 1000, divisions: 10 });
    expect(rulerStep(0.012)).toEqual({ step: 5000, divisions: 10 });
  });

  it("checks grid settings and finds the lines either side", () => {
    expect(isGridSettings({ spacing: 100, subdivisions: 4 })).toBe(true);
    expect(isGridSettings({ spacing: 0, subdivisions: 4 })).toBe(false);
    expect(isGridSettings({ spacing: 100, subdivisions: 2.5 })).toBe(false);
    expect(isGridSettings({ spacing: 100, subdivisions: 21 })).toBe(false);
    expect(isGridSettings(null)).toBe(false);
    expect(nearestLines([37, 50], 10, 25)).toEqual([35, 60, 35, 60]);
    expect(nearestLines([5], 10, 25)).toEqual([-15, 10]);
    expect(nearestLines([5], 0, 0)).toEqual([]);
  });
});

describe("cropGuides", () => {
  it("keeps the guides inside the crop, placed where the cropped image shows, and drops the rest", () => {
    const guides: Guide[] = [
      { axis: "x", position: 150 },
      { axis: "x", position: 50 },
      { axis: "y", position: 100 },
      { axis: "y", position: 300 },
      { axis: "x", position: 100 },
    ];
    // Cropped to 100..300 × 100..200, shown at twice the size from (10, 20).
    const kept = cropGuides(guides, { left: 100, top: 100, width: 200, height: 100 }, { left: 10, top: 20, width: 400, height: 200 });
    expect(kept).toEqual([
      { axis: "x", position: 110 },
      { axis: "y", position: 20 },
      { axis: "x", position: 10 },
    ]);
    expect(cropGuides(guides, { left: 0, top: 0, width: 0, height: 10 }, { left: 0, top: 0, width: 10, height: 10 })).toEqual([]);
  });
});
