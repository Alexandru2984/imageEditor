import { Mask } from "./mask";

export interface Point {
  x: number;
  y: number;
}

/** Rows sampled per pixel when edges are anti-aliased. */
const SUBROWS = 4;

/**
 * Fill a closed polygon (pixel coordinates; even-odd rule, so a lasso that
 * crosses itself leaves the overlap out). Anti-aliased edges get partial
 * values; otherwise a pixel is in when its centre is.
 */
export function polygonMask(width: number, height: number, points: Point[], antiAlias = true): Mask {
  const mask = new Mask(width, height);
  if (points.length < 3) return mask;

  const edges: { x0: number; y0: number; slope: number; top: number; bottom: number }[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length]!;
    minY = Math.min(minY, start.y);
    maxY = Math.max(maxY, start.y);
    if (start.y === end.y) return;
    edges.push({
      x0: start.x,
      y0: start.y,
      slope: (end.x - start.x) / (end.y - start.y),
      top: Math.min(start.y, end.y),
      bottom: Math.max(start.y, end.y),
    });
  });
  edges.sort((a, b) => a.top - b.top);

  const samples = antiAlias ? SUBROWS : 1;
  const weight = 1 / samples;
  const coverage = new Float32Array(width + 1);
  const runs = new Float32Array(width + 1);
  const crossings: number[] = [];
  const firstRow = Math.max(0, Math.floor(minY));
  const lastRow = Math.min(height, Math.ceil(maxY));

  for (let row = firstRow; row < lastRow; row += 1) {
    coverage.fill(0);
    runs.fill(0);
    for (let sample = 0; sample < samples; sample += 1) {
      const y = row + (sample + 0.5) / samples;
      crossings.length = 0;
      for (const edge of edges) {
        if (edge.top > y) break;
        if (y < edge.bottom) crossings.push(edge.x0 + (y - edge.y0) * edge.slope);
      }
      crossings.sort((a, b) => a - b);
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const from = crossings[index]!;
        const to = crossings[index + 1]!;
        if (antiAlias) addCoverage(coverage, runs, width, from, to, weight);
        else addCentres(coverage, width, from, to);
      }
    }
    const offset = row * width;
    let run = 0;
    for (let x = 0; x < width; x += 1) {
      run += runs[x]!;
      const value = Math.min(1, coverage[x]! + run);
      mask.data[offset + x] = antiAlias ? Math.round(value * 255) : value > 0 ? 255 : 0;
    }
  }
  return mask;
}

/** Add the exact share of each pixel that the span [from, to) covers. */
function addCoverage(
  coverage: Float32Array,
  runs: Float32Array,
  width: number,
  from: number,
  to: number,
  weight: number
) {
  const start = Math.max(0, Math.min(width, from));
  const end = Math.max(0, Math.min(width, to));
  if (end <= start) return;
  const first = Math.floor(start);
  const last = Math.floor(end);
  if (first === last) {
    coverage[first] = coverage[first]! + (end - start) * weight;
    return;
  }
  coverage[first] = coverage[first]! + (first + 1 - start) * weight;
  // Whole pixels in between, summed later along the row.
  runs[first + 1] = runs[first + 1]! + weight;
  runs[last] = runs[last]! - weight;
  if (last < width) coverage[last] = coverage[last]! + (end - last) * weight;
}

/** Mark the pixels whose centres lie in [from, to). */
function addCentres(coverage: Float32Array, width: number, from: number, to: number) {
  const first = Math.max(0, Math.ceil(from - 0.5));
  const last = Math.min(width, Math.ceil(to - 0.5));
  for (let x = first; x < last; x += 1) coverage[x] = 1;
}

/** An ellipse inside the box between two corners. */
export function ellipseMask(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  antiAlias = true
): Mask {
  const radiusX = Math.abs(x1 - x0) / 2;
  const radiusY = Math.abs(y1 - y0) / 2;
  const centreX = (x0 + x1) / 2;
  const centreY = (y0 + y1) / 2;
  // Segments about two pixels long look round at any size.
  const steps = Math.min(4096, Math.max(32, Math.ceil((Math.PI * (radiusX + radiusY)) / 2)));
  const points: Point[] = [];
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    points.push({ x: centreX + Math.cos(angle) * radiusX, y: centreY + Math.sin(angle) * radiusY });
  }
  return polygonMask(width, height, points, antiAlias);
}
