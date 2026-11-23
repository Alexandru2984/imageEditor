import type { TMat2D } from "fabric";
import type { Dab } from "./stroke";

/**
 * The brush engine's settings and arithmetic, without any canvas: Photoshop's
 * Brush Settings (tip shape, shape dynamics, scattering, transfer), symmetry
 * painting, brush tips taken from pixels, and brush presets. Each dab the
 * stroke spacer places becomes one or more stamps of the tip.
 */

export interface BrushDynamics {
  /** Tip angle, degrees counter-clockwise, −180–180. */
  angle: number;
  /** 1–100 %: 100 is round, less is squashed across the angle. */
  roundness: number;
  /** Distance between dabs, 1–1000 % of the tip. */
  spacing: number;
  /** How much each stamp may shrink at random, 0–100 %. */
  sizeJitter: number;
  /** The least a stamp shrinks to by jitter or pressure, 0–100 % of the size. */
  minimumDiameter: number;
  /** How far each stamp may turn at random, 0–100 % of half a turn. */
  angleJitter: number;
  /** How far stamps stray from the stroke, 0–1000 % of the tip. */
  scatter: number;
  /** Stray along the stroke too, not only across it. */
  bothAxes: boolean;
  /** Stamps per dab, 1–16. */
  count: number;
  /** How much each stamp may fade at random, 0–100 %. */
  opacityJitter: number;
  flowJitter: number;
  /** Pen pressure sets the size. */
  pressureSize: boolean;
  /** Pen pressure sets the opacity. */
  pressureOpacity: boolean;
}

export const DEFAULT_DYNAMICS: BrushDynamics = {
  angle: 0,
  roundness: 100,
  spacing: 25,
  sizeJitter: 0,
  minimumDiameter: 0,
  angleJitter: 0,
  scatter: 0,
  bothAxes: false,
  count: 1,
  opacityJitter: 0,
  flowJitter: 0,
  pressureSize: true,
  pressureOpacity: false,
};

type NumberKey = { [K in keyof BrushDynamics]: BrushDynamics[K] extends number ? K : never }[keyof BrushDynamics];

export const DYNAMICS_LIMITS: Record<NumberKey, readonly [number, number]> = {
  angle: [-180, 180],
  roundness: [1, 100],
  spacing: [1, 1000],
  sizeJitter: [0, 100],
  minimumDiameter: [0, 100],
  angleJitter: [0, 100],
  scatter: [0, 1000],
  count: [1, 16],
  opacityJitter: [0, 100],
  flowJitter: [0, 100],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const inRange = (value: unknown, [min, max]: readonly [number, number]) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function isBrushDynamics(value: unknown): value is BrushDynamics {
  if (!isRecord(value)) return false;
  const keys = Object.keys(DEFAULT_DYNAMICS);
  if (Object.keys(value).length !== keys.length || !keys.every((key) => key in value)) return false;
  for (const [key, range] of Object.entries(DYNAMICS_LIMITS)) {
    if (!inRange(value[key], range)) return false;
  }
  return ["bothAxes", "pressureSize", "pressureOpacity"].every((key) => typeof value[key] === "boolean");
}

// ---------- Stamps ----------

/** A small, fast random source that repeats for the same seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One print of the tip. */
export interface Stamp {
  x: number;
  y: number;
  diameter: number;
  /** Degrees counter-clockwise. */
  angle: number;
  /** How much paint it lays, 0–1 (flow included). */
  alpha: number;
}

/**
 * The stamps of one dab: its size, angle and paint varied at random as the
 * dynamics allow, scattered around it. `size` is the brush's own diameter,
 * `flow` 0–1. (Roundness shapes the tip itself, once per stroke.)
 */
export function stampsFor(dab: Dab, size: number, flow: number, dynamics: BrushDynamics, random: () => number): Stamp[] {
  const stamps: Stamp[] = [];
  const floor = (size * dynamics.minimumDiameter) / 100;
  const across = { x: -Math.sin(dab.direction), y: Math.cos(dab.direction) };
  const along = { x: Math.cos(dab.direction), y: Math.sin(dab.direction) };
  for (let index = 0; index < dynamics.count; index += 1) {
    let diameter = dab.diameter;
    if (dynamics.sizeJitter > 0) diameter *= 1 - (dynamics.sizeJitter / 100) * random();
    if (dynamics.sizeJitter > 0 || dynamics.pressureSize) diameter = Math.max(diameter, Math.min(size, floor));
    let angle = dynamics.angle;
    if (dynamics.angleJitter > 0) angle += (random() * 2 - 1) * (dynamics.angleJitter / 100) * 180;
    let alpha = flow;
    if (dynamics.flowJitter > 0) alpha *= 1 - (dynamics.flowJitter / 100) * random();
    if (dynamics.opacityJitter > 0) alpha *= 1 - (dynamics.opacityJitter / 100) * random();
    if (dynamics.pressureOpacity) alpha *= dab.pressure;
    let x = dab.x;
    let y = dab.y;
    if (dynamics.scatter > 0) {
      const reach = (dynamics.scatter / 100) * dab.diameter;
      const sideways = (random() * 2 - 1) * reach;
      x += across.x * sideways;
      y += across.y * sideways;
      if (dynamics.bothAxes) {
        const forwards = (random() * 2 - 1) * reach;
        x += along.x * forwards;
        y += along.y * forwards;
      }
    }
    stamps.push({ x, y, diameter: Math.max(0.5, diameter), angle, alpha });
  }
  return stamps;
}

// ---------- Symmetry ----------

export type SymmetryMode = "off" | "vertical" | "horizontal" | "dual" | "radial" | "mandala";

export interface SymmetryOptions {
  mode: SymmetryMode;
  /** Radial and mandala: how many times round, 2–12. */
  segments: number;
}

export const DEFAULT_SYMMETRY: SymmetryOptions = { mode: "off", segments: 6 };
export const SYMMETRY_SEGMENTS = [2, 12] as const;

const rotation = (angle: number, cx: number, cy: number): TMat2D => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
};
/** Mirror across the vertical line through `cx`. */
const mirrorX = (cx: number): TMat2D => [-1, 0, 0, 1, 2 * cx, 0];
const mirrorY = (cy: number): TMat2D => [1, 0, 0, -1, 0, 2 * cy];
const multiply = (a: TMat2D, b: TMat2D): TMat2D => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * Where else each stroke is painted, around (`cx`, `cy`): the transforms
 * besides the stroke itself (none when symmetry is off).
 */
export function symmetryTransforms(options: SymmetryOptions, cx: number, cy: number): TMat2D[] {
  const segments = Math.round(Math.min(SYMMETRY_SEGMENTS[1], Math.max(SYMMETRY_SEGMENTS[0], options.segments)));
  switch (options.mode) {
    case "vertical":
      return [mirrorX(cx)];
    case "horizontal":
      return [mirrorY(cy)];
    case "dual":
      return [mirrorX(cx), mirrorY(cy), rotation(Math.PI, cx, cy)];
    case "radial":
      return Array.from({ length: segments - 1 }, (_, index) => rotation(((index + 1) * Math.PI * 2) / segments, cx, cy));
    case "mandala": {
      const turns = Array.from({ length: segments }, (_, index) => rotation((index * Math.PI * 2) / segments, cx, cy));
      return [...turns.slice(1), ...turns.map((turn) => multiply(turn, mirrorX(cx)))];
    }
    default:
      return [];
  }
}

/** The lines the symmetry turns about, as angles (radians, clockwise from up) through the centre. */
export function symmetryAxes(options: SymmetryOptions): number[] {
  const segments = Math.round(Math.min(SYMMETRY_SEGMENTS[1], Math.max(SYMMETRY_SEGMENTS[0], options.segments)));
  switch (options.mode) {
    case "vertical":
      return [0, Math.PI];
    case "horizontal":
      return [Math.PI / 2, -Math.PI / 2];
    case "dual":
      return [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    case "radial":
      return Array.from({ length: segments }, (_, index) => (index * Math.PI * 2) / segments);
    case "mandala":
      return Array.from({ length: segments * 2 }, (_, index) => (index * Math.PI) / segments);
    default:
      return [];
  }
}

export const isSymmetryOptions = (value: unknown): value is SymmetryOptions =>
  isRecord(value) &&
  ["off", "vertical", "horizontal", "dual", "radial", "mandala"].includes(value.mode as string) &&
  Number.isInteger(value.segments) &&
  inRange(value.segments, SYMMETRY_SEGMENTS);

// ---------- Tips ----------

/** A brush tip from pixels: how much paint each of its pixels lays, 0–255. */
export interface BrushTip {
  width: number;
  height: number;
  alpha: Uint8Array;
}

/** The largest side a tip is kept at; it is scaled to the brush size. */
export const TIP_MAX_SIDE = 256;

/**
 * A tip from RGBA pixels as Photoshop's Define Brush Preset makes one: dark
 * paints, white and transparent do not, cut to where there is something, and
 * scaled down to at most TIP_MAX_SIDE. `coverage` (0–255 a pixel) limits it
 * to a selection. Null when there is nothing to paint with.
 */
export function tipFromPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  coverage?: Uint8Array
): { tip: BrushTip; size: number } | null {
  const amount = new Uint8Array(width * height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const at = index * 4;
      const luminance = 0.299 * rgba[at]! + 0.587 * rgba[at + 1]! + 0.114 * rgba[at + 2]!;
      let value = ((255 - luminance) * rgba[at + 3]!) / 255;
      if (coverage) value = (value * coverage[index]!) / 255;
      amount[index] = Math.round(value);
      if (value <= 2) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const cutWidth = right - left + 1;
  const cutHeight = bottom - top + 1;
  const scale = Math.min(1, TIP_MAX_SIDE / Math.max(cutWidth, cutHeight));
  const tipWidth = Math.max(1, Math.round(cutWidth * scale));
  const tipHeight = Math.max(1, Math.round(cutHeight * scale));
  const alpha = new Uint8Array(tipWidth * tipHeight);
  // Each tip pixel is the average of the pixels it covers.
  for (let ty = 0; ty < tipHeight; ty += 1) {
    const y0 = top + Math.floor((ty * cutHeight) / tipHeight);
    const y1 = top + Math.max(Math.floor(((ty + 1) * cutHeight) / tipHeight), Math.floor((ty * cutHeight) / tipHeight) + 1);
    for (let tx = 0; tx < tipWidth; tx += 1) {
      const x0 = left + Math.floor((tx * cutWidth) / tipWidth);
      const x1 = left + Math.max(Math.floor(((tx + 1) * cutWidth) / tipWidth), Math.floor((tx * cutWidth) / tipWidth) + 1);
      let sum = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) sum += amount[y * width + x]!;
      alpha[ty * tipWidth + tx] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { tip: { width: tipWidth, height: tipHeight, alpha }, size: Math.max(cutWidth, cutHeight) };
}

/** Photoshop-like chalk: a rough disc with holes. */
function chalkTip(): BrushTip {
  const side = 96;
  const random = seededRandom(7);
  const alpha = new Uint8Array(side * side);
  const centre = (side - 1) / 2;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const distance = Math.hypot(x - centre, y - centre) / (side / 2);
      const grain = random();
      if (distance > 0.98 - grain * 0.12 || grain < 0.18) continue;
      alpha[y * side + x] = Math.round(255 * (0.45 + 0.55 * grain) * Math.min(1, (1 - distance) * 4));
    }
  }
  return { width: side, height: side, alpha };
}

/** Spatter: a spray of round drops. */
function spatterTip(): BrushTip {
  const side = 96;
  const random = seededRandom(11);
  const alpha = new Uint8Array(side * side);
  for (let drop = 0; drop < 34; drop += 1) {
    const angle = random() * Math.PI * 2;
    const reach = Math.sqrt(random()) * (side / 2 - 8);
    const cx = side / 2 + Math.cos(angle) * reach;
    const cy = side / 2 + Math.sin(angle) * reach;
    const radius = 1.2 + random() * random() * 7;
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y += 1) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x += 1) {
        if (x < 0 || y < 0 || x >= side || y >= side) continue;
        const cover = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(x - cx, y - cy)));
        const index = y * side + x;
        alpha[index] = Math.max(alpha[index]!, Math.round(cover * 255));
      }
    }
  }
  return { width: side, height: side, alpha };
}

export const BUILTIN_TIPS: Record<string, () => BrushTip> = {
  "builtin:chalk": chalkTip,
  "builtin:spatter": spatterTip,
};

/** A tip as text, for storage. */
export function encodeTip(tip: BrushTip): { width: number; height: number; alpha: string } {
  let binary = "";
  for (let index = 0; index < tip.alpha.length; index += 0x8000) {
    binary += String.fromCharCode(...tip.alpha.subarray(index, index + 0x8000));
  }
  return { width: tip.width, height: tip.height, alpha: btoa(binary) };
}

/** A stored tip back, or null when it is not one. */
export function decodeTip(value: unknown): BrushTip | null {
  if (!isRecord(value)) return null;
  const { width, height, alpha } = value;
  if (!Number.isInteger(width) || !Number.isInteger(height) || typeof alpha !== "string") return null;
  if ((width as number) < 1 || (height as number) < 1 || (width as number) > TIP_MAX_SIDE || (height as number) > TIP_MAX_SIDE) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(alpha);
  } catch {
    return null;
  }
  if (binary.length !== (width as number) * (height as number)) return null;
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { width: width as number, height: height as number, alpha: bytes };
}

// ---------- Presets ----------

export interface BrushPreset {
  id: string;
  name: string;
  /** Image pixels. */
  size: number;
  /** 0–100. */
  hardness: number;
  /** 0–100. */
  flow: number;
  dynamics: BrushDynamics;
  /** A tip from pixels, or null for the round tip. */
  tipId: string | null;
}

export const PRESET_ID = /^(builtin|user):[a-z0-9-]{1,40}$/;
export const PRESET_NAME_MAX = 60;

export const BUILTIN_PRESETS: readonly BrushPreset[] = [
  { id: "builtin:soft-round", name: "Soft round", size: 30, hardness: 0, flow: 100, dynamics: DEFAULT_DYNAMICS, tipId: null },
  { id: "builtin:hard-round", name: "Hard round", size: 30, hardness: 100, flow: 100, dynamics: DEFAULT_DYNAMICS, tipId: null },
  {
    id: "builtin:airbrush",
    name: "Airbrush",
    size: 80,
    hardness: 0,
    flow: 8,
    dynamics: { ...DEFAULT_DYNAMICS, spacing: 5 },
    tipId: null,
  },
  {
    id: "builtin:calligraphy",
    name: "Calligraphy",
    size: 24,
    hardness: 100,
    flow: 100,
    dynamics: { ...DEFAULT_DYNAMICS, angle: 45, roundness: 18, spacing: 4 },
    tipId: null,
  },
  {
    id: "builtin:chalk",
    name: "Chalk",
    size: 40,
    hardness: 100,
    flow: 100,
    dynamics: { ...DEFAULT_DYNAMICS, spacing: 20, angleJitter: 100 },
    tipId: "builtin:chalk",
  },
  {
    id: "builtin:spatter",
    name: "Spatter",
    size: 48,
    hardness: 100,
    flow: 100,
    dynamics: { ...DEFAULT_DYNAMICS, spacing: 60, sizeJitter: 50, angleJitter: 100, scatter: 120, count: 2 },
    tipId: "builtin:spatter",
  },
];

export function isBrushPreset(value: unknown): value is BrushPreset {
  if (!isRecord(value)) return false;
  const keys = ["id", "name", "size", "hardness", "flow", "dynamics", "tipId"];
  if (Object.keys(value).length !== keys.length || !keys.every((key) => key in value)) return false;
  return (
    typeof value.id === "string" &&
    PRESET_ID.test(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= PRESET_NAME_MAX &&
    inRange(value.size, [1, 1000]) &&
    inRange(value.hardness, [0, 100]) &&
    inRange(value.flow, [1, 100]) &&
    isBrushDynamics(value.dynamics) &&
    (value.tipId === null || (typeof value.tipId === "string" && PRESET_ID.test(value.tipId)))
  );
}
