import { useEffect, useRef, useCallback } from "react";
import {
  Canvas as FabricCanvas,
  Circle,
  Rect,
  PencilBrush,
  IText,
  FabricImage,
  Line,
  Triangle,
  Group,
} from "fabric";
import { EraserBrush } from "@erase2d/fabric";
import type { Tool } from "@/types/editor";

interface CanvasProps {
  activeTool: Tool;
  activeColor: string;
  brushWidth: number;
  uploadedImage: string | null;
  onCanvasReady: (canvas: FabricCanvas) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

export const Canvas = ({
  activeTool,
  activeColor,
  brushWidth,
  uploadedImage,
  onCanvasReady,
  zoom,
  onZoomChange,
}: CanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const prevToolRef = useRef<Tool>(activeTool);
  const cropRectRef = useRef<Rect | null>(null);

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

    // Zoom with Ctrl+scroll wheel
    const handleWheel = (opt: { e: WheelEvent }) => {
      const e = opt.e;
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      let newZoom = canvas.getZoom();
      newZoom *= 0.999 ** delta;
      newZoom = Math.min(Math.max(newZoom, 0.1), 5);
      newZoom = parseFloat(newZoom.toFixed(2));

      const point = canvas.getScenePoint(e);
      canvas.zoomToPoint(point, newZoom);
      onZoomChange(newZoom);
    };

    canvas.on("mouse:wheel", handleWheel as unknown as (...args: unknown[]) => void);

    // ResizeObserver for responsive resizing
    const resizeObserver = new ResizeObserver(() => {
      fitCanvasToContainer();
    });
    resizeObserver.observe(container);

    return () => {
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

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-lg overflow-hidden shadow-2xl border border-border"
    >
      <canvas ref={canvasRef} />
    </div>
  );
};
