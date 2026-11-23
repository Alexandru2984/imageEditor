import { describe, expect, it } from "vitest";
import {
  cornerAt,
  flattenSubpath,
  isPathList,
  mapPaths,
  moveHandle,
  nextPathName,
  simplifyPolyline,
  smoothAt,
  svgPathData,
  type DocumentPath,
} from "./pathData";
import { traceOutlines } from "./trace";

const square: DocumentPath = {
  name: "Path 1",
  subpaths: [
    {
      closed: true,
      anchors: [cornerAt({ x: 0, y: 0 }), cornerAt({ x: 10, y: 0 }), cornerAt({ x: 10, y: 10 }), cornerAt({ x: 0, y: 10 })],
    },
  ],
};

describe("path data", () => {
  it("accepts paths a document may hold and refuses anything else", () => {
    expect(isPathList([square])).toBe(true);
    expect(isPathList([])).toBe(true);
    expect(isPathList([{ ...square, extra: 1 }])).toBe(false);
    expect(isPathList([{ name: "", subpaths: [] }])).toBe(false);
    expect(isPathList([{ name: "x", subpaths: [{ closed: true, anchors: [] }] }])).toBe(false);
    const bad = structuredClone(square);
    (bad.subpaths[0]!.anchors[0] as unknown as Record<string, unknown>).x = Number.NaN;
    expect(isPathList([bad])).toBe(false);
    const sneaky = structuredClone(square);
    (sneaky.subpaths[0]!.anchors[0] as unknown as Record<string, unknown>).onload = "alert(1)";
    expect(isPathList([sneaky])).toBe(false);
    expect(isPathList(Array.from({ length: 101 }, () => square))).toBe(false);
    expect(isPathList("M 0 0")).toBe(false);
  });

  it("maps paths through a turn of the scene, handles included", () => {
    const curve: DocumentPath = { name: "c", subpaths: [{ closed: false, anchors: [smoothAt({ x: 1, y: 2 }, { x: 3, y: 2 })] }] };
    const [turned] = mapPaths([curve], [0, 1, -1, 0, 0, 0]);
    expect(turned!.subpaths[0]!.anchors[0]).toMatchObject({ x: -2, y: 1, outX: -2, outY: 3, inX: -2, inY: -1 });
  });

  it("keeps a smooth anchor's handles opposite, and breaks them on request", () => {
    const anchor = smoothAt({ x: 0, y: 0 }, { x: 10, y: 0 });
    const turned = moveHandle(anchor, "out", { x: 0, y: 5 }, false);
    expect(turned.inX).toBeCloseTo(0);
    expect(turned.inY).toBeCloseTo(-10);
    const broken = moveHandle(anchor, "out", { x: 0, y: 5 }, true);
    expect(broken).toMatchObject({ inX: -10, inY: 0, smooth: false });
  });

  it("flattens curves and writes SVG path data", () => {
    const line = flattenSubpath(square.subpaths[0]!);
    expect(line).toHaveLength(5);
    expect(line.at(-1)).toEqual({ x: 0, y: 0 });
    const arc = flattenSubpath({ closed: false, anchors: [smoothAt({ x: 0, y: 0 }, { x: 0, y: 50 }), smoothAt({ x: 100, y: 0 }, { x: 100, y: -50 })] });
    expect(arc.length).toBeGreaterThan(8);
    // The curve bulges down between its ends.
    expect(Math.max(...arc.map((point) => point.y))).toBeGreaterThan(30);
    expect(svgPathData(square.subpaths)).toBe("M 0 0 C 0 0 10 0 10 0 C 10 0 10 10 10 10 C 10 10 0 10 0 10 C 0 10 0 0 0 0 Z");
  });

  it("names new paths after the highest one", () => {
    expect(nextPathName([])).toBe("Path 1");
    expect(nextPathName([square, { name: "Path 7", subpaths: [] }, { name: "Work Path", subpaths: [] }])).toBe("Path 8");
  });

  it("simplifies polylines to their corners", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPolyline(points, 0.5)).toEqual([points[0], points[2], points[3]]);
  });
});

describe("tracing a selection into a path", () => {
  const maskOf = (width: number, height: number, rows: string[]) => ({
    width,
    height,
    data: Uint8Array.from(rows.join("").split(""), (cell) => (cell === "#" ? 255 : 0)),
  });

  it("traces a rectangle as its four corners", () => {
    const loops = traceOutlines(maskOf(6, 5, ["......", ".###..", ".###..", ".###..", "......"]), 0.5);
    expect(loops).toHaveLength(1);
    const xs = loops[0]!.map((point) => point.x).sort();
    const ys = loops[0]!.map((point) => point.y).sort();
    expect(loops[0]).toHaveLength(4);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([1, 4, 1, 4]);
  });

  it("traces holes and pixels touching at a corner", () => {
    const ring = traceOutlines(maskOf(5, 5, ["#####", "#...#", "#...#", "#...#", "#####"]), 0.5);
    expect(ring).toHaveLength(2);
    const diagonal = traceOutlines(maskOf(4, 4, ["##..", "##..", "..##", "..##"]), 0.5);
    expect(diagonal.length).toBeGreaterThanOrEqual(1);
    expect(diagonal.flat().length).toBeGreaterThanOrEqual(8);
    expect(traceOutlines(maskOf(2, 2, ["..", ".."]), 1)).toEqual([]);
  });
});
