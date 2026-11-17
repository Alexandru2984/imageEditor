import {
  ActiveSelection,
  Ellipse,
  Group,
  Line,
  Path,
  Polygon,
  Rect,
  Triangle,
} from "fabric";
import type { FabricObject } from "fabric";

export type ShapeKind =
  | "rectangle"
  | "circle"
  | "triangle"
  | "star"
  | "line"
  | "arrow";

export const SHAPE_KINDS: readonly ShapeKind[] = [
  "rectangle",
  "circle",
  "triangle",
  "star",
  "line",
  "arrow",
];

export const isShapeKind = (value: string): value is ShapeKind =>
  (SHAPE_KINDS as readonly string[]).includes(value);

export interface Point2D {
  x: number;
  y: number;
}

export interface ShapeStyle {
  color: string;
  /** Stroke width for line-like shapes, in scene units. */
  strokeWidth: number;
}

const LINE_LIKE = new Set<ShapeKind>(["line", "arrow"]);

export const isLineLike = (kind: ShapeKind): boolean => LINE_LIKE.has(kind);

/**
 * Normalise a drag into the geometry a shape needs. Shift constrains boxes to
 * squares and lines to 45° steps, matching common design tools.
 */
export function constrainDrag(
  kind: ShapeKind,
  start: Point2D,
  end: Point2D,
  constrain: boolean
): Point2D {
  if (!constrain) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (isLineLike(kind)) {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const length = Math.hypot(dx, dy);
    return {
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    };
  }
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx || 1) * size,
    y: start.y + Math.sign(dy || 1) * size,
  };
}

/** Points of a five-pointed star inscribed in a width x height box. */
export function starPoints(width: number, height: number): Point2D[] {
  const points: Point2D[] = [];
  const outerX = width / 2;
  const outerY = height / 2;
  const inner = 0.4;
  for (let index = 0; index < 10; index += 1) {
    const radiusScale = index % 2 === 0 ? 1 : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push({
      x: outerX + Math.cos(angle) * outerX * radiusScale,
      y: outerY + Math.sin(angle) * outerY * radiusScale,
    });
  }
  return points;
}

/** An open arrow (shaft + two head strokes) as a single stroked path. */
export function arrowPathData(start: Point2D, end: Point2D, strokeWidth: number): string {
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const head = Math.min(Math.max(strokeWidth * 4, 12), length * 0.6);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const spread = Math.PI / 7;
  const left = {
    x: end.x - head * Math.cos(angle - spread),
    y: end.y - head * Math.sin(angle - spread),
  };
  const right = {
    x: end.x - head * Math.cos(angle + spread),
    y: end.y - head * Math.sin(angle + spread),
  };
  const f = (value: number) => Number(value.toFixed(2));
  return [
    `M ${f(start.x)} ${f(start.y)} L ${f(end.x)} ${f(end.y)}`,
    `M ${f(left.x)} ${f(left.y)} L ${f(end.x)} ${f(end.y)} L ${f(right.x)} ${f(right.y)}`,
  ].join(" ");
}

/**
 * Build the shape for a drag from `start` to `end` (scene coordinates).
 * Returns a fresh object every call; callers own adding it to a canvas.
 */
export function createShape(
  kind: ShapeKind,
  start: Point2D,
  end: Point2D,
  style: ShapeStyle
): FabricObject {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.max(1, Math.abs(end.x - start.x));
  const height = Math.max(1, Math.abs(end.y - start.y));
  const strokeWidth = Math.max(1, style.strokeWidth);

  switch (kind) {
    case "rectangle":
      return new Rect({ left, top, width, height, fill: style.color, strokeWidth: 0 });
    case "circle":
      return new Ellipse({
        left,
        top,
        rx: width / 2,
        ry: height / 2,
        fill: style.color,
        strokeWidth: 0,
      });
    case "triangle":
      return new Triangle({ left, top, width, height, fill: style.color, strokeWidth: 0 });
    case "star": {
      const star = new Polygon(starPoints(width, height), {
        fill: style.color,
        strokeWidth: 0,
      });
      star.set({ left, top });
      star.setCoords();
      return star;
    }
    case "line":
      return new Line([start.x, start.y, end.x, end.y], {
        stroke: style.color,
        strokeWidth,
        strokeLineCap: "round",
        fill: "",
      });
    case "arrow":
      return new Path(arrowPathData(start, end, strokeWidth), {
        stroke: style.color,
        strokeWidth,
        strokeLineCap: "round",
        strokeLineJoin: "round",
        fill: "",
      });
  }
}

const isTransparentPaint = (paint: unknown): boolean =>
  paint === null ||
  paint === undefined ||
  paint === "" ||
  paint === "transparent" ||
  (typeof paint === "string" && /^rgba\([^)]*,\s*0(\.0+)?\s*\)$/i.test(paint));

const STROKE_ONLY_TYPES = new Set(["path", "line", "polyline"]);

/**
 * Recolour an object the way a user expects from a swatch: strokes and lines
 * change their stroke, outline-only shapes their outline, filled shapes and
 * text their fill. Groups and multi-selections recolour every child. Images
 * are left untouched.
 */
export function applyColor(object: FabricObject, color: string): void {
  if (object instanceof ActiveSelection || object instanceof Group) {
    for (const child of object.getObjects()) applyColor(child, color);
    object.set("dirty", true);
    return;
  }
  const type = (object.type ?? "").toLowerCase();
  if (type === "image") return;
  if (STROKE_ONLY_TYPES.has(type) || isTransparentPaint(object.fill)) {
    object.set("stroke", color);
  } else {
    object.set("fill", color);
  }
}

/** The colour the active-colour control should show for a selection. */
export function displayColor(object: FabricObject): string | null {
  const type = (object.type ?? "").toLowerCase();
  const paint =
    STROKE_ONLY_TYPES.has(type) || isTransparentPaint(object.fill)
      ? object.stroke
      : object.fill;
  return typeof paint === "string" && /^#[0-9a-f]{6}$/i.test(paint)
    ? paint
    : null;
}
