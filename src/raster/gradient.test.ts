import { describe, expect, it } from "vitest";
import { constrainAngle, gradientStops } from "./gradient";

describe("constrainAngle", () => {
  it("snaps to horizontal and vertical lines", () => {
    expect(constrainAngle({ x: 10, y: 10 }, { x: 110, y: 18 })).toEqual({ x: expect.closeTo(110.32, 1), y: 10 });
    expect(constrainAngle({ x: 0, y: 0 }, { x: -3, y: -50 })).toEqual({ x: 0, y: expect.closeTo(-50.09, 1) });
  });

  it("snaps to diagonals, keeping the drag's reach", () => {
    const end = constrainAngle({ x: 0, y: 0 }, { x: 40, y: 34 });
    expect(end.x).toBeCloseTo(40);
    expect(end.y).toBeCloseTo(40);
  });

  it("leaves a click where it is", () => {
    expect(constrainAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});

describe("gradientStops", () => {
  it("runs from the foreground to the background colour", () => {
    expect(
      gradientStops({ colors: "foreground-background", reverse: false }, "#ff0000", "#0000ff")
    ).toEqual([
      [0, "rgba(255, 0, 0, 1)"],
      [1, "rgba(0, 0, 255, 1)"],
    ]);
  });

  it("fades the foreground out, and can be reversed", () => {
    expect(
      gradientStops({ colors: "foreground-transparent", reverse: true }, "#00ff00", "#ffffff")
    ).toEqual([
      [0, "rgba(0, 255, 0, 0)"],
      [1, "rgba(0, 255, 0, 1)"],
    ]);
  });
});
