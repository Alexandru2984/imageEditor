import { DocumentLayer } from "./documentLayer";
import { readFill, type FillContent } from "./fillData";

export * from "./fillData";

/**
 * Photoshop's fill layers: a solid colour or a gradient over the whole
 * document, shown through the layer's mask, opacity and blend mode. The
 * compositor draws it.
 */

const FALLBACK: FillContent = { kind: "solid", color: "#000000" };

export class FillLayer extends DocumentLayer {
  static type = "FillLayer";

  /**
   * Draws a fill layer's content over the document, through its mask, onto
   * a context set up for the scene (src/compositing/fillPaint.ts).
   */
  static painter: ((ctx: CanvasRenderingContext2D, layer: FillLayer) => void) | null = null;

  declare fillContent: FillContent;
  /** Photoshop's Fill: the content's own opacity. */
  declare __fill?: number;

  constructor(options?: Record<string, unknown>) {
    super(options);
    this.fillContent = readFill(this.fillContent) ?? FALLBACK;
  }

  /** As any layer draws: with its opacity and blend mode, wherever the stack puts it. */
  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible || !(this.opacity > 0)) return;
    const fill = typeof this.__fill === "number" && Number.isFinite(this.__fill) ? Math.min(1, Math.max(0, this.__fill)) : 1;
    if (fill <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = this.globalCompositeOperation ?? "source-over";
    ctx.globalAlpha *= this.opacity * fill;
    try {
      FillLayer.painter?.(ctx, this);
    } finally {
      ctx.restore();
    }
  }

  toObject(propertiesToInclude: string[] = []) {
    return super.toObject([...propertiesToInclude, "fillContent"] as never[]);
  }
}

export const isFillLayer = (object: unknown): object is FillLayer => object instanceof FillLayer;
