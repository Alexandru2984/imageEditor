/** Axis-aligned box in scene coordinates. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A guide drawn while a layer is snapped: a vertical (x) or horizontal (y) line. */
export interface SnapLine {
  axis: "x" | "y";
  /** Scene coordinate of the line on its axis. */
  position: number;
  /** Extent of the line along the other axis. */
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  lines: SnapLine[];
}

const EPSILON = 0.01;

const xStops = (box: Box) => [box.left, box.left + box.width / 2, box.left + box.width];
const yStops = (box: Box) => [box.top, box.top + box.height / 2, box.top + box.height];

/** Smallest offset (within the threshold) that lines up any stop with any target stop. */
function bestOffset(moving: number[], targets: number[][], threshold: number): number | null {
  let best: number | null = null;
  for (const stops of targets) {
    for (const target of stops) {
      for (const stop of moving) {
        const delta = target - stop;
        if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) {
          best = delta;
        }
      }
    }
  }
  return best;
}

/**
 * Snap a moving box to the edges and centres of reference boxes (the photo
 * and the other layers). Each axis snaps independently to the closest match
 * inside `threshold`; every reference stop that lines up after snapping gets
 * a guide spanning both boxes.
 */
export function computeSnap(moving: Box, references: Box[], threshold: number): SnapResult {
  const dx = bestOffset(xStops(moving), references.map(xStops), threshold) ?? 0;
  const dy = bestOffset(yStops(moving), references.map(yStops), threshold) ?? 0;
  const snapped: Box = { ...moving, left: moving.left + dx, top: moving.top + dy };
  const lines: SnapLine[] = [];

  // One guide per aligned coordinate, stretched over every box it touches.
  const addLine = (line: SnapLine) => {
    const existing = lines.find(
      (candidate) =>
        candidate.axis === line.axis && Math.abs(candidate.position - line.position) < EPSILON
    );
    if (existing) {
      existing.from = Math.min(existing.from, line.from);
      existing.to = Math.max(existing.to, line.to);
    } else {
      lines.push(line);
    }
  };

  const movingX = xStops(snapped);
  const movingY = yStops(snapped);
  for (const reference of references) {
    for (const target of xStops(reference)) {
      if (movingX.some((stop) => Math.abs(stop - target) < EPSILON)) {
        addLine({
          axis: "x",
          position: target,
          from: Math.min(snapped.top, reference.top),
          to: Math.max(snapped.top + snapped.height, reference.top + reference.height),
        });
      }
    }
    for (const target of yStops(reference)) {
      if (movingY.some((stop) => Math.abs(stop - target) < EPSILON)) {
        addLine({
          axis: "y",
          position: target,
          from: Math.min(snapped.left, reference.left),
          to: Math.max(snapped.left + snapped.width, reference.left + reference.width),
        });
      }
    }
  }
  return { dx, dy, lines };
}
