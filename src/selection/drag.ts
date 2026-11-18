import type { SelectionMode } from "./mask";

interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The mode a new shape joins the selection in: Shift adds, Alt subtracts and
 * both intersect, as in Photoshop; otherwise the options bar's mode.
 */
export function modeFor(event: Modifiers, chosen: SelectionMode): SelectionMode {
  if (event.shiftKey && event.altKey) return "intersect";
  if (event.shiftKey) return "add";
  if (event.altKey) return "subtract";
  return chosen;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The box a marquee drag draws: a square with `square`, and centred on the
 * starting point with `fromCentre`.
 */
export function dragBox(
  start: Point,
  end: Point,
  { square = false, fromCentre = false }: { square?: boolean; fromCentre?: boolean } = {}
): { x0: number; y0: number; x1: number; y1: number } {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  if (fromCentre) return { x0: start.x - dx, y0: start.y - dy, x1: start.x + dx, y1: start.y + dy };
  return { x0: start.x, y0: start.y, x1: start.x + dx, y1: start.y + dy };
}

/**
 * Tracks a modifier held when a drag began: it chose the selection mode, so
 * it only constrains the shape once released and pressed again (Photoshop).
 */
export class HeldModifier {
  private released: boolean;

  constructor(heldAtStart: boolean) {
    this.released = !heldAtStart;
  }

  /** Whether the key now acts on the shape. */
  update(held: boolean): boolean {
    if (!held) this.released = true;
    return held && this.released;
  }
}
