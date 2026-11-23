import { describe, expect, it } from "vitest";
import { contentAwareMovePixels, patchPixels } from "./patch";
import { fixRedEye, redness } from "./redEye";

/** A 60×40 gradient (left dark, right light) with a black 6×6 spot at (10, 17). */
const picture = () => {
  const width = 60;
  const height = 40;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = 80 + x * 2;
      const spot = x >= 10 && x < 16 && y >= 17 && y < 23;
      data.set(spot ? [0, 0, 0, 255] : [value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height, x: 0, y: 0 };
};
const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
/** A square of `covered` from (x0, y0), `size` wide, in a `width` × `height` mask. */
const square = (width: number, height: number, x0: number, y0: number, size: number) => {
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y0 + size; y += 1) mask.fill(255, y * width + x0, y * width + x0 + size);
  return mask;
};

describe("Patch", () => {
  it("replaces the patched area with pixels from elsewhere, taking on the light around it", () => {
    const area = picture();
    const covered = square(60, 40, 8, 15, 10);
    // From 20 pixels right: lighter there, but healed to the light here.
    const result = patchPixels(area, 60, 40, covered, { x: 20, y: 0 });
    const middle = pixel(result, 60, 13, 20);
    expect(middle[0]).toBeGreaterThan(95);
    expect(middle[0]).toBeLessThan(120);
    // Outside the patch nothing changes.
    expect(pixel(result, 60, 40, 5)).toEqual(pixel(area.data, 60, 40, 5));
  });

  it("works on a region inside a larger area", () => {
    const area = picture();
    // The region is x 5–24, y 12–27 of the area.
    const covered = square(20, 16, 3, 3, 10);
    const result = patchPixels({ ...area, x: 5, y: 12 }, 20, 16, covered, { x: 30, y: 0 });
    expect(result.length).toBe(20 * 16 * 4);
    expect(pixel(result, 20, 8, 8)[0]).toBeGreaterThan(90);
  });
});

describe("Content-Aware Move", () => {
  it("moves the spot and fills where it was", () => {
    const area = picture();
    const moved = square(60, 40, 9, 16, 8);
    const result = contentAwareMovePixels(area, 60, 40, moved, { x: 30, y: 0 }, false);
    // The spot is gone from where it was…
    expect(pixel(result, 60, 13, 20)[0]).toBeGreaterThan(80);
    // …and is dark where it went, though healed to the lighter place.
    expect(pixel(result, 60, 43, 20)[0]).toBeLessThan(pixel(result, 60, 43, 5)[0]! - 80);
  });

  it("leaves the original with Extend", () => {
    const area = picture();
    const moved = square(60, 40, 9, 16, 8);
    const result = contentAwareMovePixels(area, 60, 40, moved, { x: 30, y: 0 }, true);
    expect(pixel(result, 60, 13, 20)[0]).toBeLessThan(20);
    expect(pixel(result, 60, 43, 20)[0]).toBeLessThan(pixel(result, 60, 43, 5)[0]! - 80);
  });
});

describe("Red Eye", () => {
  it("measures how red a colour is", () => {
    expect(redness(220, 30, 40)).toBeGreaterThan(0.8);
    expect(redness(120, 120, 120)).toBe(0);
    expect(redness(30, 0, 0)).toBe(0);
  });

  it("greys and darkens the red pupil nearest the middle, not other reds", () => {
    const width = 40;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pupil = (x - 20) ** 2 + (y - 20) ** 2 <= 36;
        const lips = y >= 36 && x < 10;
        data.set(pupil || lips ? [210, 40, 50, 255] : [150, 120, 100, 255], (y * width + x) * 4);
      }
    }
    const fixed = fixRedEye(data, width, height, { pupilSize: 50, darken: 50 })!;
    const middle = pixel(fixed, width, 20, 20);
    expect(middle[0]).toBeLessThan(40);
    expect(Math.abs(middle[0]! - middle[2]!)).toBeLessThan(10);
    // The skin and the other red stay.
    expect(pixel(fixed, width, 2, 2)).toEqual([150, 120, 100, 255]);
    expect(pixel(fixed, width, 3, 38)).toEqual([210, 40, 50, 255]);
  });

  it("finds nothing to fix without red", () => {
    const data = new Uint8ClampedArray(20 * 20 * 4).fill(128);
    expect(fixRedEye(data, 20, 20)).toBeNull();
  });
});
