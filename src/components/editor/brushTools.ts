import { Highlighter, Paintbrush, type LucideIcon } from "lucide-react";
import type { Tool } from "@/types/editor";

/** The tools behind the Brush button, as in Photoshop's brush group. */
export type BrushTool = "brush" | "draw";

export interface BrushToolDef {
  id: BrushTool;
  icon: LucideIcon;
  /** Tooltip, with the group's key. */
  label: string;
  name: string;
  description: string;
}

export const BRUSH_TOOLS: BrushToolDef[] = [
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
