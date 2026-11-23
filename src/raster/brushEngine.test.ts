import { describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  BUILTIN_TIPS,
  DEFAULT_DYNAMICS,
  TIP_MAX_SIDE,
  decodeTip,
  encodeTip,
  isBrushDynamics,
  isBrushPreset,
  isSymmetryOptions,
  seededRandom,
  stampsFor,
  symmetryAxes,
  symmetryTransforms,
  tipFromPixels,
} from "./brushEngine";
import type { Dab } from "./stroke";

const dab = (change: Partial<Dab> = {}): Dab => ({ x: 50, y: 40, pressure: 1, diameter: 20, direction: 0, ...change });
const apply = (matrix: number[], x: number, y: number) => [
  matrix[0]! * x + matrix[2]! * y + matrix[4]!,
  matrix[1]! * x + matrix[3]! * y + matrix[5]!,
];

describe("brush dynamics", () => {
  it("prints the dab as it is with the default settings", () => {
    expect(stampsFor(dab(), 20, 0.8, DEFAULT_DYNAMICS, () => 0.5)).toEqual([{ x: 50, y: 40, diameter: 20, angle: 0, alpha: 0.8 }]);
  });

  it("varies size within the minimum, angle and paint, the same way for the same seed", () => {
    const dynamics = { ...DEFAULT_DYNAMICS, sizeJitter: 100, minimumDiameter: 25, angleJitter: 100, flowJitter: 50, opacityJitter: 50 };
    const first = Array.from({ length: 200 }, (_, index) => stampsFor(dab(), 20, 1, dynamics, seededRandom(index))[0]!);
    const again = Array.from({ length: 200 }, (_, index) => stampsFor(dab(), 20, 1, dynamics, seededRandom(index))[0]!);
    expect(again).toEqual(first);
    const sizes = first.map((stamp) => stamp.diameter);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(10);
    const angles = first.map((stamp) => stamp.angle);
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(-180);
    expect(Math.max(...angles)).toBeLessThanOrEqual(180);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(300);
    const alphas = first.map((stamp) => stamp.alpha);
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.25);
    expect(Math.min(...alphas)).toBeLessThan(0.4);
  });

  it("scatters across the stroke, and along it too with both axes", () => {
    const across = stampsFor(dab({ direction: 0 }), 20, 1, { ...DEFAULT_DYNAMICS, scatter: 100, count: 16 }, seededRandom(3));
    expect(across).toHaveLength(16);
    expect(across.every((stamp) => stamp.x === 50 && Math.abs(stamp.y - 40) <= 20)).toBe(true);
    expect(across.some((stamp) => Math.abs(stamp.y - 40) > 5)).toBe(true);
    const both = stampsFor(dab({ direction: 0 }), 20, 1, { ...DEFAULT_DYNAMICS, scatter: 100, bothAxes: true, count: 16 }, seededRandom(3));
    expect(both.some((stamp) => Math.abs(stamp.x - 50) > 5)).toBe(true);
  });

  it("lets pen pressure set the opacity", () => {
    const [stamp] = stampsFor(dab({ pressure: 0.25 }), 20, 1, { ...DEFAULT_DYNAMICS, pressureOpacity: true }, Math.random);
    expect(stamp!.alpha).toBeCloseTo(0.25);
  });

  it("checks stored dynamics", () => {
    expect(isBrushDynamics(DEFAULT_DYNAMICS)).toBe(true);
    for (const bad of [
      null,
      { ...DEFAULT_DYNAMICS, spacing: 0 },
      { ...DEFAULT_DYNAMICS, count: 17 },
      { ...DEFAULT_DYNAMICS, roundness: Number.NaN },
      { ...DEFAULT_DYNAMICS, bothAxes: "yes" },
      { ...DEFAULT_DYNAMICS, extra: 1 },
    ]) {
      expect(isBrushDynamics(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("symmetry", () => {
  it("mirrors and turns about the centre", () => {
    expect(symmetryTransforms({ mode: "off", segments: 6 }, 100, 50)).toEqual([]);
    const [mirror] = symmetryTransforms({ mode: "vertical", segments: 6 }, 100, 50);
    expect(apply(mirror!, 130, 20)).toEqual([70, 20]);
    const [flip] = symmetryTransforms({ mode: "horizontal", segments: 6 }, 100, 50);
    expect(apply(flip!, 130, 20)).toEqual([130, 80]);
    const dual = symmetryTransforms({ mode: "dual", segments: 6 }, 100, 50).map((matrix) => apply(matrix, 130, 20).map(Math.round));
    expect(dual).toEqual([
      [70, 20],
      [130, 80],
      [70, 80],
    ]);
    const quarter = symmetryTransforms({ mode: "radial", segments: 4 }, 100, 50);
    expect(quarter).toHaveLength(3);
    // A point above the centre goes round to its right, below and left.
    expect(quarter.map((matrix) => apply(matrix, 100, 20).map((value) => Math.round(value)))).toEqual([
      [130, 50],
      [100, 80],
      [70, 50],
    ]);
    // Mandala: every turn, and every turn mirrored.
    expect(symmetryTransforms({ mode: "mandala", segments: 3 }, 0, 0)).toHaveLength(5);
  });

  it("draws an axis for each line it turns about, and checks stored settings", () => {
    expect(symmetryAxes({ mode: "vertical", segments: 6 })).toHaveLength(2);
    expect(symmetryAxes({ mode: "radial", segments: 5 })).toHaveLength(5);
    expect(symmetryAxes({ mode: "mandala", segments: 5 })).toHaveLength(10);
    expect(isSymmetryOptions({ mode: "radial", segments: 12 })).toBe(true);
    expect(isSymmetryOptions({ mode: "radial", segments: 13 })).toBe(false);
    expect(isSymmetryOptions({ mode: "spiral", segments: 4 })).toBe(false);
  });
});

describe("brush tips", () => {
  /** A white `width` × `height` picture with a black square. */
  const picture = (width: number, height: number, square: { x: number; y: number; size: number }) => {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = square.y; y < square.y + square.size; y += 1) {
      for (let x = square.x; x < square.x + square.size; x += 1) data.set([0, 0, 0, 255], (y * width + x) * 4);
    }
    return data;
  };

  it("paints with what is dark, cut to it", () => {
    const made = tipFromPixels(picture(30, 20, { x: 5, y: 4, size: 10 }), 30, 20)!;
    expect(made.size).toBe(10);
    expect(made.tip.width).toBe(10);
    expect(made.tip.height).toBe(10);
    expect(made.tip.alpha.every((value) => value === 255)).toBe(true);
    // White and transparent paint nothing at all.
    expect(tipFromPixels(new Uint8ClampedArray(10 * 10 * 4).fill(255), 10, 10)).toBeNull();
    expect(tipFromPixels(new Uint8ClampedArray(10 * 10 * 4), 10, 10)).toBeNull();
  });

  it("keeps only the selected part, and scales large ones down", () => {
    const coverage = new Uint8Array(30 * 20);
    for (let y = 4; y < 14; y += 1) coverage.fill(255, y * 30 + 5, y * 30 + 10);
    expect(tipFromPixels(picture(30, 20, { x: 5, y: 4, size: 10 }), 30, 20, coverage)!.tip.width).toBe(5);
    const big = tipFromPixels(picture(600, 400, { x: 0, y: 0, size: 400 }), 600, 400)!;
    expect(big.size).toBe(400);
    expect(Math.max(big.tip.width, big.tip.height)).toBe(TIP_MAX_SIDE);
  });

  it("are kept as text and read back, and nothing else is", () => {
    const tip = BUILTIN_TIPS["builtin:spatter"]!();
    expect(decodeTip(encodeTip(tip))).toEqual(tip);
    for (const bad of [
      null,
      { width: 2, height: 2, alpha: btoa("abc") },
      { width: 300, height: 1, alpha: btoa("x".repeat(300)) },
      { width: 1, height: 1, alpha: "%%%" },
      { width: 1.5, height: 1, alpha: "AA==" },
    ]) {
      expect(decodeTip(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("brush presets", () => {
  it("built-in ones are all valid, and stored ones are checked", () => {
    expect(BUILTIN_PRESETS.every(isBrushPreset)).toBe(true);
    const preset = BUILTIN_PRESETS[0]!;
    for (const bad of [
      { ...preset, id: "user:<script>" },
      { ...preset, name: "" },
      { ...preset, name: "x".repeat(61) },
      { ...preset, size: 0 },
      { ...preset, flow: 0 },
      { ...preset, tipId: "javascript:alert(1)" },
      { ...preset, dynamics: { ...preset.dynamics, scatter: 5000 } },
      { ...preset, onclick: "x" },
    ]) {
      expect(isBrushPreset(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
