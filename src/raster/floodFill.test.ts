import { describe, expect, it } from "vitest";
import { floodFillMask } from "./floodFill";

type Rgba = [number, number, number, number];
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

/** An image from rows of one-letter pixels. */
function image(rows: string[], palette: Record<string, Rgba>) {
  const height = rows.length;
  const width = rows[0]!.length;
  const pixels = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((key, x) => pixels.set(palette[key]!, (y * width + x) * 4))
  );
  return { pixels, width, height };
}

const asRows = (mask: Uint8Array | null, width: number) => {
  if (!mask) return null;
  const rows: string[] = [];
  for (let start = 0; start < mask.length; start += width) {
    rows.push([...mask.subarray(start, start + width)].map((value) => (value ? "#" : ".")).join(""));
  }
  return rows;
};

const fill = (
  rows: string[],
  palette: Record<string, Rgba>,
  x: number,
  y: number,
  tolerance = 0,
  contiguous = true
) => {
  const { pixels, width, height } = image(rows, palette);
  return asRows(floodFillMask(pixels, width, height, x, y, { tolerance, contiguous }), width);
};

describe("floodFillMask", () => {
  const palette = { w: WHITE, b: BLACK };

  it("fills the connected area of the clicked colour, not through walls", () => {
    expect(fill(["wwbww", "wwbww", "bbbww", "wwwww"], palette, 0, 0)).toEqual([
      "##...",
      "##...",
      ".....",
      ".....",
    ]);
  });

  it("follows winding areas, including runs that start to the left", () => {
    expect(fill(["wbwww", "wbwbw", "wwwbw", "bbbbw"], palette, 0, 0)).toEqual([
      "#.###",
      "#.#.#",
      "###.#",
      "....#",
    ]);
  });

  it("fills every similar pixel when not contiguous", () => {
    expect(fill(["wwbww", "wwbww", "bbbww"], palette, 0, 0, 0, false)).toEqual([
      "##.##",
      "##.##",
      "...##",
    ]);
  });

  it("takes in nearby colours within the tolerance", () => {
    const shades = { a: [100, 100, 100, 255] as Rgba, b: [110, 100, 95, 255] as Rgba, c: [140, 100, 100, 255] as Rgba };
    expect(fill(["aabbcc"], shades, 0, 0, 10)).toEqual(["####.."]);
    expect(fill(["aabbcc"], shades, 0, 0, 9)).toEqual(["##...."]);
    expect(fill(["aabbcc"], shades, 0, 0, 40)).toEqual(["######"]);
  });

  it("treats all transparent pixels as one colour", () => {
    const palette = { t: CLEAR, u: [255, 0, 0, 0] as Rgba, b: BLACK };
    // The last pixel is transparent too, but walled off by the black ones.
    expect(fill(["tuubt", "ttubt"], palette, 0, 0)).toEqual(["###..", "###.."]);
  });

  it("returns nothing for a click outside the pixels", () => {
    expect(fill(["ww"], palette, 2, 0)).toBeNull();
    expect(fill(["ww"], palette, -0.5, 0)).toBeNull();
  });

  it("handles a large open area without a deep stack", () => {
    const width = 2000;
    const height = 1500;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const mask = floodFillMask(pixels, width, height, 1000, 700, { tolerance: 0, contiguous: true });
    expect(mask?.every((value) => value === 255)).toBe(true);
  });
});
