import { useEffect, useRef, useCallback } from "react";
import {
  Canvas as FabricCanvas,
  Circle,
  Rect,
  PencilBrush,
  IText,
  FabricImage,
  Line,
  Point,
  Triangle,
  Group,
} from "fabric";
import type { TMat2D } from "fabric";
import { EraserBrush } from "@erase2d/fabric";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampZoom } from "@/utils/viewport";
import type { Tool } from "@/types/editor";

interface CanvasProps {
  activeTool: Tool;
  activeColor: string;
  brushWidth: number;
  uploadedImage: string | null;
  onCanvasReady: (canvas: FabricCanvas) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onToolChange: (tool: Tool) => void;
}

export const Canvas = ({
  activeTool,
  activeColor,
  brushWidth,
  uploadedImage,
  onCanvasReady,
  zoom,
  onZoomChange,
  onToolChange,
}: CanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const prevToolRef = useRef<Tool>(activeTool);
  const cropRectRef = useRef<Rect | null>(null);
  const spaceDownRef = useRef(false);

  // ---------- Responsive canvas sizing ----------
  const fitCanvasToContainer = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;

    canvas.setDimensions({ width: clientWidth, height: clientHeight });
    canvas.renderAll();
  }, []);

  // ---------- Initialize canvas ----------
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const { clientWidth, clientHeight } = container;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: clientWidth || 800,
      height: clientHeight || 600,
      backgroundColor: "#1a1a1a",
    });

    fabricCanvasRef.current = canvas;
    onCanvasReady(canvas);

    // Annotations can be erased with the eraser tool; the background
    // photo (non-selectable) cannot.
    const markErasable = (e: { target?: unknown }) => {
      const obj = e.target as Record<string, unknown> | undefined;
      if (obj) obj.erasable = obj.selectable !== false;
    };
    canvas.on("object:added", markErasable);

    // Load uploaded image with correct aspect ratio
    if (uploadedImage) {
      FabricImage.fromURL(uploadedImage).then((img) => {
        const canvasW = canvas.width!;
        const canvasH = canvas.height!;
        const imgW = img.width!;
        const imgH = img.height!;

        // Fix: Calculate correct uniform scale to preserve aspect ratio
        const scale = Math.min(
          (canvasW * 0.85) / imgW,
          (canvasH * 0.85) / imgH
        );
        img.scale(scale);

        img.set({
          left: canvasW / 2 - (imgW * scale) / 2,
          top: canvasH / 2 - (imgH * scale) / 2,
        });
        img.selectable = false;
        canvas.add(img);
        canvas.sendObjectToBack(img);
        canvas.renderAll();
      });
    }

    // Ctrl+scroll zooms (anchored under the cursor — zoomToPoint expects
    // viewport coordinates); plain scroll pans the view.
    const handleWheel = (opt: { e: WheelEvent }) => {
      const e = opt.e;
      e.preventDefault();
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        const newZoom = clampZoom(canvas.getZoom() * 0.999 ** e.deltaY);
        canvas.zoomToPoint(canvas.getViewportPoint(e), newZoom);
        onZoomChange(newZoom);
      } else {
        canvas.relativePan(new Point(-e.deltaX, -e.deltaY));
      }
    };

    canvas.on("mouse:wheel", handleWheel as unknown as (...args: unknown[]) => void);

    // ---------- Pan (space+drag, middle mouse) & pinch zoom ----------
    // The mousedown/touchstart listeners run in the capture phase on the
    // container, so a pan/pinch gesture never reaches Fabric and can't
    // start a brush stroke or a selection.
    let isPanning = false;
    let lastX = 0;
    let lastY = 0;
    let pinch: {
      startDist: number;
      startZoom: number;
      lastMidX: number;
      lastMidY: number;
    } | null = null;

    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || spaceDownRef.current) return;
      if (isTypingTarget(e.target)) return;
      const active = canvas.getActiveObject();
      if (active && "isEditing" in active && (active as { isEditing?: boolean }).isEditing) {
        return;
      }
      e.preventDefault();
      spaceDownRef.current = true;
      canvas.defaultCursor = "grab";
      canvas.setCursor("grab");
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDownRef.current = false;
      canvas.defaultCursor = "default";
      if (!isPanning) canvas.setCursor("default");
    };

    const handleContainerMouseDown = (e: MouseEvent) => {
      if (!spaceDownRef.current && e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      isPanning = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setCursor("grabbing");
    };

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      canvas.relativePan(new Point(e.clientX - lastX, e.clientY - lastY));
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const handleWindowMouseUp = () => {
      if (!isPanning) return;
      isPanning = false;
      canvas.setCursor(spaceDownRef.current ? "grab" : "default");
    };

    const touchDistance = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const touchMidpoint = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const mid = touchMidpoint(e.touches);
      pinch = {
        startDist: touchDistance(e.touches),
        startZoom: canvas.getZoom(),
        lastMidX: mid.x,
        lastMidY: mid.y,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = container.getBoundingClientRect();
      const mid = touchMidpoint(e.touches);
      const newZoom = clampZoom(
        pinch.startZoom * (touchDistance(e.touches) / pinch.startDist)
      );
      canvas.zoomToPoint(
        new Point(mid.x - rect.left, mid.y - rect.top),
        newZoom
      );
      canvas.relativePan(
        new Point(mid.x - pinch.lastMidX, mid.y - pinch.lastMidY)
      );
      pinch.lastMidX = mid.x;
      pinch.lastMidY = mid.y;
      onZoomChange(newZoom);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) pinch = null;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    container.addEventListener("mousedown", handleContainerMouseDown, {
      capture: true,
    });
    container.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: false,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd, { capture: true });

    // ResizeObserver for responsive resizing
    const resizeObserver = new ResizeObserver(() => {
      fitCanvasToContainer();
    });
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      container.removeEventListener("mousedown", handleContainerMouseDown, {
        capture: true,
      });
      container.removeEventListener("touchstart", handleTouchStart, {
        capture: true,
      });
      container.removeEventListener("touchmove", handleTouchMove, {
        capture: true,
      });
      container.removeEventListener("touchend", handleTouchEnd, {
        capture: true,
      });
      resizeObserver.disconnect();
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedImage]);

  // ---------- Apply zoom from parent ----------
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const currentZoom = canvas.getZoom();
    if (Math.abs(currentZoom - zoom) > 0.01) {
      const center = canvas.getCenterPoint();
      canvas.zoomToPoint(center, zoom);
      canvas.renderAll();
    }
  }, [zoom]);

  // ---------- Tool changes ----------
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const prevTool = prevToolRef.current;
    prevToolRef.current = activeTool;

    // Clean up crop overlay when switching away from crop
    if (prevTool === "crop" && activeTool !== "crop") {
      removeCropOverlay(canvas);
    }

    // Reset drawing mode
    canvas.isDrawingMode = activeTool === "draw" || activeTool === "eraser";

    if (activeTool === "draw") {
      const brush = new PencilBrush(canvas);
      brush.color = activeColor;
      brush.width = brushWidth;
      canvas.freeDrawingBrush = brush;
    } else if (activeTool === "eraser") {
      const eraser = new EraserBrush(canvas);
      eraser.width = brushWidth;
      eraser.on("end", async (e) => {
        e.preventDefault();
        await eraser.commit(e.detail);
        // Let listeners (undo history) know the document changed
        canvas.fire("object:modified");
        canvas.requestRenderAll();
      });
      canvas.freeDrawingBrush = eraser;
    }

    // Only create shapes when tool changes TO a shape tool (not on color changes)
    const shapeTools: Tool[] = ["rectangle", "circle", "text", "line", "arrow"];
    const isNewShapeTool = shapeTools.includes(activeTool) && prevTool !== activeTool;

    if (isNewShapeTool) {
      const centerX = (canvas.width || 800) / 2;
      const centerY = (canvas.height || 600) / 2;

      if (activeTool === "rectangle") {
        const rect = new Rect({
          left: centerX - 75,
          top: centerY - 50,
          fill: activeColor,
          width: 150,
          height: 100,
          stroke: activeColor,
          strokeWidth: 2,
        });
        canvas.add(rect);
        canvas.setActiveObject(rect);
      } else if (activeTool === "circle") {
        const circle = new Circle({
          left: centerX - 75,
          top: centerY - 75,
          fill: activeColor,
          radius: 75,
          stroke: activeColor,
          strokeWidth: 2,
        });
        canvas.add(circle);
        canvas.setActiveObject(circle);
      } else if (activeTool === "text") {
        const text = new IText("Double click to edit", {
          left: centerX - 100,
          top: centerY - 16,
          fill: activeColor,
          fontSize: 32,
          fontFamily: "Arial",
        });
        canvas.add(text);
        canvas.setActiveObject(text);
      } else if (activeTool === "line") {
        const line = new Line(
          [centerX - 75, centerY, centerX + 75, centerY],
          {
            stroke: activeColor,
            strokeWidth: brushWidth,
          }
        );
        canvas.add(line);
        canvas.setActiveObject(line);
      } else if (activeTool === "arrow") {
        const lineLength = 150;
        const arrowLine = new Line(
          [centerX - lineLength / 2, centerY, centerX + lineLength / 2 - 15, centerY],
          {
            stroke: activeColor,
            strokeWidth: brushWidth,
          }
        );
        const arrowHead = new Triangle({
          left: centerX + lineLength / 2,
          top: centerY,
          fill: activeColor,
          width: 20,
          height: 20,
          angle: 90,
          originX: "center",
          originY: "center",
        });
        const arrowGroup = new Group([arrowLine, arrowHead], {
          left: centerX - lineLength / 2,
          top: centerY - 10,
        });
        canvas.add(arrowGroup);
        canvas.setActiveObject(arrowGroup);
      }
    }

    // Crop tool overlay
    if (activeTool === "crop" && prevTool !== "crop") {
      addCropOverlay(canvas);
    }

    canvas.renderAll();
  }, [activeTool]); // Only depend on activeTool — use refs for color/brushWidth

  // ---------- Update brush color/width without creating shapes ----------
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    if (canvas.isDrawingMode && canvas.freeDrawingBrush) {
      if (activeTool === "draw") {
        canvas.freeDrawingBrush.color = activeColor;
      }
      canvas.freeDrawingBrush.width = brushWidth;
    }
  }, [activeColor, brushWidth, activeTool]);

  // ---------- Crop helpers ----------
  const addCropOverlay = (canvas: FabricCanvas) => {
    removeCropOverlay(canvas);

    const canvasW = canvas.width || 800;
    const canvasH = canvas.height || 600;
    const cropW = canvasW * 0.6;
    const cropH = canvasH * 0.6;

    const cropRect = new Rect({
      left: (canvasW - cropW) / 2,
      top: (canvasH - cropH) / 2,
      width: cropW,
      height: cropH,
      fill: "rgba(255, 255, 255, 0.05)",
      stroke: "#a855f7",
      strokeWidth: 2,
      strokeDashArray: [8, 4],
      cornerColor: "#a855f7",
      cornerSize: 10,
      transparentCorners: false,
      hasRotatingPoint: false,
      lockRotation: true,
    });
    (cropRect as unknown as Record<string, unknown>).__isCropOverlay = true;

    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);
    cropRectRef.current = cropRect;
  };

  const removeCropOverlay = (canvas: FabricCanvas) => {
    const objects = canvas.getObjects();
    for (const obj of objects) {
      if ((obj as unknown as Record<string, unknown>).__isCropOverlay) {
        canvas.remove(obj);
      }
    }
    cropRectRef.current = null;
  };

  // ---------- Apply / cancel crop ----------
  const applyCrop = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect) return;

    const region = cropRect.getBoundingRect();
    removeCropOverlay(canvas);
    canvas.discardActiveObject();

    // Render the selected region in scene coordinates at the background
    // image's native resolution, then flatten it into a new background.
    const prevVpt = [...canvas.viewportTransform] as TMat2D;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const bgImage = canvas
      .getObjects()
      .find((obj) => !obj.selectable && obj.type === "image");
    const multiplier = bgImage
      ? bgImage.width / bgImage.getScaledWidth()
      : 1;

    const dataURL = canvas.toDataURL({
      format: "png",
      quality: 1,
      multiplier,
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
    });
    canvas.setViewportTransform(prevVpt);

    FabricImage.fromURL(dataURL).then((img) => {
      canvas.remove(...canvas.getObjects());

      const canvasW = canvas.width!;
      const canvasH = canvas.height!;
      const scale = Math.min(
        (canvasW * 0.85) / img.width!,
        (canvasH * 0.85) / img.height!
      );
      img.scale(scale);
      img.set({
        left: canvasW / 2 - (img.width! * scale) / 2,
        top: canvasH / 2 - (img.height! * scale) / 2,
      });
      img.selectable = false;
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      onZoomChange(1);
      canvas.renderAll();
    });

    onToolChange("select");
  }, [onToolChange, onZoomChange]);

  const cancelCrop = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (canvas) {
      removeCropOverlay(canvas);
      canvas.renderAll();
    }
    onToolChange("select");
  }, [onToolChange]);

  // Enter applies / Escape cancels while cropping
  useEffect(() => {
    if (activeTool !== "crop") return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyCrop();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelCrop();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTool, applyCrop, cancelCrop]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-lg overflow-hidden shadow-2xl border border-border"
    >
      <canvas ref={canvasRef} />

      {/* Crop confirmation controls */}
      {activeTool === "crop" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-lg bg-[hsl(var(--editor-panel))] border border-border shadow-lg px-2 py-1.5">
          <Button size="sm" className="h-8" onClick={applyCrop}>
            <Check className="h-4 w-4 mr-1" />
            Apply crop
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={cancelCrop}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
};
