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

/** Which tones dodging and burning work on most. */
export type ToneRange = "shadows" | "midtones" | "highlights";

/** Dodge (lighten) or burn (darken), as a darkroom printer would. */
export interface ToneStroke {
  kind: "tone";
  mode: "dodge" | "burn";
  range: ToneRange;
  /** Strength, 0–1. */
  exposure: number;
  /** Change brightness alone, keeping hues and saturation. */
  protectTones: boolean;
}

/** Sponge: more or less colour. */
export interface SpongeStroke {
  kind: "sponge";
  mode: "saturate" | "desaturate";
  /** Strength, 0–1. */
  flow: number;
}

export type RetouchStroke = CloneStroke | HealStroke | SpotStroke | ToneStroke | SpongeStroke;

/**
 * What a full dodge or burn does to a level (0–1) at an exposure (0–1): each
 * range changes its own tones most and leaves black and white (mostly) be.
 */
export function toneCurve(mode: "dodge" | "burn", range: ToneRange, exposure: number): (value: number) => number {
  const e = exposure;
  if (mode === "dodge") {
    if (range === "shadows") return (v) => v + e * 0.5 * (1 - v) * (1 - v);
    if (range === "highlights") return (v) => Math.min(1, v * (1 + e * v));
    return (v) => Math.pow(v, 1 / (1 + e));
  }
  if (range === "shadows") return (v) => v * (1 - e * (1 - v));
  if (range === "highlights") return (v) => v * (1 - 0.5 * e * v);
  return (v) => Math.pow(v, 1 + e);
}

/** How much of the full effect each dab of a toning stroke adds. */
const TONE_DAB_SHARE = 0.5;

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

  /** A toning stroke's full effect on each level. */
  private readonly toneTable: Float32Array | null = null;

  constructor(
    private readonly pixels: Pixels,
    private readonly settings: RetouchSettings
  ) {
    this.original = pixels.data.slice();
    this.coverage = new Uint16Array(pixels.width * pixels.height);
    this.spacer = new DabSpacer(settings.diameter);
    const stroke = settings.stroke;
    if (stroke.kind === "tone") {
      const curve = toneCurve(stroke.mode, stroke.range, stroke.exposure);
      this.toneTable = new Float32Array(256);
      for (let level = 0; level < 256; level += 1) this.toneTable[level] = curve(level / 255) * 255;
    }
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
        switch (this.settings.stroke.kind) {
          case "spot":
            this.markSpot(index, weight);
            break;
          case "tone":
            this.tonePixel(index, weight);
            break;
          case "sponge":
            this.spongePixel(index, weight);
            break;
          default:
            this.clonePixel(x, y, index, weight);
        }
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

  /**
   * Dodge and burn: the stroke moves each pixel from how it was towards the
   * curve's result, as far as it has covered it.
   */
  private tonePixel(index: number, weight: number) {
    const stroke = this.settings.stroke as ToneStroke;
    const table = this.toneTable!;
    const amount = this.cover(index, weight, TONE_DAB_SHARE);
    const at = index * 4;
    const { data } = this.pixels;
    const original = this.original;
    if (stroke.protectTones) {
      // Shift every channel by the change in brightness: hues stay put.
      const red = original[at]!;
      const green = original[at + 1]!;
      const blue = original[at + 2]!;
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
      const level = Math.min(255, Math.round(luma));
      const shift = (table[level]! - luma) * amount;
      data[at] = red + shift;
      data[at + 1] = green + shift;
      data[at + 2] = blue + shift;
      return;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const before = original[at + channel]!;
      data[at + channel] = before + (table[before]! - before) * amount;
    }
  }

  /** Sponge: push each colour away from (or towards) its grey. */
  private spongePixel(index: number, weight: number) {
    const stroke = this.settings.stroke as SpongeStroke;
    const amount = this.cover(index, weight, TONE_DAB_SHARE) * stroke.flow;
    const factor = stroke.mode === "saturate" ? 1 + amount : 1 - amount;
    const at = index * 4;
    const original = this.original;
    const red = original[at]!;
    const green = original[at + 1]!;
    const blue = original[at + 2]!;
    const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
    const { data } = this.pixels;
    data[at] = luma + (red - luma) * factor;
    data[at + 1] = luma + (green - luma) * factor;
    data[at + 2] = luma + (blue - luma) * factor;
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
