// Fabric defaults must be set before any Fabric object is constructed; this
// module is the editor chunk's entry point.
import "@/lib/fabricDefaults";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { ImagePlus, Layers, Paintbrush, Pipette, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { Canvas as FabricCanvasComponent } from "./Canvas";
import { Toolbar } from "./Toolbar";
import { PropertiesPanel } from "./PropertiesPanel";
import { AdjustPanel } from "./AdjustPanel";
import { LayersPanel } from "./LayersPanel";
import { TopBar } from "./TopBar";
import { OptionsBar } from "./OptionsBar";
import { ColorWells } from "./ColorWells";
import { ExportDialog } from "./ExportDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { CommandPalette } from "./CommandPalette";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSessionState } from "@/hooks/useSessionState";
import { DEFAULT_RETOUCH_OPTIONS, type RetouchOptions } from "@/raster/retouchSettings";
import { HistogramPanel } from "./HistogramPanel";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useEditorCommands } from "@/hooks/useEditorCommands";
import { useAiActions } from "@/hooks/useAiActions";
import { useEyedropper } from "@/hooks/useEyedropper";
import { useDocumentFonts } from "@/hooks/useDocumentFonts";
import { useSmartGuides } from "@/hooks/useSmartGuides";
import { BRUSHES, stepBrushHardness, stepBrushWidth, type BrushKind } from "@/utils/brushes";
import { DEFAULT_PAINT_OPTIONS, stepPaintSize, type PaintOptions } from "@/raster/paintSettings";
import { DEFAULT_BUCKET_OPTIONS, type BucketOptions } from "@/raster/fill";
import { DEFAULT_GRADIENT_OPTIONS, type GradientOptions } from "@/raster/gradient";
import {
  isBrushTool,
  isFillTool,
  isHealingTool,
  isLassoTool,
  isToningTool,
  isFocusTool,
  isMarqueeTool,
  type BrushTool,
  type FillTool,
  type HealingTool,
  type ToningTool,
  type FocusTool,
  type LassoTool,
  type MarqueeTool,
} from "./toolGroups";
import { DEFAULT_WAND_OPTIONS, type WandOptions } from "@/selection/magicWand";
import type { SelectionMode } from "@/selection/mask";
import { SelectionModifyDialog, type SelectionModification } from "./SelectionModifyDialog";
import { LayerStyleDialog } from "./LayerStyleDialog";
import { AdjustmentDialog, type AdjustmentKind } from "./adjustments/AdjustmentDialog";
import { DocumentDialog, type DocumentDialogKind } from "./DocumentDialog";
import { copySource, selectionLayer } from "@/selection/actions";
import { selectionOf } from "@/selection/state";
import { useMaskTarget } from "@/hooks/useMaskTarget";
import { maskTargetOf } from "@/raster/layerMask";
import {
  SNAP_PREFERENCE_KEY,
  readBooleanPreference,
  writeBooleanPreference,
} from "@/utils/preferences";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { downloadProjectFile } from "@/utils/projectFile";
import type { CanvasSnapshot } from "@/utils/canvasSnapshot";
import { isAbortError } from "@/utils/abort";
import { RASTER_FILE_ACCEPT, readSafeRasterImage } from "@/utils/imageFile";
import { clampZoom, fitToScreen } from "@/utils/viewport";
import { isEditorChrome, isReadOnlySelection, type EditorFabricObject } from "@/utils/editorObjects";
import { nextLayerName } from "@/raster/pixelLayer";
import { applyColor, isShapeKind, type ShapeKind } from "@/utils/shapes";
import {
  addImageLayer,
  arrange,
  cloneObjects,
  copySelection,
  duplicateSelection,
  flip,
  placeCopies,
  rotate,
  type ArrangeAction,
} from "@/utils/canvasActions";
import type { PanelTab, Tool } from "@/types/editor";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Replacing the open document needs a confirmation first. */
type DiscardAction = "new" | "openImage" | "openProject";

const DISCARD_TEXT: Record<DiscardAction, { title: string; confirm: string }> = {
  new: { title: "Start a new project?", confirm: "Start new" },
  openImage: { title: "Open another image?", confirm: "Choose image" },
  openProject: { title: "Open a project file?", confirm: "Choose file" },
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return (
    !!element &&
    (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable)
  );
};

const isProjectFile = (file: File): boolean =>
  file.type === "application/json" || /\.json$/i.test(file.name);

const dragHasFiles = (event: DragEvent): boolean =>
  !!event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");

export interface EditorWorkspaceProps {
  /** The document's first image (or a placeholder for restored projects). */
  uploadedImage: string;
  /** A saved document to restore instead of starting from uploadedImage. */
  initialSnapshot: CanvasSnapshot | null;
  documentName: string;
  /** Every committed history state, for autosave. */
  onSnapshot: (snapshot: CanvasSnapshot) => void;
  onLoadError: (error: unknown) => void;
  onOpenImageFile: (file: File) => void;
  onOpenProjectFile: (file: File) => void;
  onNewProject: () => void;
}

/**
 * Everything that needs the editing engine (Fabric). Loaded on demand, so the
 * start screen does not pay for it. The parent remounts this per document.
 */
export const EditorWorkspace = ({
  uploadedImage,
  initialSnapshot,
  documentName,
  onSnapshot,
  onLoadError,
  onOpenImageFile,
  onOpenProjectFile,
  onNewProject,
}: EditorWorkspaceProps) => {
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [lastShape, setLastShape] = useSessionState<ShapeKind>("lastShape", "rectangle");
  const [lastBrushTool, setLastBrushTool] = useSessionState<BrushTool>("lastBrushTool", "brush");
  const [paint, setPaint] = useSessionState<PaintOptions>("paint", DEFAULT_PAINT_OPTIONS);
  const [histogramOpen, setHistogramOpen] = useSessionState<boolean>("histogram", false);
  const [bucket, setBucket] = useSessionState<BucketOptions>("bucket", DEFAULT_BUCKET_OPTIONS);
  const [gradient, setGradient] = useSessionState<GradientOptions>("gradient", DEFAULT_GRADIENT_OPTIONS);
  const updateGradient = useCallback(
    (change: Partial<GradientOptions>) => setGradient((current) => ({ ...current, ...change })),
    [setGradient]
  );
  const [lastFillTool, setLastFillTool] = useSessionState<FillTool>("lastFillTool", "bucket");
  const [lastHealingTool, setLastHealingTool] = useSessionState<HealingTool>("lastHealingTool", "spotHealing");
  const [lastToningTool, setLastToningTool] = useSessionState<ToningTool>("lastToningTool", "dodge");
  const [lastFocusTool, setLastFocusTool] = useSessionState<FocusTool>("lastFocusTool", "blur");
  const [lastMarqueeTool, setLastMarqueeTool] = useSessionState<MarqueeTool>("lastMarqueeTool", "marquee");
  const [selectionMode, setSelectionMode] = useSessionState<SelectionMode>("selectionMode", "replace");
  const [lastLassoTool, setLastLassoTool] = useSessionState<LassoTool>("lastLassoTool", "lasso");
  const [wand, setWand] = useSessionState<WandOptions>("wand", DEFAULT_WAND_OPTIONS);
  const [retouch, setRetouch] = useSessionState<RetouchOptions>("retouch", DEFAULT_RETOUCH_OPTIONS);
  const updateRetouch = useCallback(
    (change: Partial<RetouchOptions>) => setRetouch((current) => ({ ...current, ...change })),
    [setRetouch]
  );
  const [pickingSource, setPickingSource] = useState(false);
  const updateWand = useCallback(
    (change: Partial<WandOptions>) => setWand((current) => ({ ...current, ...change })),
    [setWand]
  );
  const updateBucket = useCallback(
    (change: Partial<BucketOptions>) => setBucket((current) => ({ ...current, ...change })),
    [setBucket]
  );
  const updatePaint = useCallback(
    (change: Partial<PaintOptions>) => setPaint((current) => ({ ...current, ...change })),
    [setPaint]
  );
  const [activeColor, setActiveColor] = useSessionState("activeColor", "#a855f7");
  const [backgroundColor, setBackgroundColor] = useSessionState("backgroundColor", "#ffffff");
  const [brushWidth, setBrushWidth] = useSessionState("brushWidth", 3);
  const [brushHardness, setBrushHardness] = useSessionState("brushHardness", 100);
  const [brushOpacity, setBrushOpacity] = useSessionState("brushOpacity", 100);
  const [brushKind, setBrushKind] = useSessionState<BrushKind>("brushKind", "pen");
  const handleBrushKindChange = useCallback((kind: BrushKind) => {
    setBrushKind(kind);
    const option = BRUSHES.find((candidate) => candidate.kind === kind);
    if (option) setBrushWidth((width) => Math.max(width, option.minWidth));
  }, [setBrushKind, setBrushWidth]);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  // Zoom is a fraction everywhere (1 = 100%), matching Fabric's own getZoom()
  const [zoom, setZoom] = useState(1);
  const isMobile = useIsMobile();
  const [panel, setPanel] = useSessionState<PanelTab | null>(
    "panel",
    isMobile ? null : "properties"
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [discardAction, setDiscardAction] = useState<DiscardAction | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const layerInputRef = useRef<HTMLInputElement>(null);
  const layerLoadControllerRef = useRef<AbortController | null>(null);
  const clipboardRef = useRef<{ objects: FabricObject[]; pastes: number } | null>(null);
  const dragDepthRef = useRef(0);

  useEffect(
    () => () => {
      layerLoadControllerRef.current?.abort();
    },
    []
  );

  // Copied layers belong to the document they came from.
  useEffect(() => {
    clipboardRef.current = null;
    layerLoadControllerRef.current?.abort();
    layerLoadControllerRef.current = null;
  }, [fabricCanvas]);

  const handleHistoryError = useCallback((error: unknown) => {
    console.error("Could not update edit history:", error);
    toast.error("Undo/redo failed. The editor attempted a safe rollback.");
  }, []);

  const { undo, redo, canUndo, canRedo, hasUndo, hasRedo } = useUndoRedo(
    fabricCanvas,
    onSnapshot,
    handleHistoryError
  );

  const ai = useAiActions(fabricCanvas);
  useDocumentFonts(fabricCanvas);
  const [snapping, setSnapping] = useState(() => readBooleanPreference(SNAP_PREFERENCE_KEY, true));
  const handleSnappingChange = useCallback((enabled: boolean) => {
    setSnapping(enabled);
    writeBooleanPreference(SNAP_PREFERENCE_KEY, enabled);
  }, []);
  useSmartGuides(fabricCanvas, snapping);

  // Phones start with the canvas unobstructed; wide screens with the panel.
  const previousIsMobileRef = useRef(isMobile);
  useEffect(() => {
    if (previousIsMobileRef.current === isMobile) return;
    previousIsMobileRef.current = isMobile;
    setPanel(isMobile ? null : "properties");
  }, [isMobile, setPanel]);

  // Warn before closing the tab while a project is open
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const handleToolChange = useCallback(
    (tool: Tool) => {
      setActiveTool(tool);
      if (isShapeKind(tool)) setLastShape(tool);
      if (isBrushTool(tool)) setLastBrushTool(tool);
      if (isFillTool(tool)) setLastFillTool(tool);
      if (isHealingTool(tool)) setLastHealingTool(tool);
      if (isToningTool(tool)) setLastToningTool(tool);
      if (isFocusTool(tool)) setLastFocusTool(tool);
      if (isMarqueeTool(tool)) setLastMarqueeTool(tool);
      if (isLassoTool(tool)) setLastLassoTool(tool);
    },
    [setLastShape, setLastBrushTool, setLastFillTool, setLastHealingTool, setLastToningTool, setLastFocusTool, setLastMarqueeTool, setLastLassoTool]
  );

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  /** Decode and validate an image file, then add it as a layer. */
  const addImageFileAsLayer = useCallback(
    async (file: File, dropEvent?: DragEvent) => {
      const canvas = fabricCanvas;
      if (!canvas) return;
      layerLoadControllerRef.current?.abort();
      const controller = new AbortController();
      layerLoadControllerRef.current = controller;
      try {
        const { dataUrl } = await readSafeRasterImage(file, controller.signal);
        if (controller.signal.aborted) return;
        // Dropped files land under the pointer when it is over the canvas.
        let point;
        if (dropEvent) {
          const rect = canvas.upperCanvasEl.getBoundingClientRect();
          const inside =
            dropEvent.clientX >= rect.left &&
            dropEvent.clientX <= rect.right &&
            dropEvent.clientY >= rect.top &&
            dropEvent.clientY <= rect.bottom;
          if (inside) point = canvas.getScenePoint(dropEvent);
        }
        const image = await addImageLayer(canvas, dataUrl, {
          signal: controller.signal,
          at: point,
        });
        if (!image) return;
        setActiveTool("select");
        toast.success("Image added as a new layer");
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        toast.error(error instanceof Error ? error.message : "Failed to add the image");
      } finally {
        if (layerLoadControllerRef.current === controller) layerLoadControllerRef.current = null;
      }
    },
    [fabricCanvas]
  );

  const handleSaveProjectFile = useCallback(() => {
    if (!fabricCanvas) return;
    try {
      downloadProjectFile(fabricCanvas);
      toast.success("Project saved to a file");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this project");
    }
  }, [fabricCanvas]);

  // ---------- Canvas commands ----------

  const handleZoomIn = useCallback(() => setZoom((value) => clampZoom(value + 0.1)), []);
  const handleZoomOut = useCallback(() => setZoom((value) => clampZoom(value - 0.1)), []);
  const handleFit = useCallback(() => {
    if (fabricCanvas) setZoom(fitToScreen(fabricCanvas));
  }, [fabricCanvas]);
  const handleActualPixels = useCallback(() => setZoom(1), []);
  const swapColors = useCallback(() => {
    setActiveColor(backgroundColor);
    setBackgroundColor(activeColor);
  }, [activeColor, backgroundColor, setActiveColor, setBackgroundColor]);
  const resetColors = useCallback(() => {
    setActiveColor("#000000");
    setBackgroundColor("#ffffff");
  }, [setActiveColor, setBackgroundColor]);
  const adjustBrush = useCallback(
    (setting: "width" | "hardness", direction: 1 | -1) => {
      // The marker keeps its own settings; the pixel tools share theirs.
      if (activeTool === "draw") {
        if (setting === "width") setBrushWidth((width) => stepBrushWidth(width, direction));
        else setBrushHardness((hardness) => stepBrushHardness(hardness, direction));
      } else if (setting === "width") {
        setPaint((current) => ({ ...current, size: stepPaintSize(current.size, direction) }));
      } else {
        setPaint((current) => ({
          ...current,
          hardness: stepBrushHardness(current.hardness, direction),
        }));
      }
    },
    [activeTool, setBrushWidth, setBrushHardness, setPaint]
  );

  const handleRotate = useCallback(
    (degrees: number) => {
      if (!fabricCanvas) return;
      const result = rotate(fabricCanvas, degrees);
      if (result === null && fabricCanvas.getActiveObject()) {
        toast.error("Unlock the layer before rotating it");
      } else if (result === "canvas") {
        setZoom(fabricCanvas.getZoom());
      }
    },
    [fabricCanvas]
  );

  const handleFlip = useCallback(
    (axis: "x" | "y") => {
      if (!fabricCanvas) return;
      const result = flip(fabricCanvas, axis);
      if (result === null && fabricCanvas.getActiveObject()) {
        toast.error("Unlock the layer before flipping it");
      }
    },
    [fabricCanvas]
  );

  const handleArrange = useCallback(
    (action: ArrangeAction) => {
      if (!fabricCanvas) return;
      if (!arrange(fabricCanvas, action) && fabricCanvas.getActiveObject()) {
        toast.error("The photo always stays at the bottom. Unlock a layer to move it.");
      }
    },
    [fabricCanvas]
  );

  const handleDuplicate = useCallback(() => {
    if (!fabricCanvas) return;
    void duplicateSelection(fabricCanvas)
      .then((count) => {
        if (count === 0) toast("Select a layer to duplicate");
      })
      .catch((error) => {
        console.error("Duplicate failed:", error);
        toast.error("That layer could not be duplicated");
      });
  }, [fabricCanvas]);

  const handleCopy = useCallback(() => {
    if (!fabricCanvas) return;
    const pixels = selectionOf(fabricCanvas).current();
    if (pixels) {
      // The selected pixels of the selected layer (or the photo), read now.
      void selectionLayer(fabricCanvas, pixels, copySource(fabricCanvas))
        .then(({ layer }) => {
          clipboardRef.current = { objects: [layer], pastes: 0 };
          toast.success("Selection copied", { id: "layer-clipboard", duration: 1500 });
        })
        .catch((error) => {
          console.error("Copy failed:", error);
          toast.error("The selection could not be copied");
        });
      return;
    }
    void copySelection(fabricCanvas)
      .then((objects) => {
        if (objects.length === 0) return;
        clipboardRef.current = { objects, pastes: 0 };
        toast.success(objects.length === 1 ? "Layer copied" : `${objects.length} layers copied`, {
          id: "layer-clipboard",
          duration: 1500,
        });
      })
      .catch((error) => {
        console.error("Copy failed:", error);
        toast.error("That layer could not be copied");
      });
  }, [fabricCanvas]);

  const pasteLayers = useCallback(async () => {
    const canvas = fabricCanvas;
    const clipboard = clipboardRef.current;
    if (!canvas || !clipboard) return false;
    clipboard.pastes += 1;
    const copies = await cloneObjects(clipboard.objects);
    // Copied pixels have no layer name yet; they become "Layer N".
    let number = Number(/\d+$/.exec(nextLayerName(canvas))?.[0] ?? 1);
    for (const copy of copies) {
      const layer = copy as EditorFabricObject;
      if (!layer.name) layer.name = `Layer ${number++}`;
    }
    placeCopies(canvas, copies, (16 * clipboard.pastes) / (canvas.getZoom() || 1));
    return copies.length > 0;
  }, [fabricCanvas]);

  const canPasteLayers = useCallback(() => clipboardRef.current !== null, []);
  const handleContextPaste = useCallback(() => {
    void pasteLayers().catch((error) => {
      console.error("Paste failed:", error);
      toast.error("Those layers could not be pasted");
    });
  }, [pasteLayers]);

  const handlePickedColor = useCallback(
    (hex: string) => {
      setActiveColor(hex);
      const active = fabricCanvas?.getActiveObject();
      if (fabricCanvas && active && !isEditorChrome(active) && !isReadOnlySelection(active)) {
        applyColor(active, hex);
        fabricCanvas.fire("object:modified", { target: active });
        fabricCanvas.requestRenderAll();
      }
      toast.success(`Picked ${hex}`, { id: "eyedropper", duration: 1800 });
    },
    [fabricCanvas, setActiveColor]
  );
  const eyedropper = useEyedropper(fabricCanvas, handlePickedColor);

  const openExport = useCallback(() => {
    if (fabricCanvas) setExportOpen(true);
  }, [fabricCanvas]);

  const togglePanel = useCallback(
    (tab: PanelTab) => setPanel((current) => (current === tab ? null : tab)),
    [setPanel]
  );
  const openPanel = useCallback((tab: PanelTab) => setPanel(tab), [setPanel]);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const [selectionModification, setSelectionModification] = useState<SelectionModification | null>(null);
  const openStrokeDialog = useCallback(() => setSelectionModification("stroke"), []);
  /** The layer the Layer style dialog is open for. */
  const [styledLayer, setStyledLayer] = useState<FabricObject | null>(null);
  /** The Image › Adjustments dialog that is open. */
  const [adjustment, setAdjustment] = useState<AdjustmentKind | null>(null);
  const [documentDialog, setDocumentDialog] = useState<DocumentDialogKind | null>(null);
  const maskTargetLayer = useMaskTarget(fabricCanvas);
  const leaveMask = useCallback(() => {
    if (fabricCanvas) maskTargetOf(fabricCanvas).set(null);
  }, [fabricCanvas]);
  const paintColors = useMemo(
    () => ({ foreground: activeColor, background: backgroundColor }),
    [activeColor, backgroundColor]
  );
  const openCommandPalette = useCallback(() => setPaletteOpen(true), []);
  const requestNew = useCallback(() => setDiscardAction("new"), []);
  const requestOpenImage = useCallback(() => setDiscardAction("openImage"), []);
  const requestOpenProject = useCallback(() => setDiscardAction("openProject"), []);
  const placeImage = useCallback(() => layerInputRef.current?.click(), []);

  const confirmDiscard = () => {
    const action = discardAction;
    setDiscardAction(null);
    if (action === "new") {
      ai.cancel();
      onNewProject();
    } else if (action === "openImage") {
      // Still inside the click that confirmed, so the file picker may open.
      imageInputRef.current?.click();
    } else if (action === "openProject") {
      projectInputRef.current?.click();
    }
  };

  const commands = useEditorCommands({
    canvas: fabricCanvas,
    activeTool,
    onToolChange: handleToolChange,
    lastShape,
    lastBrushTool,
    lastFillTool,
    lastHealingTool,
    lastToningTool,
    lastMarqueeTool,
    lastLassoTool,
    undo,
    redo,
    hasUndo,
    hasRedo,
    zoomIn: handleZoomIn,
    zoomOut: handleZoomOut,
    fitOnScreen: handleFit,
    actualPixels: handleActualPixels,
    rotate: handleRotate,
    flip: handleFlip,
    arrange: handleArrange,
    duplicate: handleDuplicate,
    copy: handleCopy,
    paste: handleContextPaste,
    canPaste: canPasteLayers,
    requestNew,
    requestOpenImage,
    requestOpenProject,
    placeImage,
    saveProject: handleSaveProjectFile,
    exportImage: openExport,
    ai,
    pickColor: eyedropper.start,
    snapping,
    setSnapping: handleSnappingChange,
    panel,
    togglePanel,
    histogram: histogramOpen,
    setHistogram: setHistogramOpen,
    openPanel,
    showShortcuts,
    modifySelection: setSelectionModification,
    strokeSelection: openStrokeDialog,
    openLayerStyle: setStyledLayer,
    openDocumentDialog: setDocumentDialog,
    openAdjustment: setAdjustment,
    colors: paintColors,
    adjustBrush,
    swapColors,
    resetColors,
    openCommandPalette,
  });
  const commandList = useMemo(() => Object.values(commands), [commands]);
  useKeyboardShortcuts({ canvas: fabricCanvas, commands: commandList });

  // ---------- Paste and drop: images open or become layers ----------

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const active = fabricCanvas?.getActiveObject() as { isEditing?: boolean } | undefined;
      if (active?.isEditing) return;
      const imageItem = Array.from(event.clipboardData?.items ?? []).find(
        (item) => item.kind === "file" && item.type.startsWith("image/")
      );
      const file = imageItem?.getAsFile();
      if (file) {
        event.preventDefault();
        void addImageFileAsLayer(file);
        return;
      }
      if (clipboardRef.current) {
        event.preventDefault();
        void pasteLayers().catch((error) => {
          console.error("Paste failed:", error);
          toast.error("Those layers could not be pasted");
        });
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [addImageFileAsLayer, fabricCanvas, pasteLayers]);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const handleDragOver = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const handleDrop = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      if (isProjectFile(file)) {
        toast("Use “Open project file” in the menu to replace the current project");
        return;
      }
      void addImageFileAsLayer(file, event);
    };
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [addImageFileAsLayer]);

  // ---------- Layout ----------

  const panelTabs = (
    <Tabs
      value={panel ?? "properties"}
      onValueChange={(value) => setPanel(value as PanelTab)}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <TabsList className="h-9 flex-1">
          <TabsTrigger value="properties">
            <Paintbrush />
            Properties
          </TabsTrigger>
          <TabsTrigger value="adjust">
            <SlidersHorizontal />
            Adjust
          </TabsTrigger>
          <TabsTrigger value="layers">
            <Layers />
            Layers
          </TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          aria-label="Close panel"
          onClick={() => setPanel(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <TabsContent value="properties" className="mt-0 min-h-0 flex-1">
        <PropertiesPanel
          activeColor={activeColor}
          onColorChange={setActiveColor}
          fabricCanvas={fabricCanvas}
        />
      </TabsContent>
      <TabsContent value="adjust" className="mt-0 min-h-0 flex-1">
        <AdjustPanel fabricCanvas={fabricCanvas} />
      </TabsContent>
      <TabsContent value="layers" className="mt-0 min-h-0 flex-1">
        <LayersPanel
          fabricCanvas={fabricCanvas}
          onAddMask={commands["layer.mask.add"]?.run}
          onLayerStyle={commands["layer.style"]?.run}
        />
      </TabsContent>
    </Tabs>
  );

  const desktopChrome = !isMobile;
  const mobileChrome = isMobile;

  const colorWells = (large: boolean) => (
    <ColorWells
      foreground={activeColor}
      background={backgroundColor}
      onForegroundChange={setActiveColor}
      onBackgroundChange={setBackgroundColor}
      onSwap={swapColors}
      onReset={resetColors}
      large={large}
    />
  );

  const optionsBar = (
    <OptionsBar
      colors={colorWells(true)}
      activeTool={activeTool}
      onToolChange={handleToolChange}
      compact={isMobile}
      activeColor={activeColor}
      brush={{ kind: brushKind, width: brushWidth, hardness: brushHardness, opacity: brushOpacity }}
      onBrushKindChange={handleBrushKindChange}
      onBrushWidthChange={setBrushWidth}
      onBrushHardnessChange={setBrushHardness}
      onBrushOpacityChange={setBrushOpacity}
      paint={paint}
      onPaintChange={updatePaint}
      bucket={bucket}
      onBucketChange={updateBucket}
      gradient={gradient}
      onGradientChange={updateGradient}
      secondaryColor={backgroundColor}
      snapping={snapping}
      onSnappingChange={handleSnappingChange}
      selectionMode={selectionMode}
      onSelectionModeChange={setSelectionMode}
      wand={wand}
      onWandChange={updateWand}
      retouch={retouch}
      onRetouchChange={updateRetouch}
      pickingSource={pickingSource}
      onPickingSourceChange={setPickingSource}
      maskLayerName={maskTargetLayer ? (maskTargetLayer as EditorFabricObject).name ?? "the layer" : null}
      onLeaveMask={leaveMask}
    />
  );

  // The canvas <main> keeps the same position in this tree at every width so
  // crossing the mobile breakpoint never remounts (and never resets) it.
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-editor-bg text-foreground">
      <TopBar
        isMobile={isMobile}
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        ai={ai}
        onExport={openExport}
        onSaveProject={handleSaveProjectFile}
        panel={panel}
        onTogglePanel={togglePanel}
        commands={commands}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept={RASTER_FILE_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onOpenImageFile(file);
        }}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onOpenProjectFile(file);
        }}
      />
      <input
        ref={layerInputRef}
        type="file"
        accept={RASTER_FILE_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void addImageFileAsLayer(file);
        }}
      />
      <AlertDialog
        open={discardAction !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardAction(null);
        }}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{DISCARD_TEXT[discardAction ?? "new"].title}</AlertDialogTitle>
            <AlertDialogDescription>
              The current image and all edits will be discarded. Save a project file first if
              you want to keep editing later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>
              {DISCARD_TEXT[discardAction ?? "new"].confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {desktopChrome ? optionsBar : null}

      <div className="relative flex min-h-0 flex-1">
        {desktopChrome ? (
          <Toolbar
            orientation="vertical"
            activeTool={activeTool}
            onToolChange={handleToolChange}
            lastShape={lastShape}
            lastBrushTool={lastBrushTool}
            lastFillTool={lastFillTool}
            lastHealingTool={lastHealingTool}
            lastToningTool={lastToningTool}
            lastFocusTool={lastFocusTool}
            lastMarqueeTool={lastMarqueeTool}
            lastLassoTool={lastLassoTool}
            fabricCanvas={fabricCanvas}
            onEyedropper={eyedropper.start}
            colors={colorWells(false)}
          />
        ) : null}

        <main className="relative min-w-0 flex-1" aria-label="Canvas">
          <FabricCanvasComponent
            activeTool={activeTool}
            activeColor={activeColor}
            brushWidth={brushWidth}
            brushHardness={brushHardness}
            brushOpacity={brushOpacity}
            brushKind={brushKind}
            paint={paint}
            bucket={bucket}
            gradient={gradient}
            selectionMode={selectionMode}
            wand={wand}
            retouch={retouch}
            pickingSource={pickingSource}
            onPickingSourceChange={setPickingSource}
            onSelectSubject={() => void ai.selectSubject()}
            aiBusy={ai.isProcessing}
            secondaryColor={backgroundColor}
            uploadedImage={uploadedImage}
            initialSnapshot={initialSnapshot}
            onCanvasReady={setFabricCanvas}
            zoom={zoom}
            onZoomChange={handleZoomChange}
            onToolChange={handleToolChange}
            onLoadError={onLoadError}
          />

          {histogramOpen && <HistogramPanel canvas={fabricCanvas} onClose={() => setHistogramOpen(false)} />}

          {eyedropper.picking && !("EyeDropper" in window) && (
            <div
              role="button"
              aria-label="Pick a color from the canvas"
              className="absolute inset-0 z-20 cursor-crosshair"
              onPointerDown={(event) => {
                event.preventDefault();
                eyedropper.pickAt(event.clientX, event.clientY);
              }}
            >
              <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
                <Pipette className="h-3.5 w-3.5 text-primary" />
                Tap the image to pick a colour · Esc to cancel
              </div>
            </div>
          )}

          {dragActive && (
            <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-full bg-popover px-4 py-2 text-sm font-medium shadow-xl">
                <ImagePlus className="h-4 w-4 text-primary" />
                Drop to add as a new layer
              </div>
            </div>
          )}
        </main>

        {desktopChrome && panel ? (
          <aside
            aria-label="Editor panel"
            className="flex w-80 shrink-0 flex-col border-l border-border bg-editor-panel"
          >
            {panelTabs}
          </aside>
        ) : null}
      </div>

      {mobileChrome && panel ? (
        <section
          aria-label="Editor panel"
          className={cn(
            "flex h-[min(46dvh,440px)] shrink-0 flex-col border-t border-border bg-editor-panel",
            "animate-in slide-in-from-bottom-4 fade-in-0 duration-200"
          )}
        >
          {panelTabs}
        </section>
      ) : null}

      {mobileChrome ? optionsBar : null}
      {mobileChrome ? (
        <Toolbar
          orientation="horizontal"
          activeTool={activeTool}
          onToolChange={handleToolChange}
          lastShape={lastShape}
          lastBrushTool={lastBrushTool}
          lastFillTool={lastFillTool}
          lastHealingTool={lastHealingTool}
          lastToningTool={lastToningTool}
          lastFocusTool={lastFocusTool}
          lastMarqueeTool={lastMarqueeTool}
          lastLassoTool={lastLassoTool}
          fabricCanvas={fabricCanvas}
          onEyedropper={eyedropper.start}
        />
      ) : null}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        canvas={fabricCanvas}
        defaultName={documentName}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} commands={commands} />
      <LayerStyleDialog canvas={fabricCanvas} layer={styledLayer} onClose={() => setStyledLayer(null)} />
      <AdjustmentDialog
        canvas={fabricCanvas}
        kind={adjustment}
        colors={{ foreground: activeColor, background: backgroundColor }}
        onClose={() => setAdjustment(null)}
      />
      <DocumentDialog
        canvas={fabricCanvas}
        kind={documentDialog}
        onClose={() => setDocumentDialog(null)}
        onResized={handleFit}
      />
      <SelectionModifyDialog
        canvas={fabricCanvas}
        modification={selectionModification}
        strokeColor={activeColor}
        onClose={() => setSelectionModification(null)}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      <CanvasContextMenu
        canvas={fabricCanvas}
        enabled={activeTool === "select"}
        onCopy={handleCopy}
        onPaste={handleContextPaste}
        canPaste={canPasteLayers}
        onDuplicate={handleDuplicate}
        onArrange={handleArrange}
        onFlip={handleFlip}
        onFit={handleFit}
      />
    </div>
  );
};

export default EditorWorkspace;
