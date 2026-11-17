import { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  Circle,
  Triangle,
  Star,
  Minus,
  MoveUpRight,
  Type,
  Crop,
  SquareDashed,
  Trash2,
  XCircle,
  ImagePlus,
  Pipette,
  Smile,
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
import {
  isEditorChrome,
  isProtectedObject,
  removeSelectedObjects,
} from "@/utils/editorObjects";
import { isShapeKind, type ShapeKind } from "@/utils/shapes";
import { STICKER_FONT, STICKER_GROUPS, addSticker } from "@/utils/stickers";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  fabricCanvas: FabricCanvas | null;
  orientation: "vertical" | "horizontal";
  onEyedropper: () => void;
}

type ToolDef = { id: Tool; icon: typeof MousePointer2; label: string };

const PRIMARY_TOOLS: ToolDef[] = [
  { id: "select", icon: MousePointer2, label: "Select (V)" },
  { id: "draw", icon: Pencil, label: "Draw (B)" },
  { id: "eraser", icon: Eraser, label: "Eraser (E)" },
];

const SHAPE_TOOLS: (ToolDef & { id: ShapeKind; name: string })[] = [
  { id: "rectangle", icon: Square, label: "Rectangle (R)", name: "Rectangle" },
  { id: "circle", icon: Circle, label: "Ellipse (C)", name: "Ellipse" },
  { id: "triangle", icon: Triangle, label: "Triangle (Y)", name: "Triangle" },
  { id: "star", icon: Star, label: "Star (S)", name: "Star" },
  { id: "line", icon: Minus, label: "Line (L)", name: "Line" },
  { id: "arrow", icon: MoveUpRight, label: "Arrow (A)", name: "Arrow" },
];

const SECONDARY_TOOLS: ToolDef[] = [
  { id: "text", icon: Type, label: "Text (T)" },
  { id: "marquee", icon: SquareDashed, label: "Select region (M)" },
  { id: "crop", icon: Crop, label: "Crop (K)" },
];

const ACTIVE_CLASS =
  "bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:bg-primary hover:text-primary-foreground";
const IDLE_CLASS = "text-muted-foreground hover:text-foreground";

export const Toolbar = ({
  activeTool,
  onToolChange,
  fabricCanvas,
  orientation,
  onEyedropper,
}: ToolbarProps) => {
  const vertical = orientation === "vertical";
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageLoadControllerRef = useRef<AbortController | null>(null);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [lastShape, setLastShape] = useState<ShapeKind>("rectangle");
  const tooltipSide = vertical ? "right" : "top";

  useEffect(() => {
    if (isShapeKind(activeTool)) setLastShape(activeTool);
  }, [activeTool]);

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

  const handleClear = () => {
    if (!fabricCanvas) return;
    const removable = fabricCanvas
      .getObjects()
      .filter((object) => !isEditorChrome(object) && !isProtectedObject(object));
    if (removable.length === 0) {
      toast("Nothing to clear: only the photo and locked layers remain");
      return;
    }
    fabricCanvas.discardActiveObject();
    fabricCanvas.remove(...removable);
    fabricCanvas.requestRenderAll();
    toast.success(`Cleared ${removable.length} layer${removable.length === 1 ? "" : "s"}`, {
      description: "Press Ctrl+Z to bring them back.",
    });
  };

  const buttonSize = "h-10 w-10 shrink-0";

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
  const ShapeIcon = SHAPE_TOOLS.find((tool) => tool.id === lastShape)?.icon ?? Square;

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
      {PRIMARY_TOOLS.map(renderTool)}
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
      <div className={vertical ? "min-h-2 flex-1" : "min-w-2 flex-1"} />
      {separator}
      {actionButton(Trash2, "Delete selected layer", "Delete selected (Del)", handleDelete, true)}
      {actionButton(XCircle, "Clear unlocked layers", "Clear all layers", handleClear, true)}
    </nav>
  );
};
