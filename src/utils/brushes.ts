import { Shadow, type BaseBrush } from "fabric";

export type BrushKind = "pen" | "highlighter" | "neon" | "dashed";

export interface BrushOption {
  kind: BrushKind;
  label: string;
  /** Narrowest stroke that still reads as this brush; picking it widens thinner brushes. */
  minWidth: number;
  /** Whether the hardness (soft edge) setting applies. */
  usesHardness: boolean;
}

export const BRUSHES: BrushOption[] = [
  { kind: "pen", label: "Pen", minWidth: 1, usesHardness: true },
  { kind: "highlighter", label: "Highlighter", minWidth: 14, usesHardness: false },
  { kind: "neon", label: "Neon", minWidth: 4, usesHardness: false },
  { kind: "dashed", label: "Dashed", minWidth: 2, usesHardness: true },
];

export const HIGHLIGHTER_ALPHA = 0.45;

const HEX = /^#([0-9a-f]{6})$/i;

/** `#rrggbb` → `rgba(r, g, b, alpha)`; other colour strings pass through. */
export function withAlpha(color: string, alpha: number): string {
  const match = HEX.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Blend `#rrggbb` toward white by `amount` (0..1). */
export function tint(color: string, amount: number): string {
  const match = HEX.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1]!, 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const r = mix((value >> 16) & 255);
  const g = mix((value >> 8) & 255);
  const b = mix(value & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function softEdge(color: string, hardness: number, width: number): Shadow | null {
  if (hardness >= 100) return null;
  const blur = ((100 - hardness) / 100) * width;
  return new Shadow({ color, blur, offsetX: 0, offsetY: 0 });
}

/** Configure a free-drawing brush for the chosen kind, colour and settings. */
export function styleBrush(
  brush: BaseBrush,
  kind: BrushKind,
  color: string,
  width: number,
  hardness: number
): void {
  brush.width = width;
  brush.strokeDashArray = null;
  brush.strokeLineCap = "round";
  brush.strokeLineJoin = "round";
  switch (kind) {
    case "highlighter":
      // Translucent in the colour itself so one stroke never darkens where
      // it overlaps itself; the multiply blend is added to the finished path.
      brush.color = withAlpha(color, HIGHLIGHTER_ALPHA);
      brush.strokeLineCap = "butt";
      brush.shadow = null;
      break;
    case "neon":
      brush.color = tint(color, 0.65);
      brush.shadow = new Shadow({
        color,
        blur: Math.max(10, width * 2.5),
        offsetX: 0,
        offsetY: 0,
      });
      break;
    case "dashed":
      brush.color = color;
      brush.strokeDashArray = [width * 2.5, width * 2];
      brush.strokeLineCap = "butt";
      brush.shadow = softEdge(color, hardness, width);
      break;
    default:
      brush.color = color;
      brush.shadow = softEdge(color, hardness, width);
  }
}
