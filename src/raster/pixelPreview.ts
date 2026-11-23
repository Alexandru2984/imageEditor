import { Point, util, type Canvas as FabricCanvas, type FabricImage, type TMat2D } from "fabric";
import { isObjectLocked } from "@/utils/editorObjects";
import { clearTarget, type Refusal } from "@/selection/edits";
import { selectionClip } from "@/selection/clip";
import type { PixelSelection } from "@/selection/state";
import { sceneToLayerMatrix } from "./fill";
import { histogramOf, type Histogram } from "./adjustments";
import { jobReach, type PixelJob } from "./pixelJobs";
import { runPixelJob } from "./pixelJobClient";
import { currentMaskPixels, editedMaskLayer, type MaskableLayer } from "./layerMask";
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
  layer: MaskableLayer;
  /** The pixels that change: the layer's own, or its mask's. */
  pixels: FabricImage;
  mask: boolean;
}

/** What Image › Adjustments and the Filter menu act on. */
export function adjustTarget(canvas: FabricCanvas): AdjustTarget | Refusal {
  // An adjustment layer picked alone: its mask (a white one to make, without).
  const masked = editedMaskLayer(canvas);
  if (masked) {
    if (isObjectLocked(masked)) return "Unlock the layer first";
    const pixels = currentMaskPixels(masked);
    return pixels ? { layer: masked, pixels, mask: true } : "The layer mask is still loading";
  }
  const target = clearTarget(canvas);
  if (typeof target === "string") return target;
  return { layer: target.layer, pixels: target.layer, mask: false };
}

/** Pixels around a preview's region; the region starts at `x`, `y` in them. */
export interface SurroundingPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  x: number;
  y: number;
}


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
  private aroundCache: { reach: number; area: SurroundingPixels } | null = null;

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
    private readonly fresh: boolean,
    private readonly surfaceSize: { width: number; height: number }
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
    return new PixelPreview(canvas, target, context, region, original, weights, fresh, {
      width: surface.width,
      height: surface.height,
    });
  }

  get width(): number {
    return this.original.width;
  }

  get height(): number {
    return this.original.height;
  }

  /**
   * The original pixels of the region and `reach` pixels around it (as far
   * as the layer goes), for filters that look at neighbours: a blur inside a
   * selection draws on what lies outside it too.
   */
  around(reach: number): SurroundingPixels {
    const margin = Math.max(0, Math.ceil(reach));
    if (this.aroundCache && this.aroundCache.reach === margin) return this.aroundCache.area;
    const { region, original } = this;
    const left = Math.max(0, region.left - margin);
    const top = Math.max(0, region.top - margin);
    const right = Math.min(this.surfaceSize.width, region.right + margin);
    const bottom = Math.min(this.surfaceSize.height, region.bottom + margin);
    const width = right - left;
    const height = bottom - top;
    // Outside the region the surface is untouched; inside it may show a
    // preview, so the original goes back over it.
    const data =
      width === original.width && height === original.height
        ? original.data.slice()
        : this.context.getImageData(left, top, width, height).data;
    const x = region.left - left;
    const y = region.top - top;
    if (data.length !== original.data.length) {
      for (let row = 0; row < original.height; row += 1) {
        const from = row * original.width * 4;
        data.set(original.data.subarray(from, from + original.width * 4), ((y + row) * width + x) * 4);
      }
    }
    const area = { data, width, height, x, y };
    this.aroundCache = { reach: margin, area };
    return area;
  }

  /** How much of each region pixel another selection takes (0–255), on the same surface. */
  coverage(selection: PixelSelection): Uint8Array {
    const { region } = this;
    const width = region.right - region.left;
    const height = region.bottom - region.top;
    const clip = selectionClip(this.target.pixels, selection, this.surfaceSize.width, this.surfaceSize.height);
    const alpha = clip.getContext("2d")!.getImageData(region.left, region.top, width, height).data;
    const out = new Uint8Array(width * height);
    for (let index = 0; index < out.length; index += 1) out[index] = alpha[index * 4 + 3]!;
    return out;
  }

  /** The colours of the pixels the change applies to. */
  histogram(): Histogram {
    this.histogramCache ??= histogramOf(this.original.data, this.weights);
    return this.histogramCache;
  }

  /** Work out a job's result for the region, in a worker where possible. */
  compute(job: PixelJob): Promise<Uint8ClampedArray> {
    const area = this.around(jobReach(job));
    return runPixelJob(job, area, this.width, this.height, {
      x: this.region.left - area.x,
      y: this.region.top - area.y,
    });
  }

  /** Show a result (the region's size) on the layer, or with null its own pixels. */
  present(result: Uint8ClampedArray | null): void {
    if (this.closed) return;
    const source = this.original.data;
    const shown = this.buffer.data;
    if (!result) {
      shown.set(source);
    } else {
      shown.set(result);
      const weights = this.weights;
      if (weights) {
        // Partly selected pixels change partly.
        for (let index = 0, offset = 0; index < weights.length; index += 1, offset += 4) {
          const weight = weights[index]!;
          if (weight === 255) continue;
          for (let channel = 0; channel < 4; channel += 1) {
            const before = source[offset + channel]!;
            shown[offset + channel] = weight === 0 ? before : before + ((shown[offset + channel]! - before) * weight) / 255;
          }
        }
      }
    }
    this.context.putImageData(this.buffer, this.region.left, this.region.top);
    this.changed = result !== null;
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
