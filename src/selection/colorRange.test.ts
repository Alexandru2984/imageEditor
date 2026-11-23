import { describe, expect, it } from "vitest";
import { colorRangeMask, colorRangeTable, DEFAULT_COLOR_RANGE, type ColorRangeSettings, type Rgb } from "./colorRange";

const pixelsOf = (colours: (Rgb | [number, number, number, number])[]) =>
  Uint8ClampedArray.from(colours.flatMap((colour) => (colour.length === 4 ? [...colour] : [...colour, 255])));

const select = (settings: Partial<ColorRangeSettings>, colours: (Rgb | [number, number, number, number])[]) => {
  const table = colorRangeTable({ ...DEFAULT_COLOR_RANGE, ...settings });
  return table ? [...colorRangeMask(pixelsOf(colours), table)] : null;
};

describe("Color Range", () => {
  it("selects sampled colours fully, near ones partly, others not", () => {
    const values = select({ samples: [[200, 40, 40]], fuzziness: 40 }, [
      [200, 40, 40],
      [210, 45, 40],
      [225, 55, 40],
      [40, 40, 200],
    ])!;
    expect(values[0]).toBe(255);
    expect(values[1]).toBe(255);
    expect(values[2]).toBeGreaterThan(0);
    expect(values[2]).toBeLessThan(255);
    expect(values[3]).toBe(0);
  });

  it("matches a colour exactly with no fuzziness, and nothing before sampling", () => {
    expect(select({ samples: [[17, 99, 201]], fuzziness: 0 }, [[17, 99, 201], [40, 99, 201]])).toEqual([255, 0]);
    expect(select({ samples: [] }, [[1, 2, 3]])).toBeNull();
  });

  it("leaves out excluded colours and inverts", () => {
    const settings = { samples: [[200, 40, 40]] as Rgb[], excluded: [[215, 50, 40]] as Rgb[], fuzziness: 60 };
    const values = select(settings, [[200, 40, 40], [215, 50, 40]])!;
    expect(values[1]).toBe(0);
    expect(select({ ...settings, invert: true }, [[40, 40, 200]])).toEqual([255]);
  });

  it("picks colour families and tones", () => {
    expect(select({ target: "reds" }, [[220, 30, 30], [30, 30, 220], [128, 128, 128]])).toEqual([255, 0, 0]);
    expect(select({ target: "blues" }, [[30, 30, 220]])).toEqual([255]);
    expect(select({ target: "shadows" }, [[10, 10, 10], [240, 240, 240]])).toEqual([255, 0]);
    expect(select({ target: "highlights" }, [[10, 10, 10], [240, 240, 240]])).toEqual([0, 255]);
    expect(select({ target: "midtones" }, [[128, 128, 128], [10, 10, 10]])).toEqual([255, 0]);
  });

  it("does not select transparent pixels", () => {
    expect(select({ target: "shadows" }, [[0, 0, 0, 0], [0, 0, 0, 128]])).toEqual([0, 128]);
  });
});
