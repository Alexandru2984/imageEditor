import {
  applyLuts,
  blackWhite,
  colorBalance,
  desaturate,
  gradientMap,
  hueSaturation,
  threshold,
  type BlackWhiteSettings,
  type ColorBalanceSettings,
  type HueSaturationSettings,
  type Luts,
} from "./adjustments";
import { warpPixels, type Homography } from "./warp";
import {
  addNoise,
  cropInto,
  emboss,
  findEdges,
  gaussianBlur,
  highPass,
  mosaic,
  unsharpMask,
  type Area,
  type EmbossSettings,
  type NoiseSettings,
  type UnsharpSettings,
} from "./filters";
import { inpaint } from "./inpaint";
import { liquifyPixels } from "./liquify";
import { contentAwareMovePixels, patchPixels } from "./patch";
import { fixRedEye } from "./redEye";
import { motionBlur } from "./motionBlur";

/**
 * An adjustment or filter as plain data, so it can run in a worker as well
 * as on the page.
 */
export type PixelJob =
  | { op: "luts"; luts: Luts }
  | { op: "threshold"; level: number }
  | { op: "desaturate" }
  | { op: "gradientMap"; luts: Luts }
  | { op: "blackWhite"; settings: BlackWhiteSettings }
  | { op: "hueSaturation"; settings: HueSaturationSettings }
  | { op: "colorBalance"; settings: ColorBalanceSettings }
  | { op: "gaussianBlur"; radius: number }
  | { op: "motionBlur"; angle: number; distance: number }
  | { op: "unsharpMask"; settings: UnsharpSettings }
  | { op: "highPass"; radius: number }
  | { op: "addNoise"; settings: NoiseSettings }
  | { op: "mosaic"; size: number }
  | { op: "emboss"; settings: EmbossSettings }
  | { op: "findEdges" }
  /**
   * Content-aware fill of `hole` (non-zero where to fill, the region's size)
   * from up to `reach` pixels around it.
   */
  | { op: "inpaint"; hole: Uint8Array; reach: number; seed?: number }
  /**
   * Perspective/distort: the result (`width`×`height`, its own size) shows the
   * area's pixels through `inverse`, which takes result pixels to area pixels.
   */
  | { op: "warp"; inverse: Homography }
  /**
   * Liquify: each pixel of the region shows the area at its place plus the
   * displacement there, from a field of `columns` × `rows` nodes `cell`
   * pixels apart (dx, dy each); `reach` is the longest displacement.
   */
  | { op: "liquify"; field: Float32Array; columns: number; rows: number; cell: number; reach: number }
  /** Patch: where `covered` (the region's size) is set, the pixels `source` away, healed in. */
  | { op: "patch"; covered: Uint8Array; sourceX: number; sourceY: number; reach: number }
  /**
   * Content-Aware Move: what `moved` covers goes `offset` away, healed in;
   * unless `extend`, where it was is filled in from around it.
   */
  | { op: "contentAwareMove"; moved: Uint8Array; offsetX: number; offsetY: number; extend: boolean; reach: number; seed?: number }
  /** Red Eye: the red pupil nearest the region's middle made grey and dark. */
  | { op: "redEye"; pupilSize: number; darken: number };

/** How many pixels around each one a job looks at. */
export function jobReach(job: PixelJob): number {
  switch (job.op) {
    case "gaussianBlur":
    case "highPass":
      return job.radius * 3 + 2;
    case "unsharpMask":
      return job.settings.radius * 3 + 2;
    case "motionBlur":
      return job.distance / 2 + 2;
    case "mosaic":
      return job.size;
    case "emboss":
      return job.settings.height + 1;
    case "findEdges":
      return 1;
    case "inpaint":
    case "liquify":
    case "patch":
    case "contentAwareMove":
      return job.reach;
    default:
      return 0;
  }
}

/** Pixels around a region, which starts at `x`, `y` in them. */
export interface JobArea extends Area {
  x: number;
  y: number;
}

/**
 * Run a job on the pixels around a region (`width` × `height`); the result
 * covers the region only. `origin` is where the area starts on the layer.
 */
export function runJob(job: PixelJob, area: JobArea, width: number, height: number, origin: { x: number; y: number }): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const filtered = (full: Uint8ClampedArray) => {
    cropInto(full, area, area.x, area.y, out, width, height);
    return out;
  };
  switch (job.op) {
    case "gaussianBlur":
      return filtered(gaussianBlur(area, job.radius));
    case "motionBlur":
      return filtered(motionBlur(area, job.angle, job.distance));
    case "unsharpMask":
      return filtered(unsharpMask(area, job.settings));
    case "highPass":
      return filtered(highPass(area, job.radius));
    case "addNoise":
      return filtered(addNoise(area, job.settings));
    case "mosaic":
      return filtered(mosaic(area, job.size, origin));
    case "emboss":
      return filtered(emboss(area, job.settings));
    case "findEdges":
      return filtered(findEdges(area));
    case "inpaint": {
      // The hole covers the region; the rest of the area is what fills it.
      const hole = new Uint8Array(area.width * area.height);
      for (let y = 0; y < height; y += 1) {
        hole.set(job.hole.subarray(y * width, (y + 1) * width), (area.y + y) * area.width + area.x);
      }
      return filtered(inpaint(area.data, area.width, area.height, hole, job.seed));
    }
    case "warp":
      return warpPixels(area, job.inverse, width, height);
    case "liquify":
      return liquifyPixels({ data: job.field, columns: job.columns, rows: job.rows, cell: job.cell }, area, width, height);
    case "patch":
      return patchPixels(area, width, height, job.covered, { x: job.sourceX, y: job.sourceY });
    case "contentAwareMove":
      return contentAwareMovePixels(area, width, height, job.moved, { x: job.offsetX, y: job.offsetY }, job.extend, job.seed);
  }
  // Pixel by pixel: only the region itself.
  let source = area.data;
  if (area.width !== width || area.height !== height) {
    source = new Uint8ClampedArray(width * height * 4);
    cropInto(area.data, area, area.x, area.y, source, width, height);
  }
  switch (job.op) {
    case "luts":
      applyLuts(source, out, job.luts);
      break;
    case "threshold":
      threshold(source, out, job.level);
      break;
    case "desaturate":
      desaturate(source, out);
      break;
    case "gradientMap":
      gradientMap(source, out, job.luts);
      break;
    case "blackWhite":
      blackWhite(source, out, job.settings);
      break;
    case "hueSaturation":
      hueSaturation(source, out, job.settings);
      break;
    case "colorBalance":
      colorBalance(source, out, job.settings);
      break;
    case "redEye":
      out.set(fixRedEye(source, width, height, job) ?? source);
      break;
  }
  return out;
}
