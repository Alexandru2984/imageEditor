import type { FabricObject } from "fabric";

/**
 * Photoshop's blend modes, in its order and groups. The label is what the
 * user sees; the value is what the layer stores as globalCompositeOperation:
 * the canvas's own name where it has the mode, else one the compositor
 * blends itself on the GPU (see compositing/blendMath.ts).
 */
export const BLEND_MODE_GROUPS: { label: string; value: GlobalCompositeOperation }[][] = [
  [
    { label: "Normal", value: "source-over" },
    { label: "Dissolve", value: "dissolve" as GlobalCompositeOperation },
  ],
  [
    { label: "Darken", value: "darken" },
    { label: "Multiply", value: "multiply" },
    { label: "Color Burn", value: "color-burn" },
    { label: "Linear Burn", value: "linear-burn" as GlobalCompositeOperation },
    { label: "Darker Color", value: "darker-color" as GlobalCompositeOperation },
  ],
  [
    { label: "Lighten", value: "lighten" },
    { label: "Screen", value: "screen" },
    { label: "Color Dodge", value: "color-dodge" },
    { label: "Linear Dodge (Add)", value: "linear-dodge" as GlobalCompositeOperation },
    { label: "Lighter Color", value: "lighter-color" as GlobalCompositeOperation },
  ],
  [
    { label: "Overlay", value: "overlay" },
    { label: "Soft Light", value: "soft-light" },
    { label: "Hard Light", value: "hard-light" },
    { label: "Vivid Light", value: "vivid-light" as GlobalCompositeOperation },
    { label: "Linear Light", value: "linear-light" as GlobalCompositeOperation },
    { label: "Pin Light", value: "pin-light" as GlobalCompositeOperation },
    { label: "Hard Mix", value: "hard-mix" as GlobalCompositeOperation },
  ],
  [
    { label: "Difference", value: "difference" },
    { label: "Exclusion", value: "exclusion" },
    { label: "Subtract", value: "subtract" as GlobalCompositeOperation },
    { label: "Divide", value: "divide" as GlobalCompositeOperation },
  ],
  [
    { label: "Hue", value: "hue" },
    { label: "Saturation", value: "saturation" },
    { label: "Color", value: "color" },
    { label: "Luminosity", value: "luminosity" },
  ],
];

export const BLEND_MODES: { label: string; value: GlobalCompositeOperation }[] = BLEND_MODE_GROUPS.flat();

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
