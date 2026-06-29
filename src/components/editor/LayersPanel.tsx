import { useState, useEffect, useCallback } from "react";
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  ChevronUp,
  ChevronDown,
  Square,
  Circle,
  Minus,
  Type,
  Pencil,
  Image as ImageIcon,
  MoveRight,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LayerItem {
  id: number;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  fabricObject: any;
}

interface LayersPanelProps {
  fabricCanvas: any;
}

const getTypeIcon = (type: string) => {
  switch (type) {
    case "rect":
      return Square;
    case "circle":
    case "ellipse":
      return Circle;
    case "line":
      return Minus;
    case "path":
    case "pencilBrush":
      return Pencil;
    case "i-text":
    case "text":
    case "textbox":
      return Type;
    case "image":
      return ImageIcon;
    case "triangle":
    case "polygon":
      return MoveRight;
    default:
      return Square;
  }
};

const getLayerName = (obj: any, index: number): string => {
  if (obj.name) return obj.name;

  const type = obj.type || "object";
  switch (type) {
    case "rect":
      return `Rectangle ${index}`;
    case "circle":
      return `Circle ${index}`;
    case "ellipse":
      return `Ellipse ${index}`;
    case "line":
      return `Line ${index}`;
    case "path":
      return `Drawing ${index}`;
    case "i-text":
    case "text":
    case "textbox":
      return `Text ${index}`;
    case "image":
      return `Image ${index}`;
    case "triangle":
      return `Triangle ${index}`;
    case "polygon":
      return `Polygon ${index}`;
    case "group":
      return `Group ${index}`;
    default:
      return `Object ${index}`;
  }
};

export const LayersPanel = ({ fabricCanvas }: LayersPanelProps) => {
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null);

  const refreshLayers = useCallback(() => {
    if (!fabricCanvas) {
      setLayers([]);
      return;
    }

    const objects = fabricCanvas.getObjects();
    const layerItems: LayerItem[] = [];
    let counter = 1;

    for (const obj of objects) {
      // Skip background images (non-selectable)
      if (!obj.selectable && obj.type === "image") continue;

      layerItems.push({
        id: obj.__uid || counter,
        name: getLayerName(obj, counter),
        type: obj.type || "object",
        visible: obj.visible !== false,
        locked: obj.lockMovementX === true && obj.lockMovementY === true,
        fabricObject: obj,
      });
      counter++;
    }

    // Reverse so topmost layer appears first
    setLayers(layerItems.reverse());
  }, [fabricCanvas]);

  useEffect(() => {
    if (!fabricCanvas) return;

    refreshLayers();

    const events = [
      "object:added",
      "object:removed",
      "object:modified",
      "selection:created",
      "selection:updated",
      "selection:cleared",
    ];

    const handler = () => refreshLayers();
    events.forEach((event) => fabricCanvas.on(event, handler));

    return () => {
      events.forEach((event) => fabricCanvas.off(event, handler));
    };
  }, [fabricCanvas, refreshLayers]);

  // Sync selection state
  useEffect(() => {
    if (!fabricCanvas) return;

    const onSelectionCreated = (e: any) => {
      const obj = e.selected?.[0];
      if (obj) {
        const layer = layers.find((l) => l.fabricObject === obj);
        if (layer) setSelectedLayerId(layer.id);
      }
    };

    const onSelectionCleared = () => setSelectedLayerId(null);

    fabricCanvas.on("selection:created", onSelectionCreated);
    fabricCanvas.on("selection:updated", onSelectionCreated);
    fabricCanvas.on("selection:cleared", onSelectionCleared);

    return () => {
      fabricCanvas.off("selection:created", onSelectionCreated);
      fabricCanvas.off("selection:updated", onSelectionCreated);
      fabricCanvas.off("selection:cleared", onSelectionCleared);
    };
  }, [fabricCanvas, layers]);

  const handleSelectLayer = (layer: LayerItem) => {
    if (!fabricCanvas) return;
    fabricCanvas.setActiveObject(layer.fabricObject);
    fabricCanvas.renderAll();
    setSelectedLayerId(layer.id);
  };

  const handleToggleVisibility = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas) return;
    layer.fabricObject.set("visible", !layer.visible);
    fabricCanvas.renderAll();
    refreshLayers();
  };

  const handleToggleLock = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas) return;

    const isLocked = layer.locked;
    layer.fabricObject.set({
      lockMovementX: !isLocked,
      lockMovementY: !isLocked,
      lockRotation: !isLocked,
      lockScalingX: !isLocked,
      lockScalingY: !isLocked,
      hasControls: isLocked,
      selectable: isLocked,
    });
    fabricCanvas.renderAll();
    refreshLayers();
  };

  const handleDelete = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas) return;
    fabricCanvas.remove(layer.fabricObject);
    fabricCanvas.renderAll();
    refreshLayers();
  };

  const handleMoveUp = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas) return;

    const objects = fabricCanvas.getObjects();
    const index = objects.indexOf(layer.fabricObject);
    if (index < objects.length - 1) {
      // Move forward in z-order (visually up)
      fabricCanvas.moveObjectTo(layer.fabricObject, index + 1);
      fabricCanvas.renderAll();
      refreshLayers();
    }
  };

  const handleMoveDown = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas) return;

    const objects = fabricCanvas.getObjects();
    const index = objects.indexOf(layer.fabricObject);
    // Don't move below the background image
    const bgIndex = objects.findIndex(
      (obj: any) => !obj.selectable && obj.type === "image"
    );
    if (index > bgIndex + 1) {
      fabricCanvas.moveObjectTo(layer.fabricObject, index - 1);
      fabricCanvas.renderAll();
      refreshLayers();
    }
  };

  return (
    <div className="w-72 bg-[hsl(var(--editor-panel))] border-l border-border flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Layers</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {layers.length}
        </span>
      </div>

      <ScrollArea className="flex-1">
        {layers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Layers className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No layers yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Draw or add shapes to create layers
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {layers.map((layer) => {
              const TypeIcon = getTypeIcon(layer.type);
              const isSelected = selectedLayerId === layer.id;

              return (
                <div
                  key={`${layer.id}-${layer.name}`}
                  onClick={() => handleSelectLayer(layer)}
                  className={`
                    group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer
                    transition-colors duration-100
                    ${
                      isSelected
                        ? "bg-primary/15 border border-primary/30"
                        : "hover:bg-accent border border-transparent"
                    }
                    ${!layer.visible ? "opacity-50" : ""}
                  `}
                >
                  <TypeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

                  <span className="text-xs truncate flex-1 min-w-0">
                    {layer.name}
                  </span>

                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => handleMoveUp(layer, e)}
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p>Move Up</p>
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => handleMoveDown(layer, e)}
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p>Move Down</p>
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:text-destructive"
                          onClick={(e) => handleDelete(layer, e)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p>Delete</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={(e) => handleToggleVisibility(layer, e)}
                      >
                        {layer.visible ? (
                          <Eye className="h-3 w-3" />
                        ) : (
                          <EyeOff className="h-3 w-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>{layer.visible ? "Hide" : "Show"}</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={(e) => handleToggleLock(layer, e)}
                      >
                        {layer.locked ? (
                          <Lock className="h-3 w-3 text-amber-500" />
                        ) : (
                          <Unlock className="h-3 w-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>{layer.locked ? "Unlock" : "Lock"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
