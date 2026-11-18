import type { FabricImage } from "fabric";
import { hexToRgb } from "./painter";
import { beginPixelEdit } from "./pixelLayer";
import { sceneToLayerMatrix } from "./fill";

export type GradientType = "linear" | "radial";
export type GradientColors = "foreground-background" | "foreground-transparent";

export interface GradientOptions {
  type: GradientType;
  colors: GradientColors;
  reverse: boolean;
  /** 0–100 */
  opacity: number;
}

export const DEFAULT_GRADIENT_OPTIONS: GradientOptions = {
  type: "linear",
  colors: "foreground-background",
  reverse: false,
  opacity: 100,
};

interface Point {
  x: number;
  y: number;
}

/** Move `end` so the line from `start` runs at a multiple of 45°, as Shift does. */
export function constrainAngle(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { ...end };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  // Diagonals keep the drag's reach along the axis rather than its length.
  const reach = Math.abs(Math.cos(angle)) > 1e-9 && Math.abs(Math.sin(angle)) > 1e-9
    ? Math.max(Math.abs(dx), Math.abs(dy)) * Math.SQRT2
    : length;
  const round = (value: number) => (Math.abs(value) < 1e-9 ? 0 : value);
  return {
    x: start.x + round(Math.cos(angle) * reach),
    y: start.y + round(Math.sin(angle) * reach),
  };
}

const rgba = (color: string, alpha: number) => {
  const [red, green, blue] = hexToRgb(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

/** The gradient's colour stops, from the start of the drag to its end. */
export function gradientStops(
  options: Pick<GradientOptions, "colors" | "reverse">,
  foreground: string,
  background: string
): [offset: number, color: string][] {
  const first = rgba(foreground, 1);
  const last =
    options.colors === "foreground-background" ? rgba(background, 1) : rgba(foreground, 0);
  return options.reverse
    ? [
        [0, last],
        [1, first],
      ]
    : [
        [0, first],
        [1, last],
      ];
}

/**
 * Paint a gradient over the whole layer, defined by a drag between two scene
 * points so it looks the same however the layer is placed or scaled.
 */
export function drawGradient(
  layer: FabricImage,
  start: Point,
  end: Point,
  foreground: string,
  background: string,
  options: GradientOptions
): void {
  const { context } = beginPixelEdit(layer);
  const gradient =
    options.type === "radial"
      ? context.createRadialGradient(
          start.x,
          start.y,
          0,
          start.x,
          start.y,
          Math.max(1e-6, Math.hypot(end.x - start.x, end.y - start.y))
        )
      : context.createLinearGradient(start.x, start.y, end.x, end.y);
  for (const [offset, color] of gradientStops(options, foreground, background)) {
    gradient.addColorStop(offset, color);
  }
  layer.setCoords();
  const box = layer.getBoundingRect();
  context.save();
  context.setTransform(...sceneToLayerMatrix(layer));
  context.globalAlpha = options.opacity / 100;
  context.fillStyle = gradient;
  // A little past the layer's box, so its edges are covered at any angle.
  context.fillRect(box.left - 1, box.top - 1, box.width + 2, box.height + 2);
  context.restore();
}
