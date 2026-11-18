import type { ReactNode } from "react";
import {
  Crop,
  Eraser,
  Magnet,
  MousePointer2,
  Pencil,
  Shapes,
  SquareDashed,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { BrushPreview } from "./BrushPreview";
import { SHAPE_TOOLS } from "./shapeTools";
import { BRUSHES, BRUSH_WIDTH_MAX, BRUSH_WIDTH_MIN, type BrushKind } from "@/utils/brushes";
import { isShapeKind } from "@/utils/shapes";
import type { Tool } from "@/types/editor";
import { cn } from "@/lib/utils";

export interface BrushSettings {
  kind: BrushKind;
  width: number;
  hardness: number;
  opacity: number;
}

interface OptionsBarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  /** Phones: a strip above the tools, shown only for tools with settings. */
  compact: boolean;
  activeColor: string;
  brush: BrushSettings;
  onBrushKindChange: (kind: BrushKind) => void;
  onBrushWidthChange: (width: number) => void;
  onBrushHardnessChange: (hardness: number) => void;
  onBrushOpacityChange: (opacity: number) => void;
  snapping: boolean;
  onSnappingChange: (enabled: boolean) => void;
}

const TOOL_INFO: Record<string, { icon: LucideIcon; name: string; hint: string }> = {
  select: {
    icon: MousePointer2,
    name: "Move",
    hint: "Shift-click adds layers to the selection · Alt-drag moves without snapping",
  },
  draw: { icon: Pencil, name: "Brush", hint: "" },
  eraser: { icon: Eraser, name: "Eraser", hint: "The photo and locked layers are protected" },
  shape: { icon: Shapes, name: "Shape", hint: "Click to place a shape, or drag to size it" },
  text: { icon: Type, name: "Text", hint: "Click to add text · Double-click a text layer to edit it" },
  marquee: {
    icon: SquareDashed,
    name: "Select region",
    hint: "Drag over the image, then blur, pixelate, copy or crop the region",
  },
  crop: { icon: Crop, name: "Crop", hint: "Drag the frame · Enter applies · Esc cancels" },
};

function Setting({
  label,
  value,
  keys,
  children,
}: {
  label: string;
  value: string;
  /** The keys that change it, for the tooltip. */
  keys?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2" title={keys}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      <span className="w-9 text-right text-xs tabular-nums text-foreground/80">{value}</span>
    </div>
  );
}

/**
 * Settings for the active tool, as in Photoshop's options bar: under the menu
 * bar on wide screens, above the tools on phones.
 */
export function OptionsBar({
  activeTool,
  onToolChange,
  compact,
  activeColor,
  brush,
  onBrushKindChange,
  onBrushWidthChange,
  onBrushHardnessChange,
  onBrushOpacityChange,
  snapping,
  onSnappingChange,
}: OptionsBarProps) {
  const shape = isShapeKind(activeTool);
  const info = TOOL_INFO[shape ? "shape" : activeTool] ?? TOOL_INFO.select!;
  const painting = activeTool === "draw" || activeTool === "eraser";
  const brushOption = BRUSHES.find((option) => option.kind === brush.kind);
  const sliderClass = compact ? "w-16" : "w-20 xl:w-28";

  // On a phone, space goes to the canvas unless there is something to set.
  if (compact && !painting && !shape) return null;

  const widthSetting = (
    <Setting label="Size" value={`${brush.width}px`} keys="[ and ] change the size">
      <Slider
        value={[brush.width]}
        aria-label="Brush width"
        min={BRUSH_WIDTH_MIN}
        max={BRUSH_WIDTH_MAX}
        step={1}
        onValueChange={(value) => onBrushWidthChange(value[0] ?? brush.width)}
        className={sliderClass}
      />
    </Setting>
  );

  let options: ReactNode = null;
  if (activeTool === "draw") {
    options = (
      <>
        <div role="radiogroup" aria-label="Brush type" className="flex shrink-0 items-center gap-1">
          {BRUSHES.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={brush.kind === option.kind}
              aria-label={option.label}
              title={option.label}
              onClick={() => onBrushKindChange(option.kind)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                brush.kind === option.kind
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <BrushPreview kind={option.kind} color={activeColor} />
              {!compact && <span className="hidden xl:inline">{option.label}</span>}
            </button>
          ))}
        </div>
        <Separator orientation="vertical" className="h-5" />
        {widthSetting}
        {brushOption?.usesHardness !== false && (
          <Setting
            label="Hardness"
            value={`${brush.hardness}%`}
            keys="Shift+[ and Shift+] change the hardness"
          >
            <Slider
              value={[brush.hardness]}
              aria-label="Brush hardness"
              min={0}
              max={100}
              step={1}
              onValueChange={(value) => onBrushHardnessChange(value[0] ?? brush.hardness)}
              className={sliderClass}
            />
          </Setting>
        )}
        <Setting label="Opacity" value={`${brush.opacity}%`}>
          <Slider
            value={[brush.opacity]}
            aria-label="Brush opacity"
            min={10}
            max={100}
            step={1}
            onValueChange={(value) => onBrushOpacityChange(value[0] ?? brush.opacity)}
            className={sliderClass}
          />
        </Setting>
      </>
    );
  } else if (activeTool === "eraser") {
    options = widthSetting;
  } else if (shape) {
    options = (
      <div role="radiogroup" aria-label="Shape" className="flex shrink-0 items-center gap-1">
        {SHAPE_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="radio"
            aria-checked={activeTool === tool.id}
            aria-label={tool.name}
            title={tool.name}
            onClick={() => onToolChange(tool.id)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border transition-colors [&_svg]:size-4",
              activeTool === tool.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <tool.icon />
          </button>
        ))}
      </div>
    );
  } else if (activeTool === "select") {
    options = (
      <button
        type="button"
        aria-pressed={snapping}
        onClick={() => onSnappingChange(!snapping)}
        className={cn(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors [&_svg]:size-3.5",
          snapping
            ? "border-primary bg-primary/10 text-foreground"
            : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <Magnet />
        Snap to guides
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Tool options"
      className={cn(
        "flex shrink-0 items-center gap-3 overflow-x-auto overscroll-x-contain bg-editor-panel px-3 [scrollbar-width:none]",
        compact
          ? // Fades at the edge: there is more to scroll to.
            "h-12 border-t border-border [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] pr-8"
          : "h-11 border-b border-border"
      )}
    >
      {!compact && (
        <>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground/80 [&_svg]:size-4 [&_svg]:text-muted-foreground">
            <info.icon />
            <span className={cn(options !== null && "hidden lg:inline")}>{info.name}</span>
          </span>
          {options !== null && <Separator orientation="vertical" className="h-5" />}
        </>
      )}
      {options}
      {!compact && info.hint && (
        <span
          className={cn(
            "min-w-0 truncate text-xs text-muted-foreground",
            options !== null && "ml-auto hidden pl-4 lg:block"
          )}
        >
          {info.hint}
        </span>
      )}
    </div>
  );
}
