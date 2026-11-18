import {
  Blend,
  CircleDashed,
  Highlighter,
  Lasso,
  PaintBucket,
  Paintbrush,
  SquareDashed,
  WandSparkles,
  Pentagon,
  type LucideIcon,
} from "lucide-react";
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

/** The marquee tools behind the selection button (M). */
export type MarqueeTool = "marquee" | "ellipseMarquee";

export const MARQUEE_TOOLS: GroupedToolDef<MarqueeTool>[] = [
  {
    id: "marquee",
    icon: SquareDashed,
    label: "Rectangle select (M)",
    name: "Rectangle select",
    description: "Drag to select a rectangle",
  },
  {
    id: "ellipseMarquee",
    icon: CircleDashed,
    label: "Ellipse select (M)",
    name: "Ellipse select",
    description: "Drag to select an ellipse",
  },
];

export const isMarqueeTool = (tool: Tool): tool is MarqueeTool =>
  tool === "marquee" || tool === "ellipseMarquee";

/** The freehand selection tools and the magic wand (L, W). */
export type LassoTool = "lasso" | "polygonLasso" | "magicWand";

export const LASSO_TOOLS: GroupedToolDef<LassoTool>[] = [
  {
    id: "lasso",
    icon: Lasso,
    label: "Lasso (L)",
    name: "Lasso",
    description: "Drag around what to select",
  },
  {
    id: "polygonLasso",
    icon: Pentagon,
    label: "Polygonal lasso (L)",
    name: "Polygonal lasso",
    description: "Click corner by corner around what to select",
  },
  {
    id: "magicWand",
    icon: WandSparkles,
    label: "Magic wand (W)",
    name: "Magic wand",
    description: "Click a colour to select the area like it",
  },
];

export const isLassoTool = (tool: Tool): tool is LassoTool =>
  tool === "lasso" || tool === "polygonLasso" || tool === "magicWand";

/** Tools that draw a pixel selection. */
export const isSelectionTool = (tool: Tool): boolean => isMarqueeTool(tool) || isLassoTool(tool);
