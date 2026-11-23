/**
 * Filter › Liquify: a field of displacements over the layer, on a grid of
 * nodes `cell` pixels apart, that the Liquify tools push about. Each output
 * pixel shows the picture at its own place plus the displacement there
 * (bilinear between the nodes), so a tool changes the field and only the
 * pixels around the brush are drawn again. Plain data, so the full-size
 * result is worked out in the pixel-job worker.
 */

export type LiquifyTool =
  | "warp"
  | "reconstruct"
  | "smooth"
  | "twirl"
  | "pucker"
  | "bloat"
  | "pushLeft"
  | "freeze"
  | "thaw";

export interface LiquifyBrush {
  /** In layer pixels. */
  radius: number;
  /** 0–100: how far towards the edge the brush works at full strength. */
  density: number;
  /** 0–100: how strongly it works. */
  pressure: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A box of layer (or preview) pixels, `right` and `bottom` excluded. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The field as plain data (for the worker). */
export interface FieldData {
  /** dx, dy for each node, row by row. */
  data: Float32Array;
  columns: number;
  rows: number;
  /** Layer pixels between nodes. */
  cell: number;
}

export interface SourcePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** At most this many nodes: about 12 MB of field. */
const MAX_NODES = 1_500_000;
/** Undo keeps the field in tiles of this many nodes a side. */
const TILE = 32;
/** How many strokes Ctrl+Z goes back. */
const UNDO_DEPTH = 40;

/** The node spacing for a layer region, fine enough yet not too many nodes. */
export function fieldCell(width: number, height: number, maxNodes = MAX_NODES): number {
  let cell = 1;
  while ((Math.ceil(width / cell) + 1) * (Math.ceil(height / cell) + 1) > maxNodes) cell += 1;
  return cell;
}

/** Full strength in the middle, fading to nothing at the rim; `density` sets where the fade starts. */
export function brushFalloff(distance: number, radius: number, density: number): number {
  if (radius <= 0 || distance >= radius) return 0;
  const inner = Math.min(0.95, Math.max(0, density / 100) * 0.95);
  const t = distance / radius;
  if (t <= inner) return 1;
  return 0.5 * (1 + Math.cos((Math.PI * (t - inner)) / (1 - inner)));
}

/** The displacement at (x, y) in layer pixels, bilinear between the nodes, into `out`. */
export function displacementAt(field: FieldData, x: number, y: number, out: Float32Array | number[]): void {
  const { data, columns, rows, cell } = field;
  const gx = Math.min(columns - 1, Math.max(0, x / cell));
  const gy = Math.min(rows - 1, Math.max(0, y / cell));
  const i0 = Math.min(columns - 2, Math.floor(gx));
  const j0 = Math.min(rows - 2, Math.floor(gy));
  const fx = gx - i0;
  const fy = gy - j0;
  const a = (j0 * columns + i0) * 2;
  const b = a + 2;
  const c = a + columns * 2;
  const d = c + 2;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  out[0] = data[a]! * w00 + data[b]! * w10 + data[c]! * w01 + data[d]! * w11;
  out[1] = data[a + 1]! * w00 + data[b + 1]! * w10 + data[c + 1]! * w01 + data[d + 1]! * w11;
}

interface Snapshot {
  data: Float32Array;
  freeze: Uint8Array;
}

export class LiquifyField implements FieldData {
  readonly data: Float32Array;
  /** How frozen each node is (0–255): frozen parts do not move. */
  readonly freeze: Uint8Array;
  readonly columns: number;
  readonly rows: number;
  private readonly tileColumns: number;
  private stroke: Map<number, Snapshot> | null = null;
  private readonly history: Map<number, Snapshot>[] = [];

  constructor(
    /** The layer region's size, in pixels. */
    readonly width: number,
    readonly height: number,
    readonly cell = fieldCell(width, height)
  ) {
    this.columns = Math.ceil(width / cell) + 1;
    this.rows = Math.ceil(height / cell) + 1;
    this.data = new Float32Array(this.columns * this.rows * 2);
    this.freeze = new Uint8Array(this.columns * this.rows);
    this.tileColumns = Math.ceil(this.columns / TILE);
  }

  // ---------- Undo, a stroke at a time ----------

  beginStroke(): void {
    this.stroke ??= new Map();
  }

  endStroke(): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke || stroke.size === 0) return;
    this.history.push(stroke);
    if (this.history.length > UNDO_DEPTH) this.history.shift();
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** Take back the last stroke; the layer pixels it changed, or null. */
  undo(): Box | null {
    this.endStroke();
    const last = this.history.pop();
    if (!last) return null;
    let box: Box | null = null;
    for (const [tile, saved] of last) {
      const area = this.tileArea(tile);
      let at = 0;
      for (let j = area.j0; j < area.j1; j += 1) {
        for (let i = area.i0; i < area.i1; i += 1, at += 1) {
          const node = j * this.columns + i;
          this.data[node * 2] = saved.data[at * 2]!;
          this.data[node * 2 + 1] = saved.data[at * 2 + 1]!;
          this.freeze[node] = saved.freeze[at]!;
        }
      }
      box = union(box, this.nodeBox(area.i0, area.j0, area.i1 - 1, area.j1 - 1));
    }
    return box;
  }

  private tileArea(tile: number) {
    const ti = tile % this.tileColumns;
    const tj = Math.floor(tile / this.tileColumns);
    return {
      i0: ti * TILE,
      j0: tj * TILE,
      i1: Math.min(this.columns, (ti + 1) * TILE),
      j1: Math.min(this.rows, (tj + 1) * TILE),
    };
  }

  /** Keep the nodes from (i0, j0) to (i1, j1) as they were before this stroke. */
  private touch(i0: number, j0: number, i1: number, j1: number) {
    const stroke = this.stroke;
    if (!stroke) return;
    for (let tj = Math.floor(j0 / TILE); tj <= Math.floor(j1 / TILE); tj += 1) {
      for (let ti = Math.floor(i0 / TILE); ti <= Math.floor(i1 / TILE); ti += 1) {
        const tile = tj * this.tileColumns + ti;
        if (stroke.has(tile)) continue;
        const area = this.tileArea(tile);
        const count = (area.i1 - area.i0) * (area.j1 - area.j0);
        const saved: Snapshot = { data: new Float32Array(count * 2), freeze: new Uint8Array(count) };
        let at = 0;
        for (let j = area.j0; j < area.j1; j += 1) {
          for (let i = area.i0; i < area.i1; i += 1, at += 1) {
            const node = j * this.columns + i;
            saved.data[at * 2] = this.data[node * 2]!;
            saved.data[at * 2 + 1] = this.data[node * 2 + 1]!;
            saved.freeze[at] = this.freeze[node]!;
          }
        }
        stroke.set(tile, saved);
      }
    }
  }

  // ---------- Geometry ----------

  /** The layer pixels drawn from the nodes (i0, j0)–(i1, j1). */
  private nodeBox(i0: number, j0: number, i1: number, j1: number): Box {
    const { cell } = this;
    return {
      left: Math.max(0, (i0 - 1) * cell),
      top: Math.max(0, (j0 - 1) * cell),
      right: Math.min(this.width, (i1 + 1) * cell + 1),
      bottom: Math.min(this.height, (j1 + 1) * cell + 1),
    };
  }

  /** The nodes within `radius` of a point, or null when none are. */
  private nodesAround(center: Point, radius: number) {
    const { cell } = this;
    const i0 = Math.max(0, Math.floor((center.x - radius) / cell));
    const j0 = Math.max(0, Math.floor((center.y - radius) / cell));
    const i1 = Math.min(this.columns - 1, Math.ceil((center.x + radius) / cell));
    const j1 = Math.min(this.rows - 1, Math.ceil((center.y + radius) / cell));
    return i1 < i0 || j1 < j0 ? null : { i0, j0, i1, j1 };
  }

  /** How free a node is to move (1 thawed, 0 frozen). */
  private thawed(node: number): number {
    return 1 - this.freeze[node]! / 255;
  }

  /**
   * Make the picture at each node within the brush show what it showed at
   * `map`(node), which lies at most `reach` pixels away: the new displacement
   * is the way to there plus the displacement there before.
   */
  private remap(
    center: Point,
    brush: LiquifyBrush,
    strength: number,
    reach: number,
    map: (x: number, y: number, weight: number, out: number[]) => void
  ): Box | null {
    const around = this.nodesAround(center, brush.radius);
    if (!around || strength <= 0) return null;
    const { cell, columns, rows } = this;
    const pad = Math.ceil(reach / cell) + 2;
    // The field before, around the brush and as far as it reaches.
    const ci0 = Math.max(0, around.i0 - pad);
    const cj0 = Math.max(0, around.j0 - pad);
    const ci1 = Math.min(columns - 1, around.i1 + pad);
    const cj1 = Math.min(rows - 1, around.j1 + pad);
    const copyColumns = ci1 - ci0 + 1;
    const copyRows = cj1 - cj0 + 1;
    const before = new Float32Array(copyColumns * copyRows * 2);
    for (let j = cj0; j <= cj1; j += 1) {
      before.set(this.data.subarray((j * columns + ci0) * 2, (j * columns + ci1 + 1) * 2), (j - cj0) * copyColumns * 2);
    }
    const old: FieldData = { data: before, columns: copyColumns, rows: copyRows, cell };
    this.touch(around.i0, around.j0, around.i1, around.j1);
    const target = [0, 0];
    const shift = new Float32Array(2);
    let changed = false;
    for (let j = around.j0; j <= around.j1; j += 1) {
      for (let i = around.i0; i <= around.i1; i += 1) {
        const x = i * cell;
        const y = j * cell;
        const node = j * columns + i;
        const weight = brushFalloff(Math.hypot(x - center.x, y - center.y), brush.radius, brush.density) * strength * this.thawed(node);
        if (weight <= 1e-4) continue;
        map(x, y, weight, target);
        const tx = Math.min(this.width, Math.max(0, target[0]!));
        const ty = Math.min(this.height, Math.max(0, target[1]!));
        displacementAt(old, tx - ci0 * cell, ty - cj0 * cell, shift);
        this.data[node * 2] = tx - x + shift[0]!;
        this.data[node * 2 + 1] = ty - y + shift[1]!;
        changed = true;
      }
    }
    return changed ? this.nodeBox(around.i0, around.j0, around.i1, around.j1) : null;
  }

  // ---------- The tools ----------

  /**
   * Forward Warp (or Push Left, `sideways`): the picture under the brush goes
   * along from `from` to `to`, in steps a fifth of the brush long. Push Left
   * moves it to the left of the way the brush goes (right with `reverse`).
   */
  push(from: Point, to: Point, brush: LiquifyBrush, sideways = false, reverse = false): Box | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    const steps = Math.max(1, Math.ceil(length / Math.max(1, brush.radius * 0.2)));
    let mx = dx / steps;
    let my = dy / steps;
    if (sideways) {
      // Dragging up pushes left.
      const sign = reverse ? -1 : 1;
      [mx, my] = [my * sign, -mx * sign];
    }
    const strength = brush.pressure / 100;
    let box: Box | null = null;
    for (let step = 1; step <= steps; step += 1) {
      const center = { x: from.x + (dx * step) / steps, y: from.y + (dy * step) / steps };
      box = union(
        box,
        this.remap(center, brush, strength, Math.hypot(mx, my), (x, y, weight, out) => {
          out[0] = x - mx * weight;
          out[1] = y - my * weight;
        })
      );
    }
    return box;
  }

  /** Twirl: the picture turns about the brush's middle by `angle` (radians, clockwise on screen when positive). */
  twirl(center: Point, angle: number, brush: LiquifyBrush): Box | null {
    return this.remap(center, brush, 1, brush.radius * Math.abs(angle) + 1, (x, y, weight, out) => {
      const turn = -angle * weight;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const rx = x - center.x;
      const ry = y - center.y;
      out[0] = center.x + rx * cos - ry * sin;
      out[1] = center.y + rx * sin + ry * cos;
    });
  }

  /** Pucker (`amount` > 0) draws the picture in towards the brush's middle; Bloat (< 0) swells it out. */
  pinch(center: Point, amount: number, brush: LiquifyBrush): Box | null {
    return this.remap(center, brush, 1, brush.radius * Math.abs(amount) + 1, (x, y, weight, out) => {
      const factor = 1 + amount * weight;
      out[0] = center.x + (x - center.x) * factor;
      out[1] = center.y + (y - center.y) * factor;
    });
  }

  /** Reconstruct: back towards the original by `amount` (0–1) at full strength. */
  reconstruct(center: Point, amount: number, brush: LiquifyBrush): Box | null {
    const around = this.nodesAround(center, brush.radius);
    if (!around) return null;
    this.touch(around.i0, around.j0, around.i1, around.j1);
    let changed = false;
    for (let j = around.j0; j <= around.j1; j += 1) {
      for (let i = around.i0; i <= around.i1; i += 1) {
        const node = j * this.columns + i;
        const weight =
          brushFalloff(Math.hypot(i * this.cell - center.x, j * this.cell - center.y), brush.radius, brush.density) *
          amount *
          this.thawed(node);
        if (weight <= 1e-4) continue;
        const keep = Math.max(0, 1 - weight);
        this.data[node * 2] = this.data[node * 2]! * keep;
        this.data[node * 2 + 1] = this.data[node * 2 + 1]! * keep;
        changed = true;
      }
    }
    return changed ? this.nodeBox(around.i0, around.j0, around.i1, around.j1) : null;
  }

  /** Smooth: evens out a jagged warp, by `amount` (0–1) at full strength. */
  smooth(center: Point, amount: number, brush: LiquifyBrush): Box | null {
    const around = this.nodesAround(center, brush.radius);
    if (!around) return null;
    const { columns, rows } = this;
    const reach = 2;
    const ci0 = Math.max(0, around.i0 - reach);
    const cj0 = Math.max(0, around.j0 - reach);
    const ci1 = Math.min(columns - 1, around.i1 + reach);
    const cj1 = Math.min(rows - 1, around.j1 + reach);
    const width = ci1 - ci0 + 1;
    const before = new Float32Array(width * (cj1 - cj0 + 1) * 2);
    for (let j = cj0; j <= cj1; j += 1) {
      before.set(this.data.subarray((j * columns + ci0) * 2, (j * columns + ci1 + 1) * 2), (j - cj0) * width * 2);
    }
    this.touch(around.i0, around.j0, around.i1, around.j1);
    let changed = false;
    for (let j = around.j0; j <= around.j1; j += 1) {
      for (let i = around.i0; i <= around.i1; i += 1) {
        const node = j * columns + i;
        const weight =
          brushFalloff(Math.hypot(i * this.cell - center.x, j * this.cell - center.y), brush.radius, brush.density) *
          amount *
          this.thawed(node);
        if (weight <= 1e-4) continue;
        let sx = 0;
        let sy = 0;
        let count = 0;
        for (let v = Math.max(cj0, j - reach); v <= Math.min(cj1, j + reach); v += 1) {
          for (let u = Math.max(ci0, i - reach); u <= Math.min(ci1, i + reach); u += 1) {
            const at = ((v - cj0) * width + (u - ci0)) * 2;
            sx += before[at]!;
            sy += before[at + 1]!;
            count += 1;
          }
        }
        const share = Math.min(1, weight);
        this.data[node * 2] = this.data[node * 2]! + (sx / count - this.data[node * 2]!) * share;
        this.data[node * 2 + 1] = this.data[node * 2 + 1]! + (sy / count - this.data[node * 2 + 1]!) * share;
        changed = true;
      }
    }
    return changed ? this.nodeBox(around.i0, around.j0, around.i1, around.j1) : null;
  }

  /** Freeze Mask (or Thaw Mask, `thaw`): protect the picture under the brush from the other tools. */
  paintFreeze(center: Point, brush: LiquifyBrush, thaw = false): Box | null {
    const around = this.nodesAround(center, brush.radius);
    if (!around) return null;
    this.touch(around.i0, around.j0, around.i1, around.j1);
    const strength = brush.pressure / 100;
    let changed = false;
    for (let j = around.j0; j <= around.j1; j += 1) {
      for (let i = around.i0; i <= around.i1; i += 1) {
        const weight = brushFalloff(Math.hypot(i * this.cell - center.x, j * this.cell - center.y), brush.radius, brush.density) * strength;
        if (weight <= 1e-4) continue;
        const node = j * this.columns + i;
        const current = this.freeze[node]!;
        const next = thaw ? Math.round(current * (1 - weight)) : Math.max(current, Math.round(255 * weight));
        if (next === current) continue;
        this.freeze[node] = next;
        changed = true;
      }
    }
    return changed ? this.nodeBox(around.i0, around.j0, around.i1, around.j1) : null;
  }

  /** Restore All: every distortion gone, frozen parts' too (as in Photoshop), as one undoable step. */
  restoreAll(): Box {
    this.endStroke();
    this.beginStroke();
    this.touch(0, 0, this.columns - 1, this.rows - 1);
    this.data.fill(0);
    this.endStroke();
    return { left: 0, top: 0, right: this.width, bottom: this.height };
  }

  /** Thaw All, as one undoable step. */
  thawAll(): Box {
    this.endStroke();
    this.beginStroke();
    this.touch(0, 0, this.columns - 1, this.rows - 1);
    this.freeze.fill(0);
    this.endStroke();
    return { left: 0, top: 0, right: this.width, bottom: this.height };
  }

  /** How far any pixel is taken from, in layer pixels. */
  maxDisplacement(): number {
    let most = 0;
    for (let index = 0; index < this.data.length; index += 2) {
      const length = this.data[index]! * this.data[index]! + this.data[index + 1]! * this.data[index + 1]!;
      if (length > most) most = length;
    }
    return Math.sqrt(most);
  }

  isIdentity(): boolean {
    return this.maxDisplacement() < 1e-3;
  }

  /** The freeze at a layer pixel (nearest node), 0–255. */
  freezeAt(x: number, y: number): number {
    const i = Math.min(this.columns - 1, Math.max(0, Math.round(x / this.cell)));
    const j = Math.min(this.rows - 1, Math.max(0, Math.round(y / this.cell)));
    return this.freeze[j * this.columns + i]!;
  }
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

export interface RenderOptions {
  /** Output pixels per layer pixel. */
  scale: number;
  /** Source pixels per layer pixel. */
  sourceScale: number;
  /** Where the field's region starts in the source, in layer pixels. */
  offsetX: number;
  offsetY: number;
  /** Only these output pixels (all of them without). */
  box?: Box;
}

/**
 * Draw the liquified region into `out` (`width` × `height` RGBA): each pixel
 * shows the source at its place plus the field's displacement, bilinearly in
 * premultiplied colour; beyond the source's edge its edge pixels carry on.
 */
export function renderLiquify(
  field: FieldData,
  source: SourcePixels,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  options: RenderOptions
): void {
  const { scale, sourceScale, offsetX, offsetY } = options;
  const box = options.box ?? { left: 0, top: 0, right: width, bottom: height };
  const left = Math.max(0, Math.floor(box.left));
  const top = Math.max(0, Math.floor(box.top));
  const right = Math.min(width, Math.ceil(box.right));
  const bottom = Math.min(height, Math.ceil(box.bottom));
  const { data, width: sourceWidth, height: sourceHeight } = source;
  const shift = new Float32Array(2);
  for (let v = top; v < bottom; v += 1) {
    const y = (v + 0.5) / scale;
    for (let u = left; u < right; u += 1) {
      const x = (u + 0.5) / scale;
      displacementAt(field, x, y, shift);
      const sx = Math.min(sourceWidth - 1, Math.max(0, (x + shift[0]! + offsetX) * sourceScale - 0.5));
      const sy = Math.min(sourceHeight - 1, Math.max(0, (y + shift[1]! + offsetY) * sourceScale - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const y1 = Math.min(sourceHeight - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let k = 0; k < 4; k += 1) {
        const qx = k & 1 ? x1 : x0;
        const qy = k >> 1 ? y1 : y0;
        const weight = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy);
        if (weight === 0) continue;
        const at = (qy * sourceWidth + qx) * 4;
        const opacity = data[at + 3]! * weight;
        red += data[at]! * opacity;
        green += data[at + 1]! * opacity;
        blue += data[at + 2]! * opacity;
        alpha += opacity;
      }
      const at = (v * width + u) * 4;
      if (alpha <= 0) {
        out[at] = 0;
        out[at + 1] = 0;
        out[at + 2] = 0;
        out[at + 3] = 0;
        continue;
      }
      out[at] = red / alpha;
      out[at + 1] = green / alpha;
      out[at + 2] = blue / alpha;
      out[at + 3] = alpha;
    }
  }
}

/** The full-size result for the region (`width` × `height`), from pixels around it starting at `area.x`, `area.y`. */
export function liquifyPixels(
  field: FieldData,
  area: SourcePixels & { x: number; y: number },
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  renderLiquify(field, area, out, width, height, { scale: 1, sourceScale: 1, offsetX: area.x, offsetY: area.y });
  return out;
}
