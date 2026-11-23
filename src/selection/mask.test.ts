import { describe, expect, it } from "vitest";
import { Mask } from "./mask";
import { ellipseMask, polygonMask } from "./shapes";
import { outlineSegments } from "./outline";

const count = (mask: Mask, minimum = 1) => mask.data.reduce((total, value) => total + (value >= minimum ? 1 : 0), 0);
const sum = (mask: Mask) => mask.data.reduce((total, value) => total + value, 0) / 255;
const at = (mask: Mask, x: number, y: number) => mask.data[y * mask.width + x]!;

describe("Mask", () => {
  it("selects whole pixels of a rectangle, clipped to the document", () => {
    const mask = Mask.rect(10, 8, 2.4, 1.6, -3, 20);
    expect(mask.bounds()).toEqual({ x: 0, y: 2, width: 2, height: 6 });
    expect(mask.isRectangle()).toBe(true);
    expect(count(mask)).toBe(12);
  });

  it("knows an empty selection", () => {
    expect(new Mask(4, 4).isEmpty()).toBe(true);
    expect(new Mask(4, 4).bounds()).toBeNull();
    expect(Mask.rect(4, 4, 1, 1, 1, 3).isEmpty()).toBe(true);
  });

  it("combines shapes in the four selection modes", () => {
    const a = Mask.rect(10, 1, 0, 0, 6, 1);
    const b = Mask.rect(10, 1, 4, 0, 10, 1);
    const row = (mask: Mask) => [...mask.data].map((value) => (value ? "#" : ".")).join("");
    expect(row(a.combine(b, "replace"))).toBe("....######");
    expect(row(a.combine(b, "add"))).toBe("##########");
    expect(row(a.combine(b, "subtract"))).toBe("####......");
    expect(row(a.combine(b, "intersect"))).toBe("....##....");
  });

  it("scales soft pixels when subtracting", () => {
    const a = Mask.full(1, 1);
    const half = new Mask(1, 1, Uint8Array.of(128));
    expect(a.combine(half, "subtract").data[0]).toBe(127);
  });

  it("moves by whole pixels, dropping what leaves the document", () => {
    const mask = Mask.rect(6, 4, 1, 1, 4, 3);
    const moved = mask.translated(3, -1);
    expect(moved.bounds()).toEqual({ x: 4, y: 0, width: 2, height: 2 });
    expect(mask.translated(-10, 0).isEmpty()).toBe(true);
    expect(mask.translated(0.4, 0).bounds()).toEqual(mask.bounds());
  });

  it("tells whether a point is selected", () => {
    const mask = Mask.rect(6, 4, 1, 1, 4, 3);
    expect(mask.includes(1.2, 2.9)).toBe(true);
    expect(mask.includes(4.1, 2)).toBe(false);
    expect(mask.includes(-1, 2)).toBe(false);
  });

  it("inverts", () => {
    const mask = Mask.rect(4, 1, 0, 0, 1, 1).inverted();
    expect([...mask.data]).toEqual([0, 255, 255, 255]);
    expect(mask.isRectangle()).toBe(true);
  });

  it("feathers the edge but keeps the middle and the amount", () => {
    const mask = Mask.rect(60, 60, 20, 20, 40, 40);
    const soft = mask.feathered(4);
    expect(at(soft, 30, 30)).toBe(255);
    expect(at(soft, 2, 2)).toBe(0);
    // Half selected right on the edge, fading either side.
    expect(at(soft, 20, 30)).toBeGreaterThan(90);
    expect(at(soft, 20, 30)).toBeLessThan(170);
    expect(at(soft, 17, 30)).toBeGreaterThan(0);
    expect(at(soft, 23, 30)).toBeLessThan(255);
    expect(sum(soft)).toBeCloseTo(sum(mask), -1);
    expect(soft.isRectangle()).toBe(false);
  });

  it("does not fade a selection along the document's edge", () => {
    const soft = Mask.full(20, 20).feathered(5);
    expect(soft.data.every((value) => value === 255)).toBe(true);
  });

  it("grows and shrinks by a distance, with round corners when growing", () => {
    const square = Mask.rect(40, 40, 10, 10, 20, 20);
    const grown = square.expanded(3);
    expect(grown.bounds()).toEqual({ x: 7, y: 7, width: 16, height: 16 });
    expect(at(grown, 7, 15)).toBe(255);
    // A corner further than 3 pixels from the square stays out.
    expect(at(grown, 7, 7)).toBe(0);
    const shrunk = square.contracted(3);
    expect(shrunk.bounds()).toEqual({ x: 13, y: 13, width: 4, height: 4 });
    expect(square.contracted(6).isEmpty()).toBe(true);
  });

  it("keeps edges on the document border when shrinking", () => {
    const shrunk = Mask.full(10, 10).contracted(2);
    expect(shrunk.data.every((value) => value === 255)).toBe(true);
  });
});

describe("polygonMask", () => {
  it("fills a pixel-aligned square exactly", () => {
    const square = [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 5 },
      { x: 2, y: 5 },
    ];
    for (const antiAlias of [true, false]) {
      const mask = polygonMask(10, 10, square, antiAlias);
      expect(mask.bounds()).toEqual({ x: 2, y: 2, width: 4, height: 3 });
      expect(mask.isRectangle()).toBe(true);
    }
  });

  it("covers the area of a triangle, softly along its slope", () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ];
    const smooth = polygonMask(50, 50, triangle, true);
    expect(sum(smooth)).toBeCloseTo(800, -1);
    expect(count(smooth) - count(smooth, 255)).toBeGreaterThan(30);
    const hard = polygonMask(50, 50, triangle, false);
    expect([...new Set(hard.data)].sort()).toEqual([0, 255]);
    expect(count(hard)).toBeGreaterThan(760);
    expect(count(hard)).toBeLessThan(840);
  });

  it("leaves out the overlap of a shape that crosses itself", () => {
    // Two squares drawn as one path that overlaps in the middle.
    const bowtie = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 3, y: 6 },
      { x: 3, y: 3 },
      { x: 9, y: 3 },
      { x: 9, y: 9 },
      { x: 0, y: 9 },
    ];
    const mask = polygonMask(10, 10, bowtie, false);
    expect(at(mask, 1, 1)).toBe(255);
    expect(at(mask, 4, 4)).toBe(0);
    expect(at(mask, 7, 7)).toBe(255);
  });

  it("ignores a shape with fewer than three points", () => {
    expect(polygonMask(5, 5, [{ x: 0, y: 0 }, { x: 4, y: 4 }]).isEmpty()).toBe(true);
  });
});

describe("ellipseMask", () => {
  it("covers the area of the ellipse inside its box", () => {
    const mask = ellipseMask(120, 80, 10, 10, 110, 70);
    expect(sum(mask)).toBeCloseTo(Math.PI * 50 * 30, -2);
    expect(at(mask, 60, 40)).toBe(255);
    expect(at(mask, 12, 12)).toBe(0);
  });
});

describe("outlineSegments", () => {
  it("traces a rectangle with four merged edges", () => {
    const segments = outlineSegments(Mask.rect(10, 10, 2, 3, 7, 6))!;
    expect(segments.length / 4).toBe(4);
    expect([...segments]).toEqual([2, 3, 7, 3, 2, 6, 7, 6, 2, 3, 2, 6, 7, 3, 7, 6]);
  });

  it("traces holes too, and nothing for an empty selection", () => {
    const ring = Mask.rect(10, 10, 1, 1, 9, 9).combine(Mask.rect(10, 10, 4, 4, 6, 6), "subtract");
    expect(outlineSegments(ring)!.length / 4).toBe(8);
    expect(outlineSegments(new Mask(3, 3))!.length).toBe(0);
  });

  it("gives up on outlines too intricate to draw", () => {
    const checker = new Mask(20, 20, Uint8Array.from({ length: 400 }, (_, index) => ((index + Math.floor(index / 20)) % 2 ? 255 : 0)));
    expect(outlineSegments(checker, 50)).toBeNull();
  });
});

describe("Border and Smooth", () => {
  it("Border selects a band centred on the edge", () => {
    const mask = Mask.rect(60, 60, 20, 20, 40, 40).bordered(6);
    // 3 px each side of the edge at x = 20.
    expect(mask.includes(17, 30)).toBe(true);
    expect(mask.includes(22, 30)).toBe(true);
    expect(mask.includes(15, 30)).toBe(false);
    expect(mask.includes(24, 30)).toBe(false);
    expect(mask.includes(30, 30)).toBe(false);
  });

  it("Border of everything is a frame inside the document", () => {
    const mask = Mask.full(40, 30).bordered(8);
    expect(mask.includes(0, 15)).toBe(true);
    expect(mask.includes(3, 15)).toBe(true);
    expect(mask.includes(5, 15)).toBe(false);
    expect(mask.includes(20, 15)).toBe(false);
    expect(mask.includes(39, 29)).toBe(true);
  });

  it("Smooth drops specks and holes and rounds corners", () => {
    const base = Mask.rect(50, 50, 10, 10, 40, 40);
    base.data[25 * 50 + 25] = 0; // a hole
    base.data[2 * 50 + 2] = 255; // a speck
    const smooth = base.smoothed(2);
    expect(smooth.includes(25, 25)).toBe(true);
    expect(smooth.includes(2, 2)).toBe(false);
    expect(smooth.includes(10, 10)).toBe(false);
    expect(smooth.includes(12, 12)).toBe(true);
    expect(smooth.includes(25, 10)).toBe(true);
    // Everything stays everything, up to the document's border.
    expect(Mask.full(20, 20).smoothed(3).bounds()).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });
});
