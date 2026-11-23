import type { TMat2D } from "fabric";
import { DEFAULT_DYNAMICS, seededRandom, stampsFor, type BrushDynamics, type BrushTip, type Stamp } from "./brushEngine";
import { DabSpacer, tipGradientStops, type StrokePoint } from "./stroke";
import type { PixelRect } from "./pixelLayer";

export interface PaintSettings {
  /** Tip diameter in layer pixels. */
  diameter: number;
  /** 0–1. */
  hardness: number;
  /** Cap on the whole stroke's coverage, 0–1. */
  opacity: number;
  /** Coverage each dab adds, 0–1. */
  flow: number;
  color: string;
  /** Remove pixels instead of painting them. */
  erase: boolean;
  /** Keep a copy of the original pixels so the stroke can be cancelled. */
  cancellable?: boolean;
  /**
   * Where the stroke may paint: a canvas the size of the surface whose alpha
   * scales the stroke (the selection, in the layer's pixels).
   */
  clip?: HTMLCanvasElement | null;
  /** Brush Settings: tip shape, jitter, scattering, transfer. */
  dynamics?: BrushDynamics;
  /** A tip from pixels instead of the round one (hardness then does not apply). */
  tip?: BrushTip | null;
  /** Symmetry: where else, in the surface's pixels, each stamp is printed. */
  mirrors?: readonly TMat2D[];
  /** The random source for jitter and scattering. */
  random?: () => number;
}

type Rect = PixelRect;

function createCanvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the brush");
  return { element, context };
}

export function hexToRgb(color: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return [0, 0, 0];
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The brush tip, drawn once per stroke in the paint colour; `width` and
 * `height` are how large it is drawn at the brush's own diameter.
 */
interface TipImage {
  element: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * The tip with its roundness already applied (squashing it per stamp would
 * lose a thin tip to the canvas's scaling); stamps only turn it.
 */
function renderTip(
  diameter: number,
  hardness: number,
  color: string,
  tip: BrushTip | null | undefined,
  roundness: number
): TipImage {
  const [r, g, b] = hexToRgb(color);
  if (tip) {
    const source = createCanvas(tip.width, tip.height);
    const pixels = source.context.createImageData(tip.width, tip.height);
    for (let index = 0; index < tip.alpha.length; index += 1) {
      pixels.data[index * 4] = r;
      pixels.data[index * 4 + 1] = g;
      pixels.data[index * 4 + 2] = b;
      pixels.data[index * 4 + 3] = tip.alpha[index]!;
    }
    source.context.putImageData(pixels, 0, 0);
    // Its longer side is the brush's diameter.
    const scale = diameter / Math.max(tip.width, tip.height);
    if (roundness >= 1) return { element: source.element, width: tip.width * scale, height: tip.height * scale };
    const squashed = createCanvas(tip.width, Math.max(1, Math.round(tip.height * roundness)));
    squashed.context.imageSmoothingQuality = "high";
    squashed.context.drawImage(source.element, 0, 0, squashed.element.width, squashed.element.height);
    source.element.width = 0;
    return { element: squashed.element, width: tip.width * scale, height: Math.max(1, tip.height * scale * roundness) };
  }
  const radius = diameter / 2;
  // Never thinner than a pixel, so a flat tip still paints a line.
  const radiusY = Math.max(0.5, radius * roundness);
  const width = Math.max(2, Math.ceil(diameter) + 2);
  const height = Math.max(2, Math.ceil(radiusY * 2) + 2);
  const { element, context } = createCanvas(width, height);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  for (const [offset, alpha] of tipGradientStops(radius, hardness)) {
    gradient.addColorStop(Math.min(1, Math.max(0, offset)), `rgba(${r}, ${g}, ${b}, ${alpha})`);
  }
  context.translate(width / 2, height / 2);
  context.scale(1, radiusY / radius);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  return { element, width, height };
}

/**
 * Paints one stroke onto a layer surface. Below full opacity the stroke
 * builds up in its own buffer and is laid over a copy of the original pixels,
 * so overlapping dabs never exceed the opacity, as in Photoshop.
 */
export class StrokePainter {
  private readonly spacer: DabSpacer;
  private readonly tip: TipImage;
  private readonly dynamics: BrushDynamics;
  private readonly random: () => number;
  private readonly target: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement | null = null;
  private readonly buffer: CanvasRenderingContext2D | null = null;
  private dirty: Rect | null = null;
  private last: StrokePoint | null = null;
  /** The stroke's dirty area cut to the clip, reused between flushes. */
  private clipped: CanvasRenderingContext2D | null = null;

  constructor(
    private readonly surface: HTMLCanvasElement,
    private readonly settings: PaintSettings
  ) {
    const context = surface.getContext("2d");
    if (!context) throw new Error("The browser could not paint on this layer");
    this.target = context;
    this.dynamics = settings.dynamics ?? DEFAULT_DYNAMICS;
    this.random = settings.random ?? seededRandom((Math.random() * 2 ** 32) >>> 0);
    this.spacer = new DabSpacer(settings.diameter, this.dynamics.spacing / 100, this.dynamics.pressureSize);
    this.tip = renderTip(settings.diameter, settings.hardness, settings.color, settings.tip, this.dynamics.roundness / 100);
    if (settings.opacity < 1 || settings.cancellable || settings.clip) {
      const base = createCanvas(surface.width, surface.height);
      base.context.drawImage(surface, 0, 0);
      this.base = base.element;
      this.buffer = createCanvas(surface.width, surface.height).context;
    }
  }

  /** The last point reached, for Shift-click straight lines. */
  get lastPoint(): StrokePoint | null {
    return this.last;
  }

  add(point: StrokePoint): void {
    this.last = point;
    const dabs = this.spacer.add(point);
    if (dabs.length === 0) return;
    const context = this.buffer ?? this.target;
    context.save();
    context.globalCompositeOperation =
      this.buffer || !this.settings.erase ? "source-over" : "destination-out";
    const mirrors = this.settings.mirrors ?? [];
    for (const dab of dabs) {
      for (const stamp of stampsFor(dab, this.settings.diameter, this.settings.flow, this.dynamics, this.random)) {
        this.print(context, stamp, null);
        for (const mirror of mirrors) this.print(context, stamp, mirror);
      }
    }
    context.restore();
  }

  /** One stamp of the tip, placed by `matrix` when it is a mirrored copy. */
  private print(context: CanvasRenderingContext2D, stamp: Stamp, matrix: TMat2D | null) {
    const scale = stamp.diameter / this.settings.diameter;
    const width = this.tip.width * scale;
    const height = this.tip.height * scale;
    if (!matrix && stamp.angle === 0) {
      // The usual round dab: no transform needed.
      context.globalAlpha = stamp.alpha;
      context.drawImage(this.tip.element, stamp.x - width / 2, stamp.y - height / 2, width, height);
      this.grow(stamp.x - width / 2, stamp.y - height / 2, stamp.x + width / 2, stamp.y + height / 2);
      return;
    }
    context.save();
    if (matrix) context.transform(...matrix);
    context.translate(stamp.x, stamp.y);
    context.rotate((-stamp.angle * Math.PI) / 180);
    context.globalAlpha = stamp.alpha;
    context.drawImage(this.tip.element, -width / 2, -height / 2, width, height);
    context.restore();
    // Whatever it was turned to, it stays within its diagonal.
    const reach = Math.hypot(width, height) / 2 + 1;
    const x = matrix ? matrix[0] * stamp.x + matrix[2] * stamp.y + matrix[4] : stamp.x;
    const y = matrix ? matrix[1] * stamp.x + matrix[3] * stamp.y + matrix[5] : stamp.y;
    const stretch = matrix ? Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3])) : 1;
    this.grow(x - reach * stretch, y - reach * stretch, x + reach * stretch, y + reach * stretch);
  }

  private grow(left: number, top: number, right: number, bottom: number) {
    const rect = {
      left: Math.max(0, Math.floor(left)),
      top: Math.max(0, Math.floor(top)),
      right: Math.min(this.surface.width, Math.ceil(right)),
      bottom: Math.min(this.surface.height, Math.ceil(bottom)),
    };
    if (rect.right <= rect.left || rect.bottom <= rect.top) return;
    this.dirty = this.dirty
      ? {
          left: Math.min(this.dirty.left, rect.left),
          top: Math.min(this.dirty.top, rect.top),
          right: Math.max(this.dirty.right, rect.right),
          bottom: Math.max(this.dirty.bottom, rect.bottom),
        }
      : rect;
  }

  /** Bring the surface up to date; the part that changed, or null for none. */
  flush(): PixelRect | null {
    const rect = this.dirty;
    if (!rect) return null;
    this.dirty = null;
    if (!this.base || !this.buffer) return rect;
    const { left, top } = rect;
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    const target = this.target;
    target.save();
    target.clearRect(left, top, width, height);
    target.drawImage(this.base, left, top, width, height, left, top, width, height);
    target.globalAlpha = this.settings.opacity;
    target.globalCompositeOperation = this.settings.erase ? "destination-out" : "source-over";
    target.drawImage(this.clippedStroke(rect) ?? this.buffer.canvas, left, top, width, height, left, top, width, height);
    target.restore();
    return rect;
  }

  /** The stroke within `rect`, faded by the clip, at the same coordinates. */
  private clippedStroke(rect: Rect): HTMLCanvasElement | null {
    const clip = this.settings.clip;
    if (!clip || !this.buffer) return null;
    if (!this.clipped) this.clipped = createCanvas(this.surface.width, this.surface.height).context;
    const context = this.clipped;
    const { left, top } = rect;
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    context.save();
    // Both operations would otherwise touch the whole canvas, every frame.
    context.beginPath();
    context.rect(left, top, width, height);
    context.clip();
    context.globalCompositeOperation = "copy";
    context.drawImage(this.buffer.canvas, left, top, width, height, left, top, width, height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(clip, left, top, width, height, left, top, width, height);
    context.restore();
    return context.canvas;
  }

  /** Put the original pixels back (only for cancellable strokes). */
  cancel(): void {
    this.dirty = null;
    if (this.base) {
      this.target.save();
      this.target.globalCompositeOperation = "copy";
      this.target.drawImage(this.base, 0, 0);
      this.target.restore();
    }
    this.release();
  }

  /** Final flush; frees the stroke's working memory. */
  /** Paint what is left and let go; returns what the last flush changed. */
  finish(): PixelRect | null {
    const painted = this.flush();
    this.release();
    return painted;
  }

  private release(): void {
    if (this.base) {
      this.base.width = 0;
      this.base.height = 0;
    }
    if (this.buffer) {
      this.buffer.canvas.width = 0;
      this.buffer.canvas.height = 0;
    }
    if (this.clipped) {
      this.clipped.canvas.width = 0;
      this.clipped.canvas.height = 0;
      this.clipped = null;
    }
  }
}
