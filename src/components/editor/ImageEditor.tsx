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
  type SavedProject,
} from "@/utils/projectStore";
import { downloadProjectFile, readProjectFile } from "@/utils/projectFile";
import type { CanvasSnapshot } from "@/utils/canvasSnapshot";
import { toast } from "sonner";
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

  const uploadedImageRef = useRef<string | null>(null);
  uploadedImageRef.current = uploadedImage;
  const autosaveTimerRef = useRef<number | null>(null);

  const handleSnapshot = useCallback((snapshot: CanvasSnapshot) => {
    const image = uploadedImageRef.current;
    if (!image) return;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      saveProject({ snapshot, uploadedImage: image, savedAt: Date.now() }).catch(
        (error) => console.warn("Autosave failed:", error)
      );
    }, AUTOSAVE_DELAY_MS);
  }, []);

  const { undo, redo, canUndo, canRedo } = useUndoRedo(
    fabricCanvas,
    handleSnapshot
  );

  // Offer to continue the last session
  useEffect(() => {
    loadProject()
      .then((project) => setSavedProject(project ?? null))
      .catch(() => setSavedProject(null));
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

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

  useKeyboardShortcuts({
    canvas: fabricCanvas,
    undo,
    redo,
    zoom,
    onZoomChange: handleZoomChange,
    onToolChange: handleToolChange,
  });

  const handleImageUpload = useCallback((dataUrl: string) => {
    setInitialSnapshot(null);
    setUploadedImage(dataUrl);
  }, []);

  const handleRestoreProject = useCallback(() => {
    if (!savedProject) return;
    setInitialSnapshot(savedProject.snapshot);
    setUploadedImage(savedProject.uploadedImage);
  }, [savedProject]);

  const handleSaveProjectFile = useCallback(() => {
    if (!fabricCanvas) return;
    downloadProjectFile(fabricCanvas);
    toast.success("Project saved to a file");
  }, [fabricCanvas]);

  const handleOpenProjectFile = useCallback(async (file: File) => {
    try {
      const snapshot = await readProjectFile(file);
      setFabricCanvas(null);
      setInitialSnapshot(snapshot);
      // uploadedImage just needs to be truthy to show the editor; reuse the
      // project's first image so AI actions still have a source
      setUploadedImage(snapshot.srcs[0] ?? "loaded-project");
      toast.success("Project opened");
    } catch {
      toast.error("Couldn't open that file — is it a project file?");
    }
  }, []);

  const handleNewProject = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    clearProject().catch(() => {});
    setSavedProject(null);
    setInitialSnapshot(null);
    setUploadedImage(null);
    setFabricCanvas(null);
    setActiveTool("select");
    setZoom(1);
  }, []);

  const handleToggleProperties = useCallback(() => {
    setShowProperties((prev) => !prev);
  }, []);

  const handleToggleLayers = useCallback(() => {
    setShowLayers((prev) => !prev);
  }, []);

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
