import { useState, useEffect, useCallback, useRef } from "react";
import type {
  Canvas as FabricCanvas,
  FabricObject,
} from "fabric";
import { findBackgroundImage } from "@/utils/viewport";
import {
  onCanvasEvent,
  offCanvasEvent,
  HISTORY_RESTORED,
} from "@/utils/canvasEvents";
import {
  isEditorChrome,
  isReadOnlySelection,
} from "@/utils/editorObjects";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { applyColor } from "@/utils/shapes";
import { isSticker } from "@/utils/stickers";
import { BRUSHES, type BrushKind } from "@/utils/brushes";
import { cn } from "@/lib/utils";
import { BrushPreview } from "./BrushPreview";
import { TextControls, type ApplyMode, type TextObject } from "./TextControls";
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
} from "lucide-react";

interface PropertiesPanelProps {
  activeColor: string;
  onColorChange: (color: string) => void;
  brushWidth: number;
  onBrushWidthChange: (width: number) => void;
  brushKind: BrushKind;
  onBrushKindChange: (kind: BrushKind) => void;
  brushHardness: number;
  onBrushHardnessChange: (hardness: number) => void;
  brushOpacity: number;
  onBrushOpacityChange: (opacity: number) => void;
  fabricCanvas: FabricCanvas | null;
}

const COLOR_SWATCHES = [
  "#000000", "#ffffff", "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#10b981", "#3b82f6", "#6366f1", "#a855f7", "#ec4899",
];

/** A compact "#rrggbb" field that only commits valid colours. */
const HexInput = ({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (color: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(draft.trim());
    if (!match) {
      setDraft(value);
      return;
    }
    let hex = match[1]!.toLowerCase();
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (`#${hex}` !== value) onCommit(`#${hex}`);
    else setDraft(value);
  };
  return (
    <input
      aria-label="Hex color"
      value={draft}
      maxLength={7}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          setDraft(value);
        }
      }}
      className="h-7 w-[5.5rem] rounded-md border border-input bg-background px-2 font-mono text-xs uppercase text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
};

interface SelectedObjectProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  underline?: boolean;
  textAlign?: string;
  type?: string;
  hasMask: boolean;
  maskInverted: boolean;
  readOnly: boolean;
}

// Text-only props are absent on the base FabricObject type
type TextlikeObject = FabricObject & {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  underline?: boolean;
  textAlign?: string;
};

export const PropertiesPanel = ({
  activeColor,
  onColorChange,
  brushWidth,
  onBrushWidthChange,
  brushKind,
  onBrushKindChange,
  brushHardness,
  onBrushHardnessChange,
  brushOpacity,
  onBrushOpacityChange,
  fabricCanvas,
}: PropertiesPanelProps) => {
  const [selectedProps, setSelectedProps] =
    useState<SelectedObjectProps | null>(null);
  const [objectOpacity, setObjectOpacity] = useState(100);
  const pendingObjectCommitRef = useRef<FabricObject | null>(null);
  const objectCommitTimerRef = useRef<number | null>(null);

  const getEditableActiveObject = useCallback(():
    | FabricObject
    | undefined => {
    const active = fabricCanvas?.getActiveObject();
    return active && !isReadOnlySelection(active) ? active : undefined;
  }, [fabricCanvas]);

  const fireObjectModified = useCallback(
    (target: FabricObject): boolean => {
      if (!fabricCanvas || isReadOnlySelection(target)) return false;
      const isActive = fabricCanvas.getActiveObject() === target;
      if (!isActive && !fabricCanvas.getObjects().includes(target)) return false;
      fabricCanvas.fire("object:modified", { target });
      return true;
    },
    [fabricCanvas]
  );

  const flushScheduledObjectCommit = useCallback((): FabricObject | null => {
    if (objectCommitTimerRef.current !== null) {
      window.clearTimeout(objectCommitTimerRef.current);
      objectCommitTimerRef.current = null;
    }
    const target = pendingObjectCommitRef.current;
    pendingObjectCommitRef.current = null;
    return target && fireObjectModified(target) ? target : null;
  }, [fireObjectModified]);

  const scheduleObjectCommit = useCallback(
    (target: FabricObject) => {
      pendingObjectCommitRef.current = target;
      if (objectCommitTimerRef.current !== null) {
        window.clearTimeout(objectCommitTimerRef.current);
      }
      objectCommitTimerRef.current = window.setTimeout(() => {
        objectCommitTimerRef.current = null;
        const pending = pendingObjectCommitRef.current;
        pendingObjectCommitRef.current = null;
        if (pending) fireObjectModified(pending);
      }, 75);
    },
    [fireObjectModified]
  );

  useEffect(
    () => () => {
      flushScheduledObjectCommit();
    },
    [fabricCanvas, flushScheduledObjectCommit]
  );

  // Slider work is coalesced; applying pixels and recording the history entry
  // happen together so pointer and keyboard event ordering cannot lose edits.
  const commitObjectChange = useCallback(() => {
    if (!fabricCanvas) return;
    const flushed = flushScheduledObjectCommit();
    const active = getEditableActiveObject();
    if (active && active !== flushed) fireObjectModified(active);
  }, [
    fabricCanvas,
    fireObjectModified,
    flushScheduledObjectCommit,
    getEditableActiveObject,
  ]);

  // Read properties from selected object
  const readSelectedObject = useCallback(() => {
    if (!fabricCanvas) {
      setSelectedProps(null);
      return;
    }

    const active = fabricCanvas.getActiveObject() as TextlikeObject | undefined;
    if (!active || isEditorChrome(active)) {
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
      fontWeight: active.fontWeight,
      fontStyle: active.fontStyle,
      underline: active.underline,
      textAlign: active.textAlign,
      type: active.type,
      hasMask: !!clip,
      maskInverted: !!clip?.inverted,
      readOnly: isReadOnlySelection(active),
    });
    setObjectOpacity(Math.round((active.opacity ?? 1) * 100));
  }, [fabricCanvas]);

  const toggleMaskInverted = () => {
    if (!fabricCanvas) return;
    const active = getEditableActiveObject();
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
    const active = getEditableActiveObject();
    if (active?.clipPath) {
      active.clipPath = undefined;
      fabricCanvas.fire("object:modified", { target: active });
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  // Listen for selection events. The panel can mount while something is
  // already selected (switching tabs), so read the current selection first.
  useEffect(() => {
    if (!fabricCanvas) return;
    readSelectedObject();

    const onSelect = () => readSelectedObject();
    const onClear = () => setSelectedProps(null);

    onCanvasEvent(fabricCanvas, HISTORY_RESTORED, onSelect);
    fabricCanvas.on("selection:created", onSelect);
    fabricCanvas.on("selection:updated", onSelect);
    fabricCanvas.on("selection:cleared", onClear);
    fabricCanvas.on("object:modified", onSelect);

    return () => {
      offCanvasEvent(fabricCanvas, HISTORY_RESTORED, onSelect);
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
    const active = getEditableActiveObject();
    if (active) {
      applyColor(active, color);
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  const handleObjectOpacityChange = (value: number[]) => {
    const v = value[0];
    if (v === undefined) return;
    if (!fabricCanvas) return;
    const active = getEditableActiveObject();
    if (active) {
      setObjectOpacity(v);
      active.set("opacity", v / 100);
      fabricCanvas.renderAll();
      scheduleObjectCommit(active);
    }
  };

  const handleObjectStrokeChange = (color: string) => {
    if (!fabricCanvas) return;
    const active = getEditableActiveObject();
    if (active) {
      active.set("stroke", color);
      fabricCanvas.renderAll();
      readSelectedObject();
    }
  };

  const handleObjectStrokeWidthChange = (value: number[]) => {
    if (!fabricCanvas) return;
    const strokeWidth = value[0];
    if (strokeWidth === undefined) return;
    const active = getEditableActiveObject();
    if (active) {
      active.set("strokeWidth", strokeWidth);
      fabricCanvas.renderAll();
      readSelectedObject();
      scheduleObjectCommit(active);
    }
  };

  // Align the selected object within the photo or, without one, the visible
  // canvas region (scene coordinates, so it stays correct under zoom/pan).
  const alignObject = (
    mode: "left" | "centerH" | "right" | "top" | "middle" | "bottom"
  ) => {
    if (!fabricCanvas) return;
    const active = getEditableActiveObject();
    if (!active) return;

    // Align to the photo (the artboard) when there is one, else to the view.
    const background = findBackgroundImage(fabricCanvas);
    let viewLeft: number;
    let viewTop: number;
    let viewW: number;
    let viewH: number;
    if (background && background !== active) {
      const bounds = background.getBoundingRect();
      viewLeft = bounds.left;
      viewTop = bounds.top;
      viewW = bounds.width;
      viewH = bounds.height;
    } else {
      const zoom = fabricCanvas.getZoom();
      const vpt = fabricCanvas.viewportTransform;
      viewLeft = -vpt[4] / zoom;
      viewTop = -vpt[5] / zoom;
      viewW = fabricCanvas.width / zoom;
      viewH = fabricCanvas.height / zoom;
    }

    const br = active.getBoundingRect();
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = viewLeft - br.left;
    else if (mode === "centerH") dx = viewLeft + (viewW - br.width) / 2 - br.left;
    else if (mode === "right") dx = viewLeft + viewW - br.width - br.left;
    else if (mode === "top") dy = viewTop - br.top;
    else if (mode === "middle") dy = viewTop + (viewH - br.height) / 2 - br.top;
    else if (mode === "bottom") dy = viewTop + viewH - br.height - br.top;

    active.set({ left: active.left + dx, top: active.top + dy });
    active.setCoords();
    fabricCanvas.fire("object:modified", { target: active });
    fabricCanvas.renderAll();
  };

  /** Apply text styling to the selected text layer. */
  const applyTextChanges = (changes: Record<string, unknown>, mode: ApplyMode) => {
    if (!fabricCanvas) return;
    const active = getEditableActiveObject();
    if (!active) return;
    active.set(changes);
    active.setCoords();
    fabricCanvas.requestRenderAll();
    readSelectedObject();
    if (mode === "schedule") {
      scheduleObjectCommit(active);
      return;
    }
    const flushed = flushScheduledObjectCommit();
    if (flushed !== active) fireObjectModified(active);
  };

  const isTextObject =
    (selectedProps?.type === "i-text" ||
      selectedProps?.type === "text" ||
      selectedProps?.type === "textbox") &&
    !isSticker({ fontFamily: selectedProps?.fontFamily });

  return (
    <ScrollArea className="h-full w-full">
      <div className="space-y-5 p-4">
        {/* Color Swatches */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Color</Label>
            <HexInput value={activeColor} onCommit={(color) => {
              handleColorChange(color);
              commitObjectChange();
            }} />
          </div>
          <div className="flex flex-wrap gap-2">
            {COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use color ${color}`}
                aria-pressed={activeColor === color}
                onClick={() => {
                  handleColorChange(color);
                  commitObjectChange();
                }}
                className={`h-7 w-7 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 ${
                  activeColor === color
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-editor-panel"
                    : ""
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <label
              className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110 focus-within:ring-2 focus-within:ring-ring dark:border-white/15"
              style={{
                background:
                  "conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)",
              }}
              title="Custom color"
            >
              <input
                type="color"
                aria-label="Custom active color"
                value={activeColor}
                onChange={(e) => handleColorChange(e.target.value)}
                onBlur={commitObjectChange}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>

        {/* Brush settings matter while drawing; a selection shows its own props */}
        {!selectedProps && (
          <>
        <Separator />

        {/* Brush */}
        <div className="space-y-3">
          <div>
            <Label className="mb-2 block text-xs font-medium text-muted-foreground">Brush</Label>
            <div role="radiogroup" aria-label="Brush type" className="grid grid-cols-4 gap-1.5">
              {BRUSHES.map((brush) => (
                <button
                  key={brush.kind}
                  type="button"
                  role="radio"
                  aria-checked={brushKind === brush.kind}
                  onClick={() => onBrushKindChange(brush.kind)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[11px] transition-colors",
                    brushKind === brush.kind
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <BrushPreview kind={brush.kind} color={activeColor} />
                  {brush.label}
                </button>
              ))}
            </div>
          </div>

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
              aria-label="Brush width"
              onValueChange={(v) => onBrushWidthChange(v[0] ?? brushWidth)}
              min={1}
              max={50}
              step={1}
              className="w-full"
            />
          </div>

          {BRUSHES.find((brush) => brush.kind === brushKind)?.usesHardness !== false && (
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
                aria-label="Brush hardness"
                onValueChange={(v) =>
                  onBrushHardnessChange(v[0] ?? brushHardness)
                }
                min={0}
                max={100}
                step={1}
                className="w-full"
              />
            </div>
          )}

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
              aria-label="Brush opacity"
              onValueChange={(v) =>
                onBrushOpacityChange(v[0] ?? brushOpacity)
              }
              min={10}
              max={100}
              step={1}
              className="w-full"
            />
          </div>
        </div>

        <Separator />

          </>
        )}

        {/* Object Properties (when selected) */}
        {selectedProps && (
          <>
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold">
                  Object Properties
                </Label>
                {selectedProps.readOnly && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-500">
                    Locked
                  </span>
                )}
              </div>

              {isTextObject && fabricCanvas?.getActiveObject() && (
                <div className="mb-4 border-b border-border pb-4">
                  <TextControls
                    object={fabricCanvas.getActiveObject() as TextObject}
                    readOnly={selectedProps.readOnly}
                    activeColor={activeColor}
                    apply={applyTextChanges}
                    commit={commitObjectChange}
                  />
                </div>
              )}

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
                  aria-label="Object opacity"
                  disabled={selectedProps.readOnly}
                  onValueChange={handleObjectOpacityChange}
                  onValueCommit={() => flushScheduledObjectCommit()}
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
                    aria-label="Object fill color"
                    disabled={selectedProps.readOnly}
                    value={selectedProps.fill || "#000000"}
                    onChange={(e) => handleColorChange(e.target.value)}
                    onBlur={commitObjectChange}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border border-border disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="text-xs text-muted-foreground font-mono">
                    {selectedProps.fill}
                  </span>
                </div>
              </div>

              {/* Text layers use the Outline effect instead */}
              {!isTextObject && (
                <>
              {/* Stroke */}
              <div className="mb-3">
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Stroke
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Object stroke color"
                    disabled={selectedProps.readOnly}
                    value={
                      selectedProps.stroke === "transparent"
                        ? "#000000"
                        : selectedProps.stroke
                    }
                    onChange={(e) => handleObjectStrokeChange(e.target.value)}
                    onBlur={commitObjectChange}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border border-border disabled:cursor-not-allowed disabled:opacity-50"
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
                  aria-label="Stroke width"
                  disabled={selectedProps.readOnly}
                  onValueChange={handleObjectStrokeWidthChange}
                  onValueCommit={() => flushScheduledObjectCommit()}
                  min={0}
                  max={20}
                  step={1}
                  className="w-full"
                />
              </div>

                </>
              )}

              {/* Layer Mask (non-destructive clip) */}
              {selectedProps.hasMask && (
                <div className="mb-3">
                  <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Layer Mask
                  </Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={selectedProps.maskInverted}
                      disabled={selectedProps.readOnly}
                      onClick={toggleMaskInverted}
                      className={`flex-1 h-8 rounded-md border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selectedProps.maskInverted
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border hover:bg-accent text-muted-foreground"
                      }`}
                    >
                      {selectedProps.maskInverted ? "Inverted" : "Invert"}
                    </button>
                    <button
                      type="button"
                      disabled={selectedProps.readOnly}
                      onClick={releaseMask}
                      className="flex-1 h-8 rounded-md border border-border text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Release
                    </button>
                  </div>
                </div>
              )}

              {/* Alignment (within the visible canvas) */}
              <div className="mb-3">
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Align
                </Label>
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["left", AlignStartVertical],
                      ["centerH", AlignCenterVertical],
                      ["right", AlignEndVertical],
                      ["top", AlignStartHorizontal],
                      ["middle", AlignCenterHorizontal],
                      ["bottom", AlignEndHorizontal],
                    ] as const
                  ).map(([mode, Icon]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-label={`Align ${mode}`}
                      disabled={selectedProps.readOnly}
                      onClick={() => alignObject(mode)}
                      className="flex-1 h-8 rounded-md border border-border hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>

            </div>

            <Separator />
          </>
        )}
      </div>
    </ScrollArea>
  );
};
