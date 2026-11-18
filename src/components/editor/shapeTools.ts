import { Circle, Minus, MoveUpRight, Square, Star, Triangle, type LucideIcon } from "lucide-react";
import type { ShapeKind } from "@/utils/shapes";

export interface ShapeTool {
  id: ShapeKind;
  icon: LucideIcon;
  /** Tooltip, with the tool's key. */
  label: string;
  name: string;
}

export const SHAPE_TOOLS: ShapeTool[] = [
  { id: "rectangle", icon: Square, label: "Rectangle (U)", name: "Rectangle" },
  { id: "circle", icon: Circle, label: "Ellipse (U)", name: "Ellipse" },
  { id: "triangle", icon: Triangle, label: "Triangle (U)", name: "Triangle" },
  { id: "star", icon: Star, label: "Star (U)", name: "Star" },
  { id: "line", icon: Minus, label: "Line (U)", name: "Line" },
  { id: "arrow", icon: MoveUpRight, label: "Arrow (U)", name: "Arrow" },
];
