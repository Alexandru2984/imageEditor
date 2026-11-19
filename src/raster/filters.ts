/**
 * The Filter menu as pixel arithmetic over an "area" of RGBA bytes (straight
 * alpha). Each filter returns a new buffer the size of its input; pixels past
 * the edges count as copies of the edge, as for a photo's border.
 */

export interface Area {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const clampByte = (value: number) => (value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value));

/** Colours weighted by alpha, so transparent pixels do not bleed their colour. */
function premultiplied(data: Uint8ClampedArray): Uint8ClampedArray {
  let opaque = true;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] !== 255) {
      opaque = false;
      break;
    }
  }
  if (opaque) return data.slice();
  const out = new Uint8ClampedArray(data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!;
    out[offset + 3] = alpha;
    if (alpha === 255) {
      out[offset] = data[offset]!;
      out[offset + 1] = data[offset + 1]!;
      out[offset + 2] = data[offset + 2]!;
    } else {
      out[offset] = (data[offset]! * alpha) / 255;
      out[offset + 1] = (data[offset + 1]! * alpha) / 255;
      out[offset + 2] = (data[offset + 2]! * alpha) / 255;
    }
  }
  return out;
}

function unpremultiply(data: Uint8ClampedArray): Uint8ClampedArray {
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!;
    if (alpha === 255 || alpha === 0) continue;
    data[offset] = (data[offset]! * 255) / alpha;
    data[offset + 1] = (data[offset + 1]! * 255) / alpha;
    data[offset + 2] = (data[offset + 2]! * 255) / alpha;
  }
  return data;
}

/**
 * Average each pixel with `radius` neighbours on either side along its row,
 * with running sums (all four channels at once) so the cost does not grow
 * with the radius.
 */
/** The same bytes without clamping on write: averages never leave 0–255. */
const bytes = (data: Uint8ClampedArray) => new Uint8Array(data.buffer, data.byteOffset, data.length);

function horizontalPass(clampedSource: Uint8ClampedArray, clampedTarget: Uint8ClampedArray, width: number, height: number, radius: number) {
  const source = bytes(clampedSource);
  const target = bytes(clampedTarget);
  const scale = 1 / (radius * 2 + 1);
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    const last = row + (width - 1) * 4;
    // The window starts centred on the first pixel, edges repeated.
    let r = source[row]! * (radius + 1);
    let g = source[row + 1]! * (radius + 1);
    let b = source[row + 2]! * (radius + 1);
    let a = source[row + 3]! * (radius + 1);
    for (let index = 1; index <= radius; index += 1) {
      const offset = row + Math.min(index, width - 1) * 4;
      r += source[offset]!;
      g += source[offset + 1]!;
      b += source[offset + 2]!;
      a += source[offset + 3]!;
    }
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 4;
      target[offset] = (r * scale + 0.5) | 0;
      target[offset + 1] = (g * scale + 0.5) | 0;
      target[offset + 2] = (b * scale + 0.5) | 0;
      target[offset + 3] = (a * scale + 0.5) | 0;
      const entering = x + radius + 1 < width ? row + (x + radius + 1) * 4 : last;
      const leaving = x - radius > 0 ? row + (x - radius) * 4 : row;
      r += source[entering]! - source[leaving]!;
      g += source[entering + 1]! - source[leaving + 1]!;
      b += source[entering + 2]! - source[leaving + 2]!;
      a += source[entering + 3]! - source[leaving + 3]!;
    }
  }
}

/**
 * The same down each column, done a row at a time with a running sum per
 * column, so memory is read in order.
 */
function verticalPass(clampedSource: Uint8ClampedArray, clampedTarget: Uint8ClampedArray, width: number, height: number, radius: number) {
  const source = bytes(clampedSource);
  const target = bytes(clampedTarget);
  const stride = width * 4;
  const scale = 1 / (radius * 2 + 1);
  const sums = new Int32Array(stride);
  for (let index = 0; index < stride; index += 1) sums[index] = source[index]! * (radius + 1);
  for (let step = 1; step <= radius; step += 1) {
    const row = Math.min(step, height - 1) * stride;
    for (let index = 0; index < stride; index += 1) sums[index]! += source[row + index]!;
  }
  const lastRow = (height - 1) * stride;
  for (let y = 0; y < height; y += 1) {
    const out = y * stride;
    const entering = y + radius + 1 < height ? (y + radius + 1) * stride : lastRow;
    const leaving = y - radius > 0 ? (y - radius) * stride : 0;
    for (let index = 0; index < stride; index += 1) {
      target[out + index] = (sums[index]! * scale + 0.5) | 0;
      sums[index]! += source[entering + index]! - source[leaving + index]!;
    }
  }
}

/** Box radii whose three passes approximate a Gaussian of `sigma`. */
export function gaussBoxes(sigma: number): [number, number, number] {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower -= 1;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  const sizes = [0, 1, 2].map((pass) => (pass < m ? lower : upper));
  return sizes.map((size) => Math.max(0, (size - 1) / 2)) as [number, number, number];
}

/** Photoshop's Gaussian Blur, its radius taken as the standard deviation. */
export function gaussianBlur(area: Area, radius: number): Uint8ClampedArray {
  const { width, height } = area;
  if (radius < 0.3) return area.data.slice();
  const current = premultiplied(area.data);
  const spare = new Uint8ClampedArray(current.length);
  for (const box of gaussBoxes(radius)) {
    if (box < 1) continue;
    horizontalPass(current, spare, width, height, box);
    verticalPass(spare, current, width, height, box);
  }
  return unpremultiply(current);
}

/** Box blur along rows only (`radius` either side), for motion blur. */
export function horizontalBlur(area: Area, radius: number): Uint8ClampedArray {
  if (radius < 1) return area.data.slice();
  const current = premultiplied(area.data);
  const out = new Uint8ClampedArray(current.length);
  horizontalPass(current, out, area.width, area.height, Math.round(radius));
  return unpremultiply(out);
}

export interface UnsharpSettings {
  /** Percent of the difference added back (1–500). */
  amount: number;
  radius: number;
  /** Levels a pixel must differ from its surroundings by to be sharpened. */
  threshold: number;
}

/** Add back the difference between the image and its blur, at edges only. */
export function unsharpMask(area: Area, { amount, radius, threshold }: UnsharpSettings): Uint8ClampedArray {
  const blurred = gaussianBlur(area, radius);
  const { data } = area;
  const out = new Uint8ClampedArray(data.length);
  const gain = amount / 100;
  for (let offset = 0; offset < data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[offset + channel]!;
      const difference = value - blurred[offset + channel]!;
      out[offset + channel] = Math.abs(difference) * 2 >= threshold ? clampByte(value + difference * gain) : value;
    }
    out[offset + 3] = data[offset + 3]!;
  }
  return out;
}

/** Keep only detail finer than `radius`, on middle grey. */
export function highPass(area: Area, radius: number): Uint8ClampedArray {
  const blurred = gaussianBlur(area, radius);
  const { data } = area;
  const out = new Uint8ClampedArray(data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    out[offset] = clampByte(data[offset]! - blurred[offset]! + 128);
    out[offset + 1] = clampByte(data[offset + 1]! - blurred[offset + 1]! + 128);
    out[offset + 2] = clampByte(data[offset + 2]! - blurred[offset + 2]! + 128);
    out[offset + 3] = data[offset + 3]!;
  }
  return out;
}

/** A small fast generator, so the same settings always give the same grain. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NoiseSettings {
  /** Percent (0–400): at 100% uniform noise spans the whole level range. */
  amount: number;
  distribution: "uniform" | "gaussian";
  /** The same noise in every channel: grain without colour. */
  monochromatic: boolean;
}

export function addNoise(area: Area, { amount, distribution, monochromatic }: NoiseSettings, seed = 1): Uint8ClampedArray {
  const { data } = area;
  const out = new Uint8ClampedArray(data.length);
  const next = random(seed);
  const spread = (amount / 100) * 127.5;
  const sample =
    distribution === "uniform"
      ? () => (next() * 2 - 1) * spread
      : () => {
          // Box–Muller; a third of the spread is one standard deviation.
          const u = Math.max(1e-9, next());
          return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next()) * (spread / 3) * 1.5;
        };
  for (let offset = 0; offset < data.length; offset += 4) {
    if (monochromatic) {
      const noise = sample();
      out[offset] = clampByte(data[offset]! + noise);
      out[offset + 1] = clampByte(data[offset + 1]! + noise);
      out[offset + 2] = clampByte(data[offset + 2]! + noise);
    } else {
      out[offset] = clampByte(data[offset]! + sample());
      out[offset + 1] = clampByte(data[offset + 1]! + sample());
      out[offset + 2] = clampByte(data[offset + 2]! + sample());
    }
    out[offset + 3] = data[offset + 3]!;
  }
  return out;
}

/**
 * Squares of `size` pixels, each filled with its average colour, laid from
 * `origin` (where the area starts on the layer) so cells line up across
 * areas.
 */
export function mosaic(area: Area, size: number, origin = { x: 0, y: 0 }): Uint8ClampedArray {
  const { data, width, height } = area;
  const out = new Uint8ClampedArray(data.length);
  const cell = Math.max(1, Math.round(size));
  const startX = -(((origin.x % cell) + cell) % cell);
  const startY = -(((origin.y % cell) + cell) % cell);
  for (let top = startY; top < height; top += cell) {
    for (let left = startX; left < width; left += cell) {
      const x0 = Math.max(0, left);
      const y0 = Math.max(0, top);
      const x1 = Math.min(width, left + cell);
      const y1 = Math.min(height, top + cell);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * width + x) * 4;
          const alpha = data[offset + 3]!;
          r += data[offset]! * alpha;
          g += data[offset + 1]! * alpha;
          b += data[offset + 2]! * alpha;
          a += alpha;
        }
      }
      const count = (x1 - x0) * (y1 - y0);
      const colour = a > 0 ? [r / a, g / a, b / a] : [0, 0, 0];
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * width + x) * 4;
          out[offset] = clampByte(colour[0]!);
          out[offset + 1] = clampByte(colour[1]!);
          out[offset + 2] = clampByte(colour[2]!);
          out[offset + 3] = clampByte(a / count);
        }
      }
    }
  }
  return out;
}

const luminosity = (data: Uint8ClampedArray, offset: number) =>
  data[offset]! * 0.299 + data[offset + 1]! * 0.587 + data[offset + 2]! * 0.114;

export interface EmbossSettings {
  /** Where the light comes from, in degrees. */
  angle: number;
  /** How far apart the compared pixels are (1–10). */
  height: number;
  /** Percent (1–500). */
  amount: number;
}

/** A grey relief: each pixel lit by the difference across it towards the light. */
export function emboss(area: Area, { angle, height: depth, amount }: EmbossSettings): Uint8ClampedArray {
  const { data, width, height } = area;
  const out = new Uint8ClampedArray(data.length);
  const radians = (angle * Math.PI) / 180;
  const dx = Math.round(Math.cos(radians) * depth);
  const dy = Math.round(-Math.sin(radians) * depth);
  const gain = amount / 100;
  const at = (x: number, y: number) =>
    (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = clampByte(128 + (luminosity(data, at(x + dx, y + dy)) - luminosity(data, at(x - dx, y - dy))) * gain);
      out[offset] = value;
      out[offset + 1] = value;
      out[offset + 2] = value;
      out[offset + 3] = data[offset + 3]!;
    }
  }
  return out;
}

/** Edges dark on white, in their own colours (Sobel, per channel). */
export function findEdges(area: Area): Uint8ClampedArray {
  const { data, width, height } = area;
  const out = new Uint8ClampedArray(data.length);
  const at = (x: number, y: number) =>
    (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const nw = at(x - 1, y - 1);
      const n = at(x, y - 1);
      const ne = at(x + 1, y - 1);
      const w = at(x - 1, y);
      const e = at(x + 1, y);
      const sw = at(x - 1, y + 1);
      const s = at(x, y + 1);
      const se = at(x + 1, y + 1);
      for (let channel = 0; channel < 3; channel += 1) {
        const gx =
          data[ne + channel]! + 2 * data[e + channel]! + data[se + channel]! -
          data[nw + channel]! - 2 * data[w + channel]! - data[sw + channel]!;
        const gy =
          data[sw + channel]! + 2 * data[s + channel]! + data[se + channel]! -
          data[nw + channel]! - 2 * data[n + channel]! - data[ne + channel]!;
        out[offset + channel] = clampByte(255 - Math.sqrt(gx * gx + gy * gy) / 2);
      }
      out[offset + 3] = data[offset + 3]!;
    }
  }
  return out;
}

/** Copy the part of `full` (the size of `area`) that lies at `x`, `y` into `target`. */
export function cropInto(full: Uint8ClampedArray, area: { width: number }, x: number, y: number, target: Uint8ClampedArray, width: number, height: number): void {
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * area.width + x) * 4;
    target.set(full.subarray(from, from + width * 4), row * width * 4);
  }
}
