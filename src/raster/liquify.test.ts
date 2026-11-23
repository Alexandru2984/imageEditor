import { describe, expect, it } from "vitest";
import { runJob } from "./pixelJobs";
import { LiquifyField, brushFalloff, displacementAt, fieldCell, liquifyPixels, renderLiquify } from "./liquify";

const brush = { radius: 30, density: 100, pressure: 100 };
const at = (field: LiquifyField, x: number, y: number) => {
  const out = [0, 0];
  displacementAt(field, x, y, out);
  return out;
};

/** A 100×80 picture: a vertical red bar at x 48–51 on white. */
const picture = () => {
  const width = 100;
  const height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = x >= 48 && x < 52;
      data.set(red ? [220, 20, 20, 255] : [255, 255, 255, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height, x: 0, y: 0 };
};

describe("Liquify", () => {
  it("spaces the nodes to keep the field small", () => {
    expect(fieldCell(400, 300)).toBe(1);
    const cell = fieldCell(4000, 3000);
    expect((Math.ceil(4000 / cell) + 1) * (Math.ceil(3000 / cell) + 1)).toBeLessThanOrEqual(1_500_000);
    expect(cell).toBe(3);
  });

  it("fades the brush from its density to its rim", () => {
    expect(brushFalloff(0, 10, 50)).toBe(1);
    expect(brushFalloff(4, 10, 50)).toBe(1);
    expect(brushFalloff(7, 10, 50)).toBeGreaterThan(0);
    expect(brushFalloff(7, 10, 50)).toBeLessThan(1);
    expect(brushFalloff(10, 10, 50)).toBe(0);
  });

  it("leaves the picture as it was with an untouched field", () => {
    const source = picture();
    const field = new LiquifyField(source.width, source.height);
    expect(liquifyPixels(field, source, source.width, source.height)).toEqual(source.data);
  });

  it("pushes the picture along with Forward Warp", () => {
    const source = picture();
    const field = new LiquifyField(source.width, source.height);
    field.beginStroke();
    field.push({ x: 50, y: 40 }, { x: 60, y: 40 }, brush);
    field.endStroke();
    // Where the brush ended, the picture shows what was where it started.
    expect(at(field, 60, 40)[0]).toBeCloseTo(-10, 1);
    expect(at(field, 60, 40)[1]).toBeCloseTo(0, 3);
    expect(at(field, 5, 5)).toEqual([0, 0]);
    const result = liquifyPixels(field, source, source.width, source.height);
    expect(Array.from(result.subarray((40 * 100 + 60) * 4, (40 * 100 + 60) * 4 + 4))).toEqual([220, 20, 20, 255]);
    // Far from the brush the bar stays put.
    expect(Array.from(result.subarray((2 * 100 + 50) * 4, (2 * 100 + 50) * 4 + 4))).toEqual([220, 20, 20, 255]);

    // Undo puts the field back.
    expect(field.canUndo).toBe(true);
    expect(field.undo()).not.toBeNull();
    expect(field.isIdentity()).toBe(true);
  });

  it("pushes sideways with Push Left: dragging up moves the picture left", () => {
    const field = new LiquifyField(100, 80);
    field.push({ x: 50, y: 50 }, { x: 50, y: 40 }, brush, true);
    // Left of where it was: the pixel shows what lies to its right.
    expect(at(field, 50, 40)[0]).toBeGreaterThan(5);
    field.push({ x: 50, y: 50 }, { x: 50, y: 40 }, brush, true, true);
    expect(Math.abs(at(field, 50, 40)[0]!)).toBeLessThan(1);
  });

  it("twirls about the brush's middle, and puckers or bloats it", () => {
    const field = new LiquifyField(100, 80);
    field.twirl({ x: 50, y: 40 }, 0.5, brush);
    expect(at(field, 50, 40)).toEqual([0, 0]);
    const [dx, dy] = at(field, 60, 40);
    // Turning clockwise, the point right of the middle shows what was above it.
    expect(dy).toBeLessThan(-1);
    expect(Math.abs(dx!)).toBeLessThan(Math.abs(dy!));

    const pucker = new LiquifyField(100, 80);
    pucker.pinch({ x: 50, y: 40 }, 0.2, brush);
    expect(at(pucker, 60, 40)[0]).toBeGreaterThan(1);
    const bloat = new LiquifyField(100, 80);
    bloat.pinch({ x: 50, y: 40 }, -0.2, brush);
    expect(at(bloat, 60, 40)[0]).toBeLessThan(-1);
  });

  it("reconstructs and smooths back towards the original", () => {
    const field = new LiquifyField(100, 80);
    field.push({ x: 50, y: 40 }, { x: 62, y: 40 }, brush);
    const pushed = Math.abs(at(field, 62, 40)[0]!);
    field.smooth({ x: 62, y: 40 }, 1, { ...brush, radius: 4 });
    expect(Math.abs(at(field, 62, 40)[0]!)).toBeLessThanOrEqual(pushed);
    field.reconstruct({ x: 56, y: 40 }, 1, { ...brush, radius: 60 });
    expect(field.isIdentity()).toBe(true);
  });

  it("keeps frozen parts still; Restore All undoes every distortion", () => {
    const field = new LiquifyField(100, 80);
    field.paintFreeze({ x: 60, y: 40 }, { ...brush, radius: 8 });
    expect(field.freezeAt(60, 40)).toBe(255);
    field.push({ x: 50, y: 40 }, { x: 60, y: 40 }, brush);
    expect(at(field, 60, 40)).toEqual([0, 0]);
    expect(Math.abs(at(field, 45, 40)[0]!)).toBeGreaterThan(1);

    field.thawAll();
    expect(field.freezeAt(60, 40)).toBe(0);
    field.undo();
    expect(field.freezeAt(60, 40)).toBe(255);
    field.restoreAll();
    expect(field.isIdentity()).toBe(true);
  });

  it("draws a smaller preview of only the brushed part", () => {
    const source = picture();
    const field = new LiquifyField(100, 80);
    field.push({ x: 50, y: 40 }, { x: 60, y: 40 }, brush);
    const out = new Uint8ClampedArray(50 * 40 * 4);
    renderLiquify(field, source, out, 50, 40, { scale: 0.5, sourceScale: 1, offsetX: 0, offsetY: 0, box: { left: 25, top: 15, right: 35, bottom: 25 } });
    // Outside the box nothing was drawn.
    expect(out[(2 * 50 + 2) * 4 + 3]).toBe(0);
    expect(Array.from(out.subarray((20 * 50 + 30) * 4, (20 * 50 + 30) * 4 + 4))).toEqual([220, 20, 20, 255]);
  });

  it("runs as a pixel job on a region inside a larger area", () => {
    const source = picture();
    // The region is x 30–79, y 20–59 of the picture.
    const field = new LiquifyField(50, 40);
    field.push({ x: 20, y: 20 }, { x: 30, y: 20 }, { ...brush, radius: 8 });
    const job = { op: "liquify" as const, field: field.data, columns: field.columns, rows: field.rows, cell: field.cell, reach: Math.ceil(field.maxDisplacement()) + 2 };
    const result = runJob(job, { ...source, x: 30, y: 20 }, 50, 40, { x: 30, y: 20 });
    // The bar (picture x 48–51, region x 18–21) is pushed to region x 30.
    expect(Array.from(result.subarray((20 * 50 + 30) * 4, (20 * 50 + 30) * 4 + 4))).toEqual([220, 20, 20, 255]);
    expect(Array.from(result.subarray((1 * 50 + 19) * 4, (1 * 50 + 19) * 4 + 4))).toEqual([220, 20, 20, 255]);
  });
});

