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

export type RetouchStroke = CloneStroke;

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
        this.clonePixel(x, y, index, weight);
      }
    }
  }

  private clonePixel(x: number, y: number, index: number, weight: number) {
    const stroke = this.settings.stroke;
    const { width, height, data } = this.pixels;
    // Build up coverage as the brush does: dabs add flow, never past full.
    const covered = this.coverage[index]! / COVERAGE_MAX;
    const coverage = covered + weight * stroke.flow * (1 - covered);
    this.coverage[index] = Math.round(coverage * COVERAGE_MAX);
    const sourceX = x + stroke.offset.x;
    const sourceY = y + stroke.offset.y;
    // Nothing to copy from outside the layer.
    if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) return;
    const at = index * 4;
    mixInto(data, at, this.original, at, stroke.sample ?? this.original, (sourceY * width + sourceX) * 4, coverage * stroke.opacity);
  }
}
