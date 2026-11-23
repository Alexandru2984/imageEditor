import { describe, expect, it } from "vitest";
import { DEFAULT_REFINE, refineMask, refineSelection, type RefineSettings } from "./refineEdge";

const size = 100;
/** A red disc of radius 20 at the middle, on blue. */
const picture = (() => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const inside = (x + 0.5 - 50) ** 2 + (y + 0.5 - 50) ** 2 <= 400;
      pixels[offset] = inside ? 220 : 30;
      pixels[offset + 1] = 40;
      pixels[offset + 2] = inside ? 30 : 210;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
})();
const square = (from: number, to: number) => {
  const mask = new Uint8Array(size * size);
  for (let y = from; y < to; y += 1) mask.fill(255, y * size + from, y * size + to);
  return mask;
};
const at = (mask: Uint8Array, x: number, y: number) => mask[y * size + x]!;

describe("Select and Mask", () => {
  it("leaves the selection alone with nothing set", () => {
    const mask = square(30, 70);
    expect(refineMask(picture, mask, size, size, DEFAULT_REFINE)).toEqual(mask);
  });

  it("makes a rough selection follow the picture's edge within the radius", () => {
    const rough = square(31, 69);
    const refined = refineMask(picture, rough, size, size, { ...DEFAULT_REFINE, radius: 8 });
    // The square's corner is not in the disc; the disc's edge is.
    expect(at(refined, 33, 33)).toBeLessThan(60);
    expect(at(refined, 50, 32)).toBeGreaterThan(200);
    expect(at(refined, 50, 50)).toBe(255);
    expect(at(refined, 5, 5)).toBe(0);
  });

  it("refines where the brush went, even with no radius", () => {
    const rough = square(31, 69);
    const brushed = refineMask(picture, rough, size, size, DEFAULT_REFINE, [{ x: 33, y: 33, radius: 6 }]);
    expect(at(brushed, 33, 33)).toBeLessThan(60);
    // Elsewhere the square stays a square.
    expect(at(brushed, 67, 67)).toBe(255);
  });

  it("feathers, steepens and shifts the edge", () => {
    const mask = square(30, 70);
    const feathered = refineMask(picture, mask, size, size, { ...DEFAULT_REFINE, feather: 10 });
    expect(at(feathered, 30, 50)).toBeGreaterThan(60);
    expect(at(feathered, 30, 50)).toBeLessThan(200);
    const steep = refineMask(picture, mask, size, size, { ...DEFAULT_REFINE, feather: 10, contrast: 100 });
    expect(Math.abs(at(steep, 27, 50) - 127)).toBeGreaterThan(Math.abs(at(feathered, 27, 50) - 127));
    const grown = refineMask(picture, mask, size, size, { ...DEFAULT_REFINE, shiftEdge: 100 });
    expect(at(grown, 25, 50)).toBeGreaterThan(200);
    const shrunk = refineMask(picture, mask, size, size, { ...DEFAULT_REFINE, shiftEdge: -100 });
    expect(at(shrunk, 34, 50)).toBeLessThan(60);
    expect(at(shrunk, 50, 50)).toBe(255);
  });

  it("works at a preview's scale", () => {
    const small = 50;
    const pixels = new Uint8ClampedArray(small * small * 4);
    for (let y = 0; y < small; y += 1) {
      for (let x = 0; x < small; x += 1) {
        const source = (y * 2 * size + x * 2) * 4;
        pixels.set(picture.subarray(source, source + 4), (y * small + x) * 4);
      }
    }
    const mask = new Uint8Array(small * small);
    for (let y = 15; y < 35; y += 1) mask.fill(255, y * small + 15, y * small + 35);
    const refined = refineMask(pixels, mask, small, small, { ...DEFAULT_REFINE, radius: 8 }, [], 0.5);
    expect(refined[16 * small + 16]!).toBeLessThan(80);
    expect(refined[25 * small + 25]!).toBe(255);
  });

  it("works only around the edge, to the same result", () => {
    const big = 220;
    const pixels = new Uint8ClampedArray(big * big * 4);
    for (let y = 0; y < big; y += 1) {
      for (let x = 0; x < big; x += 1) {
        const offset = (y * big + x) * 4;
        const inside = (x - 80) ** 2 + (y - 90) ** 2 <= 30 ** 2;
        pixels[offset] = inside ? 200 + ((x * 7) % 40) : 20 + ((y * 5) % 30);
        pixels[offset + 1] = (x * y) % 60;
        pixels[offset + 2] = inside ? 40 : 190;
        pixels[offset + 3] = 255;
      }
    }
    const mask = new Uint8Array(big * big);
    for (let y = 62; y < 120; y += 1) mask.fill(255, y * big + 52, y * big + 110);
    // A soft, even area far away follows only the curves.
    for (let y = 180; y < 220; y += 1) mask.fill(100, y * big + 150, y * big + 220);
    const cases: [Partial<RefineSettings>, { x: number; y: number; radius: number }[]][] = [
      [{ radius: 10 }, []],
      [{ smooth: 40, feather: 6, contrast: 30, shiftEdge: -40 }, []],
      [{ radius: 4, shiftEdge: 60 }, [{ x: 30, y: 30, radius: 8 }]],
    ];
    for (const [settings, dabs] of cases) {
      const full = refineMask(pixels, mask, big, big, { ...DEFAULT_REFINE, ...settings }, dabs);
      const cropped = refineSelection(pixels, mask, big, big, { ...DEFAULT_REFINE, ...settings }, dabs);
      let worst = 0;
      for (let index = 0; index < full.length; index += 1) worst = Math.max(worst, Math.abs(full[index]! - cropped[index]!));
      expect(worst).toBeLessThanOrEqual(1);
    }
  });

  it("pulls a selection that is too large in all the way across the band", () => {
    const width = 400;
    const height = 300;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 100; y < 200; y += 1) {
      for (let x = 150; x < 250; x += 1) pixels.set([139, 16, 16, 255], (y * width + x) * 4);
    }
    const rough = new Uint8Array(width * height);
    for (let y = 80; y < 220; y += 1) rough.fill(255, y * width + 130, y * width + 270);
    const refined = refineSelection(pixels, rough, width, height, { ...DEFAULT_REFINE, radius: 30 });
    let left = width;
    let right = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!refined[y * width + x]) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    expect([left, right]).toEqual([150, 249]);
    expect(refined[150 * width + 200]).toBe(255);
  });
});

