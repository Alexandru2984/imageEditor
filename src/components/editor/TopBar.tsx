import { useState, useCallback } from "react";
import {
  Download,
  Image as ImageIcon,
  RotateCcw,
  RotateCw,
  Scissors,
  Sparkles,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  PanelRight,
  Layers,
  FilePlus2,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { extractSubjectDataURL } from "@/utils/cutout";
import { clampZoom, findBackgroundImage, fitToScreen } from "@/utils/viewport";
import { FabricImage, Point } from "fabric";
import type { Canvas as FabricCanvas, FabricObject, TMat2D } from "fabric";

interface TopBarProps {
  fabricCanvas: FabricCanvas | null;
  uploadedImage: string | null;
  onNewProject: () => void;
  onSaveProject: () => void;
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
  onSaveProject,
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

  // The image AI actions operate on: the selected image layer, else the
  // background photo.
  const getSubjectSource = useCallback((): FabricImage | undefined => {
    if (!fabricCanvas) return undefined;
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === "image") return active as FabricImage;
    return findBackgroundImage(fabricCanvas);
  }, [fabricCanvas]);

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

      const resultUrl = await extractSubjectDataURL(bgImage);

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

  // Non-destructive: cut the subject out onto a new layer, leaving the
  // original photo untouched — the AI-first way to composite.
  const handleExtractToLayer = useCallback(async () => {
    if (!fabricCanvas || !uploadedImage) {
      toast.error("No image to process!");
      return;
    }

    const source = getSubjectSource();
    if (!source) {
      toast.error("No image to extract from!");
      return;
    }

    setIsProcessing(true);
    const loadingToast = toast.loading(
      "Extracting subject... This may take a minute."
    );

    try {
      const resultUrl = await extractSubjectDataURL(source);
      const rect = source.getBoundingRect();
      const cutout = await FabricImage.fromURL(resultUrl);
      const scale = Math.min(
        rect.width / cutout.width!,
        rect.height / cutout.height!
      );
      cutout.scale(scale);
      cutout.set({
        left: rect.left + rect.width / 2 - (cutout.width! * scale) / 2,
        top: rect.top + rect.height / 2 - (cutout.height! * scale) / 2,
        name: "Cutout",
      });

      fabricCanvas.add(cutout);
      fabricCanvas.setActiveObject(cutout);
      fabricCanvas.renderAll();

      toast.dismiss(loadingToast);
      toast.success("Subject extracted to a new layer!");
    } catch (error) {
      console.error("Subject extraction error:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to extract subject. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [fabricCanvas, uploadedImage, getSubjectSource]);

  const handleExport = (format: "png" | "jpg") => {
    if (!fabricCanvas) return;

    // Export in scene coordinates regardless of current zoom/pan
    const prevVpt = [...fabricCanvas.viewportTransform] as TMat2D;
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

      objects.forEach((obj: FabricObject) => {
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
                size={isMobile ? "icon" : "sm"}
                onClick={handleExtractToLayer}
                disabled={isProcessing}
                className={isMobile ? "h-9 w-9" : "h-9"}
              >
                <Sparkles className="h-4 w-4" />
                {!isMobile && <span className="ml-1">Extract</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Extract subject to a new layer (AI)</p>
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onSaveProject}
                className="h-9 w-9"
              >
                <Save className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Save project file (re-editable)</p>
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

          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size={isMobile ? "icon" : "sm"}
                    className={`${isMobile ? "h-9 w-9" : "h-9"} text-muted-foreground hover:text-destructive`}
                  >
                    <FilePlus2 className="h-4 w-4" />
                    {!isMobile && <span className="ml-1">New</span>}
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>New Project</p>
              </TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start a new project?</AlertDialogTitle>
                <AlertDialogDescription>
                  The current image and all edits will be discarded. This
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onNewProject}>
                  Start new
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Spacer when no image */}
      {!hasImage && <div className="flex-1" />}
    </div>
  );
};
