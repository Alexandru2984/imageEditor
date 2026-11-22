import { describe, expect, it } from "vitest";
import { ADJUSTMENT_LAYER_KINDS, adjustmentJob, initialAdjustment, readAdjustment } from "./adjustmentData";
import { defaultCurves, defaultLevels } from "@/raster/adjustments";

const colors = { foreground: "#102030", background: "#f0e0d0" };

describe("adjustment layer data", () => {
  it("reads back every kind's starting settings, and turns each into a job", () => {
    for (const kind of ADJUSTMENT_LAYER_KINDS) {
      const adjustment = initialAdjustment(kind, colors);
      expect(readAdjustment(JSON.parse(JSON.stringify(adjustment)))).toEqual(adjustment);
      expect(adjustmentJob(adjustment).op).toMatch(/^(luts|threshold|gradientMap|blackWhite|hueSaturation|colorBalance)$/);
    }
    expect(initialAdjustment("gradientMap", colors).settings).toEqual({ from: "#102030", to: "#f0e0d0", reverse: false });
  });

  it("keeps only the settings it knows", () => {
    const read = readAdjustment({ kind: "threshold", settings: { level: 90, extra: "x" }, more: 1 });
    expect(read).toEqual({ kind: "threshold", settings: { level: 90 } });
    expect(readAdjustment({ kind: "posterize", settings: { levels: 6.6 } })).toEqual({ kind: "posterize", settings: { levels: 7 } });
  });

  it("turns away settings no adjustment of the editor has", () => {
    const levels = defaultLevels();
    const curves = defaultCurves();
    const hostile: unknown[] = [
      null,
      "levels",
      [],
      { kind: "sharpen", settings: {} },
      { kind: "levels" },
      { kind: "levels", settings: [] },
      { kind: "brightnessContrast", settings: { brightness: Number.NaN, contrast: 0 } },
      { kind: "brightnessContrast", settings: { brightness: 151, contrast: 0 } },
      { kind: "brightnessContrast", settings: { brightness: "1", contrast: 0 } },
      { kind: "levels", settings: { ...levels, rgb: { ...levels.rgb, inBlack: 200, inWhite: 100 } } },
      { kind: "levels", settings: { ...levels, red: { ...levels.red, gamma: 0 } } },
      { kind: "levels", settings: { rgb: levels.rgb } },
      { kind: "curves", settings: { ...curves, rgb: [] } },
      { kind: "curves", settings: { ...curves, rgb: Array.from({ length: 17 }, (_, x) => [x, x]) } },
      { kind: "curves", settings: { ...curves, green: [[0, 0, 0]] } },
      { kind: "curves", settings: { ...curves, blue: [[0, 300]] } },
      { kind: "exposure", settings: { exposure: 1e9, offset: 0, gamma: 1 } },
      { kind: "hueSaturation", settings: { hue: 0, saturation: 0, lightness: 0, colorize: "yes" } },
      { kind: "colorBalance", settings: { shadows: [0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true } },
      { kind: "colorBalance", settings: { shadows: [0, 0, 101], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true } },
      { kind: "blackWhite", settings: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20 } },
      { kind: "gradientMap", settings: { from: "red", to: "#ffffff", reverse: false } },
      { kind: "gradientMap", settings: { from: "#000000", to: "#ffffff\"><script>", reverse: false } },
      { kind: "posterize", settings: { levels: 1 } },
      { kind: "threshold", settings: { level: Infinity } },
    ];
    for (const value of hostile) expect(readAdjustment(value), JSON.stringify(value)).toBeNull();
  });
});
