import { describe, expect, it } from "vitest";
import { CROP_RATIOS, fitRatio, resolveRatio } from "./cropFrame";

const photo = { left: 10, top: 20, width: 1600, height: 1000 };

describe("fitRatio", () => {
  it("fits a square into a landscape photo using its full height", () => {
    expect(fitRatio(photo, 1)).toEqual({ left: 310, top: 20, width: 1000, height: 1000 });
  });

  it("fits a wide frame using the full width", () => {
    const frame = fitRatio(photo, 16 / 9);
    expect(frame.width).toBe(1600);
    expect(frame.height).toBeCloseTo(900);
    expect(frame.top).toBeCloseTo(70);
  });

  it("fits a story frame into a landscape photo", () => {
    const frame = fitRatio(photo, 9 / 16);
    expect(frame.height).toBe(1000);
    expect(frame.width).toBeCloseTo(562.5);
    expect(frame.left + frame.width / 2).toBeCloseTo(810);
  });

  it("returns the area unchanged for invalid ratios", () => {
    expect(fitRatio(photo, 0)).toEqual(photo);
    expect(fitRatio(photo, Number.NaN)).toEqual(photo);
  });
});

describe("resolveRatio", () => {
  it("uses the photo's shape for Original and nothing for Free", () => {
    const original = CROP_RATIOS.find((option) => option.id === "original")!;
    const free = CROP_RATIOS.find((option) => option.id === "free")!;
    expect(resolveRatio(original, photo)).toBe(1.6);
    expect(resolveRatio(free, photo)).toBeNull();
  });
});
