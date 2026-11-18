import { describe, expect, it } from "vitest";
import {
  DEFAULT_EFFECTS,
  hasEffects,
  isValidLayerStyle,
  layerStyleMargin,
  rgba,
  shadowOffset,
} from "./layerStyleData";

describe("isValidLayerStyle", () => {
  it("accepts every effect the editor writes", () => {
    expect(isValidLayerStyle({})).toBe(true);
    expect(isValidLayerStyle(DEFAULT_EFFECTS)).toBe(true);
    expect(isValidLayerStyle({ stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true, position: "center" } })).toBe(true);
  });

  it("rejects unknown effects, extra fields and hostile values", () => {
    const shadow = DEFAULT_EFFECTS.dropShadow;
    for (const style of [
      null,
      [],
      "stroke",
      { bevel: {} },
      { dropShadow: { ...shadow, onload: "x" } },
      { dropShadow: { ...shadow, color: "url(https://evil.example)" } },
      { dropShadow: { ...shadow, color: "red" } },
      { dropShadow: { ...shadow, size: 1e9 } },
      { dropShadow: { ...shadow, distance: Number.NaN } },
      { dropShadow: { ...shadow, enabled: "yes" } },
      { stroke: { ...DEFAULT_EFFECTS.stroke, position: "everywhere" } },
      { outerGlow: { enabled: true, color: "#ffffff", opacity: 50 } },
    ]) {
      expect(isValidLayerStyle(style), JSON.stringify(style)).toBe(false);
    }
  });
});

describe("layer style helpers", () => {
  it("knows when effects are on", () => {
    expect(hasEffects(undefined)).toBe(false);
    expect(hasEffects(DEFAULT_EFFECTS)).toBe(false);
    expect(hasEffects({ outerGlow: { ...DEFAULT_EFFECTS.outerGlow, enabled: true } })).toBe(true);
    expect(hasEffects({ stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true, size: 0 } })).toBe(false);
  });

  it("reaches as far as the furthest effect", () => {
    expect(layerStyleMargin(DEFAULT_EFFECTS)).toBe(0);
    expect(layerStyleMargin({ stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true, size: 8 } })).toBe(10);
    expect(layerStyleMargin({ stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true, position: "inside" } })).toBe(0);
    expect(
      layerStyleMargin({ dropShadow: { ...DEFAULT_EFFECTS.dropShadow, enabled: true, distance: 10, size: 4 } })
    ).toBe(18);
  });

  it("casts shadows away from the light", () => {
    const offset = shadowOffset({ angle: 120, distance: 10 });
    expect(offset.x).toBeCloseTo(5);
    expect(offset.y).toBeCloseTo(8.66);
    expect(shadowOffset({ angle: 90, distance: 4 }).y).toBeCloseTo(4);
  });

  it("writes colours for canvas styles", () => {
    expect(rgba("#ff8000", 50)).toBe("rgba(255, 128, 0, 0.5)");
    expect(rgba("bogus", 100)).toBe("rgba(0, 0, 0, 1)");
  });
});
