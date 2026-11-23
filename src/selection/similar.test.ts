import { describe, expect, it } from "vitest";
import { Mask } from "./mask";
import { grownSelection } from "./similar";

/** A width × height image: left half red, right half blue, with a red patch inside the blue. */
function picture(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = x < width / 2 || (x >= 30 && x < 34 && y >= 4 && y < 8);
      pixels[offset] = red ? 200 + (x % 3) : 20;
      pixels[offset + 1] = 30;
      pixels[offset + 2] = red ? 20 : 220;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

describe("Grow and Similar", () => {
  const width = 40;
  const height = 20;
  const pixels = picture(width, height);
  const seed = Mask.rect(width, height, 2, 2, 5, 5);

  it("Grow spreads through like colours that touch the selection", () => {
    const grown = grownSelection(pixels, seed, 32, true)!;
    expect(grown.includes(19, 19)).toBe(true);
    expect(grown.includes(0, 0)).toBe(true);
    expect(grown.includes(25, 10)).toBe(false);
    // The red patch inside the blue is not reached.
    expect(grown.includes(31, 5)).toBe(false);
  });

  it("Similar takes like colours anywhere", () => {
    const similar = grownSelection(pixels, seed, 32, false)!;
    expect(similar.includes(19, 19)).toBe(true);
    expect(similar.includes(31, 5)).toBe(true);
    expect(similar.includes(25, 10)).toBe(false);
  });

  it("a wide tolerance takes other colours too; nothing selected grows nothing", () => {
    expect(grownSelection(pixels, seed, 255, true)!.includes(25, 10)).toBe(true);
    expect(grownSelection(pixels, new Mask(width, height), 32, true)).toBeNull();
  });
});
