/**
 * Perspective and distort: a layer's rectangle of pixels mapped onto any
 * four-cornered shape by a projective transform (a homography). Pure maths,
 * so the editor can preview with it and a worker can resample with it.
 */

export interface Corner {
  x: number;
  y: number;
}

/** Top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Corner, Corner, Corner, Corner];

/** A 3×3 matrix, row by row: (x, y) ↦ ((a x + b y + c) / w, (d x + e y + f) / w), w = g x + h y + i. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/** The homography taking the unit square's corners to `quad`'s (Heckbert). */
function squareToQuad(quad: Quad): Homography {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    // A parallelogram: no perspective.
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

export function multiply(m: Homography, n: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = m;
  const [A, B, C, D, E, F, G, H, I] = n;
  return [
    a * A + b * D + c * G,
    a * B + b * E + c * H,
    a * C + b * F + c * I,
    d * A + e * D + f * G,
    d * B + e * E + f * H,
    d * C + e * F + f * I,
    g * A + h * D + i * G,
    g * B + h * E + i * H,
    g * C + h * F + i * I,
  ];
}

export function invert(m: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const determinant = a * A + b * B + c * C;
  if (Math.abs(determinant) < 1e-18) throw new Error("The shape is too thin to map");
  const k = 1 / determinant;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

/** Where `m` takes a point. */
export function mapPoint(m: Homography, x: number, y: number): Corner {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/** The homography taking a `width`×`height` rectangle at the origin onto `quad`. */
export function rectToQuad(width: number, height: number, quad: Quad): Homography {
  return multiply(squareToQuad(quad), [1 / width, 0, 0, 0, 1 / height, 0, 0, 0, 1]);
}

/** Whether the corners, in order, make a shape without a dent or a crossing. */
export function isConvex(quad: Quad): boolean {
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = quad[index]!;
    const b = quad[(index + 1) % 4]!;
    const c = quad[(index + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * Perspective, as Photoshop drags it: a corner moved along one axis moves
 * its neighbour on the same edge the opposite way, so the shape stays
 * symmetric. `start` is the shape when the drag began.
 */
export function perspectiveDrag(start: Quad, index: number, dx: number, dy: number): Quad {
  const corners = start.map((corner) => ({ ...corner })) as [Corner, Corner, Corner, Corner];
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Along the top (0–1) or bottom (3–2) edge.
    const partner = [1, 0, 3, 2][index]!;
    corners[index]!.x += dx;
    corners[partner]!.x -= dx;
  } else {
    // Along the left (0–3) or right (1–2) edge.
    const partner = [3, 2, 1, 0][index]!;
    corners[index]!.y += dy;
    corners[partner]!.y -= dy;
  }
  return corners;
}

/**
 * Resample `source` into a `width`×`height` image whose pixel (x, y) shows the
 * source at `inverse`(x + ½, y + ½), bilinearly in premultiplied colour;
 * outside the source is transparent, so the edges come out smooth.
 */
export function warpPixels(
  source: { data: Uint8ClampedArray; width: number; height: number },
  inverse: Homography,
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sourceWidth, height: sourceHeight } = source;
  const [a, b, c, d, e, f, g, h, i] = inverse;
  for (let y = 0; y < height; y += 1) {
    const py = y + 0.5;
    for (let x = 0; x < width; x += 1) {
      const px = x + 0.5;
      const w = g * px + h * py + i;
      if (w <= 0) continue;
      const sx = (a * px + b * py + c) / w - 0.5;
      const sy = (d * px + e * py + f) / w - 0.5;
      if (sx <= -1 || sy <= -1 || sx >= sourceWidth || sy >= sourceHeight) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let k = 0; k < 4; k += 1) {
        const qx = x0 + (k & 1);
        const qy = y0 + (k >> 1);
        if (qx < 0 || qy < 0 || qx >= sourceWidth || qy >= sourceHeight) continue;
        const weight = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy);
        const at = (qy * sourceWidth + qx) * 4;
        const opacity = data[at + 3]! * weight;
        red += data[at]! * opacity;
        green += data[at + 1]! * opacity;
        blue += data[at + 2]! * opacity;
        alpha += opacity;
      }
      if (alpha <= 0) continue;
      const at = (y * width + x) * 4;
      out[at] = red / alpha;
      out[at + 1] = green / alpha;
      out[at + 2] = blue / alpha;
      out[at + 3] = alpha;
    }
  }
  return out;
}
