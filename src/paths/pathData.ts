/**
 * Paths, as Photoshop's Pen draws them: subpaths of anchor points joined by
 * cubic Bézier curves, each anchor with an incoming and an outgoing handle
 * (both on the anchor for a sharp corner). They live on the document, in
 * scene coordinates like the guides, so they are saved with it, come back
 * on undo and follow it when it turns, flips, stretches or is cropped.
 * No canvas here, so project files can be checked with it.
 */

export interface PathAnchor {
  x: number;
  y: number;
  /** The handle the curve arrives along. */
  inX: number;
  inY: number;
  /** The handle the curve leaves along. */
  outX: number;
  outY: number;
  /** Moving one handle turns the other with it. */
  smooth: boolean;
}

export interface Subpath {
  closed: boolean;
  anchors: PathAnchor[];
}

export interface DocumentPath {
  name: string;
  subpaths: Subpath[];
}

export interface Point {
  x: number;
  y: number;
}

export const WORK_PATH = "Work Path";
export const MAX_PATHS = 100;
const MAX_SUBPATHS = 2_000;
const MAX_ANCHORS = 100_000;
const MAX_NAME = 256;
const MAX_POSITION = 10_000_000;
const ANCHOR_KEYS = ["x", "y", "inX", "inY", "outX", "outY", "smooth"];

const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isCoordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_POSITION;

/** Whether a value is a list of paths a document may hold (from a saved file, say). */
export function isPathList(value: unknown): value is DocumentPath[] {
  if (!Array.isArray(value) || value.length > MAX_PATHS) return false;
  let anchors = 0;
  let subpaths = 0;
  for (const path of value) {
    if (!isRecord(path) || !onlyKeys(path, ["name", "subpaths"])) return false;
    if (typeof path.name !== "string" || path.name.length === 0 || path.name.length > MAX_NAME) return false;
    if (!Array.isArray(path.subpaths)) return false;
    subpaths += path.subpaths.length;
    if (subpaths > MAX_SUBPATHS) return false;
    for (const subpath of path.subpaths) {
      if (!isRecord(subpath) || !onlyKeys(subpath, ["closed", "anchors"])) return false;
      if (typeof subpath.closed !== "boolean" || !Array.isArray(subpath.anchors) || subpath.anchors.length === 0) return false;
      anchors += subpath.anchors.length;
      if (anchors > MAX_ANCHORS) return false;
      for (const anchor of subpath.anchors) {
        if (!isRecord(anchor) || !onlyKeys(anchor, ANCHOR_KEYS)) return false;
        if (typeof anchor.smooth !== "boolean") return false;
        if (!ANCHOR_KEYS.slice(0, 6).every((key) => isCoordinate(anchor[key]))) return false;
      }
    }
  }
  return true;
}

/** An affine map of the scene: [a, b, c, d, e, f] takes (x, y) to (a x + c y + e, b x + d y + f). */
export type SceneMatrix = readonly [number, number, number, number, number, number];

/** Paths carried through a change of the whole scene; a Bézier curve maps exactly. */
export function mapPaths(paths: readonly DocumentPath[], matrix: SceneMatrix): DocumentPath[] {
  const [a, b, c, d, e, f] = matrix;
  return paths.map((path) => ({
    name: path.name,
    subpaths: path.subpaths.map((subpath) => ({
      closed: subpath.closed,
      anchors: subpath.anchors.map((anchor) => ({
        x: a * anchor.x + c * anchor.y + e,
        y: b * anchor.x + d * anchor.y + f,
        inX: a * anchor.inX + c * anchor.inY + e,
        inY: b * anchor.inX + d * anchor.inY + f,
        outX: a * anchor.outX + c * anchor.outY + e,
        outY: b * anchor.outX + d * anchor.outY + f,
        smooth: anchor.smooth,
      })),
    })),
  }));
}

/** An anchor with both handles on it (a sharp corner). */
export const cornerAt = (point: Point): PathAnchor => ({
  x: point.x,
  y: point.y,
  inX: point.x,
  inY: point.y,
  outX: point.x,
  outY: point.y,
  smooth: false,
});

/** An anchor whose outgoing handle is at `out` and incoming one opposite it. */
export const smoothAt = (point: Point, out: Point): PathAnchor => ({
  x: point.x,
  y: point.y,
  inX: 2 * point.x - out.x,
  inY: 2 * point.y - out.y,
  outX: out.x,
  outY: out.y,
  smooth: true,
});

const hasHandles = (anchor: PathAnchor) =>
  anchor.inX !== anchor.x || anchor.inY !== anchor.y || anchor.outX !== anchor.x || anchor.outY !== anchor.y;

export { hasHandles as anchorHasHandles };

/** Move one handle of an anchor; a smooth anchor turns its other handle to stay opposite (keeping its length). */
export function moveHandle(anchor: PathAnchor, which: "in" | "out", to: Point, breakSmooth: boolean): PathAnchor {
  const moved = which === "in" ? { ...anchor, inX: to.x, inY: to.y } : { ...anchor, outX: to.x, outY: to.y };
  if (breakSmooth) return { ...moved, smooth: false };
  if (!anchor.smooth) return moved;
  const [otherX, otherY] = which === "in" ? [anchor.outX, anchor.outY] : [anchor.inX, anchor.inY];
  const length = Math.hypot(otherX - anchor.x, otherY - anchor.y);
  const dx = anchor.x - to.x;
  const dy = anchor.y - to.y;
  const reach = Math.hypot(dx, dy);
  if (reach === 0) return moved;
  const other = { x: anchor.x + (dx / reach) * length, y: anchor.y + (dy / reach) * length };
  return which === "in" ? { ...moved, outX: other.x, outY: other.y } : { ...moved, inX: other.x, inY: other.y };
}

export const translateAnchor = (anchor: PathAnchor, dx: number, dy: number): PathAnchor => ({
  ...anchor,
  x: anchor.x + dx,
  y: anchor.y + dy,
  inX: anchor.inX + dx,
  inY: anchor.inY + dy,
  outX: anchor.outX + dx,
  outY: anchor.outY + dy,
});

/** The segments of a subpath, as [from, to] anchor pairs (the closing one included). */
export function segmentsOf(subpath: Subpath): [PathAnchor, PathAnchor][] {
  const { anchors } = subpath;
  const pairs: [PathAnchor, PathAnchor][] = [];
  for (let index = 0; index + 1 < anchors.length; index += 1) pairs.push([anchors[index]!, anchors[index + 1]!]);
  if (subpath.closed && anchors.length > 1) pairs.push([anchors[anchors.length - 1]!, anchors[0]!]);
  return pairs;
}

function bezierPoint(from: PathAnchor, to: PathAnchor, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * from.outX + c * to.inX + d * to.x,
    y: a * from.y + b * from.outY + c * to.inY + d * to.y,
  };
}

/** How many straight pieces keep a segment within about `tolerance` of the curve. */
function piecesFor(from: PathAnchor, to: PathAnchor, tolerance: number): number {
  if (from.outX === from.x && from.outY === from.y && to.inX === to.x && to.inY === to.y) return 1;
  // The control polygon's bend bounds how far the curve strays from its chord.
  const bend = Math.max(
    Math.hypot(from.x - 2 * from.outX + to.inX, from.y - 2 * from.outY + to.inY),
    Math.hypot(from.outX - 2 * to.inX + to.x, from.outY - 2 * to.inY + to.y)
  );
  return Math.min(512, Math.max(1, Math.ceil(Math.sqrt((3 * bend) / (4 * Math.max(tolerance, 0.01))))));
}

/** A subpath as a polyline within about `tolerance` scene units of the curve; closed ones end where they start. */
export function flattenSubpath(subpath: Subpath, tolerance = 0.25): Point[] {
  const anchors = subpath.anchors;
  if (anchors.length === 0) return [];
  const points: Point[] = [{ x: anchors[0]!.x, y: anchors[0]!.y }];
  for (const [from, to] of segmentsOf(subpath)) {
    const pieces = piecesFor(from, to, tolerance);
    for (let step = 1; step <= pieces; step += 1) points.push(bezierPoint(from, to, step / pieces));
  }
  return points;
}

/** The SVG path data for paths (Fabric's Path, PSD vector data). */
export function svgPathData(subpaths: readonly Subpath[]): string {
  const number = (value: number) => Number(value.toFixed(3)).toString();
  const parts: string[] = [];
  for (const subpath of subpaths) {
    const anchors = subpath.anchors;
    if (anchors.length === 0) continue;
    parts.push(`M ${number(anchors[0]!.x)} ${number(anchors[0]!.y)}`);
    for (const [from, to] of segmentsOf(subpath)) {
      parts.push(
        `C ${number(from.outX)} ${number(from.outY)} ${number(to.inX)} ${number(to.inY)} ${number(to.x)} ${number(to.y)}`
      );
    }
    if (subpath.closed) parts.push("Z");
  }
  return parts.join(" ");
}

/** The next free "Path N" name. */
export function nextPathName(paths: readonly DocumentPath[]): string {
  let highest = 0;
  for (const path of paths) {
    const match = /^Path (\d+)$/.exec(path.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Path ${highest + 1}`;
}

/** The squared distance from p to the segment a–b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  const x = a.x + t * dx - p.x;
  const y = a.y + t * dy - p.y;
  return x * x + y * y;
}

/** Douglas–Peucker: the corners of a polyline that keep it within `tolerance`. */
export function simplifyPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const limit = tolerance * tolerance;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstDistance = limit;
    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToSegment(points[index]!, points[first]!, points[last]!);
      if (distance > worstDistance) {
        worst = index;
        worstDistance = distance;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}
