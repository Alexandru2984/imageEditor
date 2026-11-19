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
  | { op: "inpaint"; hole: Uint8Array; reach: number; seed?: number };

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
  }
  return out;
}
