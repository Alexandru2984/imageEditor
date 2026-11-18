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

/** The brush tip, drawn once per stroke at full size and scaled per dab. */
function renderTip(diameter: number, hardness: number, color: string) {
  const size = Math.max(2, Math.ceil(diameter) + 2);
  const { element, context } = createCanvas(size, size);
  const radius = diameter / 2;
  const [r, g, b] = hexToRgb(color);
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, radius);
  for (const [offset, alpha] of tipGradientStops(radius, hardness)) {
    gradient.addColorStop(Math.min(1, Math.max(0, offset)), `rgba(${r}, ${g}, ${b}, ${alpha})`);
  }
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  context.fill();
  return { element, size };
}

/**
 * Paints one stroke onto a layer surface. Below full opacity the stroke
 * builds up in its own buffer and is laid over a copy of the original pixels,
 * so overlapping dabs never exceed the opacity, as in Photoshop.
 */
export class StrokePainter {
  private readonly spacer: DabSpacer;
  private readonly tip: { element: HTMLCanvasElement; size: number };
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
    this.spacer = new DabSpacer(settings.diameter);
    this.tip = renderTip(settings.diameter, settings.hardness, settings.color);
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
    context.globalAlpha = this.settings.flow;
    context.globalCompositeOperation =
      this.buffer || !this.settings.erase ? "source-over" : "destination-out";
    for (const dab of dabs) {
      const scale = dab.diameter / this.settings.diameter;
      const size = this.tip.size * scale;
      const left = dab.x - size / 2;
      const top = dab.y - size / 2;
      context.drawImage(this.tip.element, left, top, size, size);
      this.grow(left, top, left + size, top + size);
    }
    context.restore();
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
