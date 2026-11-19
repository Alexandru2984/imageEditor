import { membraneFill } from "./heal";
import { DabSpacer, tipAlpha, type Dab, type StrokePoint } from "./stroke";
import type { PixelRect } from "./pixelLayer";

/** RGBA pixels, row by row. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Copies pixels from elsewhere on the layer (or the document) as it paints. */
export interface CloneStroke {
  kind: "clone";
  /** Cap on the stroke's coverage, 0–1. */
  opacity: number;
  /** Coverage each dab adds, 0–1. */
  flow: number;
  /** Where the copied pixels come from, relative to where they land (whole pixels). */
  offset: { x: number; y: number };
  /** The pixels copied from, the layer's size; by default the layer as the stroke began. */
  sample?: Uint8ClampedArray | null;
}

/**
 * Healing brush: copies like the clone stamp, then on release blends the
 * copy into its surroundings, keeping its texture but their colour and light.
 */
export interface HealStroke {
  kind: "heal";
  offset: { x: number; y: number };
  sample?: Uint8ClampedArray | null;
}

/** Spot healing: marks what to rebuild; the rebuilding happens on release. */
export interface SpotStroke {
  kind: "spot";
}

export type RetouchStroke = CloneStroke | HealStroke | SpotStroke;

/** The part of a spot-healing stroke to rebuild, and what surrounds it. */
export interface SpotRequest {
  rect: PixelRect;
  /** The layer's pixels there as the stroke began (rect-sized RGBA). */
  pixels: Uint8ClampedArray;
  /** 1 where the stroke went. */
  hole: Uint8Array;
}

/** The colour a spot-healing stroke is shown in until it is rebuilt. */
const SPOT_TINT = 60;

export interface RetouchSettings {
  /** Tip diameter in layer pixels. */
  diameter: number;
  /** 0–1. */
  hardness: number;
  /** How much of each pixel may change (0–255, the layer's size), from the selection. */
  clip?: Uint8Array | null;
  stroke: RetouchStroke;
}

const COVERAGE_MAX = 65535;

/**
 * Blend from one straight-alpha colour to another by `t`, in premultiplied
 * colour so transparent pixels never darken the result.
 */
function mixInto(
  target: Uint8ClampedArray,
  at: number,
  from: Uint8ClampedArray,
  fromAt: number,
  to: Uint8ClampedArray,
  toAt: number,
  t: number
) {
  const fromAlpha = from[fromAt + 3]!;
  const toAlpha = to[toAt + 3]!;
  const alpha = fromAlpha + (toAlpha - fromAlpha) * t;
  if (alpha <= 0) {
    target[at] = 0;
    target[at + 1] = 0;
    target[at + 2] = 0;
    target[at + 3] = 0;
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const a = from[fromAt + channel]! * fromAlpha;
    const b = to[toAt + channel]! * toAlpha;
    target[at + channel] = (a + (b - a) * t) / alpha;
  }
  target[at + 3] = alpha;
}

/**
 * The retouching tools' strokes, worked out on a layer's pixels in memory:
 * each dab reads and writes them directly, as Photoshop's clone and healing
 * tools do. The pixels are changed in place; {@link takeChanged} says where.
 */
export class RetouchPainter {
  private readonly spacer: DabSpacer;
  /** The layer as the stroke began. */
  readonly original: Uint8ClampedArray;
  /** How much of each pixel the stroke has covered (0–65535), for strokes that blend. */
  private readonly coverage: Uint16Array;
  private changed: PixelRect | null = null;
  /** Everything the stroke has touched. */
  private touched: PixelRect | null = null;
  private last: StrokePoint | null = null;

  constructor(
    private readonly pixels: Pixels,
    private readonly settings: RetouchSettings
  ) {
    this.original = pixels.data.slice();
    this.coverage = new Uint16Array(pixels.width * pixels.height);
    this.spacer = new DabSpacer(settings.diameter);
  }

  /** The last point reached, for Shift-click straight lines. */
  get lastPoint(): StrokePoint | null {
    return this.last;
  }

  /** Everything the stroke has changed so far. */
  get area(): PixelRect | null {
    return this.touched;
  }

  add(point: StrokePoint): void {
    this.last = point;
    for (const dab of this.spacer.add(point)) this.dab(dab);
  }

  /** Where the pixels changed since the last call, or null. */
  takeChanged(): PixelRect | null {
    const changed = this.changed;
    this.changed = null;
    return changed;
  }

  /** Put the layer back as it was. */
  cancel(): void {
    this.pixels.data.set(this.original);
    this.changed = this.touched;
  }

  private grow(rect: PixelRect) {
    const union = (current: PixelRect | null): PixelRect =>
      current
        ? {
            left: Math.min(current.left, rect.left),
            top: Math.min(current.top, rect.top),
            right: Math.max(current.right, rect.right),
            bottom: Math.max(current.bottom, rect.bottom),
          }
        : { ...rect };
    this.changed = union(this.changed);
    this.touched = union(this.touched);
  }

  private dab(dab: Dab) {
    const { width, height } = this.pixels;
    const radius = dab.diameter / 2;
    const rect = {
      left: Math.max(0, Math.floor(dab.x - radius)),
      top: Math.max(0, Math.floor(dab.y - radius)),
      right: Math.min(width, Math.ceil(dab.x + radius)),
      bottom: Math.min(height, Math.ceil(dab.y + radius)),
    };
    if (rect.right <= rect.left || rect.bottom <= rect.top) return;
    this.grow(rect);
    const { hardness, clip } = this.settings;
    for (let y = rect.top; y < rect.bottom; y += 1) {
      const dy = y + 0.5 - dab.y;
      for (let x = rect.left; x < rect.right; x += 1) {
        const dx = x + 0.5 - dab.x;
        let weight = tipAlpha(Math.sqrt(dx * dx + dy * dy), radius, hardness);
        if (weight <= 0) continue;
        const index = y * width + x;
        if (clip) {
          weight *= clip[index]! / 255;
          if (weight <= 0) continue;
        }
        if (this.settings.stroke.kind === "spot") this.markSpot(index, weight);
        else this.clonePixel(x, y, index, weight);
      }
    }
  }

  /** Build up coverage as the brush does: dabs add flow, never past full. */
  private cover(index: number, weight: number, flow: number): number {
    const covered = this.coverage[index]! / COVERAGE_MAX;
    const coverage = covered + weight * flow * (1 - covered);
    this.coverage[index] = Math.round(coverage * COVERAGE_MAX);
    return coverage;
  }

  private markSpot(index: number, weight: number) {
    const shade = this.cover(index, weight, 1) * 0.5;
    const at = index * 4;
    const { data } = this.pixels;
    for (let channel = 0; channel < 3; channel += 1) {
      const before = this.original[at + channel]!;
      data[at + channel] = before + (SPOT_TINT - before) * shade;
    }
  }

  private clonePixel(x: number, y: number, index: number, weight: number) {
    const stroke = this.settings.stroke as CloneStroke | HealStroke;
    const { width, height, data } = this.pixels;
    const clone = stroke.kind === "clone";
    const coverage = this.cover(index, weight, clone ? stroke.flow : 1);
    const sourceX = x + stroke.offset.x;
    const sourceY = y + stroke.offset.y;
    // Nothing to copy from outside the layer.
    if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) return;
    const at = index * 4;
    mixInto(
      data,
      at,
      this.original,
      at,
      stroke.sample ?? this.original,
      (sourceY * width + sourceX) * 4,
      clone ? coverage * stroke.opacity : coverage
    );
  }

  /**
   * Healing brush, on release: the difference between the layer and the
   * copied pixels is known around the stroke; spread smoothly over it and
   * added to the copy, the copy takes on the light and colour around it.
   */
  heal(): void {
    const stroke = this.settings.stroke;
    const area = this.touched;
    if (stroke.kind !== "heal" || !area) return;
    const { width, height, data } = this.pixels;
    const sample = stroke.sample ?? this.original;
    const left = Math.max(0, area.left - 1);
    const top = Math.max(0, area.top - 1);
    const right = Math.min(width, area.right + 1);
    const bottom = Math.min(height, area.bottom + 1);
    const regionWidth = right - left;
    const regionHeight = bottom - top;
    const difference = new Float32Array(regionWidth * regionHeight * 4);
    const known = new Uint8Array(regionWidth * regionHeight);
    const sourceOf = (x: number, y: number) => {
      const sx = x + stroke.offset.x;
      const sy = y + stroke.offset.y;
      return sx < 0 || sy < 0 || sx >= width || sy >= height ? -1 : (sy * width + sx) * 4;
    };
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = y * width + x;
        if (this.coverage[index]! > 0) continue;
        const source = sourceOf(x, y);
        if (source < 0) continue;
        const local = (y - top) * regionWidth + (x - left);
        known[local] = 1;
        for (let channel = 0; channel < 4; channel += 1) {
          difference[local * 4 + channel] = this.original[index * 4 + channel]! - sample[source + channel]!;
        }
      }
    }
    if (!membraneFill(difference, known, regionWidth, regionHeight, 4)) return;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = y * width + x;
        const coverage = this.coverage[index]! / COVERAGE_MAX;
        const source = sourceOf(x, y);
        if (coverage <= 0 || source < 0) continue;
        const local = (y - top) * regionWidth + (x - left);
        const at = index * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const healed = sample[source + channel]! + difference[local * 4 + channel]!;
          const before = this.original[at + channel]!;
          data[at + channel] = before + (Math.min(255, Math.max(0, healed)) - before) * coverage;
        }
      }
    }
    this.grow({ left, top, right, bottom });
  }

  /**
   * Spot healing, on release: the stroke's area and `margin` pixels around
   * it, to rebuild the stroke from (see {@link applySpot}).
   */
  spotRequest(margin: number): SpotRequest | null {
    const area = this.touched;
    if (this.settings.stroke.kind !== "spot" || !area) return null;
    const { width, height } = this.pixels;
    const rect = {
      left: Math.max(0, area.left - margin),
      top: Math.max(0, area.top - margin),
      right: Math.min(width, area.right + margin),
      bottom: Math.min(height, area.bottom + margin),
    };
    const regionWidth = rect.right - rect.left;
    const regionHeight = rect.bottom - rect.top;
    const pixels = new Uint8ClampedArray(regionWidth * regionHeight * 4);
    const hole = new Uint8Array(regionWidth * regionHeight);
    for (let y = rect.top; y < rect.bottom; y += 1) {
      const row = (y - rect.top) * regionWidth;
      pixels.set(this.original.subarray((y * width + rect.left) * 4, (y * width + rect.right) * 4), row * 4);
      for (let x = rect.left; x < rect.right; x += 1) {
        if (this.coverage[y * width + x]! > 0) hole[row + x - rect.left] = 1;
      }
    }
    return { rect, pixels, hole };
  }

  /** Spot healing: lay the rebuilt pixels in, faded where the brush was soft. */
  applySpot(rect: PixelRect, rebuilt: Uint8ClampedArray): void {
    const { width, data } = this.pixels;
    const regionWidth = rect.right - rect.left;
    for (let y = rect.top; y < rect.bottom; y += 1) {
      for (let x = rect.left; x < rect.right; x += 1) {
        const index = y * width + x;
        const coverage = this.coverage[index]! / COVERAGE_MAX;
        if (coverage <= 0) continue;
        const at = index * 4;
        const from = ((y - rect.top) * regionWidth + (x - rect.left)) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const before = this.original[at + channel]!;
          data[at + channel] = before + (rebuilt[from + channel]! - before) * coverage;
        }
      }
    }
    this.grow(rect);
  }
}
