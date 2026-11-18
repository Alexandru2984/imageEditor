import { describe, expect, it } from "vitest";
import { growBox, snapToPixelGrid, unionBoxes } from "./regions";

describe("unionBoxes", () => {
  it("covers every box", () => {
    expect(
      unionBoxes([
        { left: 10, top: 20, width: 5, height: 5 },
        { left: -3, top: 22, width: 4, height: 10 },
      ])
    ).toEqual({ left: -3, top: 20, width: 18, height: 12 });
  });

  it("is empty for no boxes", () => {
    expect(unionBoxes([])).toBeNull();
  });
});

describe("growBox", () => {
  it("adds the margin on every side", () => {
    expect(growBox({ left: 0, top: 0, width: 10, height: 4 }, 2)).toEqual({
      left: -2,
      top: -2,
      width: 14,
      height: 8,
    });
  });
});

describe("snapToPixelGrid", () => {
  it("grows a box outwards to whole document pixels", () => {
    // Two pixels per scene unit, grid starting at 10.
    const box = snapToPixelGrid({ left: 10.3, top: 10.9, width: 1, height: 0.2 }, { x: 10, y: 10 }, 2);
    expect(box).toEqual({ left: 10, top: 10.5, width: 1.5, height: 1 });
  });

  it("keeps boxes already on the grid, despite floating point noise", () => {
    const multiplier = 1 / 0.85;
    const left = 7 + 120 / multiplier;
    const box = snapToPixelGrid({ left, top: 7, width: 30 / multiplier, height: 1 / multiplier }, { x: 7, y: 7 }, multiplier);
    expect(box.left).toBeCloseTo(left, 9);
    expect(box.width * multiplier).toBeCloseTo(30, 9);
    expect(box.height * multiplier).toBeCloseTo(1, 9);
  });
});
