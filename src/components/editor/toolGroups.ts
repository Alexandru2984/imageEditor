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
  Stamp,
  Bandage,
  Syringe,
  Lollipop,
  Hand,
  Droplets,
  Droplet,
  Triangle,
  Pointer,
  Puzzle,
  Move,
  Eye,
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

export const CLONE_STAMP_TOOL: GroupedToolDef<"cloneStamp"> = {
  id: "cloneStamp",
  icon: Stamp,
  label: "Clone stamp (S)",
  name: "Clone stamp",
  description: "Alt-click a source, then paint its pixels elsewhere",
};

/** Photoshop's healing group (J). */
export type HealingTool = "spotHealing" | "healingBrush" | "patch" | "contentAwareMove" | "redEye";

export const HEALING_TOOLS: GroupedToolDef<HealingTool>[] = [
  {
    id: "spotHealing",
    icon: Bandage,
    label: "Spot healing brush (J)",
    name: "Spot healing brush",
    description: "Paint over a blemish to rebuild it from around it",
  },
  {
    id: "healingBrush",
    icon: Syringe,
    label: "Healing brush (J)",
    name: "Healing brush",
    description: "Alt-click a source; the copy blends into where it lands",
  },
  {
    id: "patch",
    icon: Puzzle,
    label: "Patch (J)",
    name: "Patch",
    description: "Draw around a flaw, then drag it onto a clean area",
  },
  {
    id: "contentAwareMove",
    icon: Move,
    label: "Content-aware move (J)",
    name: "Content-aware move",
    description: "Draw around something, then drag it; the gap fills in",
  },
  {
    id: "redEye",
    icon: Eye,
    label: "Red eye (J)",
    name: "Red eye",
    description: "Click a red pupil, or drag a box around the eye",
  },
];

export const isHealingTool = (tool: Tool): tool is HealingTool =>
  tool === "spotHealing" || tool === "healingBrush" || tool === "patch" || tool === "contentAwareMove" || tool === "redEye";

/** Patch and Content-Aware Move: they draw a selection, and act when it is dragged. */
export const isPatchingTool = (tool: Tool): tool is "patch" | "contentAwareMove" => tool === "patch" || tool === "contentAwareMove";

/** Photoshop's toning group (O). */
export type ToningTool = "dodge" | "burn" | "sponge";

export const TONING_TOOLS: GroupedToolDef<ToningTool>[] = [
  { id: "dodge", icon: Lollipop, label: "Dodge (O)", name: "Dodge", description: "Paint to lighten" },
  { id: "burn", icon: Hand, label: "Burn (O)", name: "Burn", description: "Paint to darken" },
  { id: "sponge", icon: Droplets, label: "Sponge (O)", name: "Sponge", description: "Paint to add or take away colour" },
];

export const isToningTool = (tool: Tool): tool is ToningTool => tool === "dodge" || tool === "burn" || tool === "sponge";

/** Photoshop's focus group: blur, sharpen, smudge. */
export type FocusTool = "blur" | "sharpen" | "smudge";

export const FOCUS_TOOLS: GroupedToolDef<FocusTool>[] = [
  { id: "blur", icon: Droplet, label: "Blur", name: "Blur", description: "Paint to soften" },
  { id: "sharpen", icon: Triangle, label: "Sharpen", name: "Sharpen", description: "Paint to crisp up edges" },
  { id: "smudge", icon: Pointer, label: "Smudge", name: "Smudge", description: "Drag colour along" },
];

export const isFocusTool = (tool: Tool): tool is FocusTool => tool === "blur" || tool === "sharpen" || tool === "smudge";

/** Tools that rework a layer's own pixels as they paint. */
export const isRetouchTool = (tool: Tool): boolean =>
  tool === "cloneStamp" || tool === "spotHealing" || tool === "healingBrush" || isToningTool(tool) || isFocusTool(tool);

/** Retouching tools that copy from a source the user sets (Alt-click). */
export const needsCloneSource = (tool: Tool): boolean => tool === "cloneStamp" || tool === "healingBrush";

/** Tools that paint with the pixel brush's size and hardness. */
export const usesPaintBrush = (tool: Tool): boolean => tool === "brush" || tool === "eraser" || isRetouchTool(tool);

/** Tools that draw a pixel selection. */
export const isSelectionTool = (tool: Tool): boolean => isMarqueeTool(tool) || isLassoTool(tool);
