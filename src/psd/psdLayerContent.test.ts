import { describe, expect, it } from "vitest";
import { ADJUSTMENT_LAYER_KINDS, initialAdjustment, type AdjustmentData } from "@/adjustments/adjustmentData";
import type { FillContent } from "@/adjustments/fillData";
import { adjustmentFromPsd, adjustmentToPsd, fillFromPsd, fillToPsd, hexOfPsdColor } from "./psdLayerContent";

const colors = { foreground: "#102030", background: "#f0e0d0" };

const changed: AdjustmentData[] = [
  { kind: "brightnessContrast", settings: { brightness: 40, contrast: -20 } },
  {
    kind: "levels",
    settings: {
      rgb: { inBlack: 10, inWhite: 240, gamma: 1.5, outBlack: 5, outWhite: 250 },
      red: { inBlack: 0, inWhite: 255, gamma: 0.8, outBlack: 0, outWhite: 255 },
      green: { inBlack: 20, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
      blue: { inBlack: 0, inWhite: 200, gamma: 1, outBlack: 30, outWhite: 255 },
    },
  },
  {
    kind: "curves",
    settings: {
      rgb: [
        [0, 0],
        [64, 90],
        [255, 255],
      ],
      red: [
        [0, 20],
        [255, 235],
      ],
      green: [
        [0, 0],
        [255, 255],
      ],
      blue: [
        [0, 0],
        [128, 100],
        [255, 255],
      ],
    },
  },
  { kind: "exposure", settings: { exposure: 1.25, offset: -0.05, gamma: 1.2 } },
  { kind: "hueSaturation", settings: { hue: -30, saturation: 20, lightness: -10, colorize: false } },
  { kind: "hueSaturation", settings: { hue: 200, saturation: 60, lightness: 5, colorize: true } },
  { kind: "colorBalance", settings: { shadows: [10, -5, 0], midtones: [0, 20, -30], highlights: [-100, 0, 100], preserveLuminosity: false } },
  { kind: "blackWhite", settings: { reds: -50, yellows: 120, greens: 40, cyans: 60, blues: 300, magentas: -200 } },
  { kind: "gradientMap", settings: { from: "#112233", to: "#ddeeff", reverse: true } },
  { kind: "posterize", settings: { levels: 7 } },
  { kind: "threshold", settings: { level: 90 } },
  { kind: "invert", settings: {} },
];

describe("adjustment layers in Photoshop files", () => {
  it("go there and back unchanged, every kind", () => {
    for (const kind of ADJUSTMENT_LAYER_KINDS) {
      const adjustment = initialAdjustment(kind, colors);
      expect(adjustmentFromPsd(adjustmentToPsd(adjustment)), kind).toEqual({ value: adjustment, simplified: false });
    }
    for (const adjustment of changed) {
      expect(adjustmentFromPsd(adjustmentToPsd(adjustment)), adjustment.kind).toEqual({ value: adjustment, simplified: false });
    }
  });

  it("are written as Photoshop keeps them", () => {
    expect(adjustmentToPsd(changed[0]!)).toEqual({ type: "brightness/contrast", brightness: 40, contrast: -20, useLegacy: false });
    expect(adjustmentToPsd(changed[5]!)).toMatchObject({ type: "hue/saturation", colorize: true, colorization: { hue: 200, saturation: 60, lightness: 5 } });
    expect(adjustmentToPsd(changed[6]!)).toMatchObject({ shadows: { cyanRed: 10, magentaGreen: -5, yellowBlue: 0 } });
    expect(adjustmentToPsd(changed[8]!)).toMatchObject({
      type: "gradient map",
      reverse: true,
      colorStops: [
        { color: { r: 0x11, g: 0x22, b: 0x33 }, location: 0 },
        { color: { r: 0xdd, g: 0xee, b: 0xff }, location: 1 },
      ],
    });
  });

  it("bring what the editor cannot keep into its ranges, and say so", () => {
    expect(adjustmentFromPsd({ type: "brightness/contrast", brightness: 90, contrast: 80, useLegacy: true })).toEqual({
      value: { kind: "brightnessContrast", settings: { brightness: 90, contrast: 80 } },
      simplified: true,
    });
    expect(adjustmentFromPsd({ type: "posterize", levels: 900 })).toEqual({ value: { kind: "posterize", settings: { levels: 255 } }, simplified: true });
    const hue = adjustmentFromPsd({
      type: "hue/saturation",
      master: { hue: 10, saturation: 0, lightness: 0 },
      reds: { a: 0, b: 0, c: 0, d: 0, hue: 40, saturation: 0, lightness: 0 },
    });
    expect(hue).toEqual({ value: { kind: "hueSaturation", settings: { hue: 10, saturation: 0, lightness: 0, colorize: false } }, simplified: true });
    // A curve drawn with the pencil becomes points through it.
    const table = Array.from({ length: 256 }, (_, index) => 255 - index);
    const pencil = adjustmentFromPsd({ type: "curves", values: [table] });
    expect(pencil?.simplified).toBe(true);
    expect(pencil?.value.kind === "curves" && pencil.value.settings.rgb.at(0)).toEqual([0, 255]);
    expect(pencil?.value.kind === "curves" && pencil.value.settings.rgb.at(-1)).toEqual([255, 0]);
    // A gradient with more stops keeps its ends.
    const gradient = adjustmentFromPsd({
      type: "gradient map",
      gradientType: "solid",
      colorStops: [
        { color: { r: 255, g: 255, b: 255 }, location: 1, midpoint: 0.5 },
        { color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 0.5 },
        { color: { r: 255, g: 0, b: 0 }, location: 0.5, midpoint: 0.5 },
      ],
      opacityStops: [],
    });
    expect(gradient).toEqual({ value: { kind: "gradientMap", settings: { from: "#000000", to: "#ffffff", reverse: false } }, simplified: true });
  });

  it("are left out when the editor has nothing like them, or they are not what they say", () => {
    expect(adjustmentFromPsd({ type: "vibrance", vibrance: 10 })).toBeNull();
    expect(adjustmentFromPsd({ type: "selective color" })).toBeNull();
    expect(adjustmentFromPsd({ type: "gradient map", gradientType: "noise" })).toBeNull();
    expect(adjustmentFromPsd({ type: "gradient map", gradientType: "solid", colorStops: [], opacityStops: [] })).toBeNull();
    expect(adjustmentFromPsd(undefined)).toBeNull();
    expect(adjustmentFromPsd({ type: "bogus" } as never)).toBeNull();
    // Hostile values end up in range, never as NaN or out of it.
    const levels = adjustmentFromPsd({
      type: "levels",
      channels: [{ shadowInput: Number.NaN, highlightInput: -5, shadowOutput: 1e9, highlightOutput: -1e9, midtoneInput: Infinity }],
    });
    expect(levels?.value).toEqual({
      kind: "levels",
      settings: {
        rgb: { inBlack: 0, inWhite: 2, gamma: 1, outBlack: 255, outWhite: 0 },
        red: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
        green: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
        blue: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
      },
    });
    const curves = adjustmentFromPsd({ type: "curves", channels: [Array.from({ length: 40 }, (_, index) => ({ input: index * 6, output: 1e6 }))] });
    expect(curves?.value.kind === "curves" && curves.value.settings.rgb.length).toBe(16);
    expect(curves?.simplified).toBe(true);
  });
});

describe("fill layers in Photoshop files", () => {
  const fills: FillContent[] = [
    { kind: "solid", color: "#3366cc" },
    { kind: "gradient", from: "#000000", to: "#ffffff", style: "linear", angle: 90, scale: 100, reverse: false },
    { kind: "gradient", from: "#ff0000", to: "#0000ff", style: "radial", angle: -45, scale: 150, reverse: true },
    { kind: "gradient", from: "#00ff00", to: "#000000", style: "reflected", angle: 180, scale: 10, reverse: false },
  ];

  it("go there and back unchanged", () => {
    for (const fill of fills) expect(fillFromPsd(fillToPsd(fill))).toEqual({ value: fill, simplified: false });
    expect(fillToPsd(fills[2]!)).toMatchObject({ type: "solid", style: "radial", angle: -45, scale: 1.5, reverse: true });
  });

  it("keep what they can of Photoshop's other gradients, and leave out patterns and noise", () => {
    const diamond = fillFromPsd({
      type: "solid",
      name: "",
      style: "diamond",
      angle: 270,
      scale: 3,
      colorStops: [
        { color: { h: 0, s: 1, b: 1 }, location: 0, midpoint: 0.5 },
        { color: { k: 255 }, location: 1, midpoint: 0.5 },
      ],
      opacityStops: [],
    });
    expect(diamond).toEqual({
      value: { kind: "gradient", from: "#ff0000", to: "#000000", style: "linear", angle: -90, scale: 150, reverse: false },
      simplified: true,
    });
    expect(fillFromPsd({ type: "pattern", name: "", id: "" })).toBeNull();
    expect(fillFromPsd({ type: "noise", name: "", min: [], max: [] })).toBeNull();
    expect(fillFromPsd({ type: "color", color: { r: Number.NaN, g: 0, b: 0 } })).toBeNull();
  });

  it("read colours from any of Photoshop's models", () => {
    expect(hexOfPsdColor({ r: 255, g: 127.6, b: 0 })).toBe("#ff8000");
    expect(hexOfPsdColor({ fr: 1, fg: 0, fb: 0.5 })).toBe("#ff0080");
    expect(hexOfPsdColor({ h: 1 / 3, s: 1, b: 1 })).toBe("#00ff00");
    expect(hexOfPsdColor({ c: 0, m: 0, y: 0, k: 255 })).toBe("#000000");
    expect(hexOfPsdColor({ k: 0 })).toBe("#ffffff");
    expect(hexOfPsdColor({ l: 1, a: 0, b: 0 })).toBe("#ffffff");
    expect(hexOfPsdColor({ l: 0, a: 0, b: 0 })).toBe("#000000");
    expect(hexOfPsdColor(undefined)).toBeNull();
  });
});
