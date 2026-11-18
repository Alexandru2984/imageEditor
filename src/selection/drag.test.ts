import { describe, expect, it } from "vitest";
import { HeldModifier, dragBox, modeFor } from "./drag";

describe("modeFor", () => {
  it("follows Photoshop's modifiers over the chosen mode", () => {
    expect(modeFor({ shiftKey: false, altKey: false }, "subtract")).toBe("subtract");
    expect(modeFor({ shiftKey: true, altKey: false }, "replace")).toBe("add");
    expect(modeFor({ shiftKey: false, altKey: true }, "replace")).toBe("subtract");
    expect(modeFor({ shiftKey: true, altKey: true }, "add")).toBe("intersect");
  });
});

describe("dragBox", () => {
  const start = { x: 10, y: 10 };
  it("spans the drag", () => {
    expect(dragBox(start, { x: 4, y: 30 })).toEqual({ x0: 10, y0: 10, x1: 4, y1: 30 });
  });
  it("makes a square in the drag's direction", () => {
    expect(dragBox(start, { x: 4, y: 30 }, { square: true })).toEqual({ x0: 10, y0: 10, x1: -10, y1: 30 });
  });
  it("grows from the centre", () => {
    expect(dragBox(start, { x: 14, y: 12 }, { fromCentre: true })).toEqual({ x0: 6, y0: 8, x1: 14, y1: 12 });
  });
});

describe("HeldModifier", () => {
  it("ignores a key held from the start until it is pressed again", () => {
    const shift = new HeldModifier(true);
    expect(shift.update(true)).toBe(false);
    expect(shift.update(false)).toBe(false);
    expect(shift.update(true)).toBe(true);
  });
  it("acts at once when the drag began without it", () => {
    const alt = new HeldModifier(false);
    expect(alt.update(false)).toBe(false);
    expect(alt.update(true)).toBe(true);
  });
});
