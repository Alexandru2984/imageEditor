import { useState, useCallback } from "react";
import { Canvas as FabricCanvas } from "fabric";
import { Canvas as FabricCanvasComponent } from "./Canvas";
import { Toolbar } from "./Toolbar";
import { PropertiesPanel } from "./PropertiesPanel";
import { ImageUpload } from "./ImageUpload";
import { TopBar } from "./TopBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { Tool } from "@/types/editor";

// Re-export Tool so existing consumers (e.g. Toolbar) that import from ./ImageEditor still work
export type { Tool } from "@/types/editor";

export const ImageEditor = () => {
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [activeColor, setActiveColor] = useState("#a855f7");
  const [brushWidth, setBrushWidth] = useState(3);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showProperties, setShowProperties] = useState(true);
  const [showLayers, setShowLayers] = useState(false);

  const isMobile = useIsMobile();
  const { undo, redo, canUndo, canRedo } = useUndoRedo(fabricCanvas);

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

  const handleNewProject = useCallback(() => {
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

  // On desktop, show properties by default; on mobile, hide unless toggled
  const shouldShowProperties = showProperties && !isMobile;

  if (isMobile) {
    // ---------- MOBILE LAYOUT ----------
    return (
      <div className="flex flex-col h-screen bg-[hsl(var(--editor-bg))]">
        {/* TopBar — pass only currently accepted props; extras for future expansion */}
        <TopBar
          fabricCanvas={fabricCanvas}
          uploadedImage={uploadedImage}
        />

        <div className="flex-1 overflow-hidden p-2">
          {!uploadedImage ? (
            <div className="flex items-center justify-center h-full">
              <ImageUpload onImageUpload={setUploadedImage} />
            </div>
          ) : (
            <FabricCanvasComponent
              activeTool={activeTool}
              activeColor={activeColor}
              brushWidth={brushWidth}
              uploadedImage={uploadedImage}
              onCanvasReady={setFabricCanvas}
              zoom={zoom}
              onZoomChange={handleZoomChange}
            />
          )}
        </div>

        {/* Mobile bottom toolbar */}
        <div className="h-14 flex-shrink-0">
          <Toolbar
            activeTool={activeTool}
            onToolClick={handleToolChange}
            fabricCanvas={fabricCanvas}
          />
        </div>

        {/* PropertiesPanel as Sheet overlay on mobile — toggled */}
        {showProperties && (
          <div className="fixed inset-0 z-50 bg-black/50" onClick={handleToggleProperties}>
            <div
              className="absolute right-0 top-0 h-full w-72 bg-[hsl(var(--editor-panel))] border-l border-border overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <PropertiesPanel
                activeColor={activeColor}
                onColorChange={setActiveColor}
                fabricCanvas={fabricCanvas}
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
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar — w-14 */}
        <div className="w-14 flex-shrink-0">
          <Toolbar
            activeTool={activeTool}
            onToolClick={handleToolChange}
            fabricCanvas={fabricCanvas}
          />
        </div>

        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          {!uploadedImage ? (
            <ImageUpload onImageUpload={setUploadedImage} />
          ) : (
            <FabricCanvasComponent
              activeTool={activeTool}
              activeColor={activeColor}
              brushWidth={brushWidth}
              uploadedImage={uploadedImage}
              onCanvasReady={setFabricCanvas}
              zoom={zoom}
              onZoomChange={handleZoomChange}
            />
          )}
        </div>

        {/* Properties Panel */}
        {shouldShowProperties && (
          <div className="w-72 flex-shrink-0">
            <PropertiesPanel
              activeColor={activeColor}
              onColorChange={setActiveColor}
              fabricCanvas={fabricCanvas}
            />
          </div>
        )}

        {/* Layers Panel placeholder */}
        {showLayers && (
          <div className="w-72 flex-shrink-0 bg-[hsl(var(--editor-panel))] border-l border-border p-4 overflow-y-auto">
            <p className="text-sm text-muted-foreground">Layers panel</p>
          </div>
        )}
      </div>
    </div>
  );
};
