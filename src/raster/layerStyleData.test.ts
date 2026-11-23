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
    expect(
      isValidLayerStyle({
        bevel: { ...DEFAULT_EFFECTS.bevel, enabled: true, kind: "pillowEmboss", direction: "down", depth: 1000, altitude: 90 },
        innerGlow: { ...DEFAULT_EFFECTS.innerGlow, source: "center" },
        satin: { ...DEFAULT_EFFECTS.satin, invert: false },
        gradientOverlay: { ...DEFAULT_EFFECTS.gradientOverlay, gradient: "reflected", endColor: "#123abc" },
      })
    ).toBe(true);
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
      { bevel: { ...DEFAULT_EFFECTS.bevel, kind: "chisel" } },
      { bevel: { ...DEFAULT_EFFECTS.bevel, depth: 0 } },
      { bevel: { ...DEFAULT_EFFECTS.bevel, altitude: 91 } },
      { bevel: { ...DEFAULT_EFFECTS.bevel, soften: 17 } },
      { bevel: { ...DEFAULT_EFFECTS.bevel, shadowColor: "black" } },
      { bevel: { ...DEFAULT_EFFECTS.bevel, shadowOpacity: 101 } },
      { bevel: { ...DEFAULT_EFFECTS.bevel, direction: "sideways" } },
      { innerGlow: { ...DEFAULT_EFFECTS.innerGlow, source: "everywhere" } },
      { satin: { ...DEFAULT_EFFECTS.satin, invert: "yes" } },
      { gradientOverlay: { ...DEFAULT_EFFECTS.gradientOverlay, endColor: "url(x)" } },
      { gradientOverlay: { ...DEFAULT_EFFECTS.gradientOverlay, gradient: "conic" } },
      // A field of one effect on another.
      { innerShadow: { ...DEFAULT_EFFECTS.innerShadow, invert: true } },
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
    expect(hasEffects({ satin: { ...DEFAULT_EFFECTS.satin, enabled: true } })).toBe(true);
    expect(hasEffects({ bevel: { ...DEFAULT_EFFECTS.bevel, enabled: true, size: 0 } })).toBe(false);
  });

  it("reaches as far as the furthest effect", () => {
    expect(layerStyleMargin(DEFAULT_EFFECTS)).toBe(0);
    expect(layerStyleMargin({ stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true, size: 8 } })).toBe(10);
    expect(layerStyleMargin({ stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true, position: "inside" } })).toBe(0);
    expect(
      layerStyleMargin({ dropShadow: { ...DEFAULT_EFFECTS.dropShadow, enabled: true, distance: 10, size: 4 } })
    ).toBe(18);
    // Inner effects stay inside; all bevels but the inner one shade outside too.
    expect(layerStyleMargin({ innerShadow: { ...DEFAULT_EFFECTS.innerShadow, enabled: true, distance: 50 } })).toBe(0);
    expect(layerStyleMargin({ bevel: { ...DEFAULT_EFFECTS.bevel, enabled: true } })).toBe(0);
    expect(layerStyleMargin({ bevel: { ...DEFAULT_EFFECTS.bevel, enabled: true, kind: "emboss", size: 5, soften: 2 } })).toBe(15);
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
