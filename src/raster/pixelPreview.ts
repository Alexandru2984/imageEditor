import { Point, util, type Canvas as FabricCanvas, type FabricImage, type TMat2D } from "fabric";
import { isObjectLocked } from "@/utils/editorObjects";
import { clearTarget, type Refusal } from "@/selection/edits";
import { selectionClip } from "@/selection/clip";
import type { PixelSelection } from "@/selection/state";
import { sceneToLayerMatrix } from "./fill";
import { histogramOf, type Histogram } from "./adjustments";
import { currentMaskPixels, maskTargetOf } from "./layerMask";
import {
  abandonPixelEdit,
  beginPixelEdit,
  commitPixelEdit,
  editSession,
  refreshPixelLayer,
  type PixelRect,
} from "./pixelLayer";

/**
 * Adjustments and filters on a layer's pixels, as Photoshop applies them:
 * on the selected layer (or the photo), or on its mask while the mask is
 * being edited, only inside the selection when there is one. The result is
 * shown while its settings change and recorded as one step on commit.
 */

export interface AdjustTarget {
  /** The layer the document holds. */
  layer: FabricImage;
  /** The pixels that change: the layer's own, or its mask's. */
  pixels: FabricImage;
  mask: boolean;
}

/** What Image › Adjustments and the Filter menu act on. */
export function adjustTarget(canvas: FabricCanvas): AdjustTarget | Refusal {
  const masked = maskTargetOf(canvas).layer();
  if (masked) {
    if (isObjectLocked(masked)) return "Unlock the layer first";
    const pixels = currentMaskPixels(masked);
    return pixels ? { layer: masked, pixels, mask: true } : "The layer mask is still loading";
  }
  const target = clearTarget(canvas);
  if (typeof target === "string") return target;
  return { layer: target.layer, pixels: target.layer, mask: false };
}

/** Compute a result from the original pixels (RGBA, row by row). */
export type PixelProcess = (source: Uint8ClampedArray, target: Uint8ClampedArray, width: number, height: number) => void;

/** The part of a layer's surface a selection reaches, or null when it misses it. */
function selectionRegion(layer: FabricImage, selection: PixelSelection, width: number, height: number): PixelRect | null {
  const box = selection.mask.bounds();
  if (!box) return null;
  const { grid } = selection;
  const gridToScene: TMat2D = [1 / grid.scale, 0, 0, 1 / grid.scale, grid.left, grid.top];
  const matrix = util.multiplyTransformMatrices(sceneToLayerMatrix(layer), gridToScene);
  const corners = [
    new Point(box.x, box.y),
    new Point(box.x + box.width, box.y),
    new Point(box.x, box.y + box.height),
    new Point(box.x + box.width, box.y + box.height),
  ].map((corner) => util.transformPoint(corner, matrix));
  // A pixel of room for the clip's smoothing.
  const left = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x))) - 1);
  const top = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y))) - 1);
  const right = Math.min(width, Math.ceil(Math.max(...corners.map((point) => point.x))) + 1);
  const bottom = Math.min(height, Math.ceil(Math.max(...corners.map((point) => point.y))) + 1);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

export class PixelPreview {
  private closed = false;
  /** Whether the layer shows a result rather than its own pixels. */
  private changed = false;
  private readonly buffer: ImageData;
  private histogramCache: Histogram | null = null;

  private constructor(
    private readonly canvas: FabricCanvas,
    readonly target: AdjustTarget,
    private readonly context: CanvasRenderingContext2D,
    /** Where on the surface the pixels change. */
    readonly region: PixelRect,
    /** The pixels there before. */
    readonly original: ImageData,
    /** How much of each pixel is selected (0–255), or null for all of it. */
    readonly weights: Uint8Array | null,
    /** The edit was started for this; abandoning it restores the layer. */
    private readonly fresh: boolean
  ) {
    this.buffer = new ImageData(original.width, original.height);
  }

  static open(canvas: FabricCanvas, target: AdjustTarget, selection: PixelSelection | null): PixelPreview | Refusal {
    const { pixels } = target;
    const fresh = !editSession(pixels);
    const { surface, context } = beginPixelEdit(pixels);
    let region: PixelRect = { left: 0, top: 0, right: surface.width, bottom: surface.height };
    let weights: Uint8Array | null = null;
    if (selection) {
      const reached = selectionRegion(pixels, selection, surface.width, surface.height);
      if (!reached) {
        if (fresh) abandonPixelEdit(canvas, pixels);
        return "The selection is outside this layer";
      }
      region = reached;
      const clip = selectionClip(pixels, selection, surface.width, surface.height);
      const alpha = clip
        .getContext("2d")!
        .getImageData(region.left, region.top, region.right - region.left, region.bottom - region.top).data;
      weights = new Uint8Array(alpha.length / 4);
      for (let index = 0; index < weights.length; index += 1) weights[index] = alpha[index * 4 + 3]!;
    }
    const original = context.getImageData(region.left, region.top, region.right - region.left, region.bottom - region.top);
    return new PixelPreview(canvas, target, context, region, original, weights, fresh);
  }

  get width(): number {
    return this.original.width;
  }

  get height(): number {
    return this.original.height;
  }

  /** The colours of the pixels the change applies to. */
  histogram(): Histogram {
    this.histogramCache ??= histogramOf(this.original.data, this.weights);
    return this.histogramCache;
  }

  /** Show `process`'s result on the layer, or (with null) its own pixels. */
  show(process: PixelProcess | null): void {
    if (this.closed) return;
    const source = this.original.data;
    const result = this.buffer.data;
    if (!process) {
      result.set(source);
    } else {
      process(source, result, this.width, this.height);
      const weights = this.weights;
      if (weights) {
        // Partly selected pixels change partly.
        for (let index = 0, offset = 0; index < weights.length; index += 1, offset += 4) {
          const weight = weights[index]!;
          if (weight === 255) continue;
          if (weight === 0) {
            result[offset] = source[offset]!;
            result[offset + 1] = source[offset + 1]!;
            result[offset + 2] = source[offset + 2]!;
            result[offset + 3] = source[offset + 3]!;
            continue;
          }
          for (let channel = 0; channel < 4; channel += 1) {
            const before = source[offset + channel]!;
            result[offset + channel] = before + ((result[offset + channel]! - before) * weight) / 255;
          }
        }
      }
    }
    this.context.putImageData(this.buffer, this.region.left, this.region.top);
    this.changed = process !== null;
    refreshPixelLayer(this.target.pixels, this.canvas, this.region);
  }

  /** Record the result shown as one step. Resolves false when nothing was recorded. */
  async commit(): Promise<boolean> {
    if (this.closed) return false;
    this.closed = true;
    if (!this.changed) {
      this.restore();
      return false;
    }
    return commitPixelEdit(this.canvas, this.target.pixels);
  }

  /** Put the layer back as it was. */
  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    this.restore();
  }

  private restore() {
    this.context.putImageData(this.original, this.region.left, this.region.top);
    if (this.fresh) abandonPixelEdit(this.canvas, this.target.pixels);
    else refreshPixelLayer(this.target.pixels, this.canvas, this.region);
  }
}
