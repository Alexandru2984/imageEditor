import { describe, expect, it } from "vitest";
import { stepBrushHardness, stepBrushWidth, tint, withAlpha } from "./brushes";

describe("brush colours", () => {
  it("adds alpha to hex colours and leaves others alone", () => {
    expect(withAlpha("#ff8000", 0.45)).toBe("rgba(255, 128, 0, 0.45)");
    expect(withAlpha("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
  });

  it("tints toward white", () => {
    expect(tint("#000000", 0.5)).toBe("#808080");
    expect(tint("#ff0000", 0)).toBe("#ff0000");
    expect(tint("#3b82f6", 1)).toBe("#ffffff");
  });
});

describe("brush size keys", () => {
  it("step by one pixel while fine, then by five", () => {
    expect(stepBrushWidth(3, 1)).toBe(4);
    expect(stepBrushWidth(9, 1)).toBe(10);
    expect(stepBrushWidth(10, 1)).toBe(15);
    expect(stepBrushWidth(15, -1)).toBe(10);
    expect(stepBrushWidth(10, -1)).toBe(9);
  });

  it("snap slider sizes to the grid and stay in range", () => {
    expect(stepBrushWidth(12, 1)).toBe(15);
    expect(stepBrushWidth(12, -1)).toBe(10);
    expect(stepBrushWidth(1, -1)).toBe(1);
    expect(stepBrushWidth(48, 1)).toBe(50);
    expect(stepBrushWidth(50, 1)).toBe(50);
  });

  it("step hardness in quarters", () => {
    expect(stepBrushHardness(100, -1)).toBe(75);
    expect(stepBrushHardness(60, -1)).toBe(50);
    expect(stepBrushHardness(60, 1)).toBe(75);
    expect(stepBrushHardness(0, -1)).toBe(0);
    expect(stepBrushHardness(100, 1)).toBe(100);
  });
});
