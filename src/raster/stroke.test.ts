import { describe, expect, it } from "vitest";
import { DabSpacer, pressureDiameter, tipAlpha, tipGradientStops } from "./stroke";

const point = (x: number, y = 0, pressure = 1) => ({ x, y, pressure });

describe("DabSpacer", () => {
  it("stamps once where the stroke starts", () => {
    const spacer = new DabSpacer(20);
    expect(spacer.add(point(5, 5))).toEqual([{ x: 5, y: 5, pressure: 1, diameter: 20 }]);
  });

  it("spaces dabs a quarter of the tip apart along the path", () => {
    const spacer = new DabSpacer(20);
    spacer.add(point(0));
    const dabs = spacer.add(point(20));
    expect(dabs.map((dab) => dab.x)).toEqual([5, 10, 15, 20]);
  });

  it("keeps even spacing however the samples are split", () => {
    const whole = new DabSpacer(20);
    whole.add(point(0));
    const once = whole.add(point(37)).map((dab) => dab.x);

    const split = new DabSpacer(20);
    split.add(point(0));
    const pieces = [3, 9.5, 11, 24, 30.2, 37].flatMap((x) => split.add(point(x)).map((dab) => dab.x));
    expect(pieces.map((x) => +x.toFixed(6))).toEqual(once.map((x) => +x.toFixed(6)));
  });

  it("follows diagonal paths and ignores repeated samples", () => {
    const spacer = new DabSpacer(8);
    spacer.add(point(0, 0));
    expect(spacer.add(point(0, 0))).toEqual([]);
    const dabs = spacer.add(point(3, 4));
    expect(dabs).toHaveLength(2);
    expect(dabs[1]!.x).toBeCloseTo(2.4);
    expect(dabs[1]!.y).toBeCloseTo(3.2);
  });

  it("shrinks the tip, and the spacing, with stylus pressure", () => {
    const spacer = new DabSpacer(40);
    spacer.add(point(0, 0, 0.25));
    const dabs = spacer.add(point(10, 0, 0.25));
    expect(dabs.map((dab) => dab.x)).toEqual([2.5, 5, 7.5, 10]);
    expect(dabs[0]!.diameter).toBe(10);
  });

  it("never stamps a vanishing tip", () => {
    expect(pressureDiameter(100, 0)).toBe(5);
    expect(pressureDiameter(100, 2)).toBe(100);
  });
});

describe("tip shape", () => {
  it("is solid to the rim when fully hard, with a one-pixel antialiased edge", () => {
    expect(tipAlpha(0, 10, 1)).toBe(1);
    expect(tipAlpha(9, 10, 1)).toBe(1);
    expect(tipAlpha(9.5, 10, 1)).toBeCloseTo(0.5);
    expect(tipAlpha(10, 10, 1)).toBe(0);
  });

  it("fades from the core when soft", () => {
    expect(tipAlpha(0, 10, 0)).toBe(1);
    expect(tipAlpha(5, 10, 0)).toBeCloseTo(0.5);
    expect(tipAlpha(2.5, 10, 0)).toBeGreaterThan(tipAlpha(7.5, 10, 0));
    expect(tipAlpha(5, 10, 0.5)).toBe(1);
  });

  it("describes the same falloff as gradient stops", () => {
    const stops = tipGradientStops(10, 0.5);
    expect(stops[0]).toEqual([0, 1]);
    expect(stops[1]).toEqual([0.5, 1]);
    expect(stops.at(-1)).toEqual([1, 0]);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index]![0]).toBeGreaterThanOrEqual(stops[index - 1]![0]);
      expect(stops[index]![1]).toBeLessThanOrEqual(stops[index - 1]![1]);
    }
  });
});
