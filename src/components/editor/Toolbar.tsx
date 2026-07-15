import { useEffect, useRef } from "react";
import {
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  Circle,
  Minus,
  MoveRight,
  Type,
  Crop,
  SquareDashed,
  Trash2,
  XCircle,
  ImagePlus,
} from "lucide-react";
import { FabricImage } from "fabric";
import type { Canvas as FabricCanvas } from "fabric";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tool } from "@/types/editor";
import { toast } from "sonner";
import { RASTER_FILE_ACCEPT, readSafeRasterImage } from "@/utils/imageFile";
import {
  isEditorChrome,
  isProtectedObject,
  removeSelectedObjects,
} from "@/utils/editorObjects";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  fabricCanvas: FabricCanvas | null;
  isMobile: boolean;
}

const drawingTools: { id: Tool; icon: typeof MousePointer2; label: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select (V)" },
  { id: "draw", icon: Pencil, label: "Draw (B)" },
  { id: "eraser", icon: Eraser, label: "Eraser (E)" },
];

const shapeTools: { id: Tool; icon: typeof MousePointer2; label: string }[] = [
  { id: "rectangle", icon: Square, label: "Rectangle (R)" },
  { id: "circle", icon: Circle, label: "Circle (C)" },
  { id: "line", icon: Minus, label: "Line (L)" },
  { id: "arrow", icon: MoveRight, label: "Arrow (A)" },
];

const otherTools: { id: Tool; icon: typeof MousePointer2; label: string }[] = [
  { id: "text", icon: Type, label: "Text (T)" },
  { id: "marquee", icon: SquareDashed, label: "Select region (M)" },
  { id: "crop", icon: Crop, label: "Crop (K)" },
];

export const Toolbar = ({
  activeTool,
  onToolChange,
  fabricCanvas,
  isMobile,
}: ToolbarProps) => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageLoadControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      imageLoadControllerRef.current?.abort();
      imageLoadControllerRef.current = null;
    },
    [fabricCanvas]
  );

  const handleAddImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !fabricCanvas) return;

    imageLoadControllerRef.current?.abort();
    const controller = new AbortController();
    imageLoadControllerRef.current = controller;
    try {
      const { dataUrl } = await readSafeRasterImage(file, controller.signal);
      if (controller.signal.aborted) return;
      const img = await FabricImage.fromURL(dataUrl, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        fabricCanvas.disposed ||
        fabricCanvas.destroyed
      ) {
        img.dispose();
        return;
      }

      // At most half the visible area, centered in the current viewport
      const viewZoom = fabricCanvas.getZoom() || 1;
      const scale = Math.min(
        (fabricCanvas.width / viewZoom) * 0.5 / img.width!,
        (fabricCanvas.height / viewZoom) * 0.5 / img.height!,
        1
      );
      img.scale(scale);

      const center = fabricCanvas.getVpCenter();
      img.set({
        left: center.x - (img.width! * scale) / 2,
        top: center.y - (img.height! * scale) / 2,
      });

      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      fabricCanvas.renderAll();
      onToolChange("select");
      toast.success("Image added!");
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(
          error instanceof Error ? error.message : "Failed to add the image"
        );
      }
    } finally {
      if (imageLoadControllerRef.current === controller) {
        imageLoadControllerRef.current = null;
      }
    }
  };

  const handleDelete = () => {
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject) {
      const removed = removeSelectedObjects(fabricCanvas);
      if (removed > 0) toast.success("Object deleted!");
      else toast.error("Unlock the layer before deleting it");
    } else {
      toast.error("No object selected");
    }
  };

  const handleClear = () => {
    if (!fabricCanvas) return;
    const removable = fabricCanvas
      .getObjects()
      .filter(
        (object) => !isEditorChrome(object) && !isProtectedObject(object)
      );
    if (removable.length > 0) fabricCanvas.remove(...removable);
    fabricCanvas.discardActiveObject();
    fabricCanvas.backgroundColor = "#1a1a1a";
    fabricCanvas.requestRenderAll();
    toast.success("Canvas cleared!");
  };

  const renderToolButton = (tool: {
    id: Tool;
    icon: typeof MousePointer2;
    label: string;
  }) => {
    const Icon = tool.icon;
    const isActive = activeTool === tool.id;

    return (
      <Tooltip key={tool.id}>
        <TooltipTrigger asChild>
          <Button
            variant={isActive ? "default" : "ghost"}
            size="icon"
            aria-label={tool.label}
            onClick={() => onToolChange(tool.id)}
            className={`w-10 h-10 ${
              isActive
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={isMobile ? "top" : "right"}>
          <p>{tool.label}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  const addImageButton = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add image layer"
            onClick={() => imageInputRef.current?.click()}
            className="w-10 h-10 text-muted-foreground hover:text-foreground"
          >
            <ImagePlus className="h-[18px] w-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={isMobile ? "top" : "right"}>
          <p>Add Image</p>
        </TooltipContent>
      </Tooltip>
      <input
        ref={imageInputRef}
        type="file"
        accept={RASTER_FILE_ACCEPT}
        onChange={handleAddImageFile}
        className="hidden"
      />
    </>
  );

  // Mobile: horizontal bottom bar
  if (isMobile) {
    return (
      <div className="h-14 bg-[hsl(var(--editor-panel))] border-t border-border flex items-center justify-center px-2 gap-0.5 overflow-x-auto">
        {drawingTools.map(renderToolButton)}
        <Separator orientation="vertical" className="h-8 mx-1" />
        {shapeTools.map(renderToolButton)}
        <Separator orientation="vertical" className="h-8 mx-1" />
        {otherTools.map(renderToolButton)}
        {addImageButton}
        <Separator orientation="vertical" className="h-8 mx-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete selected layer"
              onClick={handleDelete}
              className="w-10 h-10 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Delete Selected</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear unlocked layers"
              onClick={handleClear}
              className="w-10 h-10 text-muted-foreground hover:text-destructive"
            >
              <XCircle className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Clear All</p>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Desktop: vertical sidebar
  return (
    <div className="w-14 bg-[hsl(var(--editor-panel))] border-r border-border flex flex-col items-center py-3 gap-1">
      {drawingTools.map(renderToolButton)}

      <Separator className="my-1.5 w-8" />

      {shapeTools.map(renderToolButton)}

      <Separator className="my-1.5 w-8" />

      {otherTools.map(renderToolButton)}
      {addImageButton}

      <div className="flex-1" />

      <Separator className="my-1.5 w-8" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete selected layer"
            onClick={handleDelete}
            className="w-10 h-10 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Delete Selected</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear unlocked layers"
            onClick={handleClear}
            className="w-10 h-10 text-muted-foreground hover:text-destructive"
          >
            <XCircle className="h-[18px] w-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Clear All</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};
