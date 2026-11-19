import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { histogramPath } from "./histogramPath";

interface HistogramChartProps {
  bins: Uint32Array;
  /** Fill colour of the bars (a CSS colour). */
  color?: string;
  className?: string;
  /** Height of the drawing in its own units (the width is always 256). */
  height?: number;
}

export function HistogramChart({ bins, color = "currentColor", className, height = 100 }: HistogramChartProps) {
  const path = useMemo(() => histogramPath(bins, height), [bins, height]);
  return (
    <svg
      viewBox={`0 0 256 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("block w-full", className)}
    >
      <path d={path} fill={color} />
    </svg>
  );
}
