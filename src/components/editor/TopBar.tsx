import { useState, useCallback } from "react";
import {
  Download,
  Image as ImageIcon,
  RotateCcw,
  RotateCw,
  Scissors,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  PanelRight,
  Layers,
  FilePlus2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { blobToDataURL, removeBackground } from "@/utils/backgroundRemoval";
import { clampZoom, findBackgroundImage, fitToScreen } from "@/utils/viewport";
import { FabricImage, Point } from "fabric";

interface TopBarProps {
  fabricCanvas: any;
  uploadedImage: string | null;
  onNewProject: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isMobile: boolean;
  onToggleProperties: () => void;
  onToggleLayers: () => void;
}

export const TopBar = ({
  fabricCanvas,
  uploadedImage,
  onNewProject,
  zoom,
  onZoomChange,
  undo,
  redo,
  canUndo,
  canRedo,
  isMobile,
  onToggleProperties,
  onToggleLayers,
}: TopBarProps) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleRemoveBackground = useCallback(async () => {
    if (!fabricCanvas || !uploadedImage) {
      toast.error("No image to process!");
      return;
    }

    setIsProcessing(true);
    const loadingToast = toast.loading(
      "Removing background... This may take a minute."
    );

    try {
      const bgImage = findBackgroundImage(fabricCanvas);

      if (!bgImage) {
        throw new Error("Could not find background image");
      }

      // Convert canvas image to blob
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) throw new Error("Could not get canvas context");

      const imgElement = (bgImage as any).getElement();
      tempCanvas.width = imgElement.naturalWidth;
      tempCanvas.height = imgElement.naturalHeight;
      tempCtx.drawImage(imgElement, 0, 0);

      const blob = await new Promise<Blob>((resolve) => {
        tempCanvas.toBlob((b) => resolve(b!), "image/png");
      });

      const resultBlob = await removeBackground(blob);

      // A data URL (not a revocable blob URL) so undo/redo snapshots that
      // reference this src keep working indefinitely
      const resultUrl = await blobToDataURL(resultBlob);

      // Place the result exactly over the old background so annotations
      // keep their position (the model may return a downscaled image)
      const oldRect = bgImage.getBoundingRect();
      const newImg = await FabricImage.fromURL(resultUrl);
      const scale = Math.min(
        oldRect.width / newImg.width!,
        oldRect.height / newImg.height!
      );
      newImg.scale(scale);
      newImg.set({
        left: oldRect.left + oldRect.width / 2 - (newImg.width! * scale) / 2,
        top: oldRect.top + oldRect.height / 2 - (newImg.height! * scale) / 2,
      });
      newImg.selectable = false;

      fabricCanvas.remove(bgImage);
      fabricCanvas.add(newImg);
      fabricCanvas.sendObjectToBack(newImg);
      fabricCanvas.renderAll();

      toast.dismiss(loadingToast);
      toast.success("Background removed successfully!");
    } catch (error) {
      console.error("Background removal error:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to remove background. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [fabricCanvas, uploadedImage]);

  const handleExport = (format: "png" | "jpg") => {
    if (!fabricCanvas) return;

    // Export in scene coordinates regardless of current zoom/pan
    const prevVpt = [...fabricCanvas.viewportTransform];
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // Crop to the background image bounds and upscale back to its
    // native resolution, so the export isn't a screen-sized screenshot
    // with dark margins around it.
    const bgImage = findBackgroundImage(fabricCanvas);

    let crop: Record<string, number> = {};
    if (bgImage) {
      const rect = bgImage.getBoundingRect();
      crop = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        multiplier: bgImage.width / bgImage.getScaledWidth(),
      };
    }

    const dataURL = fabricCanvas.toDataURL({
      format: format === "png" ? "png" : "jpeg",
      quality: 1,
      multiplier: 1,
      ...crop,
    });

    fabricCanvas.setViewportTransform(prevVpt);

    const link = document.createElement("a");
    link.download = `image-editor-export.${format}`;
    link.href = dataURL;
    link.click();

    toast.success(`Exported as ${format.toUpperCase()}!`);
  };

  const handleRotate = () => {
    if (!fabricCanvas) return;

    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject) {
      activeObject.rotate(((activeObject.angle || 0) + 90) % 360);
      activeObject.setCoords();
      fabricCanvas.fire("object:modified", { target: activeObject });
      fabricCanvas.renderAll();
      toast.success("Object rotated!");
    } else {
      // Rotate the whole canvas: every object turns 90° and also orbits a
      // shared pivot, so annotations keep their position on the photo
      const objects = fabricCanvas.getObjects();
      if (objects.length === 0) return;

      const bgImage = findBackgroundImage(fabricCanvas);
      const pivot = bgImage
        ? bgImage.getCenterPoint()
        : new Point(fabricCanvas.width / 2, fabricCanvas.height / 2);

      objects.forEach((obj: any) => {
        const center = obj.getCenterPoint();
        // 90° clockwise around the pivot: (dx, dy) -> (-dy, dx)
        const newCenter = new Point(
          pivot.x - (center.y - pivot.y),
          pivot.y + (center.x - pivot.x)
        );
        obj.rotate(((obj.angle || 0) + 90) % 360);
        obj.setPositionByOrigin(newCenter, "center", "center");
        obj.setCoords();
      });

      fabricCanvas.fire("object:modified");
      onZoomChange(fitToScreen(fabricCanvas));
      toast.success("Canvas rotated!");
    }
  };

  // Zoom is a fraction (1 = 100%), same units as Fabric's getZoom()
  const handleZoomIn = () => {
    onZoomChange(clampZoom(zoom + 0.1));
  };

  const handleZoomOut = () => {
    onZoomChange(clampZoom(zoom - 0.1));
  };

  const handleFitToScreen = () => {
    if (!fabricCanvas) return;
    onZoomChange(fitToScreen(fabricCanvas));
  };

  const hasImage = !!uploadedImage;

  return (
    <div className="h-14 bg-[hsl(var(--editor-panel))] border-b border-border flex items-center justify-between px-3 gap-2">
      {/* Left: Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <ImageIcon className="w-5 h-5 text-primary" />
        {!isMobile && (
          <h1 className="text-base font-bold whitespace-nowrap">
            Image Editor
          </h1>
        )}
      </div>

      {/* Center: Undo/Redo + Zoom (when image loaded) */}
      {hasImage && (
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={undo}
                disabled={!canUndo}
                className="h-9 w-9"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Undo</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={redo}
                disabled={!canRedo}
                className="h-9 w-9"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Redo</p>
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleZoomOut}
                className="h-9 w-9"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Zoom Out</p>
            </TooltipContent>
          </Tooltip>

          <span className="text-xs font-mono text-muted-foreground w-12 text-center tabular-nums select-none">
            {Math.round(zoom * 100)}%
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleZoomIn}
                className="h-9 w-9"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Zoom In</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleFitToScreen}
                className="h-9 w-9"
              >
                <Maximize className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Fit to Screen</p>
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Right: Actions (when image loaded) */}
      {hasImage && (
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={isMobile ? "icon" : "sm"}
                onClick={handleRemoveBackground}
                disabled={isProcessing}
                className={isMobile ? "h-9 w-9" : "h-9"}
              >
                <Scissors className="h-4 w-4" />
                {!isMobile && (
                  <span className="ml-1">
                    {isProcessing ? "Processing..." : "Remove BG"}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Remove Background</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRotate}
                className="h-9 w-9"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Rotate</p>
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={isMobile ? "icon" : "sm"}
                onClick={() => handleExport("png")}
                className={isMobile ? "h-9 w-9" : "h-9"}
              >
                <Download className="h-4 w-4" />
                {!isMobile && <span className="ml-1">PNG</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Export PNG</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size={isMobile ? "icon" : "sm"}
                onClick={() => handleExport("jpg")}
                className={isMobile ? "h-9 w-9" : "h-9"}
              >
                <Download className="h-4 w-4" />
                {!isMobile && <span className="ml-1">JPG</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Export JPG</p>
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleProperties}
                className="h-9 w-9"
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle Properties</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleLayers}
                className="h-9 w-9"
              >
                <Layers className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle Layers</p>
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={isMobile ? "icon" : "sm"}
                onClick={onNewProject}
                className={`${isMobile ? "h-9 w-9" : "h-9"} text-muted-foreground hover:text-destructive`}
              >
                <FilePlus2 className="h-4 w-4" />
                {!isMobile && <span className="ml-1">New</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>New Project</p>
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Spacer when no image */}
      {!hasImage && <div className="flex-1" />}
    </div>
  );
};
