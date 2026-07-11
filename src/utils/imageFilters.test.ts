import { describe, it, expect } from "vitest";
import { readFilterValues, DEFAULT_FILTERS, hasAdjustments } from "./imageFilters";

describe("readFilterValues", () => {
  it("returns defaults for an empty or missing filter stack", () => {
    expect(readFilterValues(undefined)).toEqual(DEFAULT_FILTERS);
    expect(readFilterValues([])).toEqual(DEFAULT_FILTERS);
  });

  it("maps fabric filter props back to 0..100-scaled slider values", () => {
    const values = readFilterValues([
      { brightness: 0.5 },
      { contrast: -0.2 },
      { saturation: 0.3 },
      { blur: 0.1 },
      { rotation: -0.4 },
    ]);
    expect(values).toEqual({
      brightness: 50,
      contrast: -20,
      saturation: 30,
      blur: 10,
      hue: -40,
    });
  });

  it("ignores filters that don't carry a recognized prop", () => {
    expect(readFilterValues([{}, { brightness: 0.25 }])).toEqual({
      ...DEFAULT_FILTERS,
      brightness: 25,
    });
  });
});

describe("hasAdjustments", () => {
  it("is false for the default (identity) filter set", () => {
    expect(hasAdjustments(DEFAULT_FILTERS)).toBe(false);
  });

  it("is true when any channel is non-zero", () => {
    expect(hasAdjustments({ ...DEFAULT_FILTERS, blur: 5 })).toBe(true);
    expect(hasAdjustments({ ...DEFAULT_FILTERS, hue: -1 })).toBe(true);
  });
});
