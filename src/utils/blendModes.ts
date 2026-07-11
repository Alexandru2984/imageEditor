import type { FabricObject } from "fabric";

// Canvas globalCompositeOperation values that read as Photoshop-style blend
// modes. The label is what the user sees; the value is what Fabric stores.
export const BLEND_MODES: { label: string; value: GlobalCompositeOperation }[] = [
  { label: "Normal", value: "source-over" },
  { label: "Multiply", value: "multiply" },
  { label: "Screen", value: "screen" },
  { label: "Overlay", value: "overlay" },
  { label: "Darken", value: "darken" },
  { label: "Lighten", value: "lighten" },
  { label: "Color Dodge", value: "color-dodge" },
  { label: "Color Burn", value: "color-burn" },
  { label: "Hard Light", value: "hard-light" },
  { label: "Soft Light", value: "soft-light" },
  { label: "Difference", value: "difference" },
  { label: "Exclusion", value: "exclusion" },
  { label: "Hue", value: "hue" },
  { label: "Saturation", value: "saturation" },
  { label: "Color", value: "color" },
  { label: "Luminosity", value: "luminosity" },
];

export const DEFAULT_BLEND_MODE: GlobalCompositeOperation = "source-over";

/** A small thumbnail data URL of a single object, longest side ~size px. */
export function objectThumbnail(obj: FabricObject, size = 40): string {
  const longest = Math.max(obj.getScaledWidth(), obj.getScaledHeight()) || size;
  const multiplier = Math.min(size / longest, 1);
  try {
    return obj.toDataURL({ format: "png", multiplier, enableRetinaScaling: false });
  } catch {
    return "";
  }
}
