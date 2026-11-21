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

export interface LayerStyle {
  dropShadow?: DropShadowStyle;
  outerGlow?: OuterGlowStyle;
  colorOverlay?: ColorOverlayStyle;
  stroke?: StrokeStyle;
}

export type EffectName = keyof LayerStyle;

/** The effects in the order the dialog and the Layers panel list them. */
export const EFFECTS: readonly { name: EffectName; label: string }[] = [
  { name: "dropShadow", label: "Drop shadow" },
  { name: "outerGlow", label: "Outer glow" },
  { name: "colorOverlay", label: "Colour overlay" },
  { name: "stroke", label: "Stroke" },
];

export const DEFAULT_EFFECTS: Required<LayerStyle> = {
  dropShadow: { enabled: false, color: "#000000", opacity: 75, angle: 120, distance: 10, size: 10 },
  outerGlow: { enabled: false, color: "#ffffbe", opacity: 75, size: 15 },
  colorOverlay: { enabled: false, color: "#ff0000", opacity: 100 },
  stroke: { enabled: false, color: "#000000", opacity: 100, size: 3, position: "outside" },
};

export const EFFECT_LIMITS = {
  opacity: [0, 100],
  angle: [-360, 360],
  distance: [0, 1000],
  size: [0, 250],
} as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const POSITIONS: readonly StrokePosition[] = ["outside", "inside", "center"];

const FIELDS: Record<EffectName, readonly string[]> = {
  dropShadow: ["enabled", "color", "opacity", "angle", "distance", "size"],
  outerGlow: ["enabled", "color", "opacity", "size"],
  colorOverlay: ["enabled", "color", "opacity"],
  stroke: ["enabled", "color", "opacity", "size", "position"],
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
  if (typeof value.color !== "string" || !HEX_COLOR.test(value.color)) return false;
  if (!inRange(value.opacity, EFFECT_LIMITS.opacity)) return false;
  if ("angle" in value && !inRange(value.angle, EFFECT_LIMITS.angle)) return false;
  if ("distance" in value && !inRange(value.distance, EFFECT_LIMITS.distance)) return false;
  if ("size" in value && !inRange(value.size, EFFECT_LIMITS.size)) return false;
  if ("position" in value && !POSITIONS.includes(value.position as StrokePosition)) return false;
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
  (!!style.dropShadow?.enabled ||
    !!style.outerGlow?.enabled ||
    !!style.colorOverlay?.enabled ||
    (!!style.stroke?.enabled && style.stroke.size > 0));

/** How far the effects reach past the layer, in document pixels. */
export function layerStyleMargin(style: LayerStyle | null | undefined): number {
  if (!style) return 0;
  let margin = 0;
  const { dropShadow, outerGlow, stroke } = style;
  // A canvas shadow blur fades out over about its own length.
  if (dropShadow?.enabled) margin = Math.max(margin, dropShadow.distance + dropShadow.size * 1.5);
  if (outerGlow?.enabled) margin = Math.max(margin, outerGlow.size * 1.5);
  if (stroke?.enabled && stroke.position !== "inside") {
    margin = Math.max(margin, stroke.position === "center" ? stroke.size / 2 : stroke.size);
  }
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
