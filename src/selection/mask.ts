/**
 * A selection: how much of each document pixel is selected, 0 (not at all)
 * to 255 (fully). Partial values are soft (anti-aliased or feathered) edges.
 * Pure data, so every operation here is unit tested without a browser.
 */

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a new shape joins the selection: Photoshop's four selection modes. */
export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

/** Pixels at or above this count as selected where a yes/no answer is needed. */
export const SELECTED = 128;

export class Mask {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8Array
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("A selection must be at least one pixel");
    }
    this.data = data ?? new Uint8Array(width * height);
    if (this.data.length !== width * height) throw new RangeError("Selection data has the wrong size");
  }

  static full(width: number, height: number): Mask {
    return new Mask(width, height, new Uint8Array(width * height).fill(255));
  }

  /** A hard-edged rectangle between two corners, rounded to whole pixels. */
  static rect(width: number, height: number, x0: number, y0: number, x1: number, y1: number): Mask {
    const mask = new Mask(width, height);
    const left = Math.max(0, Math.round(Math.min(x0, x1)));
    const right = Math.min(width, Math.round(Math.max(x0, x1)));
    const top = Math.max(0, Math.round(Math.min(y0, y1)));
    const bottom = Math.min(height, Math.round(Math.max(y0, y1)));
    for (let y = top; y < bottom; y += 1) mask.data.fill(255, y * width + left, y * width + right);
    return mask;
  }

  clone(): Mask {
    return new Mask(this.width, this.height, this.data.slice());
  }

  isEmpty(): boolean {
    return this.bounds() === null;
  }

  /** The smallest rectangle holding every selected (non-zero) pixel. */
  bounds(): PixelBounds | null {
    const { width, height, data } = this;
    let top = -1;
    let bottom = -1;
    let left = width;
    let right = -1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let first = -1;
      let last = -1;
      for (let x = 0; x < width; x += 1) {
        if (data[row + x] !== 0) {
          if (first < 0) first = x;
          last = x;
        }
      }
      if (first < 0) continue;
      if (top < 0) top = y;
      bottom = y;
      left = Math.min(left, first);
      right = Math.max(right, last);
    }
    if (top < 0) return null;
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }

  /** Every pixel of the bounds is fully selected and nothing else is. */
  isRectangle(): boolean {
    const box = this.bounds();
    if (!box) return false;
    for (let y = box.y; y < box.y + box.height; y += 1) {
      const row = y * this.width;
      for (let x = box.x; x < box.x + box.width; x += 1) {
        if (this.data[row + x] !== 255) return false;
      }
    }
    return true;
  }

  /** This selection changed by a new shape in one of the four modes. */
  combine(shape: Mask, mode: SelectionMode): Mask {
    if (shape.width !== this.width || shape.height !== this.height) {
      throw new RangeError("Selections of different sizes cannot be combined");
    }
    if (mode === "replace") return shape.clone();
    const a = this.data;
    const b = shape.data;
    const out = new Uint8Array(a.length);
    for (let index = 0; index < a.length; index += 1) {
      const first = a[index]!;
      const second = b[index]!;
      out[index] =
        mode === "add"
          ? Math.max(first, second)
          : mode === "intersect"
            ? Math.min(first, second)
            : Math.round((first * (255 - second)) / 255);
    }
    return new Mask(this.width, this.height, out);
  }

  /** The selection moved by whole pixels; what leaves the document is lost. */
  translated(dx: number, dy: number): Mask {
    const { width, height } = this;
    const out = new Mask(width, height);
    const shiftX = Math.round(dx);
    const shiftY = Math.round(dy);
    const fromX = Math.max(0, -shiftX);
    const toX = Math.min(width, width - shiftX);
    if (toX <= fromX) return out;
    for (let y = Math.max(0, -shiftY); y < Math.min(height, height - shiftY); y += 1) {
      const source = y * width;
      const target = (y + shiftY) * width + shiftX;
      out.data.set(this.data.subarray(source + fromX, source + toX), target + fromX);
    }
    return out;
  }

  /** Whether the pixel under a point (pixel coordinates) is selected. */
  includes(x: number, y: number): boolean {
    const column = Math.floor(x);
    const row = Math.floor(y);
    if (column < 0 || row < 0 || column >= this.width || row >= this.height) return false;
    return this.data[row * this.width + column]! >= SELECTED;
  }

  inverted(): Mask {
    const out = new Uint8Array(this.data.length);
    for (let index = 0; index < out.length; index += 1) out[index] = 255 - this.data[index]!;
    return new Mask(this.width, this.height, out);
  }

  /**
   * Soften the edge over about twice `radius` pixels (a Gaussian blur made of
   * three box blurs). The document's edges are not faded.
   */
  feathered(radius: number): Mask {
    if (!(radius > 0)) return this.clone();
    const sigma = radius / 2;
    const values = Float32Array.from(this.data);
    const scratch = new Float32Array(values.length);
    for (const box of boxesForGauss(sigma, 3)) {
      const half = (box - 1) / 2;
      blurRows(values, scratch, this.width, this.height, half);
      blurColumns(scratch, values, this.width, this.height, half);
    }
    const out = new Uint8Array(values.length);
    for (let index = 0; index < out.length; index += 1) out[index] = Math.round(values[index]!);
    return new Mask(this.width, this.height, out);
  }

  /** Grow the selection by `distance` pixels (hard-edged). */
  expanded(distance: number): Mask {
    const box = this.bounds();
    if (!box || !(distance > 0)) return this.clone();
    const reach = Math.ceil(distance) + 1;
    const window = clampBox(
      { x: box.x - reach, y: box.y - reach, width: box.width + 2 * reach, height: box.height + 2 * reach },
      this.width,
      this.height
    );
    // Distance from every pixel to the nearest selected one.
    const squared = distanceTransform(this, window, (value) => value >= SELECTED);
    const limit = distance * distance;
    const out = new Mask(this.width, this.height);
    forEachIn(window, this.width, (index, local) => {
      if (squared[local]! <= limit) out.data[index] = 255;
    });
    return out;
  }

  /**
   * Select › Modify › Border: a band `width` pixels wide centred on the
   * selection's edge, in place of the selection. Along the document's
   * border only its inner half is left.
   */
  bordered(width: number): Mask {
    if (!(width > 0) || this.isEmpty()) return new Mask(this.width, this.height);
    const half = width / 2;
    const outer = this.expanded(half);
    const inner = this.contracted(half);
    // The document's border is an edge too (Select All, Border: a frame).
    const inset = Math.ceil(half);
    const insideFrame = Mask.rect(this.width, this.height, inset, inset, this.width - inset, this.height - inset);
    return outer.combine(inner.combine(insideFrame, "intersect"), "subtract");
  }

  /**
   * Select › Modify › Smooth: each pixel takes what most of the pixels
   * within `radius` (a square) are, which rounds corners and drops specks
   * and holes smaller than that.
   */
  smoothed(radius: number): Mask {
    const reach = Math.round(radius);
    if (!(reach >= 1) || this.isEmpty()) return this.clone();
    const { width, height, data } = this;
    // Selected pixels in each row's window, then in each square.
    const rows = new Uint16Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = 0; x < Math.min(reach, width); x += 1) if (data[row + x]! >= SELECTED) sum += 1;
      for (let x = 0; x < width; x += 1) {
        const enter = x + reach;
        const leave = x - reach - 1;
        if (enter < width && data[row + enter]! >= SELECTED) sum += 1;
        if (leave >= 0 && data[row + leave]! >= SELECTED) sum -= 1;
        rows[row + x] = sum;
      }
    }
    const out = new Mask(width, height);
    const column = new Uint32Array(width);
    for (let y = 0; y < Math.min(reach, height); y += 1) {
      for (let x = 0; x < width; x += 1) column[x] = column[x]! + rows[y * width + x]!;
    }
    for (let y = 0; y < height; y += 1) {
      const enter = y + reach;
      const leave = y - reach - 1;
      if (enter < height) for (let x = 0; x < width; x += 1) column[x] = column[x]! + rows[enter * width + x]!;
      if (leave >= 0) for (let x = 0; x < width; x += 1) column[x] = column[x]! - rows[leave * width + x]!;
      const spanY = Math.min(height - 1, y + reach) - Math.max(0, y - reach) + 1;
      for (let x = 0; x < width; x += 1) {
        // Only pixels inside the document vote.
        const spanX = Math.min(width - 1, x + reach) - Math.max(0, x - reach) + 1;
        if (column[x]! * 2 > spanX * spanY) out.data[y * width + x] = 255;
      }
    }
    return out;
  }

  /**
   * Shrink the selection by `distance` pixels (hard-edged). As in Photoshop,
   * an edge along the document's border stays where it is.
   */
  contracted(distance: number): Mask {
    const box = this.bounds();
    if (!box || !(distance > 0)) return this.clone();
    const window = clampBox(
      { x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 },
      this.width,
      this.height
    );
    // Distance from every pixel to the nearest unselected one.
    const squared = distanceTransform(this, window, (value) => value < SELECTED);
    const limit = distance * distance;
    const out = new Mask(this.width, this.height);
    forEachIn(window, this.width, (index, local) => {
      if (squared[local]! > limit) out.data[index] = 255;
    });
    return out;
  }
}

function clampBox(box: PixelBounds, width: number, height: number): PixelBounds {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  return {
    x,
    y,
    width: Math.min(width, box.x + box.width) - x,
    height: Math.min(height, box.y + box.height) - y,
  };
}

function forEachIn(box: PixelBounds, stride: number, visit: (index: number, local: number) => void) {
  let local = 0;
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      visit(y * stride + x, local);
      local += 1;
    }
  }
}

/** Box sizes whose three passes approximate a Gaussian of this sigma. */
function boxesForGauss(sigma: number, passes: number): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower -= 1;
  const upper = lower + 2;
  const lowerCount = Math.round(
    (12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4)
  );
  return Array.from({ length: passes }, (_, index) => (index < lowerCount ? lower : upper));
}

/** A running-sum box blur along rows; pixels past the edge repeat the edge. */
function blurRows(source: Float32Array, target: Float32Array, width: number, height: number, half: number) {
  const span = 2 * half + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const first = source[row]!;
    const last = source[row + width - 1]!;
    const at = (x: number) => (x < 0 ? first : x >= width ? last : source[row + x]!);
    let sum = 0;
    for (let x = -half; x <= half; x += 1) sum += at(x);
    for (let x = 0; x < width; x += 1) {
      target[row + x] = sum / span;
      sum += at(x + half + 1) - at(x - half);
    }
  }
}

function blurColumns(source: Float32Array, target: Float32Array, width: number, height: number, half: number) {
  const span = 2 * half + 1;
  for (let x = 0; x < width; x += 1) {
    const first = source[x]!;
    const last = source[(height - 1) * width + x]!;
    const at = (y: number) => (y < 0 ? first : y >= height ? last : source[y * width + x]!);
    let sum = 0;
    for (let y = -half; y <= half; y += 1) sum += at(y);
    for (let y = 0; y < height; y += 1) {
      target[y * width + x] = sum / span;
      sum += at(y + half + 1) - at(y - half);
    }
  }
}

const FAR = 1e20;

/**
 * Squared Euclidean distance from each pixel of `window` to the nearest pixel
 * of the window that `isFeature` accepts (Felzenszwalb & Huttenlocher).
 */
function distanceTransform(
  mask: Mask,
  window: PixelBounds,
  isFeature: (value: number) => boolean
): Float32Array {
  const { width, height } = window;
  const grid = new Float32Array(width * height);
  forEachIn(window, mask.width, (index, local) => {
    grid[local] = isFeature(mask.data[index]!) ? 0 : FAR;
  });
  const size = Math.max(width, height);
  const line = new Float64Array(size);
  const result = new Float64Array(size);
  const hull = new Int32Array(size);
  const bounds = new Float64Array(size + 1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) line[y] = grid[y * width + x]!;
    transform1d(line, height, result, hull, bounds);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = result[y]!;
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) line[x] = grid[row + x]!;
    transform1d(line, width, result, hull, bounds);
    for (let x = 0; x < width; x += 1) grid[row + x] = result[x]!;
  }
  return grid;
}

function transform1d(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array
) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k -= 1;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1]! < q) k += 1;
    const offset = q - v[k]!;
    d[q] = offset * offset + f[v[k]!]!;
  }
}
