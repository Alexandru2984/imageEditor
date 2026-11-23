/**
 * Select and Mask's refinement of a selection's edge, as plain data so it
 * runs in a worker as well as on the page. Within `radius` of the edge (and
 * wherever the Refine Edge brush went) the selection follows the picture's
 * own edges, by a colour guided filter (He, Sun and Tang): each small
 * window explains the selection as a linear function of the colours there,
 * so hair and fur against a plain background come out soft where they
 * should. Then Smooth, Feather, Contrast and Shift Edge, as in Photoshop.
 */

export interface RefineSettings {
  /** Pixels either side of the edge that follow the picture (0–250). */
  radius: number;
  /** 0–100: rounds a jagged edge before refining it. */
  smooth: number;
  /** Pixels of softness added to the edge (0–250). */
  feather: number;
  /** 0–100 %: sharpens a soft edge. */
  contrast: number;
  /** −100–100 %: moves the edge in or out. */
  shiftEdge: number;
}

export const DEFAULT_REFINE: RefineSettings = { radius: 0, smooth: 0, feather: 0, contrast: 0, shiftEdge: 0 };

/** A dab of the Refine Edge brush, in document pixels. */
export interface RefineDab {
  x: number;
  y: number;
  radius: number;
}

/** The longest a side of the guided filter's own grid may be; larger areas are worked on smaller and scaled back. */
const MAX_GUIDE_PIXELS = 600_000;
/** How much the filter lets the selection stray from the colours (its ε). */
const EPSILON = 1e-4;

const clamp01 = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value);

/** Mean over a (2r+1)² window, the window cut short at the borders. */
function boxMean(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const rows = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x < Math.min(radius, width); x += 1) sum += source[row + x]!;
    for (let x = 0; x < width; x += 1) {
      if (x + radius < width) sum += source[row + x + radius]!;
      if (x - radius - 1 >= 0) sum -= source[row + x - radius - 1]!;
      rows[row + x] = sum / (Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1);
    }
  }
  const out = new Float32Array(source.length);
  const column = new Float64Array(width);
  for (let y = 0; y < Math.min(radius, height); y += 1) for (let x = 0; x < width; x += 1) column[x] = column[x]! + rows[y * width + x]!;
  for (let y = 0; y < height; y += 1) {
    if (y + radius < height) for (let x = 0; x < width; x += 1) column[x] = column[x]! + rows[(y + radius) * width + x]!;
    if (y - radius - 1 >= 0) for (let x = 0; x < width; x += 1) column[x] = column[x]! - rows[(y - radius - 1) * width + x]!;
    const count = Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1;
    for (let x = 0; x < width; x += 1) out[y * width + x] = column[x]! / count;
  }
  return out;
}

/** The largest (or smallest) value within a (2r+1)² square of each pixel. */
function extreme(source: Float32Array, width: number, height: number, radius: number, pick: (a: number, b: number) => number): Float32Array {
  const rows = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = source[row + x]!;
      for (let dx = Math.max(0, x - radius); dx <= Math.min(width - 1, x + radius); dx += 1) value = pick(value, source[row + dx]!);
      rows[row + x] = value;
    }
  }
  const out = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = rows[y * width + x]!;
      for (let dy = Math.max(0, y - radius); dy <= Math.min(height - 1, y + radius); dy += 1) value = pick(value, rows[dy * width + x]!);
      out[y * width + x] = value;
    }
  }
  return out;
}

/** A Gaussian-like blur (three box passes) of `sigma` pixels. */
function blur(source: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return source;
  const radius = Math.max(1, Math.round(sigma * 0.87));
  let out = source;
  for (let pass = 0; pass < 3; pass += 1) out = boxMean(out, width, height, radius);
  return out;
}

/**
 * The colour guided filter of `p` by the colours of `rgb` (each 0–1, three
 * planes), with windows of `radius`: a, b planes to apply at any scale.
 */
function guidedCoefficients(r: Float32Array, g: Float32Array, b: Float32Array, p: Float32Array, width: number, height: number, radius: number) {
  const n = p.length;
  const mean = (plane: Float32Array) => boxMean(plane, width, height, radius);
  const product = (x: Float32Array, y: Float32Array) => {
    const out = new Float32Array(n);
    for (let index = 0; index < n; index += 1) out[index] = x[index]! * y[index]!;
    return mean(out);
  };
  const mr = mean(r);
  const mg = mean(g);
  const mb = mean(b);
  const mp = mean(p);
  const rp = product(r, p);
  const gp = product(g, p);
  const bp = product(b, p);
  const rr = product(r, r);
  const rg = product(r, g);
  const rb = product(r, b);
  const gg = product(g, g);
  const gb = product(g, b);
  const bb = product(b, b);
  const ar = new Float32Array(n);
  const ag = new Float32Array(n);
  const ab = new Float32Array(n);
  const bias = new Float32Array(n);
  for (let index = 0; index < n; index += 1) {
    const mR = mr[index]!;
    const mG = mg[index]!;
    const mB = mb[index]!;
    const mP = mp[index]!;
    // Covariance of the colours with the selection, and of the colours (plus ε).
    const cr = rp[index]! - mR * mP;
    const cg = gp[index]! - mG * mP;
    const cb = bp[index]! - mB * mP;
    const vrr = rr[index]! - mR * mR + EPSILON;
    const vrg = rg[index]! - mR * mG;
    const vrb = rb[index]! - mR * mB;
    const vgg = gg[index]! - mG * mG + EPSILON;
    const vgb = gb[index]! - mG * mB;
    const vbb = bb[index]! - mB * mB + EPSILON;
    // The 3×3 inverse, by cofactors.
    const i00 = vgg * vbb - vgb * vgb;
    const i01 = vrb * vgb - vrg * vbb;
    const i02 = vrg * vgb - vrb * vgg;
    const i11 = vrr * vbb - vrb * vrb;
    const i12 = vrb * vrg - vrr * vgb;
    const i22 = vrr * vgg - vrg * vrg;
    const det = vrr * i00 + vrg * i01 + vrb * i02;
    if (!(Math.abs(det) > 1e-12)) {
      bias[index] = mP;
      continue;
    }
    const aR = (i00 * cr + i01 * cg + i02 * cb) / det;
    const aG = (i01 * cr + i11 * cg + i12 * cb) / det;
    const aB = (i02 * cr + i12 * cg + i22 * cb) / det;
    ar[index] = aR;
    ag[index] = aG;
    ab[index] = aB;
    bias[index] = mP - aR * mR - aG * mG - aB * mB;
  }
  return { ar: mean(ar), ag: mean(ag), ab: mean(ab), bias: mean(bias) };
}

/** Bilinear sample of a plane of `width` × `height` at (x, y) in its own pixels. */
function sample(plane: Float32Array, width: number, height: number, x: number, y: number): number {
  const fx = Math.min(width - 1, Math.max(0, x));
  const fy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = plane[y0 * width + x0]! * (1 - tx) + plane[y0 * width + x1]! * tx;
  const bottom = plane[y1 * width + x0]! * (1 - tx) + plane[y1 * width + x1]! * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Refine a selection (`mask`, 0–255, `width` × `height`) against the
 * picture's RGBA `pixels`. Distances in `settings` and `dabs` are in
 * document pixels; `scale` is how many of these pixels one document pixel
 * is (below 1 for a preview).
 */
export function refineMask(
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  settings: RefineSettings,
  dabs: readonly RefineDab[] = [],
  scale = 1
): Uint8Array {
  const n = width * height;
  if (pixels.length !== n * 4 || mask.length !== n) throw new RangeError("The picture and the selection differ in size");
  let alpha: Float32Array = new Float32Array(n);
  for (let index = 0; index < n; index += 1) alpha[index] = mask[index]! / 255;

  // Smooth: round the edge off, keeping it about as crisp.
  const smoothRadius = (settings.smooth / 100) * 10 * scale;
  if (smoothRadius >= 0.5) {
    const blurred = blur(alpha, width, height, smoothRadius);
    for (let index = 0; index < n; index += 1) alpha[index] = clamp01((blurred[index]! - 0.5) * 3 + 0.5);
  }

  // The band to refine: near the edge, and where the brush went.
  const band = new Uint8Array(n);
  let bandCount = 0;
  const radius = settings.radius * scale;
  if (radius >= 0.5) {
    const hard = new Float32Array(n);
    for (let index = 0; index < n; index += 1) hard[index] = alpha[index]! >= 0.5 ? 1 : 0;
    const near = boxMean(hard, width, height, Math.max(1, Math.round(radius)));
    for (let index = 0; index < n; index += 1) {
      const value = near[index]!;
      if (value > 1e-4 && value < 1 - 1e-4) {
        band[index] = 1;
        bandCount += 1;
      }
    }
  }
  for (const dab of dabs) {
    const cx = dab.x * scale;
    const cy = dab.y * scale;
    const reach = Math.max(0.5, dab.radius * scale);
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(height - 1, Math.ceil(cy + reach)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(width - 1, Math.ceil(cx + reach)); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= reach * reach && !band[y * width + x]) {
          band[y * width + x] = 1;
          bandCount += 1;
        }
      }
    }
  }

  if (bandCount > 0) {
    // Only the band's box, and that at most MAX_GUIDE_PIXELS large.
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!band[y * width + x]) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    const windowRadius = Math.max(2, radius * 0.75, ...dabs.map((dab) => dab.radius * scale * 0.5));
    const pad = Math.ceil(windowRadius) + 1;
    left = Math.max(0, left - pad);
    top = Math.max(0, top - pad);
    right = Math.min(width - 1, right + pad);
    bottom = Math.min(height - 1, bottom + pad);
    const boxWidth = right - left + 1;
    const boxHeight = bottom - top + 1;
    const step = Math.max(1, Math.ceil(Math.sqrt((boxWidth * boxHeight) / MAX_GUIDE_PIXELS)));
    const lowWidth = Math.ceil(boxWidth / step);
    const lowHeight = Math.ceil(boxHeight / step);
    const low = lowWidth * lowHeight;
    const r = new Float32Array(low);
    const g = new Float32Array(low);
    const b = new Float32Array(low);
    const p = new Float32Array(low);
    // Average each step × step block.
    for (let ly = 0; ly < lowHeight; ly += 1) {
      for (let lx = 0; lx < lowWidth; lx += 1) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sp = 0;
        let count = 0;
        for (let y = top + ly * step; y < Math.min(bottom + 1, top + (ly + 1) * step); y += 1) {
          for (let x = left + lx * step; x < Math.min(right + 1, left + (lx + 1) * step); x += 1) {
            const index = y * width + x;
            sr += pixels[index * 4]!;
            sg += pixels[index * 4 + 1]!;
            sb += pixels[index * 4 + 2]!;
            sp += alpha[index]!;
            count += 1;
          }
        }
        const at = ly * lowWidth + lx;
        r[at] = sr / count / 255;
        g[at] = sg / count / 255;
        b[at] = sb / count / 255;
        p[at] = sp / count;
      }
    }
    // Known colours on either side, near each pixel: the selection outside the band.
    const fgWeight = new Float32Array(low);
    const bgWeight = new Float32Array(low);
    {
      const fgCount = new Float32Array(low);
      const bgCount = new Float32Array(low);
      for (let ly = 0; ly < lowHeight; ly += 1) {
        for (let lx = 0; lx < lowWidth; lx += 1) {
          let fg = 0;
          let bg = 0;
          let count = 0;
          for (let y = top + ly * step; y < Math.min(bottom + 1, top + (ly + 1) * step); y += 1) {
            for (let x = left + lx * step; x < Math.min(right + 1, left + (lx + 1) * step); x += 1) {
              const index = y * width + x;
              count += 1;
              if (band[index]) continue;
              if (alpha[index]! >= 0.5) fg += 1;
              else bg += 1;
            }
          }
          fgCount[ly * lowWidth + lx] = fg / count;
          bgCount[ly * lowWidth + lx] = bg / count;
        }
      }
      fgWeight.set(fgCount);
      bgWeight.set(bgCount);
    }
    // Far enough that every pixel in the band sees both sides of it.
    const bandReach = Math.max(radius, ...dabs.map((dab) => dab.radius * scale));
    const reach = Math.max(1, Math.round((bandReach * 2 + windowRadius + 2) / step));
    const weighted = (plane: Float32Array, weight: Float32Array) => {
      const out = new Float32Array(low);
      for (let index = 0; index < low; index += 1) out[index] = plane[index]! * weight[index]!;
      return boxMean(out, lowWidth, lowHeight, reach);
    };
    const fgMean = boxMean(fgWeight, lowWidth, lowHeight, reach);
    const bgMean = boxMean(bgWeight, lowWidth, lowHeight, reach);
    const fgR = weighted(r, fgWeight);
    const fgG = weighted(g, fgWeight);
    const fgB = weighted(b, fgWeight);
    const bgR = weighted(r, bgWeight);
    const bgG = weighted(g, bgWeight);
    const bgB = weighted(b, bgWeight);
    // How far each colour is from the background towards the foreground.
    const estimate = new Float32Array(p);
    for (let ly = 0; ly < lowHeight; ly += 1) {
      for (let lx = 0; lx < lowWidth; lx += 1) {
        const at = ly * lowWidth + lx;
        const x = Math.min(right, left + lx * step);
        const y = Math.min(bottom, top + ly * step);
        if (!band[y * width + x]) continue;
        const wf = fgMean[at]!;
        const wb = bgMean[at]!;
        // Only one side known nearby: nothing to tell them apart by; keep the selection.
        if (wf < 1e-6 || wb < 1e-6) continue;
        const fr = fgR[at]! / wf;
        const fgc = fgG[at]! / wf;
        const fb = fgB[at]! / wf;
        const br = bgR[at]! / wb;
        const bgc = bgG[at]! / wb;
        const bb = bgB[at]! / wb;
        const dr = fr - br;
        const dg = fgc - bgc;
        const db = fb - bb;
        const length = dr * dr + dg * dg + db * db;
        // Alike colours on both sides: the picture cannot tell; keep the selection.
        if (length < 0.01) continue;
        estimate[at] = clamp01(((r[at]! - br) * dr + (g[at]! - bgc) * dg + (b[at]! - bb) * db) / length);
      }
    }
    // The guided filter carries the estimate back to every pixel's own colour.
    const coefficients = guidedCoefficients(r, g, b, estimate, lowWidth, lowHeight, Math.max(1, Math.round(2 / step)));
    const refined = new Float32Array(alpha);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const index = y * width + x;
        if (!band[index]) continue;
        const lx = (x - left + 0.5) / step - 0.5;
        const ly = (y - top + 0.5) / step - 0.5;
        const value =
          sample(coefficients.ar, lowWidth, lowHeight, lx, ly) * (pixels[index * 4]! / 255) +
          sample(coefficients.ag, lowWidth, lowHeight, lx, ly) * (pixels[index * 4 + 1]! / 255) +
          sample(coefficients.ab, lowWidth, lowHeight, lx, ly) * (pixels[index * 4 + 2]! / 255) +
          sample(coefficients.bias, lowWidth, lowHeight, lx, ly);
        refined[index] = clamp01(value);
      }
    }
    alpha = refined;
  }

  // Feather: soften the edge.
  const feather = settings.feather * scale;
  if (feather > 0) alpha = blur(alpha, width, height, feather / 2);

  // Contrast: steepen the edge around its middle.
  if (settings.contrast > 0) {
    const slope = 1 + (settings.contrast / 100) * 9;
    for (let index = 0; index < n; index += 1) alpha[index] = clamp01((alpha[index]! - 0.5) * slope + 0.5);
  }

  // Shift Edge: up to 10 document pixels out (or in), keeping the edge's softness.
  if (settings.shiftEdge !== 0) {
    const distance = Math.max(1, Math.round((Math.abs(settings.shiftEdge) / 100) * 10 * scale));
    alpha = extreme(alpha, width, height, distance, settings.shiftEdge > 0 ? Math.max : Math.min);
  }

  const result = new Uint8Array(n);
  for (let index = 0; index < n; index += 1) result[index] = Math.round(alpha[index]! * 255);
  return result;
}

/**
 * `refineMask`, worked only where it can change anything: around the
 * selection's edge (and the brush's dabs), as far as the settings reach.
 * Elsewhere the selection is even, and stays so up to the pointwise
 * Smooth and Contrast curves, so a small selection on a 12-megapixel
 * photo refines in a fraction of the time and memory.
 */
export function refineSelection(
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  settings: RefineSettings,
  dabs: readonly RefineDab[] = [],
  scale = 1
): Uint8Array {
  const n = width * height;
  if (pixels.length !== n * 4 || mask.length !== n) throw new RangeError("The picture and the selection differ in size");
  const boxReach = (sigma: number) => (sigma > 0 ? 3 * Math.max(1, Math.round(sigma * 0.87)) : 0);
  const smoothRadius = (settings.smooth / 100) * 10 * scale;
  const radius = settings.radius * scale;
  const windowRadius = Math.max(2, radius * 0.75, ...dabs.map((dab) => dab.radius * scale * 0.5));
  const after = boxReach((settings.feather * scale) / 2) + (settings.shiftEdge !== 0 ? Math.max(1, Math.round((Math.abs(settings.shiftEdge) / 100) * 10 * scale)) : 0);
  const windowPad = Math.ceil(windowRadius) + 1;
  const edgePad = (smoothRadius >= 0.5 ? boxReach(smoothRadius) : 0) + (radius >= 0.5 ? Math.max(1, Math.round(radius)) : 0) + windowPad + after + 2;

  // Where neighbours differ, and the dabs.
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  const include = (x0: number, y0: number, x1: number, y1: number) => {
    left = Math.min(left, x0);
    top = Math.min(top, y0);
    right = Math.max(right, x1);
    bottom = Math.max(bottom, y1);
  };
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const value = mask[row + x]!;
      if ((x + 1 < width && mask[row + x + 1] !== value) || (y + 1 < height && mask[row + width + x] !== value)) {
        include(x - edgePad, y - edgePad, x + 1 + edgePad, y + 1 + edgePad);
      }
    }
  }
  for (const dab of dabs) {
    const reach = Math.max(0.5, dab.radius * scale) + windowPad + after + 2;
    include(Math.floor(dab.x * scale - reach), Math.floor(dab.y * scale - reach), Math.ceil(dab.x * scale + reach), Math.ceil(dab.y * scale + reach));
  }

  // Even areas only follow the pointwise curves.
  const curve = new Uint8Array(256);
  {
    const slope = 1 + (settings.contrast / 100) * 9;
    for (let value = 0; value < 256; value += 1) {
      let alpha = value / 255;
      if (smoothRadius >= 0.5) alpha = clamp01((alpha - 0.5) * 3 + 0.5);
      if (settings.contrast > 0) alpha = clamp01((alpha - 0.5) * slope + 0.5);
      curve[value] = Math.round(alpha * 255);
    }
  }
  const result = new Uint8Array(n);
  for (let index = 0; index < n; index += 1) result[index] = curve[mask[index]!]!;
  if (right < 0) return result;

  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(width - 1, right);
  bottom = Math.min(height - 1, bottom);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  if (cropWidth === width && cropHeight === height) return refineMask(pixels, mask, width, height, settings, dabs, scale);
  const cropPixels = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  const cropMask = new Uint8Array(cropWidth * cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    const from = (top + y) * width + left;
    cropPixels.set(pixels.subarray(from * 4, (from + cropWidth) * 4), y * cropWidth * 4);
    cropMask.set(mask.subarray(from, from + cropWidth), y * cropWidth);
  }
  const shifted = dabs.map((dab) => ({ x: dab.x - left / scale, y: dab.y - top / scale, radius: dab.radius }));
  const refined = refineMask(cropPixels, cropMask, cropWidth, cropHeight, settings, shifted, scale);
  for (let y = 0; y < cropHeight; y += 1) result.set(refined.subarray(y * cropWidth, (y + 1) * cropWidth), (top + y) * width + left);
  return result;
}
