import { describe, expect, it } from "vitest";
import { membraneFill } from "./heal";

describe("membrane fill", () => {
  it("bridges a gap between two known values with a smooth ramp", () => {
    const width = 11;
    const values = new Float32Array(width);
    const known = new Uint8Array(width);
    values[0] = 0;
    known[0] = 1;
    values[10] = 100;
    known[10] = 1;
    expect(membraneFill(values, known, width, 1, 1, 400)).toBe(true);
    // A membrane between two ends is a straight line.
    for (let x = 0; x <= 10; x += 1) expect(values[x]).toBeCloseTo(x * 10, 0);
  });

  it("fills a hole in a flat field with the field's value and keeps known values", () => {
    const width = 20;
    const height = 20;
    const values = new Float32Array(width * height * 2);
    const known = new Uint8Array(width * height);
    for (let index = 0; index < width * height; index += 1) {
      const x = index % width;
      const y = Math.floor(index / width);
      const inside = x >= 6 && x < 14 && y >= 6 && y < 14;
      known[index] = inside ? 0 : 1;
      values[index * 2] = inside ? 999 : 40;
      values[index * 2 + 1] = inside ? -999 : -7;
    }
    membraneFill(values, known, width, height, 2);
    for (let index = 0; index < width * height; index += 1) {
      expect(values[index * 2]).toBeCloseTo(40, 3);
      expect(values[index * 2 + 1]).toBeCloseTo(-7, 3);
    }
  });

  it("does nothing when nothing is known", () => {
    const values = new Float32Array([5, 6]);
    expect(membraneFill(values, new Uint8Array(2), 2, 1, 1)).toBe(false);
    expect([...values]).toEqual([5, 6]);
  });
});
