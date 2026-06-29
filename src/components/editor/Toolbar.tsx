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
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tool } from "@/types/editor";
import { toast } from "sonner";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  fabricCanvas: any;
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
  { id: "crop", icon: Crop, label: "Crop (K)" },
];

export const Toolbar = ({
  activeTool,
  onToolChange,
  fabricCanvas,
  isMobile,
}: ToolbarProps) => {
  const handleDelete = () => {
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject) {
      fabricCanvas.remove(activeObject);
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
      toast.success("Object deleted!");
    } else {
      toast.error("No object selected");
    }
  };

  const handleClear = () => {
    if (!fabricCanvas) return;
    const objects = fabricCanvas.getObjects();
    // Keep the background image (first non-selectable object)
    const bgImage = objects.find((obj: any) => !obj.selectable);
    fabricCanvas.clear();
    if (bgImage) {
      fabricCanvas.add(bgImage);
      fabricCanvas.sendObjectToBack(bgImage);
    }
    fabricCanvas.backgroundColor = "#1a1a1a";
    fabricCanvas.renderAll();
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

  // Mobile: horizontal bottom bar
  if (isMobile) {
    return (
      <div className="h-14 bg-[hsl(var(--editor-panel))] border-t border-border flex items-center justify-center px-2 gap-0.5 overflow-x-auto">
        {drawingTools.map(renderToolButton)}
        <Separator orientation="vertical" className="h-8 mx-1" />
        {shapeTools.map(renderToolButton)}
        <Separator orientation="vertical" className="h-8 mx-1" />
        {otherTools.map(renderToolButton)}
        <Separator orientation="vertical" className="h-8 mx-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
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

      <div className="flex-1" />

      <Separator className="my-1.5 w-8" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
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
