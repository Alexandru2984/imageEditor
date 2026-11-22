import { Aperture, Blend, ChartColumn, CircleDashed, Contrast, Palette, Scale, Spline, SquareSplitHorizontal, SunMedium, SwatchBook, type LucideIcon } from "lucide-react";
import type { AdjustmentLayerKind } from "@/adjustments/adjustmentData";

/** The icon each kind of adjustment layer shows in menus and on its row. */
export const ADJUSTMENT_ICONS: Record<AdjustmentLayerKind, LucideIcon> = {
  brightnessContrast: SunMedium,
  levels: ChartColumn,
  curves: Spline,
  exposure: Aperture,
  hueSaturation: Palette,
  colorBalance: Scale,
  blackWhite: Contrast,
  gradientMap: Blend,
  posterize: SwatchBook,
  threshold: SquareSplitHorizontal,
  invert: CircleDashed,
};
