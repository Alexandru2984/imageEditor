/**
 * Layer styles (Photoshop's "fx"): effects drawn from a layer's shape that
 * follow it as it changes. Sizes are in document pixels, opacities in
 * percent. This module is plain data, shared by the renderer, the dialog and
 * the project file validator.
 */

export type StrokePosition = "outside" | "inside" | "center";

export interface DropShadowStyle {
  enabled: boolean;
  color: string;
  opacity: number;
  /** Where the light comes from, in degrees (Photoshop's 120 = upper left). */
  angle: number;
  distance: number;
  size: number;
}

export interface OuterGlowStyle {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
}

export interface ColorOverlayStyle {
  enabled: boolean;
  color: string;
  opacity: number;
}

export interface StrokeStyle {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
  position: StrokePosition;
}

/** Inside the layer's edge, cast by what is outside it (Multiply). */
export type InnerShadowStyle = DropShadowStyle;

export type GlowSource = "edge" | "center";

export interface InnerGlowStyle {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
  /** From the edge inwards, or from the middle out to the edge. */
  source: GlowSource;
}

/** Silky shading inside the layer: its shape against itself, shifted both ways (Multiply). */
export interface SatinStyle {
  enabled: boolean;
  color: string;
  opacity: number;
  angle: number;
  distance: number;
  size: number;
  invert: boolean;
}

export type GradientShape = "linear" | "radial" | "reflected";

export interface GradientOverlayStyle {
  enabled: boolean;
  /** Where the gradient starts. */
  color: string;
  /** Where it ends. */
  endColor: string;
  opacity: number;
  /** The way it runs, in degrees (90 = from the bottom up). */
  angle: number;
  gradient: GradientShape;
}

export type BevelKind = "innerBevel" | "outerBevel" | "emboss" | "pillowEmboss";

export interface BevelStyle {
  enabled: boolean;
  kind: BevelKind;
  /** How strongly it stands out, 1–1000 %. */
  depth: number;
  /** Raised or sunk. */
  direction: "up" | "down";
  size: number;
  /** Extra softness, in pixels. */
  soften: number;
  /** Where the light comes from, in degrees. */
  angle: number;
  /** How high the light is, 0–90°. */
  altitude: number;
  /** The highlight (Screen). */
  color: string;
  opacity: number;
  /** The shadow (Multiply). */
  shadowColor: string;
  shadowOpacity: number;
}

export interface LayerStyle {
  bevel?: BevelStyle;
  stroke?: StrokeStyle;
  innerShadow?: InnerShadowStyle;
  innerGlow?: InnerGlowStyle;
  satin?: SatinStyle;
  colorOverlay?: ColorOverlayStyle;
  gradientOverlay?: GradientOverlayStyle;
  outerGlow?: OuterGlowStyle;
  dropShadow?: DropShadowStyle;
}

export type EffectName = keyof LayerStyle;

/** The effects in the order the dialog and the Layers panel list them (Photoshop's: top-most first). */
export const EFFECTS: readonly { name: EffectName; label: string }[] = [
  { name: "bevel", label: "Bevel & emboss" },
  { name: "stroke", label: "Stroke" },
  { name: "innerShadow", label: "Inner shadow" },
  { name: "innerGlow", label: "Inner glow" },
  { name: "satin", label: "Satin" },
  { name: "colorOverlay", label: "Colour overlay" },
  { name: "gradientOverlay", label: "Gradient overlay" },
  { name: "outerGlow", label: "Outer glow" },
  { name: "dropShadow", label: "Drop shadow" },
];

export const DEFAULT_EFFECTS: Required<LayerStyle> = {
  bevel: {
    enabled: false,
    kind: "innerBevel",
    depth: 100,
    direction: "up",
    size: 5,
    soften: 0,
    angle: 120,
    altitude: 30,
    color: "#ffffff",
    opacity: 75,
    shadowColor: "#000000",
    shadowOpacity: 75,
  },
  stroke: { enabled: false, color: "#000000", opacity: 100, size: 3, position: "outside" },
  innerShadow: { enabled: false, color: "#000000", opacity: 75, angle: 120, distance: 5, size: 5 },
  innerGlow: { enabled: false, color: "#ffffbe", opacity: 75, size: 5, source: "edge" },
  satin: { enabled: false, color: "#000000", opacity: 50, angle: 19, distance: 11, size: 14, invert: true },
  colorOverlay: { enabled: false, color: "#ff0000", opacity: 100 },
  gradientOverlay: { enabled: false, color: "#000000", endColor: "#ffffff", opacity: 100, angle: 90, gradient: "linear" },
  outerGlow: { enabled: false, color: "#ffffbe", opacity: 75, size: 15 },
  dropShadow: { enabled: false, color: "#000000", opacity: 75, angle: 120, distance: 10, size: 10 },
};

export const EFFECT_LIMITS = {
  opacity: [0, 100],
  angle: [-360, 360],
  distance: [0, 1000],
  size: [0, 250],
  depth: [1, 1000],
  soften: [0, 16],
  altitude: [0, 90],
} as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const POSITIONS: readonly StrokePosition[] = ["outside", "inside", "center"];

const FIELDS: Record<EffectName, readonly string[]> = {
  bevel: [
    "enabled",
    "kind",
    "depth",
    "direction",
    "size",
    "soften",
    "angle",
    "altitude",
    "color",
    "opacity",
    "shadowColor",
    "shadowOpacity",
  ],
  stroke: ["enabled", "color", "opacity", "size", "position"],
  innerShadow: ["enabled", "color", "opacity", "angle", "distance", "size"],
  innerGlow: ["enabled", "color", "opacity", "size", "source"],
  satin: ["enabled", "color", "opacity", "angle", "distance", "size", "invert"],
  colorOverlay: ["enabled", "color", "opacity"],
  gradientOverlay: ["enabled", "color", "endColor", "opacity", "angle", "gradient"],
  outerGlow: ["enabled", "color", "opacity", "size"],
  dropShadow: ["enabled", "color", "opacity", "angle", "distance", "size"],
};

/** The fields that are one of a few words, and those words. */
const CHOICES: Record<string, readonly string[]> = {
  position: POSITIONS,
  source: ["edge", "center"],
  gradient: ["linear", "radial", "reflected"],
  kind: ["innerBevel", "outerBevel", "emboss", "pillowEmboss"],
  direction: ["up", "down"],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const inRange = (value: unknown, [min, max]: readonly [number, number]) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

function isValidEffect(name: EffectName, value: unknown): boolean {
  if (!isRecord(value)) return false;
  const fields = FIELDS[name];
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) return false;
  if (typeof value.enabled !== "boolean") return false;
  for (const key of ["color", "endColor", "shadowColor"]) {
    if (key in value && (typeof value[key] !== "string" || !HEX_COLOR.test(value[key] as string))) return false;
  }
  if (!("color" in value)) return false;
  for (const key of ["opacity", "shadowOpacity"]) {
    if (key in value && !inRange(value[key], EFFECT_LIMITS.opacity)) return false;
  }
  for (const key of ["angle", "distance", "size", "depth", "soften", "altitude"] as const) {
    if (key in value && !inRange(value[key], EFFECT_LIMITS[key])) return false;
  }
  for (const [key, words] of Object.entries(CHOICES)) {
    if (key in value && !words.includes(value[key] as string)) return false;
  }
  if ("invert" in value && typeof value.invert !== "boolean") return false;
  return true;
}

/** Whether untrusted data is a layer style the editor would write. */
export function isValidLayerStyle(value: unknown): value is LayerStyle {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([name, effect]) => name in FIELDS && isValidEffect(name as EffectName, effect)
  );
}

/** Whether any effect is on. */
export const hasEffects = (style: LayerStyle | null | undefined): style is LayerStyle =>
  !!style &&
  EFFECTS.some(({ name }) => {
    const effect = style[name];
    if (!effect?.enabled) return false;
    return name === "stroke" || name === "bevel" ? (effect as StrokeStyle | BevelStyle).size > 0 : true;
  });

/** How far the effects reach past the layer, in document pixels. */
export function layerStyleMargin(style: LayerStyle | null | undefined): number {
  if (!style) return 0;
  let margin = 0;
  const { dropShadow, outerGlow, stroke, bevel } = style;
  // A canvas shadow blur fades out over about its own length.
  if (dropShadow?.enabled) margin = Math.max(margin, dropShadow.distance + dropShadow.size * 1.5);
  if (outerGlow?.enabled) margin = Math.max(margin, outerGlow.size * 1.5);
  if (stroke?.enabled && stroke.position !== "inside") {
    margin = Math.max(margin, stroke.position === "center" ? stroke.size / 2 : stroke.size);
  }
  // All but the inner bevel shade outside the edge too.
  if (bevel?.enabled && bevel.kind !== "innerBevel") margin = Math.max(margin, bevel.size * 2 + bevel.soften * 1.5);
  return margin > 0 ? margin + 2 : 0;
}

/** Where a drop shadow lands, in document pixels: away from the light. */
export function shadowOffset(shadow: Pick<DropShadowStyle, "angle" | "distance">): { x: number; y: number } {
  const radians = (shadow.angle * Math.PI) / 180;
  return { x: -Math.cos(radians) * shadow.distance, y: Math.sin(radians) * shadow.distance };
}

/** A hex colour at an opacity in percent, for canvas styles. */
export function rgba(color: string, opacity: number): string {
  const value = HEX_COLOR.test(color) ? parseInt(color.slice(1), 16) : 0;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.min(1, Math.max(0, opacity / 100))})`;
}
