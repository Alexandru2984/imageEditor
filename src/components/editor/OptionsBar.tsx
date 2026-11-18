import type { ReactNode } from "react";
import {
  Crop,
  Eraser,
  ArrowLeftRight,
  Blend,
  CircleDashed,
  Layers,
  Magnet,
  MousePointer2,
  PaintBucket,
  Spline,
  Highlighter,
  Lasso,
  Paintbrush,
  Pentagon,
  WandSparkles,
  Shapes,
  SquareDashed,
  Type,
  CircleDot,
  X,
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
import type { GradientColors, GradientOptions, GradientType } from "@/raster/gradient";
import type { Tool } from "@/types/editor";
import type { SelectionMode } from "@/selection/mask";
import type { WandOptions } from "@/selection/magicWand";
import { cn } from "@/lib/utils";
import { isSelectionTool } from "./toolGroups";

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
  gradient: GradientOptions;
  onGradientChange: (change: Partial<GradientOptions>) => void;
  /** The background colour, shown in the gradient's colour choice. */
  secondaryColor: string;
  snapping: boolean;
  onSnappingChange: (enabled: boolean) => void;
  /** How a new selection shape joins the selection. */
  selectionMode: SelectionMode;
  onSelectionModeChange: (mode: SelectionMode) => void;
  wand: WandOptions;
  onWandChange: (change: Partial<WandOptions>) => void;
  /** The layer whose mask the pixel tools paint on, if any. */
  maskLayerName?: string | null;
  onLeaveMask?: () => void;
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
    hint: "Shift-click draws a straight line",
  },
  draw: { icon: Highlighter, name: "Marker", hint: "" },
  bucket: { icon: PaintBucket, name: "Paint bucket", hint: "" },
  gradient: { icon: Blend, name: "Gradient", hint: "" },
  eraser: {
    icon: Eraser,
    name: "Eraser",
    hint: "Erases pixels, or drawings when no pixel layer is selected",
  },
  shape: { icon: Shapes, name: "Shape", hint: "Click to place a shape, or drag to size it" },
  text: { icon: Type, name: "Text", hint: "Click to add text · Double-click a text layer to edit it" },
  marquee: {
    icon: SquareDashed,
    name: "Rectangle select",
    hint: "Shift adds · Alt subtracts · drag inside to move the selection",
  },
  ellipseMarquee: {
    icon: CircleDashed,
    name: "Ellipse select",
    hint: "Shift adds · Alt subtracts · drag inside to move the selection",
  },
  lasso: {
    icon: Lasso,
    name: "Lasso",
    hint: "Drag around what to select · Shift adds · Alt subtracts",
  },
  polygonLasso: {
    icon: Pentagon,
    name: "Polygonal lasso",
    hint: "Click the first corner or double-click to close · Backspace undoes a corner",
  },
  magicWand: {
    icon: WandSparkles,
    name: "Magic wand",
    hint: "Click a colour · Shift adds · Alt subtracts",
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

const SELECTION_MODES: { value: SelectionMode; label: string }[] = [
  { value: "replace", label: "New selection" },
  { value: "add", label: "Add to selection" },
  { value: "subtract", label: "Subtract from selection" },
  { value: "intersect", label: "Intersect with selection" },
];

/** Two overlapping squares, filled to show what each selection mode keeps. */
function SelectionModeIcon({ mode }: { mode: SelectionMode }) {
  const first = "M1.5 1.5h8v8h-8z";
  const second = "M6.5 6.5h8v8h-8z";
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1">
      {mode === "replace" && <path d="M2.5 2.5h11v11h-11z" fill="currentColor" fillOpacity="0.45" />}
      {mode === "add" && <path d="M1.5 1.5h8v5h5v8h-8v-5h-5z" fill="currentColor" fillOpacity="0.45" />}
      {mode === "subtract" && (
        <>
          <path d="M1.5 1.5h8v5h-3v3h-5z" fill="currentColor" fillOpacity="0.45" stroke="none" />
          <path d={first} />
          <path d={second} strokeDasharray="1.5 1" />
        </>
      )}
      {mode === "intersect" && (
        <>
          <path d="M6.5 6.5h3v3h-3z" fill="currentColor" fillOpacity="0.7" stroke="none" />
          <path d={first} strokeDasharray="1.5 1" />
          <path d={second} strokeDasharray="1.5 1" />
        </>
      )}
    </svg>
  );
}

/** A small set of mutually exclusive choices, as radio buttons. */
function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
  render,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  render: (option: { value: T; label: string }) => ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center gap-1">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-8 items-center rounded-md border px-1.5 transition-colors",
              checked
                ? "border-primary bg-primary/10 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {render(option)}
          </button>
        );
      })}
    </div>
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
  gradient,
  onGradientChange,
  secondaryColor,
  snapping,
  onSnappingChange,
  selectionMode,
  onSelectionModeChange,
  wand,
  onWandChange,
  maskLayerName,
  onLeaveMask,
}: OptionsBarProps) {
  const shape = isShapeKind(activeTool);
  const info = TOOL_INFO[shape ? "shape" : activeTool] ?? TOOL_INFO.select!;
  const painting =
    activeTool === "draw" ||
    activeTool === "brush" ||
    activeTool === "eraser" ||
    activeTool === "bucket" ||
    activeTool === "gradient";
  const brushOption = BRUSHES.find((option) => option.kind === brush.kind);
  const sliderClass = compact ? "w-16" : "w-20 xl:w-28";

  const selecting = isSelectionTool(activeTool);
  // On a phone, space goes to the canvas unless there is something to set.
  // The selection modes stand in for the modifier keys phones lack.
  if (compact && !painting && !shape && !selecting) return null;

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
  } else if (activeTool === "gradient") {
    const swatch = (colors: GradientColors) => {
      const end = colors === "foreground-background" ? secondaryColor : `${activeColor}00`;
      const [from, to] = gradient.reverse ? [end, activeColor] : [activeColor, end];
      return `linear-gradient(to right, ${from}, ${to}), repeating-conic-gradient(#d4d4d4 0 25%, #fff 0 50%) 0 0 / 8px 8px`;
    };
    options = (
      <>
        <Choice
          label="Gradient colors"
          value={gradient.colors}
          onChange={(colors) => onGradientChange({ colors })}
          options={[
            { value: "foreground-background", label: "Foreground to background" },
            { value: "foreground-transparent", label: "Foreground to transparent" },
          ]}
          render={(option) => (
            <span
              aria-hidden="true"
              className="block h-4 w-10 rounded-sm border border-border"
              style={{ background: swatch(option.value) }}
            />
          )}
        />
        <Choice
          label="Gradient type"
          value={gradient.type}
          onChange={(type) => onGradientChange({ type })}
          options={[
            { value: "linear" as GradientType, label: "Linear" },
            { value: "radial" as GradientType, label: "Radial" },
          ]}
          render={(option) => <span className="text-xs">{option.label}</span>}
        />
        <Setting label="Opacity" value={`${gradient.opacity}%`}>
          <Slider
            value={[gradient.opacity]}
            aria-label="Gradient opacity"
            min={1}
            max={100}
            step={1}
            onValueChange={(value) => onGradientChange({ opacity: value[0] ?? gradient.opacity })}
            className={sliderClass}
          />
        </Setting>
        <ToggleOption
          pressed={gradient.reverse}
          onChange={(reverse) => onGradientChange({ reverse })}
          icon={ArrowLeftRight}
          label="Reverse"
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
  } else if (selecting) {
    options = (
      <>
        <Choice
          label="Selection mode"
          value={selectionMode}
          onChange={onSelectionModeChange}
          options={SELECTION_MODES}
          render={(option) => <SelectionModeIcon mode={option.value} />}
        />
        {activeTool === "magicWand" && (
          <>
            <Setting label="Tolerance" value={`${wand.tolerance}`}>
              <Slider
                value={[wand.tolerance]}
                aria-label="Wand tolerance"
                min={0}
                max={255}
                step={1}
                onValueChange={(value) => onWandChange({ tolerance: value[0] ?? wand.tolerance })}
                className={sliderClass}
              />
            </Setting>
            <ToggleOption
              pressed={wand.contiguous}
              onChange={(contiguous) => onWandChange({ contiguous })}
              icon={Spline}
              label="Contiguous"
              title="Only the connected area, or every similar pixel"
            />
            <ToggleOption
              pressed={wand.sampleAll}
              onChange={(sampleAll) => onWandChange({ sampleAll })}
              icon={Layers}
              label="All layers"
              title="Judge by everything you see, or by the selected layer"
            />
          </>
        )}
      </>
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
      {maskLayerName && painting && activeTool !== "draw" && (
        <button
          type="button"
          onClick={onLeaveMask}
          aria-label="Stop painting on the layer mask"
          title={`Painting on the mask of ${maskLayerName}: black hides, white shows. Click to paint on the layer itself.`}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 text-xs text-foreground hover:bg-primary/20"
        >
          <CircleDot className="h-3.5 w-3.5 text-primary" />
          Layer mask
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
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
