import { Blend, Highlighter, PaintBucket, Paintbrush, type LucideIcon } from "lucide-react";
import type { Tool } from "@/types/editor";

export interface GroupedToolDef<T extends Tool> {
  id: T;
  icon: LucideIcon;
  /** Tooltip, with the group's key. */
  label: string;
  name: string;
  description: string;
}

/** The tools behind the Brush button, as in Photoshop's brush group. */
export type BrushTool = "brush" | "draw";

export const BRUSH_TOOLS: GroupedToolDef<BrushTool>[] = [
  {
    id: "brush",
    icon: Paintbrush,
    label: "Brush (B)",
    name: "Brush",
    description: "Paints pixels on the selected layer",
  },
  {
    id: "draw",
    icon: Highlighter,
    label: "Marker (B)",
    name: "Marker",
    description: "Draws strokes you can move and restyle",
  },
];

export const isBrushTool = (tool: Tool): tool is BrushTool => tool === "brush" || tool === "draw";

/** The tools behind the fill button: Photoshop's gradient group. */
export type FillTool = "bucket" | "gradient";

export const FILL_TOOLS: GroupedToolDef<FillTool>[] = [
  {
    id: "bucket",
    icon: PaintBucket,
    label: "Paint bucket (G)",
    name: "Paint bucket",
    description: "Fills the area around a click",
  },
  {
    id: "gradient",
    icon: Blend,
    label: "Gradient (G)",
    name: "Gradient",
    description: "Drag to blend from one colour to another",
  },
];

export const isFillTool = (tool: Tool): tool is FillTool => tool === "bucket" || tool === "gradient";
