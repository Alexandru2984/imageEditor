import { describe, expect, it } from "vitest";
import { invertLut, uniformLuts } from "./adjustments";
import { jobReach, runJob, type JobArea } from "./pixelJobs";

/** A 4×3 area whose pixel values count up, with a 2×1 region at 1, 1. */
const area = (): JobArea => ({
  width: 4,
  height: 3,
  x: 1,
  y: 1,
  data: new Uint8ClampedArray(Array.from({ length: 12 }, (_, index) => [index * 10, 0, 0, 255]).flat()),
});

describe("pixel jobs", () => {
  it("changes only the region for pixel-by-pixel jobs", () => {
    const result = runJob({ op: "luts", luts: uniformLuts(invertLut()) }, area(), 2, 1, { x: 0, y: 0 });
    // Pixels 5 and 6 of the area.
    expect([...result]).toEqual([205, 255, 255, 255, 195, 255, 255, 255]);
  });

  it("lets filters see past the region and cuts the region out", () => {
    const result = runJob({ op: "mosaic", size: 4 }, area(), 2, 1, { x: 0, y: 0 });
    // One 4×3 cell: the average of all twelve pixels (0…110).
    expect([...result.slice(0, 4)]).toEqual([55, 0, 0, 255]);
  });

  it("knows how far each job looks", () => {
    expect(jobReach({ op: "desaturate" })).toBe(0);
    expect(jobReach({ op: "gaussianBlur", radius: 4 })).toBe(14);
    expect(jobReach({ op: "motionBlur", angle: 30, distance: 20 })).toBe(12);
  });
});
