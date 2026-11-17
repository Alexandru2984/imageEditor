import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { ImagePlus, Layers, Paintbrush, Pipette, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { Canvas as FabricCanvasComponent } from "./Canvas";
import { Toolbar } from "./Toolbar";
import { PropertiesPanel } from "./PropertiesPanel";
import { AdjustPanel } from "./AdjustPanel";
import { LayersPanel } from "./LayersPanel";
import { StartScreen } from "./StartScreen";
import { TopBar } from "./TopBar";
import { ExportDialog } from "./ExportDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useKeyboardShortcuts, type ShortcutActions } from "@/hooks/useKeyboardShortcuts";
import { useAiActions } from "@/hooks/useAiActions";
import { useEyedropper } from "@/hooks/useEyedropper";
import { useDocumentFonts } from "@/hooks/useDocumentFonts";
import { useSmartGuides } from "@/hooks/useSmartGuides";
import { BRUSHES, type BrushKind } from "@/utils/brushes";
import {
  SNAP_PREFERENCE_KEY,
  readBooleanPreference,
  writeBooleanPreference,
} from "@/utils/preferences";
import { CanvasContextMenu } from "./CanvasContextMenu";
import {
  saveProject,
  loadProject,
  clearProject,
  InvalidAutosaveError,
  type SavedProject,
} from "@/utils/projectStore";
import { downloadProjectFile, readProjectFile } from "@/utils/projectFile";
import type { CanvasSnapshot } from "@/utils/canvasSnapshot";
import { isAbortError } from "@/utils/abort";
import { readSafeRasterImage } from "@/utils/imageFile";
import { clampZoom, fitToScreen } from "@/utils/viewport";
import { isEditorChrome, isReadOnlySelection } from "@/utils/editorObjects";
import { applyColor } from "@/utils/shapes";
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
import { sanitizeFileName } from "@/utils/exportImage";
import type { PanelTab, Tool } from "@/types/editor";
import { cn } from "@/lib/utils";

// Re-export Tool so existing consumers that import from ./ImageEditor still work
export type { Tool } from "@/types/editor";

const AUTOSAVE_DELAY_MS = 800;

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

export const ImageEditor = () => {
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [activeColor, setActiveColor] = useState("#a855f7");
  const [brushWidth, setBrushWidth] = useState(3);
  const [brushHardness, setBrushHardness] = useState(100);
  const [brushOpacity, setBrushOpacity] = useState(100);
  const [brushKind, setBrushKind] = useState<BrushKind>("pen");
  const handleBrushKindChange = useCallback((kind: BrushKind) => {
    setBrushKind(kind);
    const option = BRUSHES.find((candidate) => candidate.kind === kind);
    if (option) setBrushWidth((width) => Math.max(width, option.minWidth));
  }, []);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState("edited-image");
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  // Zoom is a fraction everywhere (1 = 100%), matching Fabric's own getZoom()
  const [zoom, setZoom] = useState(1);
  const isMobile = useIsMobile();
  const [panel, setPanel] = useState<PanelTab | null>(isMobile ? null : "properties");
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Autosaved session found in IndexedDB, offered on the start screen
  const [savedProject, setSavedProject] = useState<SavedProject | null>(null);
  // When restoring, the canvas loads this snapshot instead of a fresh image
  const [initialSnapshot, setInitialSnapshot] = useState<CanvasSnapshot | null>(null);

  const autosaveTimerRef = useRef<number | null>(null);
  const latestSnapshotRef = useRef<{
    snapshot: CanvasSnapshot;
    changedAt: number;
  } | null>(null);
  const lastSnapshotTimestampRef = useRef(0);
  const autosaveGenerationRef = useRef(0);
  const autosaveFailureShownRef = useRef(false);
  const autosaveConflictShownRef = useRef(false);
  const documentLoadControllerRef = useRef<AbortController | null>(null);
  const layerLoadControllerRef = useRef<AbortController | null>(null);
  const clipboardRef = useRef<{ objects: FabricObject[]; pastes: number } | null>(null);
  const dragDepthRef = useRef(0);

  const hasDocument = !!uploadedImage;

  const cancelDocumentLoad = useCallback(() => {
    documentLoadControllerRef.current?.abort();
    documentLoadControllerRef.current = null;
  }, []);

  const beginDocumentLoad = useCallback((): AbortSignal => {
    documentLoadControllerRef.current?.abort();
    const controller = new AbortController();
    documentLoadControllerRef.current = controller;
    return controller.signal;
  }, []);

  useEffect(
    () => () => {
      cancelDocumentLoad();
      layerLoadControllerRef.current?.abort();
    },
    [cancelDocumentLoad]
  );

  // Copied layers belong to the document they came from.
  useEffect(() => {
    clipboardRef.current = null;
    layerLoadControllerRef.current?.abort();
    layerLoadControllerRef.current = null;
  }, [fabricCanvas]);

  const cancelScheduledAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    latestSnapshotRef.current = null;
    autosaveGenerationRef.current += 1;
  }, []);

  const flushAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const pending = latestSnapshotRef.current;
    if (!pending) return;

    const generation = autosaveGenerationRef.current;
    const project: SavedProject = {
      snapshot: pending.snapshot,
      savedAt: pending.changedAt,
    };
    // Start in a microtask so a synchronous size-limit failure follows the
    // same error path as an IndexedDB transaction failure.
    void Promise.resolve()
      .then(() => saveProject(project))
      .then((written) => {
        if (generation !== autosaveGenerationRef.current) return;
        if (latestSnapshotRef.current === pending) {
          latestSnapshotRef.current = null;
        }
        if (!written) {
          if (!autosaveConflictShownRef.current) {
            autosaveConflictShownRef.current = true;
            toast.warning(
              "A newer autosave exists in another tab. Your next edit will become the latest version."
            );
          }
          return;
        }
        autosaveFailureShownRef.current = false;
        autosaveConflictShownRef.current = false;
        setSavedProject(project);
      })
      .catch((error) => {
        if (generation === autosaveGenerationRef.current && !autosaveFailureShownRef.current) {
          autosaveFailureShownRef.current = true;
          console.warn("Autosave failed:", error);
          toast.error("Autosave failed. Save a project file before leaving.");
        }
      });
  }, []);

  const handleSnapshot = useCallback(
    (snapshot: CanvasSnapshot) => {
      const changedAt = Math.max(Date.now(), lastSnapshotTimestampRef.current + 1);
      lastSnapshotTimestampRef.current = changedAt;
      latestSnapshotRef.current = { snapshot, changedAt };
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = window.setTimeout(() => {
        flushAutosave();
      }, AUTOSAVE_DELAY_MS);
    },
    [flushAutosave]
  );

  const handleHistoryError = useCallback((error: unknown) => {
    console.error("Could not update edit history:", error);
    toast.error("Undo/redo failed. The editor attempted a safe rollback.");
  }, []);

  const { undo, redo, canUndo, canRedo } = useUndoRedo(
    fabricCanvas,
    handleSnapshot,
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

  // Offer to continue the last session
  useEffect(() => {
    let active = true;
    const generation = autosaveGenerationRef.current;
    loadProject()
      .then((project) => {
        if (active && generation === autosaveGenerationRef.current) {
          setSavedProject(project ?? null);
        }
      })
      .catch((error) => {
        if (!active || generation !== autosaveGenerationRef.current) return;
        setSavedProject(null);
        console.warn("Could not load autosave:", error);
        if (error instanceof InvalidAutosaveError) {
          void clearProject().catch(() => {});
          toast.error("A corrupt local autosave was removed for safety.");
        } else {
          toast.error("Local autosave is unavailable in this browser.");
        }
      });
    return () => {
      active = false;
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  // Flush the latest snapshot when the page is backgrounded. This is the last
  // reliable lifecycle signal on mobile browsers, where tabs are often killed
  // without a conventional unload.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushAutosave();
    };
    const handlePageHide = () => flushAutosave();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flushAutosave]);

  // Phones start with the canvas unobstructed; wide screens with the panel.
  const previousIsMobileRef = useRef(isMobile);
  useEffect(() => {
    if (previousIsMobileRef.current === isMobile) return;
    previousIsMobileRef.current = isMobile;
    setPanel(isMobile ? null : "properties");
  }, [isMobile]);

  // Warn before closing the tab while a project is open
  useEffect(() => {
    if (!uploadedImage) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [uploadedImage]);

  const handleToolChange = useCallback((tool: Tool) => {
    setActiveTool(tool);
  }, []);

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  const handleCanvasLoadError = useCallback(
    (error: unknown) => {
      console.error("Failed to load canvas document:", error);
      toast.error("The image or project could not be decoded safely");
      cancelDocumentLoad();
      cancelScheduledAutosave();
      setFabricCanvas(null);
      setInitialSnapshot(null);
      setUploadedImage(null);
    },
    [cancelDocumentLoad, cancelScheduledAutosave]
  );

  const handleImageUpload = useCallback(
    (dataUrl: string) => {
      cancelScheduledAutosave();
      setSavedProject(null);
      void clearProject().catch((error) => {
        console.warn("Could not clear previous autosave:", error);
      });
      setInitialSnapshot(null);
      setUploadedImage(dataUrl);
    },
    [cancelScheduledAutosave]
  );

  /** Decode and validate an image file, then open it as a new document. */
  const openImageFile = useCallback(
    async (file: File) => {
      const signal = beginDocumentLoad();
      try {
        const { dataUrl } = await readSafeRasterImage(file, signal);
        if (signal.aborted) return;
        setDocumentName(sanitizeFileName(file.name.replace(/\.[^.]+$/, ""), "edited-image"));
        handleImageUpload(dataUrl);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        toast.error(
          error instanceof Error ? error.message : "Failed to read the image. Please try again."
        );
      }
    },
    [beginDocumentLoad, handleImageUpload]
  );

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

  const handleRestoreProject = useCallback(() => {
    if (!savedProject) return;
    cancelDocumentLoad();
    cancelScheduledAutosave();
    setDocumentName("edited-image");
    setInitialSnapshot(savedProject.snapshot);
    setUploadedImage(savedProject.snapshot.srcs[0] ?? "restored-project");
  }, [cancelDocumentLoad, cancelScheduledAutosave, savedProject]);

  const handleSaveProjectFile = useCallback(() => {
    if (!fabricCanvas) return;
    try {
      downloadProjectFile(fabricCanvas);
      toast.success("Project saved to a file");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this project");
    }
  }, [fabricCanvas]);

  const handleOpenProjectFile = useCallback(
    async (file: File) => {
      const signal = beginDocumentLoad();
      try {
        const snapshot = await readProjectFile(file, signal);
        if (signal.aborted) return;
        cancelScheduledAutosave();
        setSavedProject(null);
        void clearProject().catch((error) => {
          console.warn("Could not clear previous autosave:", error);
        });
        setFabricCanvas(null);
        setDocumentName(sanitizeFileName(file.name.replace(/\.[^.]+$/, ""), "edited-image"));
        setInitialSnapshot(snapshot);
        // uploadedImage just needs to be truthy to show the editor; reuse the
        // project's first image so AI actions still have a source
        setUploadedImage(snapshot.srcs[0] ?? "loaded-project");
        toast.success("Project opened");
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        toast.error(
          error instanceof Error ? error.message : "Couldn't open that file. Is it a project file?"
        );
      }
    },
    [beginDocumentLoad, cancelScheduledAutosave]
  );

  const handleNewProject = useCallback(() => {
    cancelDocumentLoad();
    cancelScheduledAutosave();
    void clearProject().catch((error) => {
      console.warn("Could not clear autosave:", error);
      toast.error("The local autosave could not be cleared.");
    });
    setSavedProject(null);
    setInitialSnapshot(null);
    setUploadedImage(null);
    setFabricCanvas(null);
    setDocumentName("edited-image");
    setActiveTool("select");
    setZoom(1);
    setExportOpen(false);
  }, [cancelDocumentLoad, cancelScheduledAutosave]);

  // ---------- Canvas commands ----------

  const handleZoomIn = useCallback(() => setZoom((value) => clampZoom(value + 0.1)), []);
  const handleZoomOut = useCallback(() => setZoom((value) => clampZoom(value - 0.1)), []);
  const handleFit = useCallback(() => {
    if (fabricCanvas) setZoom(fitToScreen(fabricCanvas));
  }, [fabricCanvas]);

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
    [fabricCanvas]
  );
  const eyedropper = useEyedropper(fabricCanvas, handlePickedColor);

  const openExport = useCallback(() => {
    if (fabricCanvas) setExportOpen(true);
  }, [fabricCanvas]);

  const shortcutActions = useMemo<ShortcutActions>(
    () => ({
      save: handleSaveProjectFile,
      exportImage: openExport,
      duplicate: handleDuplicate,
      copy: handleCopy,
      arrange: handleArrange,
      flip: handleFlip,
      pickColor: eyedropper.start,
      showShortcuts: () => setShortcutsOpen(true),
    }),
    [
      handleSaveProjectFile,
      openExport,
      handleDuplicate,
      handleCopy,
      handleArrange,
      handleFlip,
      eyedropper.start,
    ]
  );

  useKeyboardShortcuts({
    canvas: fabricCanvas,
    undo,
    redo,
    zoom,
    onZoomChange: handleZoomChange,
    onToolChange: handleToolChange,
    actions: shortcutActions,
  });

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
        if (hasDocument) void addImageFileAsLayer(file);
        else void openImageFile(file);
        return;
      }
      if (hasDocument && clipboardRef.current) {
        event.preventDefault();
        void pasteLayers().catch((error) => {
          console.error("Paste failed:", error);
          toast.error("Those layers could not be pasted");
        });
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [addImageFileAsLayer, fabricCanvas, hasDocument, openImageFile, pasteLayers]);

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
        if (hasDocument) {
          toast("Use “Open project file” in the menu to replace the current project");
          return;
        }
        void handleOpenProjectFile(file);
        return;
      }
      if (hasDocument) {
        void addImageFileAsLayer(file, event);
      } else {
        void openImageFile(file);
      }
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
  }, [addImageFileAsLayer, handleOpenProjectFile, hasDocument, openImageFile]);

  // ---------- Layout ----------

  const togglePanel = useCallback((tab: PanelTab) => {
    setPanel((current) => (current === tab ? null : tab));
  }, []);

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
          brushWidth={brushWidth}
          onBrushWidthChange={setBrushWidth}
          brushHardness={brushHardness}
          onBrushHardnessChange={setBrushHardness}
          brushOpacity={brushOpacity}
          onBrushOpacityChange={setBrushOpacity}
          brushKind={brushKind}
          onBrushKindChange={handleBrushKindChange}
          fabricCanvas={fabricCanvas}
        />
      </TabsContent>
      <TabsContent value="adjust" className="mt-0 min-h-0 flex-1">
        <AdjustPanel fabricCanvas={fabricCanvas} />
      </TabsContent>
      <TabsContent value="layers" className="mt-0 min-h-0 flex-1">
        <LayersPanel fabricCanvas={fabricCanvas} />
      </TabsContent>
    </Tabs>
  );

  const desktopChrome = hasDocument && !isMobile;
  const mobileChrome = hasDocument && isMobile;

  // The canvas <main> keeps the same position in this tree at every width so
  // crossing the mobile breakpoint never remounts (and never resets) it.
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-editor-bg text-foreground">
      <TopBar
        hasDocument={hasDocument}
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
        onRotate={handleRotate}
        onFlip={handleFlip}
        onExport={openExport}
        onSaveProject={handleSaveProjectFile}
        onOpenProject={(file) => void handleOpenProjectFile(file)}
        onNewProject={handleNewProject}
        onShowShortcuts={() => setShortcutsOpen(true)}
        snapping={snapping}
        onSnappingChange={handleSnappingChange}
        panel={panel}
        onTogglePanel={togglePanel}
      />

      <div className="relative flex min-h-0 flex-1">
        {desktopChrome ? (
          <Toolbar
            orientation="vertical"
            activeTool={activeTool}
            onToolChange={handleToolChange}
            fabricCanvas={fabricCanvas}
            onEyedropper={eyedropper.start}
          />
        ) : null}

        <main className="relative min-w-0 flex-1" aria-label={hasDocument ? "Canvas" : "Start"}>
          {hasDocument ? (
            <FabricCanvasComponent
              activeTool={activeTool}
              activeColor={activeColor}
              brushWidth={brushWidth}
              brushHardness={brushHardness}
              brushOpacity={brushOpacity}
              brushKind={brushKind}
              uploadedImage={uploadedImage}
              initialSnapshot={initialSnapshot}
              onCanvasReady={setFabricCanvas}
              zoom={zoom}
              onZoomChange={handleZoomChange}
              onToolChange={handleToolChange}
              onLoadError={handleCanvasLoadError}
            />
          ) : (
            <StartScreen
              onFile={openImageFile}
              savedProject={savedProject}
              onRestore={handleRestoreProject}
              onOpenProject={(file) => void handleOpenProjectFile(file)}
              dragActive={dragActive}
            />
          )}

          {hasDocument && eyedropper.picking && !("EyeDropper" in window) && (
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

          {hasDocument && dragActive && (
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

      {mobileChrome ? (
        <Toolbar
          orientation="horizontal"
          activeTool={activeTool}
          onToolChange={handleToolChange}
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
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {hasDocument && (
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
      )}
    </div>
  );
};
