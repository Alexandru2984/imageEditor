import { simplifyPolyline, type Point } from "./pathData";

const RIGHT = 1;
const DOWN = 2;
const LEFT = 4;
const UP = 8;
const STEPS: Record<number, [number, number]> = { [RIGHT]: [1, 0], [DOWN]: [0, 1], [LEFT]: [-1, 0], [UP]: [0, -1] };
/** For each direction, the turns to try in order: right, straight on, left. */
const TURNS: Record<number, number[]> = {
  [RIGHT]: [DOWN, RIGHT, UP],
  [DOWN]: [LEFT, DOWN, RIGHT],
  [LEFT]: [UP, LEFT, DOWN],
  [UP]: [RIGHT, UP, LEFT],
};

/**
 * The outlines of what a mask selects (values at or above `threshold`), as
 * closed loops of pixel-corner points simplified to `tolerance` pixels
 * (Photoshop's Make Work Path). Each loop keeps the selected side on its
 * right; holes run the other way round.
 */
export function traceOutlines(
  mask: { width: number; height: number; data: Uint8Array },
  tolerance: number,
  threshold = 128
): Point[][] {
  const { width, height, data } = mask;
  const stride = width + 1;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && data[y * width + x]! >= threshold;
  // The edges leaving each pixel corner, walking with the selection on the right.
  const edges = new Uint8Array(stride * (height + 1));
  const mark = (index: number, direction: number) => {
    edges[index] = edges[index]! | direction;
  };
  let any = false;
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      if (x < width) {
        const below = inside(x, y);
        if (below !== inside(x, y - 1)) {
          if (below) mark(y * stride + x, RIGHT);
          else mark(y * stride + x + 1, LEFT);
          any = true;
        }
      }
      if (y < height) {
        const left = inside(x - 1, y);
        if (left !== inside(x, y)) {
          if (left) mark(y * stride + x, DOWN);
          else mark((y + 1) * stride + x, UP);
        }
      }
    }
  }
  if (!any) return [];

  const loops: Point[][] = [];
  for (let start = 0; start < edges.length; start += 1) {
    if (!edges[start]) continue;
    let vertex = start;
    let direction = edges[start]! & -edges[start]!;
    const corners: Point[] = [{ x: start % stride, y: Math.floor(start / stride) }];
    for (;;) {
      edges[vertex] = edges[vertex]! & ~direction;
      const [dx, dy] = STEPS[direction]!;
      const x = (vertex % stride) + dx;
      const y = Math.floor(vertex / stride) + dy;
      vertex = y * stride + x;
      const out = edges[vertex]!;
      if (!out) {
        corners.push({ x, y });
        break;
      }
      const next = TURNS[direction]!.find((turn) => out & turn) ?? (out & -out);
      if (next !== direction) corners.push({ x, y });
      direction = next;
    }
    const simplified = simplifyPolyline(corners, tolerance);
    // A loop ends where it starts; the path closes it instead.
    if (simplified.length > 1) simplified.pop();
    if (simplified.length >= 3) loops.push(simplified);
  }
  return loops;
}
