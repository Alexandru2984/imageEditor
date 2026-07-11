import { useState, useEffect, useCallback } from "react";
import * as fabric from "fabric";
import type { Canvas as FabricCanvas } from "fabric";
import { findBackgroundImage } from "@/utils/viewport";
import {
  onCanvasEvent,
  offCanvasEvent,
  HISTORY_RESTORED,
} from "@/utils/canvasEvents";
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
  fabricCanvas: FabricCanvas | null;
  isMobile: boolean;
}

const COLOR_SWATCHES = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#10b981",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#ffffff",
];

interface SelectedObjectProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fontSize?: number;
  fontFamily?: string;
  type?: string;
}

// Text-only props are absent on the base FabricObject type
type TextlikeObject = fabric.FabricObject & {
  fontSize?: number;
  fontFamily?: string;
};

export const PropertiesPanel = ({
  activeColor,
  onColorChange,
  brushWidth,
  onBrushWidthChange,
  fabricCanvas,
  isMobile,
}: PropertiesPanelProps) => {
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [selectedProps, setSelectedProps] =
    useState<SelectedObjectProps | null>(null);
  const [objectOpacity, setObjectOpacity] = useState(100);

  // Apply image filters using Fabric.js v6 API
  const applyFilters = useCallback(
    (b: number, c: number, s: number) => {
      if (!fabricCanvas) return;

      const bgImage = findBackgroundImage(fabricCanvas);
      if (!bgImage) return;

      bgImage.filters = [
        new fabric.filters.Brightness({ brightness: b / 100 }),
        new fabric.filters.Contrast({ contrast: c / 100 }),
        new fabric.filters.Saturation({ saturation: s / 100 }),
      ];
      bgImage.applyFilters();
      fabricCanvas.renderAll();
    },
    [fabricCanvas]
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
    const bgImage = findBackgroundImage(fabricCanvas);
    if (bgImage) {
      fabricCanvas.fire("object:modified", { target: bgImage });
    }
  }, [fabricCanvas]);

  const handleBrightnessChange = (value: number[]) => {
    const v = value[0];
    setBrightness(v);
    applyFilters(v, contrast, saturation);
  };

  const handleContrastChange = (value: number[]) => {
    const v = value[0];
    setContrast(v);
    applyFilters(brightness, v, saturation);
  };

  const handleSaturationChange = (value: number[]) => {
    const v = value[0];
    setSaturation(v);
    applyFilters(brightness, contrast, v);
  };

  // After an undo/redo the canvas no longer matches the slider positions —
  // read the restored background's filters back into local state
  const syncFiltersFromCanvas = useCallback(() => {
    if (!fabricCanvas) return;
    const bgImage = findBackgroundImage(fabricCanvas);
    const filters = (bgImage?.filters ?? []) as Array<{
      brightness?: number;
      contrast?: number;
      saturation?: number;
    }>;
    let b = 0;
    let c = 0;
    let s = 0;
    for (const f of filters) {
      if (typeof f.brightness === "number") b = Math.round(f.brightness * 100);
      if (typeof f.contrast === "number") c = Math.round(f.contrast * 100);
      if (typeof f.saturation === "number") s = Math.round(f.saturation * 100);
    }
    setBrightness(b);
    setContrast(c);
    setSaturation(s);
  }, [fabricCanvas]);

  useEffect(() => {
    if (!fabricCanvas) return;
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

    setSelectedProps({
      fill: (active.fill as string) || "#000000",
      stroke: (active.stroke as string) || "transparent",
      strokeWidth: active.strokeWidth ?? 1,
      opacity: Math.round((active.opacity ?? 1) * 100),
      fontSize: active.fontSize,
      fontFamily: active.fontFamily,
      type: active.type,
    });
    setObjectOpacity(Math.round((active.opacity ?? 1) * 100));
  }, [fabricCanvas]);

  // Listen for selection events
  useEffect(() => {
    if (!fabricCanvas) return;

    const onSelect = () => readSelectedObject();
    const onClear = () => {
      setSelectedProps(null);
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
  }, [fabricCanvas, readSelectedObject]);

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

        {/* Brush Width */}
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

        {/* Image Filters */}
        <div>
          <Label className="text-xs font-semibold mb-3 block">
            Image Filters
          </Label>

          <div className="space-y-3">
            {/* Brightness */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Brightness
                </Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {brightness}
                </span>
              </div>
              <Slider
                value={[brightness]}
                onValueChange={handleBrightnessChange}
                onValueCommit={commitFilterChange}
                min={-100}
                max={100}
                step={1}
                className="w-full"
              />
            </div>

            {/* Contrast */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Contrast
                </Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {contrast}
                </span>
              </div>
              <Slider
                value={[contrast]}
                onValueChange={handleContrastChange}
                onValueCommit={commitFilterChange}
                min={-100}
                max={100}
                step={1}
                className="w-full"
              />
            </div>

            {/* Saturation */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Saturation
                </Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {saturation}
                </span>
              </div>
              <Slider
                value={[saturation]}
                onValueChange={handleSaturationChange}
                onValueCommit={commitFilterChange}
                min={-100}
                max={100}
                step={1}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
};
