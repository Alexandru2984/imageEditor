import { useState, useCallback, useEffect, useRef } from "react";
import { Canvas as FabricCanvas } from "fabric";
import { Canvas as FabricCanvasComponent } from "./Canvas";
import { Toolbar } from "./Toolbar";
import { PropertiesPanel } from "./PropertiesPanel";
import { LayersPanel } from "./LayersPanel";
import { ImageUpload } from "./ImageUpload";
import { TopBar } from "./TopBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import {
  saveProject,
  loadProject,
  clearProject,
  InvalidAutosaveError,
  type SavedProject,
} from "@/utils/projectStore";
import { downloadProjectFile, readProjectFile } from "@/utils/projectFile";
import type { CanvasSnapshot } from "@/utils/canvasSnapshot";
import { toast } from "sonner";
import { isAbortError } from "@/utils/abort";
import type { Tool } from "@/types/editor";

// Re-export Tool so existing consumers (e.g. Toolbar) that import from ./ImageEditor still work
export type { Tool } from "@/types/editor";

const AUTOSAVE_DELAY_MS = 800;

export const ImageEditor = () => {
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [activeColor, setActiveColor] = useState("#a855f7");
  const [brushWidth, setBrushWidth] = useState(3);
  const [brushHardness, setBrushHardness] = useState(100);
  const [brushOpacity, setBrushOpacity] = useState(100);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  // Zoom is a fraction everywhere (1 = 100%), matching Fabric's own getZoom()
  const [zoom, setZoom] = useState(1);
  const [showProperties, setShowProperties] = useState(true);
  const [showLayers, setShowLayers] = useState(false);

  // Autosaved session found in IndexedDB, offered on the upload screen
  const [savedProject, setSavedProject] = useState<SavedProject | null>(null);
  // When restoring, the canvas loads this snapshot instead of a fresh image
  const [initialSnapshot, setInitialSnapshot] = useState<CanvasSnapshot | null>(
    null
  );

  const isMobile = useIsMobile();

  const autosaveTimerRef = useRef<number | null>(null);
  const latestSnapshotRef = useRef<CanvasSnapshot | null>(null);
  const autosaveGenerationRef = useRef(0);
  const autosaveFailureShownRef = useRef(false);
  const documentLoadControllerRef = useRef<AbortController | null>(null);

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
    },
    [cancelDocumentLoad]
  );

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
    const snapshot = latestSnapshotRef.current;
    if (!snapshot) return;

    const generation = autosaveGenerationRef.current;
    const project: SavedProject = { snapshot, savedAt: Date.now() };
    // Start in a microtask so a synchronous size-limit failure follows the
    // same error path as an IndexedDB transaction failure.
    void Promise.resolve()
      .then(() => saveProject(project))
      .then(() => {
        if (generation !== autosaveGenerationRef.current) return;
        if (latestSnapshotRef.current === snapshot) {
          latestSnapshotRef.current = null;
        }
        autosaveFailureShownRef.current = false;
        setSavedProject(project);
      })
      .catch((error) => {
        if (
          generation === autosaveGenerationRef.current &&
          !autosaveFailureShownRef.current
        ) {
          autosaveFailureShownRef.current = true;
          console.warn("Autosave failed:", error);
          toast.error("Autosave failed. Save a project file before leaving.");
        }
      });
  }, []);

  const handleSnapshot = useCallback((snapshot: CanvasSnapshot) => {
    latestSnapshotRef.current = snapshot;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      flushAutosave();
    }, AUTOSAVE_DELAY_MS);
  }, [flushAutosave]);

  const handleHistoryError = useCallback((error: unknown) => {
    console.error("Could not update edit history:", error);
    toast.error("Undo/redo failed. The editor attempted a safe rollback.");
  }, []);

  const { undo, redo, canUndo, canRedo } = useUndoRedo(
    fabricCanvas,
    handleSnapshot,
    handleHistoryError
  );

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

  // On mobile the properties panel is a fullscreen overlay — start closed
  useEffect(() => {
    if (isMobile) {
      setShowProperties(false);
    }
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

  const handleCanvasLoadError = useCallback((error: unknown) => {
    console.error("Failed to load canvas document:", error);
    toast.error("The image or project could not be decoded safely");
    cancelDocumentLoad();
    cancelScheduledAutosave();
    setFabricCanvas(null);
    setInitialSnapshot(null);
    setUploadedImage(null);
  }, [cancelDocumentLoad, cancelScheduledAutosave]);

  useKeyboardShortcuts({
    canvas: fabricCanvas,
    undo,
    redo,
    zoom,
    onZoomChange: handleZoomChange,
    onToolChange: handleToolChange,
  });

  const handleImageUpload = useCallback((dataUrl: string) => {
    cancelScheduledAutosave();
    setSavedProject(null);
    void clearProject().catch((error) => {
      console.warn("Could not clear previous autosave:", error);
    });
    setInitialSnapshot(null);
    setUploadedImage(dataUrl);
  }, [cancelScheduledAutosave]);

  const handleRestoreProject = useCallback(() => {
    if (!savedProject) return;
    cancelDocumentLoad();
    cancelScheduledAutosave();
    setInitialSnapshot(savedProject.snapshot);
    setUploadedImage(savedProject.snapshot.srcs[0] ?? "restored-project");
  }, [cancelDocumentLoad, cancelScheduledAutosave, savedProject]);

  const handleSaveProjectFile = useCallback(() => {
    if (!fabricCanvas) return;
    try {
      downloadProjectFile(fabricCanvas);
      toast.success("Project saved to a file");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save this project"
      );
    }
  }, [fabricCanvas]);

  const handleOpenProjectFile = useCallback(async (file: File) => {
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
      setInitialSnapshot(snapshot);
      // uploadedImage just needs to be truthy to show the editor; reuse the
      // project's first image so AI actions still have a source
      setUploadedImage(snapshot.srcs[0] ?? "loaded-project");
      toast.success("Project opened");
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't open that file — is it a project file?"
      );
    }
  }, [beginDocumentLoad, cancelScheduledAutosave]);

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
    setActiveTool("select");
    setZoom(1);
  }, [cancelDocumentLoad, cancelScheduledAutosave]);

  const handleToggleProperties = useCallback(() => {
    setShowProperties((prev) => !prev);
    if (isMobile) setShowLayers(false);
  }, [isMobile]);

  const handleToggleLayers = useCallback(() => {
    setShowLayers((prev) => !prev);
    if (isMobile) setShowProperties(false);
  }, [isMobile]);

  if (isMobile) {
    // ---------- MOBILE LAYOUT ----------
    return (
      <div className="flex flex-col h-screen bg-[hsl(var(--editor-bg))]">
        <TopBar
          fabricCanvas={fabricCanvas}
          uploadedImage={uploadedImage}
          onNewProject={handleNewProject}
          onSaveProject={handleSaveProjectFile}
          zoom={zoom}
          onZoomChange={handleZoomChange}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          isMobile={isMobile}
          onToggleProperties={handleToggleProperties}
          onToggleLayers={handleToggleLayers}
        />

        <div className="flex-1 overflow-hidden p-2">
          {!uploadedImage ? (
            <div className="flex items-center justify-center h-full">
              <ImageUpload
                onImageUpload={handleImageUpload}
                onImageLoadStart={beginDocumentLoad}
                savedProject={savedProject}
                onRestore={handleRestoreProject}
                onOpenProject={handleOpenProjectFile}
              />
            </div>
          ) : (
            <FabricCanvasComponent
              activeTool={activeTool}
              activeColor={activeColor}
              brushWidth={brushWidth}
              brushHardness={brushHardness}
              brushOpacity={brushOpacity}
              uploadedImage={uploadedImage}
              initialSnapshot={initialSnapshot}
              onCanvasReady={setFabricCanvas}
              zoom={zoom}
              onZoomChange={handleZoomChange}
              onToolChange={handleToolChange}
              onLoadError={handleCanvasLoadError}
            />
          )}
        </div>

        {/* Mobile bottom toolbar */}
        <div className="flex-shrink-0">
          <Toolbar
            activeTool={activeTool}
            onToolChange={handleToolChange}
            fabricCanvas={fabricCanvas}
            isMobile={isMobile}
          />
        </div>

        {/* PropertiesPanel as overlay on mobile — toggled */}
        {showProperties && (
          <div className="fixed inset-0 z-50 bg-black/50" onClick={handleToggleProperties}>
            <div
              className="absolute right-0 top-0 h-full w-72"
              onClick={(e) => e.stopPropagation()}
            >
              <PropertiesPanel
                activeColor={activeColor}
                onColorChange={setActiveColor}
                brushWidth={brushWidth}
                onBrushWidthChange={setBrushWidth}
                brushHardness={brushHardness}
                onBrushHardnessChange={setBrushHardness}
                brushOpacity={brushOpacity}
                onBrushOpacityChange={setBrushOpacity}
                fabricCanvas={fabricCanvas}
                isMobile={isMobile}
              />
            </div>
          </div>
        )}

        {/* LayersPanel as a matching overlay on mobile */}
        {showLayers && (
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={handleToggleLayers}
          >
            <div
              className="absolute right-0 top-0 h-full w-72"
              onClick={(e) => e.stopPropagation()}
            >
              <LayersPanel fabricCanvas={fabricCanvas} />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------- DESKTOP LAYOUT ----------
  return (
    <div className="flex flex-col h-screen bg-[hsl(var(--editor-bg))]">
      <TopBar
        fabricCanvas={fabricCanvas}
        uploadedImage={uploadedImage}
        onNewProject={handleNewProject}
        onSaveProject={handleSaveProjectFile}
        zoom={zoom}
        onZoomChange={handleZoomChange}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        isMobile={isMobile}
        onToggleProperties={handleToggleProperties}
        onToggleLayers={handleToggleLayers}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar */}
        <div className="flex-shrink-0">
          <Toolbar
            activeTool={activeTool}
            onToolChange={handleToolChange}
            fabricCanvas={fabricCanvas}
            isMobile={isMobile}
          />
        </div>

        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          {!uploadedImage ? (
            <ImageUpload
              onImageUpload={handleImageUpload}
              onImageLoadStart={beginDocumentLoad}
              savedProject={savedProject}
              onRestore={handleRestoreProject}
              onOpenProject={handleOpenProjectFile}
            />
          ) : (
            <FabricCanvasComponent
              activeTool={activeTool}
              activeColor={activeColor}
              brushWidth={brushWidth}
              brushHardness={brushHardness}
              brushOpacity={brushOpacity}
              uploadedImage={uploadedImage}
              initialSnapshot={initialSnapshot}
              onCanvasReady={setFabricCanvas}
              zoom={zoom}
              onZoomChange={handleZoomChange}
              onToolChange={handleToolChange}
              onLoadError={handleCanvasLoadError}
            />
          )}
        </div>

        {/* Properties Panel */}
        {showProperties && (
          <div className="flex-shrink-0">
            <PropertiesPanel
              activeColor={activeColor}
              onColorChange={setActiveColor}
              brushWidth={brushWidth}
              onBrushWidthChange={setBrushWidth}
              brushHardness={brushHardness}
              onBrushHardnessChange={setBrushHardness}
              brushOpacity={brushOpacity}
              onBrushOpacityChange={setBrushOpacity}
              fabricCanvas={fabricCanvas}
              isMobile={isMobile}
            />
          </div>
        )}

        {/* Layers Panel */}
        {showLayers && (
          <div className="flex-shrink-0">
            <LayersPanel fabricCanvas={fabricCanvas} />
          </div>
        )}
      </div>
    </div>
  );
};
