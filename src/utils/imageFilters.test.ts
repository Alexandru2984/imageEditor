import { describe, it, expect, vi } from "vitest";
import type { FabricImage } from "fabric";
import {
  analyzePixels,
  applyFilterValues,
  autoEnhanceValues,
  buildFilters,
  readFilterValues,
  DEFAULT_FILTERS,
  FILTER_PRESETS,
  hasAdjustments,
  presetValues,
  sameFilterValues,
  type FilterValues,
} from "./imageFilters";

const serialize = (values: FilterValues) =>
  buildFilters(values).map((filter) => JSON.parse(JSON.stringify(filter.toObject())));

describe("readFilterValues", () => {
  it("returns defaults for an empty or missing filter stack", () => {
    expect(readFilterValues(undefined)).toEqual(DEFAULT_FILTERS);
    expect(readFilterValues([])).toEqual(DEFAULT_FILTERS);
  });

  it("maps fabric filter props back to slider values", () => {
    const values = readFilterValues([
      { type: "Brightness", brightness: 0.5 },
      { type: "Contrast", contrast: -0.2 },
      { type: "Saturation", saturation: 0.3 },
      { type: "Blur", blur: 0.1 },
      { type: "HueRotation", rotation: -0.4 },
    ]);
    expect(values).toEqual({
      ...DEFAULT_FILTERS,
      brightness: 50,
      contrast: -20,
      saturation: 30,
      blur: 10,
      hue: -40,
    });
  });

  it("round-trips every adjustment and look through serialisation", () => {
    const values: FilterValues = {
      look: "kodachrome",
      brightness: -12,
      contrast: 33,
      saturation: -7,
      vibrance: 41,
      warmth: -37,
      hue: 19,
      sharpen: 63,
      blur: 8,
      noise: 27,
      pixelate: 9,
    };
    expect(readFilterValues(serialize(values))).toEqual(values);
  });

  it("ignores unknown filters and clamps out-of-range values", () => {
    expect(
      readFilterValues([{ type: "Gamma" }, { type: "Brightness", brightness: 4 }])
    ).toEqual({ ...DEFAULT_FILTERS, brightness: 100 });
  });
});

describe("hasAdjustments", () => {
  it("is false for the default (identity) filter set", () => {
    expect(hasAdjustments(DEFAULT_FILTERS)).toBe(false);
    expect(hasAdjustments({ ...DEFAULT_FILTERS, pixelate: 1 })).toBe(false);
  });

  it("is true when any channel or a look is active", () => {
    expect(hasAdjustments({ ...DEFAULT_FILTERS, blur: 5 })).toBe(true);
    expect(hasAdjustments({ ...DEFAULT_FILTERS, hue: -1 })).toBe(true);
    expect(hasAdjustments({ ...DEFAULT_FILTERS, look: "sepia" })).toBe(true);
  });
});

describe("applyFilterValues", () => {
  it("does not run identity filters over the image", () => {
    const image = { filters: [], applyFilters: vi.fn() } as unknown as FabricImage;
    applyFilterValues(image, DEFAULT_FILTERS);
    expect(image.filters).toEqual([]);
    expect(image.applyFilters).toHaveBeenCalledOnce();
  });

  it("builds only the active filters in stable order, looks first", () => {
    const image = { filters: [], applyFilters: vi.fn() } as unknown as FabricImage;
    applyFilterValues(image, {
      ...DEFAULT_FILTERS,
      look: "sepia",
      brightness: 25,
      blur: 10,
      hue: -50,
      pixelate: 6,
    });
    expect(image.filters.map((filter) => filter.type)).toEqual([
      "Sepia",
      "Brightness",
      "HueRotation",
      "Blur",
      "Pixelate",
    ]);
  });
});

describe("presets", () => {
  it("have unique ids and start from a clean slate", () => {
    expect(new Set(FILTER_PRESETS.map((preset) => preset.id)).size).toBe(FILTER_PRESETS.length);
    expect(presetValues(FILTER_PRESETS[0]!)).toEqual(DEFAULT_FILTERS);
    for (const preset of FILTER_PRESETS) {
      const values = presetValues(preset);
      expect(readFilterValues(serialize(values))).toEqual(values);
    }
  });

  it("compare by value", () => {
    expect(sameFilterValues(DEFAULT_FILTERS, { ...DEFAULT_FILTERS })).toBe(true);
    expect(sameFilterValues(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, noise: 1 })).toBe(false);
  });
});

describe("auto enhance", () => {
  const pixels = (rgba: number[], count: number) =>
    Array.from({ length: count }, () => rgba).flat();

  it("ignores transparent pixels and reports nothing for an empty image", () => {
    expect(analyzePixels(pixels([255, 0, 0, 0], 10))).toBeNull();
  });

  it("brightens a dark, flat, dull image and leaves a balanced one mostly alone", () => {
    const dark = analyzePixels([...pixels([40, 40, 42, 255], 50), ...pixels([70, 70, 72, 255], 50)])!;
    const darkFix = autoEnhanceValues(dark);
    expect(darkFix.brightness).toBeGreaterThan(15);
    expect(darkFix.contrast).toBeGreaterThan(20);
    expect(darkFix.vibrance).toBeGreaterThan(20);

    const balanced = analyzePixels([
      ...pixels([5, 5, 5, 255], 20),
      ...pixels([128, 60, 200, 255], 60),
      ...pixels([250, 250, 250, 255], 20),
    ])!;
    const balancedFix = autoEnhanceValues(balanced);
    expect(Math.abs(balancedFix.brightness)).toBeLessThan(10);
    expect(balancedFix.contrast).toBe(0);
  });

  it("cools down a strong warm cast", () => {
    const warm = analyzePixels(pixels([200, 140, 80, 255], 100))!;
    expect(autoEnhanceValues(warm).warmth).toBeLessThan(0);
  });
});
