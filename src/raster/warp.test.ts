import { describe, expect, it } from "vitest";
import { invert, isConvex, mapPoint, perspectiveDrag, rectToQuad, warpPixels, type Quad } from "./warp";

const quad = (...points: [number, number][]): Quad =>
  points.map(([x, y]) => ({ x, y })) as unknown as Quad;

describe("warp", () => {
  it("maps a rectangle's corners onto any quad, and back", () => {
    const target = quad([10, 20], [110, 0], [130, 90], [0, 70]);
    const h = rectToQuad(200, 100, target);
    const corners = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ];
    corners.forEach(([x, y], index) => {
      const point = mapPoint(h, x!, y!);
      expect(point.x).toBeCloseTo(target[index]!.x, 9);
      expect(point.y).toBeCloseTo(target[index]!.y, 9);
    });
    const back = mapPoint(invert(h), 130, 90);
    expect(back.x).toBeCloseTo(200, 9);
    expect(back.y).toBeCloseTo(100, 9);
  });

  it("tells convex shapes from dented or crossed ones", () => {
    expect(isConvex(quad([0, 0], [10, 0], [10, 10], [0, 10]))).toBe(true);
    expect(isConvex(quad([0, 0], [10, 0], [3, 3], [0, 10]))).toBe(false);
    expect(isConvex(quad([0, 0], [10, 10], [10, 0], [0, 10]))).toBe(false);
  });

  it("drags perspective symmetrically along an edge", () => {
    const square = quad([0, 0], [10, 0], [10, 10], [0, 10]);
    expect(perspectiveDrag(square, 0, 3, 1)).toEqual(quad([3, 0], [7, 0], [10, 10], [0, 10]));
    expect(perspectiveDrag(square, 2, 0, -4)).toEqual(quad([0, 0], [10, 4], [10, 6], [0, 10]));
  });

  it("resamples pixel for pixel when the shape is the same rectangle", () => {
    const width = 4;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) data.set([index * 20, 255 - index * 20, 7, 255], index * 4);
    const h = rectToQuad(width, height, quad([0, 0], [width, 0], [width, height], [0, height]));
    const out = warpPixels({ data, width, height }, invert(h), width, height);
    expect([...out]).toEqual([...data]);
  });

  it("mirrors when the corners swap sides, and leaves outside transparent", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    // Two pixels, red then blue, drawn right to left into a wider image.
    const h = rectToQuad(2, 1, quad([3, 0], [1, 0], [1, 1], [3, 1]));
    const out = warpPixels({ data, width: 2, height: 1 }, invert(h), 4, 1);
    expect([...out]).toEqual([0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
  });
});
