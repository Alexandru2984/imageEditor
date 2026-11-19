import { describe, expect, it } from "vitest";
import { computeSnap, type Box } from "./snapping";

const photo: Box = { left: 0, top: 0, width: 1000, height: 600 };

describe("computeSnap", () => {
  it("snaps a box's centre to the photo centre on both axes", () => {
    const moving: Box = { left: 447, top: 253, width: 100, height: 100 };
    const result = computeSnap(moving, [photo], 6);
    expect(result.dx).toBe(3);
    expect(result.dy).toBe(-3);
    expect(result.lines).toEqual([
      { axis: "x", position: 500, from: 0, to: 600 },
      { axis: "y", position: 300, from: 0, to: 1000 },
    ]);
  });

  it("leaves boxes alone outside the threshold", () => {
    const moving: Box = { left: 420, top: 180, width: 100, height: 100 };
    expect(computeSnap(moving, [photo], 6)).toEqual({ dx: 0, dy: 0, lines: [] });
  });

  it("prefers the closest stop and snaps edges to other layers", () => {
    const other: Box = { left: 200, top: 100, width: 50, height: 50 };
    // Right edge (195) is 5 away from the other's left edge (200); left edge
    // (95) is 5 away from nothing closer, so the 5px move wins over none.
    const moving: Box = { left: 95, top: 102, width: 100, height: 40 };
    const result = computeSnap(moving, [photo, other], 6);
    expect(result.dx).toBe(5);
    expect(result.dy).toBe(-2);
    expect(result.lines).toContainEqual({ axis: "x", position: 200, from: 100, to: 150 });
    expect(result.lines).toContainEqual({ axis: "y", position: 100, from: 100, to: 250 });
  });

  it("merges guides that several references share", () => {
    const a: Box = { left: 0, top: 500, width: 10, height: 10 };
    const b: Box = { left: 900, top: 500, width: 10, height: 10 };
    const moving: Box = { left: 400, top: 501, width: 20, height: 10 };
    const result = computeSnap(moving, [a, b], 4);
    expect(result.dy).toBe(-1);
    const top = result.lines.filter((line) => line.axis === "y" && line.position === 500);
    expect(top).toEqual([{ axis: "y", position: 500, from: 0, to: 910 }]);
  });

  it("does nothing with a zero threshold", () => {
    const moving: Box = { left: 449, top: 250, width: 100, height: 100 };
    const result = computeSnap(moving, [photo], 0);
    expect(result.dx).toBe(0);
    // Already-aligned stops still show their guide.
    expect(result.lines).toEqual([{ axis: "y", position: 300, from: 0, to: 1000 }]);
  });

  it("snaps to extra lines (guides, the grid) without drawing a guide for them", () => {
    const result = computeSnap({ left: 96, top: 0, width: 20, height: 20 }, [], 5, { x: [100], y: [] });
    expect(result.dx).toBe(4);
    expect(result.dy).toBe(0);
    expect(result.lines).toEqual([]);
  });
});
