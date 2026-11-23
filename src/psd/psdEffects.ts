import type { BevelStyle as PsdBevelKind, Color, LayerEffectsInfo, UnitsValue } from "ag-psd";
import {
  DEFAULT_EFFECTS,
  EFFECTS,
  EFFECT_LIMITS,
  isValidLayerStyle,
  type BevelKind,
  type EffectName,
  type GradientShape,
  type LayerStyle,
} from "@/raster/layerStyleData";
import { endsOf, hexOfPsdColor, rgbOfHex, twoStops, type Read } from "./psdLayerContent";

/**
 * Layer effects to and from Photoshop's: the editor's nine as they are, read
 * back from untrusted files within the editor's limits. Effects or settings
 * the editor does not have (patterns, contours, noise, more than one of a
 * kind…) are left out or simplified, and the reader says so.
 */

const pixels = (value: number): UnitsValue => ({ units: "Pixels", value });
const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, value));
const unitsOf = (value: UnitsValue | undefined, fallback: number) => finite(value?.value, fallback);

const BEVEL_TO_PSD: Record<BevelKind, PsdBevelKind> = {
  innerBevel: "inner bevel",
  outerBevel: "outer bevel",
  emboss: "emboss",
  pillowEmboss: "pillow emboss",
};

/** The layer's style as Photoshop keeps effects. */
export function effectsToPsd(style: LayerStyle): LayerEffectsInfo | undefined {
  const effects: LayerEffectsInfo = {};
  const { dropShadow, innerShadow, outerGlow, innerGlow, bevel, satin, colorOverlay, gradientOverlay, stroke } = style;
  const common = (effect: { enabled: boolean; color: string; opacity: number }) => ({
    enabled: effect.enabled,
    present: true,
    showInDialog: true,
    color: rgbOfHex(effect.color),
    opacity: effect.opacity / 100,
  });
  if (dropShadow) {
    effects.dropShadow = [
      {
        ...common(dropShadow),
        blendMode: "multiply",
        angle: dropShadow.angle,
        distance: pixels(dropShadow.distance),
        size: pixels(dropShadow.size),
        useGlobalLight: false,
      },
    ];
  }
  if (innerShadow) {
    effects.innerShadow = [
      {
        ...common(innerShadow),
        blendMode: "multiply",
        angle: innerShadow.angle,
        distance: pixels(innerShadow.distance),
        size: pixels(innerShadow.size),
        useGlobalLight: false,
      },
    ];
  }
  if (outerGlow) {
    effects.outerGlow = { ...common(outerGlow), blendMode: "screen", technique: "softer", size: pixels(outerGlow.size) };
  }
  if (innerGlow) {
    effects.innerGlow = {
      ...common(innerGlow),
      blendMode: "screen",
      technique: "softer",
      source: innerGlow.source,
      size: pixels(innerGlow.size),
    };
  }
  if (bevel) {
    effects.bevel = {
      enabled: bevel.enabled,
      present: true,
      showInDialog: true,
      style: BEVEL_TO_PSD[bevel.kind],
      technique: "smooth",
      strength: bevel.depth / 100,
      direction: bevel.direction,
      size: pixels(bevel.size),
      soften: pixels(bevel.soften),
      angle: bevel.angle,
      altitude: bevel.altitude,
      useGlobalLight: false,
      highlightColor: rgbOfHex(bevel.color),
      highlightOpacity: bevel.opacity / 100,
      highlightBlendMode: "screen",
      shadowColor: rgbOfHex(bevel.shadowColor),
      shadowOpacity: bevel.shadowOpacity / 100,
      shadowBlendMode: "multiply",
    };
  }
  if (satin) {
    effects.satin = {
      ...common(satin),
      blendMode: "multiply",
      angle: satin.angle,
      distance: pixels(satin.distance),
      size: pixels(satin.size),
      invert: satin.invert,
    };
  }
  if (colorOverlay) effects.solidFill = [{ ...common(colorOverlay), blendMode: "normal" }];
  if (gradientOverlay) {
    effects.gradientOverlay = [
      {
        enabled: gradientOverlay.enabled,
        present: true,
        showInDialog: true,
        blendMode: "normal",
        opacity: gradientOverlay.opacity / 100,
        angle: gradientOverlay.angle,
        type: gradientOverlay.gradient,
        align: true,
        scale: 1,
        gradient: { name: "Custom", type: "solid", ...twoStops(gradientOverlay.color, gradientOverlay.endColor) },
      },
    ];
  }
  if (stroke) {
    effects.stroke = [
      {
        ...common(stroke),
        blendMode: "normal",
        fillType: "color",
        position: stroke.position,
        size: pixels(stroke.size),
      },
    ];
  }
  return Object.keys(effects).length ? effects : undefined;
}

/** Photoshop's effects as the editor's style; null when none of them can be kept. */
export function effectsFromPsd(effects: LayerEffectsInfo | undefined): Read<LayerStyle> | null {
  if (!effects || typeof effects !== "object") return null;
  const style: LayerStyle = {};
  let simplified = false;
  const off = effects.disabled === true;
  const colour = (value: Color | undefined, fallback: string) => {
    const hex = hexOfPsdColor(value);
    if (!hex) simplified = true;
    return hex ?? fallback;
  };
  const opacity = (value: unknown, fallback: number) => clamp(Math.round(finite(value, fallback / 100) * 100), EFFECT_LIMITS.opacity);
  const angle = (value: unknown, fallback: number) => clamp(finite(value, fallback), EFFECT_LIMITS.angle);
  const size = (value: UnitsValue | undefined, fallback: number) => clamp(unitsOf(value, fallback), EFFECT_LIMITS.size);
  const distance = (value: UnitsValue | undefined, fallback: number) =>
    clamp(unitsOf(value, fallback), EFFECT_LIMITS.distance);
  const enabled = (value: unknown) => !off && value !== false;
  /** One of a kind: the first shown; more is a simplification. */
  const first = <T extends { present?: boolean }>(list: T[] | undefined): T | undefined => {
    if (!Array.isArray(list)) return undefined;
    const shown = list.filter((item) => item && typeof item === "object" && item.present !== false);
    if (shown.length > 1) simplified = true;
    return shown[0];
  };
  const present = <T extends { present?: boolean }>(item: T | undefined) =>
    item && typeof item === "object" && item.present !== false ? item : undefined;

  const dropShadow = first(effects.dropShadow);
  if (dropShadow) {
    const fallback = DEFAULT_EFFECTS.dropShadow;
    style.dropShadow = {
      enabled: enabled(dropShadow.enabled),
      color: colour(dropShadow.color, fallback.color),
      opacity: opacity(dropShadow.opacity, fallback.opacity),
      angle: angle(dropShadow.angle, fallback.angle),
      distance: distance(dropShadow.distance, fallback.distance),
      size: size(dropShadow.size, fallback.size),
    };
  }
  const innerShadow = first(effects.innerShadow);
  if (innerShadow) {
    const fallback = DEFAULT_EFFECTS.innerShadow;
    style.innerShadow = {
      enabled: enabled(innerShadow.enabled),
      color: colour(innerShadow.color, fallback.color),
      opacity: opacity(innerShadow.opacity, fallback.opacity),
      angle: angle(innerShadow.angle, fallback.angle),
      distance: distance(innerShadow.distance, fallback.distance),
      size: size(innerShadow.size, fallback.size),
    };
  }
  const outerGlow = present(effects.outerGlow);
  if (outerGlow) {
    const fallback = DEFAULT_EFFECTS.outerGlow;
    if (outerGlow.gradient && outerGlow.gradient.type !== "solid") simplified = true;
    style.outerGlow = {
      enabled: enabled(outerGlow.enabled),
      color: colour(outerGlow.color ?? { r: 255, g: 255, b: 190 }, fallback.color),
      opacity: opacity(outerGlow.opacity, fallback.opacity),
      size: size(outerGlow.size, fallback.size),
    };
  }
  const innerGlow = present(effects.innerGlow);
  if (innerGlow) {
    const fallback = DEFAULT_EFFECTS.innerGlow;
    if (innerGlow.gradient && innerGlow.gradient.type !== "solid") simplified = true;
    style.innerGlow = {
      enabled: enabled(innerGlow.enabled),
      color: colour(innerGlow.color ?? { r: 255, g: 255, b: 190 }, fallback.color),
      opacity: opacity(innerGlow.opacity, fallback.opacity),
      size: size(innerGlow.size, fallback.size),
      source: innerGlow.source === "center" ? "center" : "edge",
    };
  }
  const bevel = present(effects.bevel);
  if (bevel) {
    const fallback = DEFAULT_EFFECTS.bevel;
    const kinds: Record<string, BevelKind> = {
      "inner bevel": "innerBevel",
      "outer bevel": "outerBevel",
      emboss: "emboss",
      "pillow emboss": "pillowEmboss",
    };
    const kind = kinds[bevel.style ?? "inner bevel"];
    if (!kind || (bevel.technique && bevel.technique !== "smooth")) simplified = true;
    style.bevel = {
      enabled: enabled(bevel.enabled),
      kind: kind ?? "innerBevel",
      depth: clamp(Math.round(finite(bevel.strength, 1) * 100), EFFECT_LIMITS.depth),
      direction: bevel.direction === "down" ? "down" : "up",
      size: size(bevel.size, fallback.size),
      soften: clamp(unitsOf(bevel.soften, 0), EFFECT_LIMITS.soften),
      angle: angle(bevel.angle, fallback.angle),
      altitude: clamp(finite(bevel.altitude, fallback.altitude), EFFECT_LIMITS.altitude),
      color: colour(bevel.highlightColor ?? { r: 255, g: 255, b: 255 }, fallback.color),
      opacity: opacity(bevel.highlightOpacity, fallback.opacity),
      shadowColor: colour(bevel.shadowColor ?? { r: 0, g: 0, b: 0 }, fallback.shadowColor),
      shadowOpacity: opacity(bevel.shadowOpacity, fallback.shadowOpacity),
    };
  }
  const satin = present(effects.satin);
  if (satin) {
    const fallback = DEFAULT_EFFECTS.satin;
    style.satin = {
      enabled: enabled(satin.enabled),
      color: colour(satin.color ?? { r: 0, g: 0, b: 0 }, fallback.color),
      opacity: opacity(satin.opacity, fallback.opacity),
      angle: angle(satin.angle, fallback.angle),
      distance: clamp(unitsOf(satin.distance, fallback.distance), EFFECT_LIMITS.distance),
      size: size(satin.size, fallback.size),
      invert: satin.invert !== false,
    };
  }
  const solidFill = first(effects.solidFill);
  if (solidFill) {
    const fallback = DEFAULT_EFFECTS.colorOverlay;
    style.colorOverlay = {
      enabled: enabled(solidFill.enabled),
      color: colour(solidFill.color, fallback.color),
      opacity: opacity(solidFill.opacity, fallback.opacity),
    };
  }
  const gradientOverlay = first(effects.gradientOverlay);
  if (gradientOverlay) {
    const fallback = DEFAULT_EFFECTS.gradientOverlay;
    const gradient = gradientOverlay.gradient;
    const ends = gradient?.type === "solid" ? endsOf(gradient.colorStops, gradient.opacityStops) : null;
    if (!ends || ends.simplified) simplified = true;
    const shapes: readonly GradientShape[] = ["linear", "radial", "reflected"];
    const type = gradientOverlay.type ?? "linear";
    if (!shapes.includes(type as GradientShape) || gradientOverlay.reverse || finite(gradientOverlay.scale, 1) !== 1) {
      simplified = true;
    }
    const [from, to] = ends?.value ?? [fallback.color, fallback.endColor];
    style.gradientOverlay = {
      enabled: enabled(gradientOverlay.enabled),
      // Reversed, its ends swap.
      color: gradientOverlay.reverse ? to : from,
      endColor: gradientOverlay.reverse ? from : to,
      opacity: opacity(gradientOverlay.opacity, fallback.opacity),
      angle: angle(gradientOverlay.angle, fallback.angle),
      gradient: shapes.includes(type as GradientShape) ? (type as GradientShape) : "linear",
    };
  }
  const stroke = first(effects.stroke);
  if (stroke) {
    const fallback = DEFAULT_EFFECTS.stroke;
    if (stroke.fillType && stroke.fillType !== "color") simplified = true;
    style.stroke = {
      enabled: enabled(stroke.enabled),
      color: colour(stroke.color ?? { r: 0, g: 0, b: 0 }, fallback.color),
      opacity: opacity(stroke.opacity, fallback.opacity),
      size: size(stroke.size, fallback.size),
      position: stroke.position === "inside" || stroke.position === "center" ? stroke.position : "outside",
    };
  }
  if (present(effects.patternOverlay)) simplified = true;
  if (!EFFECTS.some(({ name }) => style[name as EffectName])) return null;
  // Whatever the file held, only what the editor would write itself.
  if (!isValidLayerStyle(style)) return null;
  return { value: style, simplified };
}
