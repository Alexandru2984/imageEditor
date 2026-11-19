import { describe, expect, it } from "vitest";
import { inpaint } from "./inpaint";

function image(width: number, height: number, colour: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set([...colour(x, y), 255], (y * width + x) * 4);
    }
  }
  return data;
}

function square(width: number, height: number, left: number, top: number, size: number) {
  const hole = new Uint8Array(width * height);
  for (let y = top; y < top + size; y += 1) hole.fill(1, y * width + left, y * width + left + size);
  return hole;
}

const at = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe("content-aware fill", () => {
  it("fills a hole in a flat colour with that colour", () => {
    const width = 80;
    const height = 60;
    const source = image(width, height, () => [30, 120, 200]);
    const hole = square(width, height, 30, 20, 16);
    // Something else entirely was there.
    for (let y = 20; y < 36; y += 1) for (let x = 30; x < 46; x += 1) source.set([255, 0, 0, 255], (y * width + x) * 4);
    const result = inpaint(source, width, height, hole);
    for (let y = 20; y < 36; y += 1) {
      for (let x = 30; x < 46; x += 1) expect(at(result, width, x, y)).toEqual([30, 120, 200, 255]);
    }
  });

  it("continues stripes across the hole", () => {
    const width = 96;
    const height = 96;
    // Vertical stripes four pixels wide.
    const stripe = (x: number): [number, number, number] => (Math.floor(x / 4) % 2 ? [255, 255, 255] : [0, 0, 0]);
    const source = image(width, height, (x) => stripe(x));
    const hole = square(width, height, 40, 40, 14);
    for (let y = 40; y < 54; y += 1) for (let x = 40; x < 54; x += 1) source.set([128, 0, 128, 255], (y * width + x) * 4);
    const result = inpaint(source, width, height, hole);
    let wrong = 0;
    for (let y = 40; y < 54; y += 1) {
      for (let x = 40; x < 54; x += 1) {
        const [red, green] = at(result, width, x, y);
        // No trace of the purple, and black or white as the stripe there.
        if (Math.abs(red! - green!) > 10 || Math.abs(red! - stripe(x)[0]) > 60) wrong += 1;
      }
    }
    expect(wrong).toBeLessThan(14 * 14 * 0.05);
  });

  it("keeps every pixel outside the hole and is repeatable", () => {
    const width = 50;
    const height = 50;
    const source = image(width, height, (x, y) => [x * 5, y * 5, (x * y) % 255]);
    const hole = square(width, height, 20, 20, 8);
    const first = inpaint(source, width, height, hole, 7);
    const second = inpaint(source, width, height, hole, 7);
    expect(first).toEqual(second);
    for (let index = 0; index < width * height; index += 1) {
      if (hole[index]) continue;
      expect(first.slice(index * 4, index * 4 + 4)).toEqual(source.slice(index * 4, index * 4 + 4));
    }
  });

  it("falls back to a smooth fill when there are no whole patches to copy", () => {
    const width = 6;
    const height = 6;
    const source = image(width, height, () => [90, 90, 90]);
    const hole = square(width, height, 2, 2, 2);
    const result = inpaint(source, width, height, hole);
    expect(at(result, width, 2, 2)).toEqual([90, 90, 90, 255]);
  });
});
