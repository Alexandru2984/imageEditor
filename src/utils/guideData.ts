/**
 * Guides and the grid as data: what a saved document may hold, how guides
 * follow the document when it turns or flips, and the ruler's and grid's
 * spacing. No canvas here, so project files can be checked with it.
 */

/** A guide: a vertical line at scene x (axis "x") or a horizontal one at scene y. */
export interface Guide {
  axis: "x" | "y";
  position: number;
}

export const MAX_GUIDES = 200;
const MAX_POSITION = 10_000_000;

export function isGuideList(value: unknown): value is Guide[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_GUIDES &&
    value.every((guide: unknown) => {
      if (!guide || typeof guide !== "object" || Array.isArray(guide)) return false;
      const { axis, position, ...rest } = guide as Record<string, unknown>;
      return (
        Object.keys(rest).length === 0 &&
        (axis === "x" || axis === "y") &&
        typeof position === "number" &&
        Number.isFinite(position) &&
        Math.abs(position) <= MAX_POSITION
      );
    })
  );
}

/** An affine map of the scene: [a, b, c, d, e, f] takes (x, y) to (a x + c y + e, b x + d y + f). */
export type SceneMatrix = readonly [number, number, number, number, number, number];

/**
 * Guides carried through a change of the whole scene (a quarter turn, a
 * flip, a stretch). A guide the change would tilt stays where it was.
 */
export function mapGuides(guides: readonly Guide[], matrix: SceneMatrix): Guide[] {
  const [a, b, c, d, e, f] = matrix;
  const map = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
  return guides.map((guide) => {
    const along = guide.axis === "x" ? [map(guide.position, 0), map(guide.position, 1000)] : [map(0, guide.position), map(1000, guide.position)];
    const [p, q] = along as [{ x: number; y: number }, { x: number; y: number }];
    if (Math.abs(p.x - q.x) < 1e-6) return { axis: "x", position: p.x };
    if (Math.abs(p.y - q.y) < 1e-6) return { axis: "y", position: p.y };
    return guide;
  });
}

/**
 * The ruler's numbered step (in document pixels) for a zoom of `screenPerPixel`
 * screen pixels per document pixel: the smallest 1, 2 or 5 × 10ⁿ at least
 * `minimum` screen pixels apart, and how many ticks divide it.
 */
export function rulerStep(screenPerPixel: number, minimum = 56): { step: number; divisions: number } {
  let power = 1;
  for (;;) {
    for (const lead of [1, 2, 5]) {
      const step = lead * power;
      if (step * screenPerPixel >= minimum) {
        const options = lead === 2 ? [4, 2] : [10, 5, 2];
        const divisions = options.find((count) => (step / count) * screenPerPixel >= 5) ?? 1;
        return { step, divisions };
      }
    }
    if (power > 1e7) return { step: power, divisions: 1 };
    power *= 10;
  }
}

/** Where the grid has lines: every `spacing` ÷ `subdivisions` document pixels from the top-left corner. */
export interface GridSettings {
  /** Document pixels between the main lines. */
  spacing: number;
  /** Fainter lines dividing each square, 1 for none. */
  subdivisions: number;
}

export const DEFAULT_GRID: GridSettings = { spacing: 100, subdivisions: 4 };

export function isGridSettings(value: unknown): value is GridSettings {
  if (!value || typeof value !== "object") return false;
  const { spacing, subdivisions } = value as Record<string, unknown>;
  return (
    typeof spacing === "number" &&
    Number.isFinite(spacing) &&
    spacing >= 1 &&
    spacing <= 10_000 &&
    typeof subdivisions === "number" &&
    Number.isInteger(subdivisions) &&
    subdivisions >= 1 &&
    subdivisions <= 20
  );
}

/** The grid lines on either side of each of `stops`, for lines every `step` from `origin`. */
export function nearestLines(stops: readonly number[], origin: number, step: number): number[] {
  if (!(step > 0)) return [];
  const lines: number[] = [];
  for (const stop of stops) {
    const below = Math.floor((stop - origin) / step);
    lines.push(origin + below * step, origin + (below + 1) * step);
  }
  return lines;
}
