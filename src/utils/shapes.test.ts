import { describe, expect, it } from "vitest";
import { ActiveSelection, Group, Line, Path, Rect } from "fabric";
import {
  applyColor,
  arrowPathData,
  constrainDrag,
  createShape,
  displayColor,
  starPoints,
} from "./shapes";

describe("constrainDrag", () => {
  it("keeps free drags untouched", () => {
    expect(constrainDrag("rectangle", { x: 0, y: 0 }, { x: 30, y: 10 }, false)).toEqual({
      x: 30,
      y: 10,
    });
  });

  it("turns boxes into squares in the drag direction", () => {
    expect(constrainDrag("rectangle", { x: 0, y: 0 }, { x: -30, y: 10 }, true)).toEqual({
      x: -30,
      y: 30,
    });
  });

  it("snaps lines to 45 degree steps", () => {
    const end = constrainDrag("line", { x: 0, y: 0 }, { x: 100, y: 8 }, true);
    expect(Math.round(end.x)).toBe(100);
    expect(Math.round(end.y)).toBe(0);
  });
});

describe("shape geometry", () => {
  it("builds a ten-vertex star inside its box", () => {
    const points = starPoints(100, 80);
    expect(points).toHaveLength(10);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      expect(point.x).toBeLessThanOrEqual(100 + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(-1e-9);
      expect(point.y).toBeLessThanOrEqual(80 + 1e-9);
    }
  });

  it("draws arrows as one finite stroked path", () => {
    const data = arrowPathData({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(data.startsWith("M 0 0 L 100 0")).toBe(true);
    expect(data).not.toMatch(/NaN|Infinity/);
  });

  it("normalises reversed drags into positive boxes", () => {
    const rect = createShape("rectangle", { x: 50, y: 60 }, { x: 10, y: 20 }, {
      color: "#ff0000",
      strokeWidth: 3,
    });
    expect(rect.left).toBe(10);
    expect(rect.top).toBe(20);
    expect(rect.width).toBe(40);
    expect(rect.height).toBe(40);
  });
});

describe("applyColor", () => {
  it("recolours strokes, not the area they enclose", () => {
    const stroke = new Path("M 0 0 L 10 10", { stroke: "#000000", fill: "" });
    applyColor(stroke, "#ff0000");
    expect(stroke.stroke).toBe("#ff0000");
    expect(stroke.fill).toBe("");

    const line = new Line([0, 0, 10, 10], { stroke: "#000000" });
    applyColor(line, "#00ff00");
    expect(line.stroke).toBe("#00ff00");
  });

  it("recolours fills of filled shapes and outlines of hollow ones", () => {
    const filled = new Rect({ width: 10, height: 10, fill: "#000000" });
    applyColor(filled, "#123456");
    expect(filled.fill).toBe("#123456");

    const hollow = new Rect({ width: 10, height: 10, fill: "transparent", stroke: "#000000" });
    applyColor(hollow, "#654321");
    expect(hollow.stroke).toBe("#654321");
    expect(hollow.fill).toBe("transparent");
  });

  it("recolours every member of groups and selections", () => {
    const head = new Rect({ width: 4, height: 4, fill: "#000000" });
    const shaft = new Line([0, 0, 10, 0], { stroke: "#000000" });
    applyColor(new Group([head, shaft]), "#abcdef");
    expect(head.fill).toBe("#abcdef");
    expect(shaft.stroke).toBe("#abcdef");

    const a = new Rect({ width: 4, height: 4, fill: "#000000" });
    const b = new Rect({ width: 4, height: 4, fill: "#000000" });
    applyColor(new ActiveSelection([a, b]), "#0000ff");
    expect([a.fill, b.fill]).toEqual(["#0000ff", "#0000ff"]);
  });

  it("reports the paint the colour control should show", () => {
    expect(displayColor(new Line([0, 0, 1, 1], { stroke: "#112233" }))).toBe("#112233");
    expect(displayColor(new Rect({ fill: "#445566" }))).toBe("#445566");
    expect(displayColor(new Rect({ fill: "rgba(0,0,0,0.5)" }))).toBeNull();
  });
});
