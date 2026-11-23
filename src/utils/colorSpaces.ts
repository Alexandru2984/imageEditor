/**
 * Colour models for the colour picker: HSB (hue, saturation, brightness, as
 * Photoshop calls HSV), RGB and CIE Lab. Lab is relative to D50 white, as in
 * Photoshop's picker, so its numbers match what Photoshop shows.
 */

export type Rgb = [number, number, number];
/** Hue 0–360°, saturation and brightness 0–100%. */
export interface Hsb {
  h: number;
  s: number;
  b: number;
}
/** Lightness 0–100, a and b about −128–127. */
export interface Lab {
  l: number;
  a: number;
  b: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const hex2 = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");

/** "#abc", "abc", "#aabbcc" or "AABBCC" as "#aabbcc"; null for anything else. */
export function parseHex(text: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  const digits = match[1]!.toLowerCase();
  return digits.length === 3 ? `#${[...digits].map((digit) => digit + digit).join("")}` : `#${digits}`;
}

/** The channels of a "#rrggbb" colour (black for anything else). */
export function hexToRgb(hex: string): Rgb {
  const parsed = parseHex(hex);
  if (!parsed) return [0, 0, 0];
  const value = Number.parseInt(parsed.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export const rgbToHex = ([r, g, b]: Rgb): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** HSB of a colour; greys and black get hue 0 (callers keep their own). */
export function rgbToHsb([r, g, b]: Rgb): Hsb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : (delta / max) * 100, b: (max / 255) * 100 };
}

/** The colour of an HSB triple, rounded to whole channel values. */
export function hsbToRgb({ h, s, b }: Hsb): Rgb {
  const value = clamp(b, 0, 100) / 100;
  const chroma = value * (clamp(s, 0, 100) / 100);
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, bl] =
    sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = value - chroma;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((bl + m) * 255)];
}

// sRGB to XYZ, adapted to D50 white (Bradford), and back.
const TO_XYZ = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733];
const FROM_XYZ = [3.1338561, -1.6168667, -0.4906146, -0.9787684, 1.9161415, 0.033454, 0.0719453, -0.2289914, 1.4052427];
const WHITE = [0.96422, 1, 0.82521];
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

const toLinear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055) * 255;

export function rgbToLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  const f = [0, 1, 2].map((row) => {
    const ratio = (TO_XYZ[row * 3]! * r + TO_XYZ[row * 3 + 1]! * g + TO_XYZ[row * 3 + 2]! * b) / WHITE[row]!;
    return ratio > EPSILON ? Math.cbrt(ratio) : (KAPPA * ratio + 16) / 116;
  });
  return { l: 116 * f[1]! - 16, a: 500 * (f[0]! - f[1]!), b: 200 * (f[1]! - f[2]!) };
}

/**
 * The colour nearest a Lab triple; `inGamut` false when sRGB cannot show it
 * and the channels were clipped.
 */
export function labToRgb({ l, a, b }: Lab): { rgb: Rgb; inGamut: boolean } {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (f: number) => (f ** 3 > EPSILON ? f ** 3 : (116 * f - 16) / KAPPA);
  const xyz = [inverse(fx) * WHITE[0]!, (l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA) * WHITE[1]!, inverse(fz) * WHITE[2]!];
  let inGamut = true;
  const rgb = [0, 1, 2].map((row) => {
    const linear = FROM_XYZ[row * 3]! * xyz[0]! + FROM_XYZ[row * 3 + 1]! * xyz[1]! + FROM_XYZ[row * 3 + 2]! * xyz[2]!;
    const channel = fromLinear(Math.max(0, linear));
    if (linear < -1e-4 || channel > 255.5) inGamut = false;
    return Math.round(clamp(channel, 0, 255));
  }) as Rgb;
  return { rgb, inGamut };
}
