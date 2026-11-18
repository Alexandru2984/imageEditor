import type { ReactNode } from "react";
import {
  Crop,
  Eraser,
  Layers,
  Magnet,
  MousePointer2,
  PaintBucket,
  Spline,
  Highlighter,
  Paintbrush,
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
import {
  PAINT_SLIDER_STEPS,
  paintSizeToSlider,
  sliderToPaintSize,
  type PaintOptions,
} from "@/raster/paintSettings";
import type { BucketOptions } from "@/raster/fill";
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
  /** Colour wells for phones, where the tools have no room for them. */
  colors?: ReactNode;
  brush: BrushSettings;
  onBrushKindChange: (kind: BrushKind) => void;
  onBrushWidthChange: (width: number) => void;
  onBrushHardnessChange: (hardness: number) => void;
  onBrushOpacityChange: (opacity: number) => void;
  /** Pixel brush and eraser. */
  paint: PaintOptions;
  onPaintChange: (change: Partial<PaintOptions>) => void;
  bucket: BucketOptions;
  onBucketChange: (change: Partial<BucketOptions>) => void;
  snapping: boolean;
  onSnappingChange: (enabled: boolean) => void;
}

const TOOL_INFO: Record<string, { icon: LucideIcon; name: string; hint: string }> = {
  select: {
    icon: MousePointer2,
    name: "Move",
    hint: "Shift-click adds layers to the selection · Alt-drag moves without snapping",
  },
  brush: {
    icon: Paintbrush,
    name: "Brush",
    hint: "Paints on the selected pixel layer, or on a new one · Shift-click draws a line",
  },
  draw: { icon: Highlighter, name: "Marker", hint: "" },
  bucket: { icon: PaintBucket, name: "Paint bucket", hint: "" },
  eraser: {
    icon: Eraser,
    name: "Eraser",
    hint: "Erases pixels on the selected layer, otherwise drawings · The photo is protected",
  },
  shape: { icon: Shapes, name: "Shape", hint: "Click to place a shape, or drag to size it" },
  text: { icon: Type, name: "Text", hint: "Click to add text · Double-click a text layer to edit it" },
  marquee: {
    icon: SquareDashed,
    name: "Select region",
    hint: "Drag over the image, then blur, pixelate, copy or crop the region",
  },
  crop: { icon: Crop, name: "Crop", hint: "Drag the frame · Enter applies · Esc cancels" },
};

function ToggleOption({
  pressed,
  onChange,
  icon: Icon,
  label,
  title,
}: {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  icon: LucideIcon;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={() => onChange(!pressed)}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors [&_svg]:size-3.5",
        pressed
          ? "border-primary bg-primary/10 text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <Icon />
      {label}
    </button>
  );
}

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
  colors,
  brush,
  onBrushKindChange,
  onBrushWidthChange,
  onBrushHardnessChange,
  onBrushOpacityChange,
  paint,
  onPaintChange,
  bucket,
  onBucketChange,
  snapping,
  onSnappingChange,
}: OptionsBarProps) {
  const shape = isShapeKind(activeTool);
  const info = TOOL_INFO[shape ? "shape" : activeTool] ?? TOOL_INFO.select!;
  const painting =
    activeTool === "draw" ||
    activeTool === "brush" ||
    activeTool === "eraser" ||
    activeTool === "bucket";
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

  const percentSetting = (
    label: string,
    key: "hardness" | "opacity" | "flow",
    min: number,
    keys?: string
  ) => (
    <Setting label={label} value={`${paint[key]}%`} keys={keys}>
      <Slider
        value={[paint[key]]}
        aria-label={`Brush ${key}`}
        min={min}
        max={100}
        step={1}
        onValueChange={(value) => onPaintChange({ [key]: value[0] ?? paint[key] })}
        className={sliderClass}
      />
    </Setting>
  );

  let options: ReactNode = null;
  if (activeTool === "brush" || activeTool === "eraser") {
    options = (
      <>
        <Setting label="Size" value={`${paint.size}px`} keys="[ and ] change the size">
          <Slider
            value={[paintSizeToSlider(paint.size)]}
            aria-label="Brush size"
            aria-valuetext={`${paint.size} pixels`}
            min={0}
            max={PAINT_SLIDER_STEPS}
            step={1}
            onValueChange={(value) =>
              onPaintChange({ size: sliderToPaintSize(value[0] ?? paintSizeToSlider(paint.size)) })
            }
            className={sliderClass}
          />
        </Setting>
        {percentSetting("Hardness", "hardness", 0, "Shift+[ and Shift+] change the hardness")}
        {percentSetting("Opacity", "opacity", 1)}
        {percentSetting("Flow", "flow", 1)}
      </>
    );
  } else if (activeTool === "bucket") {
    options = (
      <>
        <Setting label="Tolerance" value={`${bucket.tolerance}`}>
          <Slider
            value={[bucket.tolerance]}
            aria-label="Fill tolerance"
            min={0}
            max={255}
            step={1}
            onValueChange={(value) => onBucketChange({ tolerance: value[0] ?? bucket.tolerance })}
            className={sliderClass}
          />
        </Setting>
        <Setting label="Opacity" value={`${bucket.opacity}%`}>
          <Slider
            value={[bucket.opacity]}
            aria-label="Fill opacity"
            min={1}
            max={100}
            step={1}
            onValueChange={(value) => onBucketChange({ opacity: value[0] ?? bucket.opacity })}
            className={sliderClass}
          />
        </Setting>
        <ToggleOption
          pressed={bucket.contiguous}
          onChange={(contiguous) => onBucketChange({ contiguous })}
          icon={Spline}
          label="Contiguous"
          title="Fill only the area connected to the click"
        />
        <ToggleOption
          pressed={bucket.sampleAll}
          onChange={(sampleAll) => onBucketChange({ sampleAll })}
          icon={Layers}
          label="All layers"
          title="Find the area from everything visible, not only this layer"
        />
      </>
    );
  } else if (activeTool === "draw") {
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
      <ToggleOption
        pressed={snapping}
        onChange={onSnappingChange}
        icon={Magnet}
        label="Snap to guides"
      />
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
      {compact && colors && (
        <>
          {colors}
          <Separator orientation="vertical" className="h-6" />
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
