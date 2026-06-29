import { MousePointer2, Pencil, Square, Circle, Type, Crop, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tool } from "./ImageEditor";
import { toast } from "sonner";

interface ToolbarProps {
  activeTool: Tool;
  onToolClick: (tool: Tool) => void;
  fabricCanvas: any;
}

export const Toolbar = ({ activeTool, onToolClick, fabricCanvas }: ToolbarProps) => {
  const handleClear = () => {
    if (!fabricCanvas) return;
    const objects = fabricCanvas.getObjects();
    // Keep the background image
    const bgImage = objects[0];
    fabricCanvas.clear();
    if (bgImage) {
      fabricCanvas.add(bgImage);
      fabricCanvas.sendObjectToBack(bgImage);
    }
    fabricCanvas.backgroundColor = "#1a1a1a";
    fabricCanvas.renderAll();
    toast.success("Canvas cleared!");
  };

  const handleDelete = () => {
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject) {
      fabricCanvas.remove(activeObject);
      toast.success("Object deleted!");
    }
  };

  const tools = [
    { id: "select" as Tool, icon: MousePointer2, label: "Select" },
    { id: "draw" as Tool, icon: Pencil, label: "Draw" },
    { id: "rectangle" as Tool, icon: Square, label: "Rectangle" },
    { id: "circle" as Tool, icon: Circle, label: "Circle" },
    { id: "text" as Tool, icon: Type, label: "Text" },
  ];

  return (
    <div className="w-16 bg-[hsl(var(--editor-panel))] border-r border-border flex flex-col items-center py-4 gap-2">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <Button
            key={tool.id}
            variant={activeTool === tool.id ? "default" : "ghost"}
            size="icon"
            onClick={() => onToolClick(tool.id)}
            title={tool.label}
            className="w-12 h-12"
          >
            <Icon className="h-5 w-5" />
          </Button>
        );
      })}
      
      <Separator className="my-2 w-10" />
      
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDelete}
        title="Delete Selected"
        className="w-12 h-12"
      >
        <Trash2 className="h-5 w-5" />
      </Button>
      
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClear}
        title="Clear All"
        className="w-12 h-12"
      >
        <Trash2 className="h-5 w-5 text-destructive" />
      </Button>
    </div>
  );
};
