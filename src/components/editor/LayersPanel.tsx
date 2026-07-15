import { useState, useEffect, useCallback, useRef } from "react";
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
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BLEND_MODES,
  DEFAULT_BLEND_MODE,
  objectThumbnail,
} from "@/utils/blendModes";
import {
  ensureLayerId,
  findBackgroundImage,
  isBackgroundObject,
  isEditorChrome,
  isObjectLocked,
  isProtectedObject,
  setObjectLocked,
  type EditorFabricObject,
} from "@/utils/editorObjects";

type EditorObject = EditorFabricObject;

interface LayerItem {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  isBackground: boolean;
  thumbnail: string;
  fabricObject: EditorObject;
}

interface LayersPanelProps {
  fabricCanvas: FabricCanvas | null;
}

// Generating a Fabric data URL is a real canvas render. Keep previews for the
// top of the stack and use type icons deeper down instead of blocking the UI on
// hundreds (or thousands) of synchronous offscreen renders.
const MAX_LAYER_THUMBNAILS = 120;
const MAX_CACHED_THUMBNAILS = 160;

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

const getLayerName = (obj: EditorObject, index: number): string => {
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
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const thumbnailCacheRef = useRef<Map<FabricObject, string>>(new Map());
  const refreshFrameRef = useRef<number | null>(null);
  const pendingOpacityCommitRef = useRef<FabricObject | null>(null);
  const opacityCommitTimerRef = useRef<number | null>(null);

  const refreshLayers = useCallback(() => {
    if (!fabricCanvas) {
      setLayers([]);
      return;
    }

    const objects = fabricCanvas.getObjects();
    const layerItems: LayerItem[] = [];
    const usedIds = new Set<string>();
    let counter = 1;

    for (const obj of objects as EditorObject[]) {
      if (isEditorChrome(obj)) continue;
      const isBackground = isBackgroundObject(obj);
      const name =
        obj.name?.trim() ||
        (isBackground ? "Background" : getLayerName(obj, counter));
      obj.name = name;

      layerItems.push({
        id: ensureLayerId(obj, usedIds),
        name,
        type: obj.type || "object",
        visible: obj.visible !== false,
        locked: isBackground || isObjectLocked(obj),
        isBackground,
        thumbnail: "",
        fabricObject: obj,
      });
      if (!isBackground) counter += 1;
    }

    // Reverse so topmost layer appears first. Thumbnails are memoized by
    // object identity and invalidated only when that object changes.
    const ordered = layerItems.reverse();
    for (let index = 0; index < ordered.length; index += 1) {
      const layer = ordered[index];
      if (!layer || index >= MAX_LAYER_THUMBNAILS) continue;
      const cache = thumbnailCacheRef.current;
      const cached = cache.get(layer.fabricObject);
      if (cache.has(layer.fabricObject)) {
        const thumbnail = cached ?? "";
        layer.thumbnail = thumbnail;
        // Refresh insertion order so the bounded map behaves as a small LRU.
        cache.delete(layer.fabricObject);
        cache.set(layer.fabricObject, thumbnail);
      } else {
        const thumbnail = objectThumbnail(layer.fabricObject);
        cache.set(layer.fabricObject, thumbnail);
        if (cache.size > MAX_CACHED_THUMBNAILS) {
          const oldest = cache.keys().next().value as FabricObject | undefined;
          if (oldest) cache.delete(oldest);
        }
        layer.thumbnail = thumbnail;
      }
    }
    setLayers(ordered);

    const active = fabricCanvas.getActiveObject() as EditorObject | undefined;
    if (active && !isEditorChrome(active)) {
      setSelectedLayerId(active.__layerId ?? null);
    } else if (!active) {
      setSelectedLayerId(null);
    }
  }, [fabricCanvas]);

  const scheduleRefresh = useCallback(
    (target?: FabricObject) => {
      if (target) thumbnailCacheRef.current.delete(target);
      else thumbnailCacheRef.current.clear();
      if (refreshFrameRef.current !== null) return;
      refreshFrameRef.current = window.requestAnimationFrame(() => {
        refreshFrameRef.current = null;
        refreshLayers();
      });
    },
    [refreshLayers]
  );

  const selectedLayer = layers.find((l) => l.id === selectedLayerId) ?? null;

  const fireOpacityCommit = useCallback(
    (target: FabricObject): boolean => {
      if (
        !fabricCanvas ||
        isProtectedObject(target) ||
        !fabricCanvas.getObjects().includes(target)
      ) {
        return false;
      }
      fabricCanvas.fire("object:modified", { target });
      return true;
    },
    [fabricCanvas]
  );

  const flushOpacityCommit = useCallback(() => {
    if (opacityCommitTimerRef.current !== null) {
      window.clearTimeout(opacityCommitTimerRef.current);
      opacityCommitTimerRef.current = null;
    }
    const target = pendingOpacityCommitRef.current;
    pendingOpacityCommitRef.current = null;
    if (target) fireOpacityCommit(target);
  }, [fireOpacityCommit]);

  const scheduleOpacityCommit = useCallback(
    (target: FabricObject) => {
      pendingOpacityCommitRef.current = target;
      if (opacityCommitTimerRef.current !== null) {
        window.clearTimeout(opacityCommitTimerRef.current);
      }
      opacityCommitTimerRef.current = window.setTimeout(() => {
        opacityCommitTimerRef.current = null;
        const pending = pendingOpacityCommitRef.current;
        pendingOpacityCommitRef.current = null;
        if (pending) fireOpacityCommit(pending);
      }, 75);
    },
    [fireOpacityCommit]
  );

  useEffect(
    () => () => flushOpacityCommit(),
    [fabricCanvas, flushOpacityCommit]
  );

  // Blend mode + opacity act on the selected layer (Photoshop-style header)
  const selectedBlend =
    (selectedLayer?.fabricObject.globalCompositeOperation as string) ||
    DEFAULT_BLEND_MODE;
  const selectedOpacity = Math.round(
    (selectedLayer?.fabricObject.opacity ?? 1) * 100
  );

  const handleBlendModeChange = (value: string) => {
    if (!fabricCanvas || !selectedLayer || selectedLayer.locked) return;
    selectedLayer.fabricObject.set(
      "globalCompositeOperation",
      value as GlobalCompositeOperation
    );
    fabricCanvas.fire("object:modified", { target: selectedLayer.fabricObject });
    fabricCanvas.renderAll();
  };

  const handleOpacityChange = (value: number[]) => {
    if (!fabricCanvas || !selectedLayer || selectedLayer.locked) return;
    const opacity = value[0];
    if (opacity === undefined) return;
    selectedLayer.fabricObject.set("opacity", opacity / 100);
    fabricCanvas.renderAll();
    // Reflect the new value without waiting for a full refresh
    setLayers((prev) => [...prev]);
    scheduleOpacityCommit(selectedLayer.fabricObject);
  };

  const handleOpacityCommit = () => {
    flushOpacityCommit();
  };

  const startRename = (layer: LayerItem) => {
    if (layer.locked) return;
    setRenamingId(layer.id);
    setRenameValue(layer.name);
  };

  const commitRename = () => {
    if (!fabricCanvas || renamingId === null) {
      setRenamingId(null);
      return;
    }
    const layer = layers.find((l) => l.id === renamingId);
    const name = renameValue.trim();
    if (layer && !layer.locked && name) {
      layer.fabricObject.name = name;
      fabricCanvas.fire("object:modified", { target: layer.fabricObject });
    }
    setRenamingId(null);
  };

  useEffect(() => {
    if (!fabricCanvas) return;
    const thumbnailCache = thumbnailCacheRef.current;

    refreshLayers();

    const events = ["object:added", "object:removed", "object:modified"] as const;

    const handler = (event: { target?: FabricObject }) =>
      scheduleRefresh(event.target);
    events.forEach((event) => fabricCanvas.on(event, handler));

    return () => {
      events.forEach((event) => fabricCanvas.off(event, handler));
      if (refreshFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshFrameRef.current);
        refreshFrameRef.current = null;
      }
      thumbnailCache.clear();
    };
  }, [fabricCanvas, refreshLayers, scheduleRefresh]);

  // Sync selection state
  useEffect(() => {
    if (!fabricCanvas) return;

    const onSelectionCreated = (e: { selected?: FabricObject[] }) => {
      const obj = e.selected?.[0] as EditorObject | undefined;
      setSelectedLayerId(obj?.__layerId ?? null);
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
  }, [fabricCanvas]);

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
    fabricCanvas.fire("object:modified", { target: layer.fabricObject });
    fabricCanvas.renderAll();
  };

  const handleToggleLock = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas || layer.isBackground) return;

    const isLocked = layer.locked;
    setObjectLocked(layer.fabricObject, !isLocked);
    fabricCanvas.fire("object:modified", { target: layer.fabricObject });
    fabricCanvas.renderAll();
  };

  const handleDelete = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas || isProtectedObject(layer.fabricObject)) return;
    fabricCanvas.remove(layer.fabricObject);
    fabricCanvas.renderAll();
  };

  const handleMoveUp = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas || isProtectedObject(layer.fabricObject)) return;

    const objects = fabricCanvas.getObjects();
    const index = objects.indexOf(layer.fabricObject);
    if (index < objects.length - 1) {
      // Move forward in z-order (visually up)
      fabricCanvas.moveObjectTo(layer.fabricObject, index + 1);
      fabricCanvas.fire("object:modified", { target: layer.fabricObject });
      fabricCanvas.renderAll();
    }
  };

  const handleMoveDown = (layer: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fabricCanvas || isProtectedObject(layer.fabricObject)) return;

    const objects = fabricCanvas.getObjects();
    const index = objects.indexOf(layer.fabricObject);
    // Don't move below the background image
    const background = findBackgroundImage(fabricCanvas);
    const bgIndex = background ? objects.indexOf(background) : -1;
    if (index > bgIndex + 1) {
      fabricCanvas.moveObjectTo(layer.fabricObject, index - 1);
      fabricCanvas.fire("object:modified", { target: layer.fabricObject });
      fabricCanvas.renderAll();
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

      {/* Blend mode + opacity for the selected layer */}
      {selectedLayer && (
        <div className="px-3 py-2.5 border-b border-border space-y-2.5">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-14 shrink-0">
              Blend
            </Label>
            <select
              value={selectedBlend}
              aria-label="Layer blend mode"
              disabled={selectedLayer.locked}
              onChange={(e) => handleBlendModeChange(e.target.value)}
              className="flex-1 h-7 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
            >
              {BLEND_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-14 shrink-0">
              Opacity
            </Label>
            <Slider
              value={[selectedOpacity]}
              aria-label="Layer opacity"
              disabled={selectedLayer.locked}
              onValueChange={handleOpacityChange}
              onValueCommit={handleOpacityCommit}
              min={0}
              max={100}
              step={1}
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
              {selectedOpacity}
            </span>
          </div>
        </div>
      )}

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
                  key={layer.id}
                  data-layer-id={layer.id}
                  role="group"
                  tabIndex={0}
                  aria-label={`${layer.name} layer`}
                  onClick={() => handleSelectLayer(layer)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectLayer(layer);
                    } else if (event.key === "F2" && !layer.locked) {
                      event.preventDefault();
                      startRename(layer);
                    }
                  }}
                  className={`
                    group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer
                    transition-colors duration-100 [content-visibility:auto] [contain-intrinsic-size:auto_40px]
                    ${
                      isSelected
                        ? "bg-primary/15 border border-primary/30"
                        : "hover:bg-accent border border-transparent"
                    }
                    ${!layer.visible ? "opacity-50" : ""}
                  `}
                >
                  {/* Thumbnail with a checkerboard so transparency reads */}
                  <div
                    className="h-7 w-7 shrink-0 rounded border border-border bg-[length:8px_8px] bg-[position:0_0,4px_4px] flex items-center justify-center overflow-hidden"
                    style={{
                      backgroundImage:
                        "linear-gradient(45deg,hsl(var(--muted)) 25%,transparent 25%,transparent 75%,hsl(var(--muted)) 75%),linear-gradient(45deg,hsl(var(--muted)) 25%,transparent 25%,transparent 75%,hsl(var(--muted)) 75%)",
                    }}
                  >
                    {layer.thumbnail ? (
                      <img
                        src={layer.thumbnail}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                        draggable={false}
                      />
                    ) : (
                      <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>

                  {renamingId === layer.id ? (
                    <input
                      autoFocus
                      aria-label={`Rename ${layer.name}`}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs flex-1 min-w-0 h-6 rounded border border-primary bg-background px-1"
                    />
                  ) : (
                    <span
                      className="text-xs truncate flex-1 min-w-0"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRename(layer);
                      }}
                    >
                      {layer.name}
                    </span>
                  )}

                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move ${layer.name} up`}
                          disabled={layer.locked}
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
                          aria-label={`Move ${layer.name} down`}
                          disabled={layer.locked}
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
                          aria-label={`Delete ${layer.name}`}
                          disabled={layer.locked}
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
                        aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
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
                        aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
                        disabled={layer.isBackground}
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
