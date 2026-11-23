import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MousePointer2,
  Eraser,
  Type,
  Crop,
  Trash2,
  ImagePlus,
  Pipette,
  Smile,
  PenTool,
  MousePointer,
} from "lucide-react";
import type { Canvas as FabricCanvas } from "fabric";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Tool } from "@/types/editor";
import { toast } from "sonner";
import { RASTER_FILE_ACCEPT, readSafeRasterImage } from "@/utils/imageFile";
import { addImageLayer } from "@/utils/canvasActions";
import { removeSelectedObjects } from "@/utils/editorObjects";
import { isShapeKind, type ShapeKind } from "@/utils/shapes";
import { STICKER_FONT, STICKER_GROUPS, addSticker } from "@/utils/stickers";
import { cn } from "@/lib/utils";
import { SHAPE_TOOLS } from "./shapeTools";
import {
  BRUSH_TOOLS,
  CLONE_STAMP_TOOL,
  HEALING_TOOLS,
  TONING_TOOLS,
  FOCUS_TOOLS,
  FILL_TOOLS,
  LASSO_TOOLS,
  MARQUEE_TOOLS,
  type BrushTool,
  type FillTool,
  type HealingTool,
  type ToningTool,
  type FocusTool,
  type LassoTool,
  type MarqueeTool,
} from "./toolGroups";
import { ToolGroupButton } from "./ToolGroupButton";
import { ACTIVE_TOOL_CLASS, IDLE_TOOL_CLASS } from "./toolStyles";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  /** The shape the Shapes button (and the U key) arms. */
  lastShape: ShapeKind;
  /** The tool the Brush button (and the B key) arms. */
  lastBrushTool: BrushTool;
  /** The tool the fill button (and the G key) arms. */
  lastFillTool: FillTool;
  /** The tool the healing button (and the J key) arms. */
  lastHealingTool: HealingTool;
  /** The tool the toning button (and the O key) arms. */
  lastToningTool: ToningTool;
  /** The tool the blur/sharpen/smudge button arms. */
  lastFocusTool: FocusTool;
  /** The tool the selection button (and the M key) arms. */
  lastMarqueeTool: MarqueeTool;
  /** The tool the lasso button arms. */
  lastLassoTool: LassoTool;
  fabricCanvas: FabricCanvas | null;
  orientation: "vertical" | "horizontal";
  onEyedropper: () => void;
  /** Foreground and background colours (the vertical toolbar only). */
  colors?: ReactNode;
}

type ToolDef = { id: Tool; icon: typeof MousePointer2; label: string };

const SELECT_TOOL: ToolDef = { id: "select", icon: MousePointer2, label: "Select (V)" };
const ERASER_TOOL: ToolDef = { id: "eraser", icon: Eraser, label: "Eraser (E)" };


const SECONDARY_TOOLS: ToolDef[] = [
  { id: "pen", icon: PenTool, label: "Pen (P)" },
  { id: "directSelect", icon: MousePointer, label: "Direct selection (A)" },
  { id: "text", icon: Type, label: "Text (T)" },
  { id: "crop", icon: Crop, label: "Crop (C)" },
];

const ACTIVE_CLASS = ACTIVE_TOOL_CLASS;
const IDLE_CLASS = IDLE_TOOL_CLASS;

export const Toolbar = ({
  activeTool,
  onToolChange,
  lastShape,
  lastBrushTool,
  lastFillTool,
  lastHealingTool,
  lastToningTool,
  lastFocusTool,
  lastMarqueeTool,
  lastLassoTool,
  fabricCanvas,
  orientation,
  onEyedropper,
  colors,
}: ToolbarProps) => {
  const vertical = orientation === "vertical";
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageLoadControllerRef = useRef<AbortController | null>(null);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const tooltipSide = vertical ? "right" : "top";

  useEffect(
    () => () => {
      imageLoadControllerRef.current?.abort();
      imageLoadControllerRef.current = null;
    },
    [fabricCanvas]
  );

  const handleAddImageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !fabricCanvas) return;

    imageLoadControllerRef.current?.abort();
    const controller = new AbortController();
    imageLoadControllerRef.current = controller;
    try {
      const { dataUrl } = await readSafeRasterImage(file, controller.signal);
      if (controller.signal.aborted) return;
      const image = await addImageLayer(fabricCanvas, dataUrl, { signal: controller.signal });
      if (!image) return;
      onToolChange("select");
      toast.success("Image added as a new layer");
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "Failed to add the image");
      }
    } finally {
      if (imageLoadControllerRef.current === controller) {
        imageLoadControllerRef.current = null;
      }
    }
  };

  const handleDelete = () => {
    if (!fabricCanvas) return;
    if (!fabricCanvas.getActiveObject()) {
      toast.error("Select a layer to delete");
      return;
    }
    const removed = removeSelectedObjects(fabricCanvas);
    if (removed > 0) toast.success(removed === 1 ? "Layer deleted" : `${removed} layers deleted`);
    else toast.error("Unlock the layer before deleting it");
  };

  // Vertical buttons are a little smaller, so the tools fit a laptop screen.
  const buttonSize = vertical ? "h-9 w-9 shrink-0" : "h-10 w-10 shrink-0";

  const renderTool = (tool: ToolDef) => {
    const Icon = tool.icon;
    const isActive = activeTool === tool.id;
    return (
      <Tooltip key={tool.id}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tool.label}
            aria-pressed={isActive}
            onClick={() => onToolChange(tool.id)}
            className={cn(buttonSize, isActive ? ACTIVE_CLASS : IDLE_CLASS)}
          >
            <Icon className="h-[18px] w-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>{tool.label}</TooltipContent>
      </Tooltip>
    );
  };

  const shapeActive = isShapeKind(activeTool);
  const ShapeIcon = (SHAPE_TOOLS.find((tool) => tool.id === lastShape) ?? SHAPE_TOOLS[0]!).icon;

  const shapesButton = (
    <Popover open={shapesOpen} onOpenChange={setShapesOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Shapes"
              aria-pressed={shapeActive}
              className={cn(buttonSize, "relative", shapeActive ? ACTIVE_CLASS : IDLE_CLASS)}
            >
              <ShapeIcon className="h-[18px] w-[18px]" />
              <span
                aria-hidden="true"
                className="absolute bottom-1 right-1 h-0 w-0 border-l-[4px] border-t-[4px] border-l-transparent border-t-current opacity-70 [transform:rotate(-90deg)]"
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>Shapes</TooltipContent>
      </Tooltip>
      <PopoverContent side={vertical ? "right" : "top"} align="start" className="w-auto p-1.5">
        <div className="grid grid-cols-3 gap-1">
          {SHAPE_TOOLS.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                aria-label={tool.label}
                aria-pressed={isActive}
                onClick={() => {
                  onToolChange(tool.id);
                  setShapesOpen(false);
                }}
                className={cn(
                  "flex w-[4.5rem] flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {tool.name}
              </button>
            );
          })}
        </div>
        <p className="max-w-[13.5rem] px-1.5 pb-0.5 pt-1.5 text-[11px] leading-snug text-muted-foreground">
          Tap to place, drag to draw. Hold Shift to constrain.
        </p>
      </PopoverContent>
    </Popover>
  );

  const stickersButton = (
    <Popover open={stickersOpen} onOpenChange={setStickersOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Stickers"
              className={cn(buttonSize, IDLE_CLASS)}
            >
              <Smile className="h-[18px] w-[18px]" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>Stickers</TooltipContent>
      </Tooltip>
      <PopoverContent
        side={vertical ? "right" : "top"}
        align="start"
        className="max-h-[min(24rem,60dvh)] w-[19rem] overflow-y-auto p-2"
      >
        {STICKER_GROUPS.map((group) => (
          <div key={group.title} className="mb-2 last:mb-0">
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {group.title}
            </p>
            <div className="grid grid-cols-8 gap-0.5">
              {group.items.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Add sticker ${emoji}`}
                  onClick={() => {
                    if (!fabricCanvas) return;
                    addSticker(fabricCanvas, emoji);
                    onToolChange("select");
                    setStickersOpen(false);
                  }}
                  className="flex aspect-square items-center justify-center rounded-md text-[22px] leading-none transition-transform hover:scale-110 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ fontFamily: STICKER_FONT }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );

  const actionButton = (
    Icon: typeof Trash2,
    label: string,
    tooltip: string,
    onClick: () => void,
    destructive = false
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={onClick}
          className={cn(
            buttonSize,
            "text-muted-foreground",
            destructive ? "hover:text-destructive" : "hover:text-foreground"
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );

  const separator = (
    <Separator
      orientation={vertical ? "horizontal" : "vertical"}
      className={vertical ? "my-1 !w-7 shrink-0" : "mx-1 !h-7 shrink-0"}
    />
  );

  return (
    <nav
      aria-label="Tools"
      className={cn(
        "scrollbar-none bg-editor-panel",
        vertical
          ? "flex h-full w-14 flex-col items-center gap-1 overflow-y-auto border-r border-border py-2"
          : "flex w-full items-center gap-1 overflow-x-auto border-t border-border px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5"
      )}
    >
      {renderTool(SELECT_TOOL)}
      <ToolGroupButton
        tools={MARQUEE_TOOLS}
        current={lastMarqueeTool}
        activeTool={activeTool}
        onToolChange={onToolChange}
        className={buttonSize}
        side={tooltipSide}
      />
      <ToolGroupButton
        tools={LASSO_TOOLS}
        current={lastLassoTool}
        activeTool={activeTool}
        onToolChange={onToolChange}
        className={buttonSize}
        side={tooltipSide}
      />
      <ToolGroupButton
        tools={BRUSH_TOOLS}
        current={lastBrushTool}
        activeTool={activeTool}
        onToolChange={onToolChange}
        className={buttonSize}
        side={tooltipSide}
      />
      <ToolGroupButton
        tools={HEALING_TOOLS}
        current={lastHealingTool}
        activeTool={activeTool}
        onToolChange={onToolChange}
        className={buttonSize}
        side={tooltipSide}
      />
      {renderTool(CLONE_STAMP_TOOL)}
      {renderTool(ERASER_TOOL)}
      <ToolGroupButton
        tools={FILL_TOOLS}
        current={lastFillTool}
        activeTool={activeTool}
        onToolChange={onToolChange}
        className={buttonSize}
        side={tooltipSide}
      />
      <ToolGroupButton
        tools={FOCUS_TOOLS}
        current={lastFocusTool}
        activeTool={activeTool}
        onToolChange={onToolChange}
        className={buttonSize}
        side={tooltipSide}
      />
      <ToolGroupButton
        tools={TONING_TOOLS}
        current={lastToningTool}
        activeTool={activeTool}
        onToolChange={onToolChange}
        className={buttonSize}
        side={tooltipSide}
      />
      {separator}
      {shapesButton}
      {SECONDARY_TOOLS.map(renderTool)}
      {stickersButton}
      {separator}
      {actionButton(ImagePlus, "Add image layer", "Add image layer", () =>
        imageInputRef.current?.click()
      )}
      {actionButton(Pipette, "Pick color", "Pick a color (I)", onEyedropper)}
      <input
        ref={imageInputRef}
        type="file"
        accept={RASTER_FILE_ACCEPT}
        onChange={handleAddImageFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      {vertical && colors && (
        <>
          {separator}
          <div className="py-1">{colors}</div>
        </>
      )}
      <div className={vertical ? "min-h-2 flex-1" : "min-w-2 flex-1"} />
      {separator}
      {actionButton(Trash2, "Delete selected layer", "Delete selected (Del)", handleDelete, true)}
    </nav>
  );
};
