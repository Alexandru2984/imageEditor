import { describe, expect, it } from "vitest";
import { initializeCanvas, writePsd, type LayerEffectsInfo } from "ag-psd";
import { DEFAULT_EFFECTS, isValidLayerStyle, type LayerStyle } from "@/raster/layerStyleData";
import { decodePsd, encodePsd, type DecodedLayer } from "./psdDocument";
import { effectsFromPsd, effectsToPsd } from "./psdEffects";

initializeCanvas(
  () => {
    throw new Error("no canvas");
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" }) as ImageData
);

const pixels = (width: number, height: number) => new Uint8ClampedArray(width * height * 4).fill(255);

/** Every effect, none at its default. */
const EVERYTHING: LayerStyle = {
  bevel: {
    ...DEFAULT_EFFECTS.bevel,
    enabled: true,
    kind: "pillowEmboss",
    depth: 250,
    direction: "down",
    size: 12,
    soften: 3,
    angle: 45,
    altitude: 60,
    color: "#ffeedd",
    opacity: 60,
    shadowColor: "#112233",
    shadowOpacity: 40,
  },
  stroke: { enabled: true, color: "#00ff00", opacity: 80, size: 4, position: "center" },
  innerShadow: { enabled: true, color: "#330000", opacity: 55, angle: -30, distance: 7, size: 9 },
  innerGlow: { enabled: false, color: "#abcdef", opacity: 35, size: 11, source: "center" },
  satin: { enabled: true, color: "#440044", opacity: 45, angle: 19, distance: 8, size: 6, invert: false },
  colorOverlay: { enabled: true, color: "#ff8800", opacity: 30 },
  gradientOverlay: { enabled: true, color: "#0000ff", endColor: "#ffff00", opacity: 90, angle: 30, gradient: "radial" },
  outerGlow: { enabled: true, color: "#ffffbe", opacity: 70, size: 20 },
  dropShadow: { enabled: true, color: "#000000", opacity: 75, angle: 120, distance: 10, size: 10 },
};

describe("layer effects in Photoshop documents", () => {
  it("writes every effect and reads it back as it was", () => {
    const written = encodePsd({
      width: 8,
      height: 6,
      layers: [
        {
          kind: "layer",
          name: "Styled",
          left: 1,
          top: 1,
          width: 4,
          height: 3,
          opacity: 1,
          visible: true,
          blend: "source-over",
          pixels: pixels(4, 3),
          clipped: false,
          fill: 0.5,
          style: EVERYTHING,
        },
      ],
      composite: pixels(8, 6),
      guides: [],
    });
    const back = decodePsd(written);
    const layer = back.layers[0] as DecodedLayer;
    expect(layer.style).toEqual(EVERYTHING);
    expect(layer.fill).toBeCloseTo(0.5, 2);
    expect(back.notes).toEqual([]);
  });

  it("keeps the first of several, and says what it simplified or left out", () => {
    const psd = {
      width: 4,
      height: 4,
      children: [
        {
          name: "Many",
          left: 0,
          top: 0,
          right: 4,
          bottom: 4,
          imageData: { width: 4, height: 4, data: pixels(4, 4) } as ImageData,
          effects: {
            dropShadow: [
              { enabled: true, color: { r: 255, g: 0, b: 0 }, opacity: 0.5, angle: 90, distance: { units: "Pixels", value: 3 }, size: { units: "Pixels", value: 2 } },
              { enabled: true, color: { r: 0, g: 0, b: 255 }, opacity: 0.5, angle: 90, distance: { units: "Pixels", value: 3 }, size: { units: "Pixels", value: 2 } },
            ],
          } as LayerEffectsInfo,
        },
        {
          name: "Pattern only",
          left: 0,
          top: 0,
          right: 4,
          bottom: 4,
          imageData: { width: 4, height: 4, data: pixels(4, 4) } as ImageData,
          effects: { patternOverlay: { enabled: true, pattern: { name: "Dots", id: "x" } } } as LayerEffectsInfo,
        },
      ],
    };
    const back = decodePsd(writePsd(psd, { generateThumbnail: false }));
    const [many, pattern] = back.layers as DecodedLayer[];
    expect(many!.style?.dropShadow?.color).toBe("#ff0000");
    expect(many!.style?.dropShadow?.distance).toBe(3);
    expect(pattern!.style).toBeUndefined();
    expect(back.notes).toEqual(["layer effects the editor does not have were left out", "some layer effect settings were simplified"]);
  });

  it("brings hostile values within the editor's limits", () => {
    const read = effectsFromPsd({
      disabled: true,
      dropShadow: [
        {
          enabled: true,
          color: { r: 1e9, g: Number.NaN, b: -5 },
          opacity: 1e6,
          angle: 1e9,
          distance: { units: "Pixels", value: 1e12 },
          size: { units: "Pixels", value: Number.POSITIVE_INFINITY },
        },
      ],
      bevel: {
        enabled: true,
        style: "stroke emboss",
        strength: 1e9,
        altitude: -40,
        soften: { units: "Pixels", value: 1e5 },
        technique: "chisel hard",
      },
      gradientOverlay: [{ enabled: true, type: "diamond", gradient: { name: "x", type: "noise", min: [], max: [] } }],
      satin: { enabled: true, color: { k: 2 } as never, invert: "yes" as never },
      stroke: [{ enabled: true, position: "everywhere" as never, fillType: "pattern" }],
    } as LayerEffectsInfo)!;
    expect(read.simplified).toBe(true);
    expect(isValidLayerStyle(read.value)).toBe(true);
    // The file had them all switched off.
    expect(Object.values(read.value).every((effect) => effect.enabled === false)).toBe(true);
    expect(read.value.dropShadow).toMatchObject({ opacity: 100, distance: 1000, size: 10 });
    expect(read.value.bevel).toMatchObject({ kind: "innerBevel", depth: 1000, altitude: 0, soften: 16 });
    expect(read.value.gradientOverlay?.gradient).toBe("linear");
    expect(read.value.stroke?.position).toBe("outside");
    expect(effectsFromPsd(undefined)).toBeNull();
    expect(effectsFromPsd({})).toBeNull();
  });

  it("writes nothing for a style without effects", () => {
    expect(effectsToPsd({})).toBeUndefined();
  });
});
