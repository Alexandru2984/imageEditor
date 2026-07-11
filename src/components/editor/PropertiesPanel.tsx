import { useState, useEffect, useCallback } from "react";
import type {
  Canvas as FabricCanvas,
  FabricImage,
  FabricObject,
} from "fabric";
import { findBackgroundImage } from "@/utils/viewport";
import {
  onCanvasEvent,
  offCanvasEvent,
  HISTORY_RESTORED,
} from "@/utils/canvasEvents";
import {
  applyFilterValues,
  readFilterValues,
  DEFAULT_FILTERS,
  type FilterValues,
} from "@/utils/imageFilters";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Paintbrush } from "lucide-react";

interface PropertiesPanelProps {
  activeColor: string;
  onColorChange: (color: string) => void;
  brushWidth: number;
  onBrushWidthChange: (width: number) => void;
  brushHardness: number;
  onBrushHardnessChange: (hardness: number) => void;
  brushOpacity: number;
  onBrushOpacityChange: (opacity: number) => void;
  fabricCanvas: FabricCanvas | null;
  isMobile: boolean;
}

const COLOR_SWATCHES = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#10b981",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#ffffff",
];

// Blur only makes sense from 0 up; the rest are symmetric around 0
const FILTER_SLIDERS: { key: keyof FilterValues; label: string; min: number }[] =
  [
    { key: "brightness", label: "Brightness", min: -100 },
    { key: "contrast", label: "Contrast", min: -100 },
    { key: "saturation", label: "Saturation", min: -100 },
    { key: "hue", label: "Hue", min: -100 },
    { key: "blur", label: "Blur", min: 0 },
  ];

interface SelectedObjectProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fontSize?: number;
  fontFamily?: string;
  type?: string;
  hasMask: boolean;
  maskInverted: boolean;
}

// Text-only props are absent on the base FabricObject type
type TextlikeObject = FabricObject & {
  fontSize?: number;
  fontFamily?: string;
};

export const PropertiesPanel = ({
  activeColor,
  onColorChange,
  brushWidth,
  onBrushWidthChange,
  brushHardness,
  onBrushHardnessChange,
  brushOpacity,
  onBrushOpacityChange,
  fabricCanvas,
  isMobile,
}: PropertiesPanelProps) => {
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTERS);
  const [hasTargetImage, setHasTargetImage] = useState(false);
  const [targetIsSelection, setTargetIsSelection] = useState(false);
  const [selectedProps, setSelectedProps] =
    useState<SelectedObjectProps | null>(null);
  const [objectOpacity, setObjectOpacity] = useState(100);

  // Filters target the selected image layer if one is selected, else the
  // background photo. That's the image the filter sliders read from and write to.
  const getFilterTarget = useCallback((): FabricImage | undefined => {
    if (!fabricCanvas) return undefined;
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === "image") return active as FabricImage;
    return findBackgroundImage(fabricCanvas);
  }, [fabricCanvas]);

  const applyFilters = useCallback(
    (values: FilterValues) => {
      if (!fabricCanvas) return;
      const target = getFilterTarget();
      if (!target) return;
      applyFilterValues(target, values);
      fabricCanvas.renderAll();
    },
    [fabricCanvas, getFilterTarget]
  );

  // Sliders apply live while dragging; the *Commit handlers below fire
  // object:modified once at drag end so the change lands in undo history
  const commitObjectChange = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      fabricCanvas.fire("object:modified", { target: active });
    }
  }, [fabricCanvas]);

  const commitFilterChange = useCallback(() => {
    if (!fabricCanvas) return;
    const target = getFilterTarget();
    if (target) {
      fabricCanvas.fire("object:modified", { target });
    }
  }, [fabricCanvas, getFilterTarget]);

  const setFilter = (key: keyof FilterValues) => (value: number[]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value[0] };
      applyFilters(next);
      return next;
    });
  };

  // Read the current filter target's values into the sliders. Runs on selection
  // change and after undo/redo, so the sliders always reflect what's on screen.
  const syncFiltersFromCanvas = useCallback(() => {
    const target = getFilterTarget();
    setHasTargetImage(!!target);
    setTargetIsSelection(
      !!target && target === fabricCanvas?.getActiveObject()
    );
    setFilters(readFilterValues(target?.filters as never));
  }, [fabricCanvas, getFilterTarget]);

  useEffect(() => {
    if (!fabricCanvas) return;
    syncFiltersFromCanvas();
    onCanvasEvent(fabricCanvas, HISTORY_RESTORED, syncFiltersFromCanvas);
    return () => {
      offCanvasEvent(fabricCanvas, HISTORY_RESTORED, syncFiltersFromCanvas);
    };
  }, [fabricCanvas, syncFiltersFromCanvas]);

  // Read properties from selected object
  const readSelectedObject = useCallback(() => {
    if (!fabricCanvas) {
      setSelectedProps(null);
      return;
    }

    const active = fabricCanvas.getActiveObject() as TextlikeObject | undefined;
    if (!active) {
      setSelectedProps(null);
      return;
    }

    const clip = active.clipPath as { inverted?: boolean } | undefined;
    setSelectedProps({
      fill: (active.fill as string) || "#000000",
      stroke: (active.stroke as string) || "transparent",
      strokeWidth: active.strokeWidth ?? 1,
      opacity: Math.round((active.opacity ?? 1) * 100),
      fontSize: active.fontSize,
      fontFamily: active.fontFamily,
      type: active.type,
      hasMask: !!clip,
      maskInverted: !!clip?.inverted,
    });
    setObjectOpacity(Math.round((active.opacity ?? 1) * 100));
  }, [fabricCanvas]);

  const toggleMaskInverted = () => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    const clip = active?.clipPath as { inverted?: boolean } | undefined;
    if (active && clip) {
      clip.inverted = !clip.inverted;
      fabricCanvas.fire("object:modified", { target: active });
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  const releaseMask = () => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active?.clipPath) {
      active.clipPath = undefined;
      fabricCanvas.fire("object:modified", { target: active });
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  // Listen for selection events
  useEffect(() => {
    if (!fabricCanvas) return;

    const onSelect = () => {
      readSelectedObject();
      // Switching selection changes which image the filters target
      syncFiltersFromCanvas();
    };
    const onClear = () => {
      setSelectedProps(null);
      syncFiltersFromCanvas();
    };

    fabricCanvas.on("selection:created", onSelect);
    fabricCanvas.on("selection:updated", onSelect);
    fabricCanvas.on("selection:cleared", onClear);
    fabricCanvas.on("object:modified", onSelect);

    return () => {
      fabricCanvas.off("selection:created", onSelect);
      fabricCanvas.off("selection:updated", onSelect);
      fabricCanvas.off("selection:cleared", onClear);
      fabricCanvas.off("object:modified", onSelect);
    };
  }, [fabricCanvas, readSelectedObject, syncFiltersFromCanvas]);

  // Update selected object's fill color
  const handleColorChange = (color: string) => {
    onColorChange(color);

    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      active.set("fill", color);
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  const handleObjectOpacityChange = (value: number[]) => {
    const v = value[0];
    setObjectOpacity(v);

    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      active.set("opacity", v / 100);
      fabricCanvas.renderAll();
    }
  };

  const handleObjectStrokeChange = (color: string) => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      active.set("stroke", color);
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  const handleObjectStrokeWidthChange = (value: number[]) => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      active.set("strokeWidth", value[0]);
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  const handleFontSizeChange = (value: number[]) => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject() as TextlikeObject | undefined;
    if (active && active.fontSize !== undefined) {
      active.set("fontSize", value[0]);
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  const handleFontFamilyChange = (family: string) => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject() as TextlikeObject | undefined;
    if (active && active.fontFamily !== undefined) {
      active.set("fontFamily", family);
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  const isTextObject =
    selectedProps?.type === "i-text" ||
    selectedProps?.type === "text" ||
    selectedProps?.type === "textbox";

  const fontFamilies = [
    "Arial",
    "Helvetica",
    "Times New Roman",
    "Courier New",
    "Georgia",
    "Verdana",
    "Impact",
    "Comic Sans MS",
  ];

  return (
    <ScrollArea
      className={`bg-[hsl(var(--editor-panel))] border-l border-border h-full ${isMobile ? "w-full" : "w-72"}`}
    >
      <div className="p-4 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Paintbrush className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Properties</h3>
        </div>

        {/* Color Swatches */}
        <div>
          <Label className="text-xs font-medium mb-2 block text-muted-foreground">
            Color
          </Label>
          <div className="grid grid-cols-5 gap-1.5">
            {COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                onClick={() => {
                  handleColorChange(color);
                  commitObjectChange();
                }}
                className={`w-full aspect-square rounded-md transition-all border ${
                  activeColor === color
                    ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-105"
                    : "border-border hover:scale-105"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <input
            type="color"
            value={activeColor}
            onChange={(e) => handleColorChange(e.target.value)}
            onBlur={commitObjectChange}
            className="w-full h-8 rounded-md mt-2 cursor-pointer bg-transparent border border-border"
          />
        </div>

        <Separator />

        {/* Brush */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Brush Width
              </Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {brushWidth}px
              </span>
            </div>
            <Slider
              value={[brushWidth]}
              onValueChange={(v) => onBrushWidthChange(v[0])}
              min={1}
              max={50}
              step={1}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Hardness
              </Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {brushHardness}%
              </span>
            </div>
            <Slider
              value={[brushHardness]}
              onValueChange={(v) => onBrushHardnessChange(v[0])}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Brush Opacity
              </Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {brushOpacity}%
              </span>
            </div>
            <Slider
              value={[brushOpacity]}
              onValueChange={(v) => onBrushOpacityChange(v[0])}
              min={10}
              max={100}
              step={1}
              className="w-full"
            />
          </div>
        </div>

        <Separator />

        {/* Object Properties (when selected) */}
        {selectedProps && (
          <>
            <div>
              <Label className="text-xs font-semibold mb-3 block">
                Object Properties
              </Label>

              {/* Opacity */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Opacity
                  </Label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {objectOpacity}%
                  </span>
                </div>
                <Slider
                  value={[objectOpacity]}
                  onValueChange={handleObjectOpacityChange}
                  onValueCommit={commitObjectChange}
                  min={0}
                  max={100}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Fill */}
              <div className="mb-3">
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Fill
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedProps.fill || "#000000"}
                    onChange={(e) => handleColorChange(e.target.value)}
                    onBlur={commitObjectChange}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border border-border"
                  />
                  <span className="text-xs text-muted-foreground font-mono">
                    {selectedProps.fill}
                  </span>
                </div>
              </div>

              {/* Stroke */}
              <div className="mb-3">
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Stroke
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={
                      selectedProps.stroke === "transparent"
                        ? "#000000"
                        : selectedProps.stroke
                    }
                    onChange={(e) => handleObjectStrokeChange(e.target.value)}
                    onBlur={commitObjectChange}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border border-border"
                  />
                  <span className="text-xs text-muted-foreground font-mono">
                    {selectedProps.stroke}
                  </span>
                </div>
              </div>

              {/* Stroke Width */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Stroke Width
                  </Label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {selectedProps.strokeWidth}px
                  </span>
                </div>
                <Slider
                  value={[selectedProps.strokeWidth]}
                  onValueChange={handleObjectStrokeWidthChange}
                  onValueCommit={commitObjectChange}
                  min={0}
                  max={20}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Layer Mask (non-destructive clip) */}
              {selectedProps.hasMask && (
                <div className="mb-3">
                  <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Layer Mask
                  </Label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleMaskInverted}
                      className={`flex-1 h-8 rounded-md border text-xs transition-colors ${
                        selectedProps.maskInverted
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border hover:bg-accent text-muted-foreground"
                      }`}
                    >
                      {selectedProps.maskInverted ? "Inverted" : "Invert"}
                    </button>
                    <button
                      onClick={releaseMask}
                      className="flex-1 h-8 rounded-md border border-border text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                    >
                      Release
                    </button>
                  </div>
                </div>
              )}

              {/* Text Properties */}
              {isTextObject && (
                <>
                  <Separator className="my-3" />
                  <Label className="text-xs font-semibold mb-3 block">
                    Text Properties
                  </Label>

                  {/* Font Size */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Font Size
                      </Label>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {selectedProps.fontSize}px
                      </span>
                    </div>
                    <Slider
                      value={[selectedProps.fontSize || 24]}
                      onValueChange={handleFontSizeChange}
                      onValueCommit={commitObjectChange}
                      min={8}
                      max={200}
                      step={1}
                      className="w-full"
                    />
                  </div>

                  {/* Font Family */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Font Family
                    </Label>
                    <select
                      value={selectedProps.fontFamily || "Arial"}
                      onChange={(e) => {
                        handleFontFamilyChange(e.target.value);
                        commitObjectChange();
                      }}
                      className="w-full h-9 rounded-md border border-border bg-background px-3 text-xs"
                    >
                      {fontFamilies.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            <Separator />
          </>
        )}

        {/* Image Filters — non-destructive, applied to the selected image
            layer or, with nothing selected, the background photo */}
        {hasTargetImage && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-xs font-semibold">Image Filters</Label>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {targetIsSelection ? "Selected" : "Background"}
              </span>
            </div>

            <div className="space-y-3">
              {FILTER_SLIDERS.map(({ key, label, min }) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">
                      {label}
                    </Label>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {filters[key]}
                    </span>
                  </div>
                  <Slider
                    value={[filters[key]]}
                    onValueChange={setFilter(key)}
                    onValueCommit={commitFilterChange}
                    min={min}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};
