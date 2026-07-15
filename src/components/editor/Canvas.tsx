import { useEffect, useRef, useCallback, useState } from "react";
import {
  Canvas as FabricCanvas,
  Circle,
  Rect,
  PencilBrush,
  IText,
  FabricImage,
  Line,
  Point,
  Shadow,
  Triangle,
  Group,
} from "fabric";
import { EraserBrush } from "@erase2d/fabric";
import {
  Check,
  X,
  Copy,
  Crop as CropIcon,
  SquareDashedBottom,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { clampZoom, fitToScreen } from "@/utils/viewport";
import { flattenRegion } from "@/utils/flatten";
import { parseSnapshot, type CanvasSnapshot } from "@/utils/canvasSnapshot";
import {
  ensureLayerId,
  isBackgroundObject,
  isEditorChrome,
  isObjectLocked,
  markBackgroundObject,
  normalizeEditorObjects,
  type EditorFabricObject,
} from "@/utils/editorObjects";
import type { Tool } from "@/types/editor";
import type { FabricObject } from "fabric";

interface CanvasProps {
  activeTool: Tool;
  activeColor: string;
  brushWidth: number;
  brushHardness: number;
  brushOpacity: number;
  uploadedImage: string | null;
  /** Autosaved state to restore instead of loading uploadedImage fresh */
  initialSnapshot?: CanvasSnapshot | null;
  onCanvasReady: (canvas: FabricCanvas) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onToolChange: (tool: Tool) => void;
  onLoadError: (error: unknown) => void;
}

// A soft brush is faked with a same-color shadow whose blur grows as hardness
// drops (hardness 100 = crisp edge, 0 = very soft).
function brushShadow(color: string, hardness: number, width: number): Shadow | null {
  if (hardness >= 100) return null;
  const blur = ((100 - hardness) / 100) * width;
  return new Shadow({ color, blur, offsetX: 0, offsetY: 0 });
}

const abortError = (): Error => {
  const error = new Error("Canvas operation was cancelled");
  error.name = "AbortError";
  return error;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export const Canvas = ({
  activeTool,
  activeColor,
  brushWidth,
  brushHardness,
  brushOpacity,
  uploadedImage,
  initialSnapshot,
  onCanvasReady,
  zoom,
  onZoomChange,
  onToolChange,
  onLoadError,
}: CanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const prevToolRef = useRef<Tool>(activeTool);
  const generatedImageControllerRef = useRef<AbortController | null>(null);
  const documentRevisionRef = useRef(0);
  const rasterBusyRef = useRef(false);
  const [isRasterizing, setIsRasterizing] = useState(false);
  const cropRectRef = useRef<Rect | null>(null);
  const spaceDownRef = useRef(false);
  // Latest brush opacity, read by the path:created handler set up once at init
  const brushOpacityRef = useRef(brushOpacity);
  brushOpacityRef.current = brushOpacity;
  // Marquee selection: the drawn rect, its animation loop, and whether a
  // committed selection currently exists (drives the floating toolbar)
  const marqueeRef = useRef<Rect | null>(null);
  const marqueeAnimRef = useRef<number | null>(null);
  const [hasMarquee, setHasMarquee] = useState(false);
  // Image layer that was selected when the marquee tool was entered — the
  // target a "Mask" operation clips to (masking needs both a layer and a region)
  const preMarqueeTargetRef = useRef<FabricImage | null>(null);
  const [canMask, setCanMask] = useState(false);

  const loadGeneratedImage = useCallback(async (dataUrl: string) => {
    generatedImageControllerRef.current?.abort();
    const controller = new AbortController();
    generatedImageControllerRef.current = controller;
    try {
      const image = await FabricImage.fromURL(dataUrl, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        image.dispose();
        throw abortError();
      }
      return image;
    } catch (error) {
      if (controller.signal.aborted) throw abortError();
      throw error;
    } finally {
      if (generatedImageControllerRef.current === controller) {
        generatedImageControllerRef.current = null;
      }
    }
  }, []);

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
    let disposed = false;
    let ready = false;
    const loadController = new AbortController();
    const reportLoadError = (error: unknown) => {
      if (!disposed) onLoadError(error);
    };
    const signalReady = () => {
      if (!disposed && !ready) {
        ready = true;
        onCanvasReady(canvas);
      }
    };

    // Assign stable layer identity as objects enter the document. Background
    // and locked layers are protected from the eraser independently of whether
    // they can be selected.
    const markErasable = (e: { target?: unknown }) => {
      const object = e.target as FabricObject | undefined;
      if (!object || isEditorChrome(object)) return;
      ensureLayerId(object);
      (object as EditorFabricObject).erasable =
        !isBackgroundObject(object) && !isObjectLocked(object);
    };
    canvas.on("object:added", markErasable);

    const trackDocumentChange = (e: { target?: unknown }) => {
      const object = e.target as FabricObject | undefined;
      if (!object || !isEditorChrome(object)) documentRevisionRef.current += 1;
    };
    canvas.on("object:added", trackDocumentChange);
    canvas.on("object:removed", trackDocumentChange);
    canvas.on("object:modified", trackDocumentChange);

    // Brush strokes get the current brush opacity (a whole-stroke cap, like
    // Photoshop's Opacity — set on the path so overlaps within a stroke don't
    // compound). Fires only for free-drawing paths.
    const applyStrokeOpacity = (e: { path?: { set: (k: string, v: number) => void } }) => {
      if (e.path && brushOpacityRef.current < 100) {
        e.path.set("opacity", brushOpacityRef.current / 100);
      }
    };
    canvas.on("path:created", applyStrokeOpacity as (...args: unknown[]) => void);

    if (initialSnapshot) {
      // Restore an autosaved session; refit because the window (and canvas)
      // may be a different size than when the project was saved
      canvas
        .loadFromJSON(parseSnapshot(initialSnapshot), undefined, {
          signal: loadController.signal,
        })
        .then(() => {
          if (disposed) return;
          const background = normalizeEditorObjects(canvas);
          if (background) canvas.sendObjectToBack(background);
          onZoomChange(fitToScreen(canvas));
          canvas.renderAll();
          signalReady();
        })
        .catch(reportLoadError);
    } else if (uploadedImage) {
      // Load uploaded image with correct aspect ratio
      FabricImage.fromURL(uploadedImage, { signal: loadController.signal })
        .then((img) => {
          if (disposed) {
            img.dispose();
            return;
          }
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
          markBackgroundObject(img);
          canvas.add(img);
          canvas.sendObjectToBack(img);
          canvas.renderAll();
          signalReady();
        })
        .catch(reportLoadError);
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

    const getTouchPair = (touches: TouchList): [Touch, Touch] | null => {
      const first = touches.item(0);
      const second = touches.item(1);
      return first && second ? [first, second] : null;
    };
    const touchDistance = ([first, second]: [Touch, Touch]) =>
      Math.hypot(
        first.clientX - second.clientX,
        first.clientY - second.clientY
      );
    const touchMidpoint = ([first, second]: [Touch, Touch]) => ({
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    });

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const touches = getTouchPair(e.touches);
      if (!touches) return;
      const mid = touchMidpoint(touches);
      pinch = {
        startDist: touchDistance(touches),
        startZoom: canvas.getZoom(),
        lastMidX: mid.x,
        lastMidY: mid.y,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const touches = getTouchPair(e.touches);
      if (!touches) return;
      const rect = container.getBoundingClientRect();
      const mid = touchMidpoint(touches);
      const newZoom = clampZoom(
        pinch.startZoom * (touchDistance(touches) / pinch.startDist)
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
      disposed = true;
      loadController.abort();
      generatedImageControllerRef.current?.abort();
      generatedImageControllerRef.current = null;
      rasterBusyRef.current = false;
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
      if (fabricCanvasRef.current === canvas) fabricCanvasRef.current = null;
      canvas.dispose();
    };
    // The canvas is intentionally recreated only when its document source changes.
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

    // Marquee mode disables Fabric's own drag-selection (we draw our own rect).
    if (activeTool === "marquee") {
      const active = canvas.getActiveObject();
      const target =
        active &&
        active.type === "image" &&
        !isBackgroundObject(active) &&
        !isObjectLocked(active)
          ? (active as FabricImage)
          : null;
      preMarqueeTargetRef.current = target;
      setCanMask(!!target);
      canvas.selection = false;
      canvas.discardActiveObject();
    } else if (prevTool === "marquee") {
      removeMarquee(canvas);
      canvas.selection = true;
    }

    // Reset drawing mode
    canvas.isDrawingMode = activeTool === "draw" || activeTool === "eraser";

    if (activeTool === "draw") {
      const brush = new PencilBrush(canvas);
      brush.color = activeColor;
      brush.width = brushWidth;
      brush.shadow = brushShadow(activeColor, brushHardness, brushWidth);
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
    // Shape creation is edge-triggered by the selected tool. Color/brush
    // changes are handled by the dedicated effect below and must not add shapes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // ---------- Update brush color/width without creating shapes ----------
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    if (canvas.isDrawingMode && canvas.freeDrawingBrush) {
      if (activeTool === "draw") {
        canvas.freeDrawingBrush.color = activeColor;
        canvas.freeDrawingBrush.shadow = brushShadow(
          activeColor,
          brushHardness,
          brushWidth
        );
      }
      canvas.freeDrawingBrush.width = brushWidth;
    }
  }, [activeColor, brushWidth, brushHardness, activeTool]);

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
  const applyCrop = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect || rasterBusyRef.current) return;

    rasterBusyRef.current = true;
    setIsRasterizing(true);
    const revision = documentRevisionRef.current;

    const region = cropRect.getBoundingRect();
    try {
      // Hide editor chrome during flattening, restoring it even if rendering
      // fails so the user can adjust/retry the crop.
      cropRect.visible = false;
      let flattened: ReturnType<typeof flattenRegion>;
      try {
        flattened = flattenRegion(canvas, region);
      } finally {
        cropRect.visible = true;
        canvas.requestRenderAll();
      }

      const img = await loadGeneratedImage(flattened.dataUrl);
      if (
        fabricCanvasRef.current !== canvas ||
        documentRevisionRef.current !== revision ||
        prevToolRef.current !== "crop"
      ) {
        img.dispose();
        return;
      }

      removeCropOverlay(canvas);
      canvas.discardActiveObject();
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
      markBackgroundObject(img);
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      onZoomChange(1);
      canvas.renderAll();
      onToolChange("select");
      if (flattened.limited) {
        toast.warning(
          `Crop was capped at ${flattened.outputWidth}×${flattened.outputHeight} for browser safety.`
        );
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Crop failed:", error);
        toast.error(error instanceof Error ? error.message : "Crop failed");
      }
    } finally {
      rasterBusyRef.current = false;
      setIsRasterizing(false);
    }
  }, [loadGeneratedImage, onToolChange, onZoomChange]);

  const cancelCrop = useCallback(() => {
    generatedImageControllerRef.current?.abort();
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

  // ---------- Marquee selection ----------
  const removeMarquee = (canvas: FabricCanvas) => {
    if (marqueeAnimRef.current !== null) {
      cancelAnimationFrame(marqueeAnimRef.current);
      marqueeAnimRef.current = null;
    }
    if (marqueeRef.current) {
      canvas.remove(marqueeRef.current);
      marqueeRef.current = null;
    }
    setHasMarquee(false);
  };

  // Animate the dashed stroke so the selection reads as marching ants
  const animateMarchingAnts = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const rect = marqueeRef.current;
    if (!canvas || !rect) return;
    rect.strokeDashOffset = (rect.strokeDashOffset ?? 0) - 0.5;
    canvas.requestRenderAll();
    marqueeAnimRef.current = requestAnimationFrame(animateMarchingAnts);
  }, []);

  // Draw the marquee by dragging (scene coordinates, so it's zoom/pan correct)
  useEffect(() => {
    if (activeTool !== "marquee") return;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    let start: { x: number; y: number } | null = null;

    const onDown = (opt: { e: MouseEvent | TouchEvent }) => {
      if (spaceDownRef.current) return; // panning
      removeMarquee(canvas);
      const p = canvas.getScenePoint(opt.e);
      start = { x: p.x, y: p.y };
      const rect = new Rect({
        left: p.x,
        top: p.y,
        width: 0,
        height: 0,
        fill: "rgba(168, 85, 247, 0.12)",
        stroke: "#ffffff",
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        strokeUniform: true,
        selectable: false,
        evented: false,
        objectCaching: false,
      });
      (rect as unknown as Record<string, unknown>).__isMarquee = true;
      marqueeRef.current = rect;
      canvas.add(rect);
    };

    const onMove = (opt: { e: MouseEvent | TouchEvent }) => {
      if (!start || !marqueeRef.current) return;
      const p = canvas.getScenePoint(opt.e);
      marqueeRef.current.set({
        left: Math.min(start.x, p.x),
        top: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      });
      canvas.requestRenderAll();
    };

    const onUp = () => {
      if (!start) return;
      start = null;
      const rect = marqueeRef.current;
      // Discard accidental clicks / tiny selections
      if (!rect || rect.width < 5 || rect.height < 5) {
        removeMarquee(canvas);
        return;
      }
      setHasMarquee(true);
      if (marqueeAnimRef.current === null) animateMarchingAnts();
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);
    return () => {
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      if (marqueeAnimRef.current !== null) {
        cancelAnimationFrame(marqueeAnimRef.current);
        marqueeAnimRef.current = null;
      }
    };
  }, [activeTool, animateMarchingAnts]);

  const newLayerFromSelection = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    const rect = marqueeRef.current;
    if (!canvas || !rect || rasterBusyRef.current) return;

    rasterBusyRef.current = true;
    setIsRasterizing(true);
    const revision = documentRevisionRef.current;

    const region = rect.getBoundingRect();
    try {
      // Hide the overlay so it does not tint the flattened pixels.
      rect.visible = false;
      let flattened: ReturnType<typeof flattenRegion>;
      try {
        flattened = flattenRegion(canvas, region);
      } finally {
        rect.visible = true;
        canvas.requestRenderAll();
      }

      const img = await loadGeneratedImage(flattened.dataUrl);
      if (
        fabricCanvasRef.current !== canvas ||
        documentRevisionRef.current !== revision ||
        prevToolRef.current !== "marquee"
      ) {
        img.dispose();
        return;
      }
      img.set({ left: region.left, top: region.top });
      img.scaleToWidth(region.width);
      removeMarquee(canvas);
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
      onToolChange("select");
      if (flattened.limited) {
        toast.warning(
          `Selection was capped at ${flattened.outputWidth}×${flattened.outputHeight} for browser safety.`
        );
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Selection copy failed:", error);
        toast.error(
          error instanceof Error ? error.message : "Could not create the layer"
        );
      }
    } finally {
      rasterBusyRef.current = false;
      setIsRasterizing(false);
    }
  }, [loadGeneratedImage, onToolChange]);

  const cropToSelection = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    const rect = marqueeRef.current;
    if (!canvas || !rect || rasterBusyRef.current) return;

    rasterBusyRef.current = true;
    setIsRasterizing(true);
    const revision = documentRevisionRef.current;

    const region = rect.getBoundingRect();
    try {
      rect.visible = false;
      let flattened: ReturnType<typeof flattenRegion>;
      try {
        flattened = flattenRegion(canvas, region);
      } finally {
        rect.visible = true;
        canvas.requestRenderAll();
      }

      const img = await loadGeneratedImage(flattened.dataUrl);
      if (
        fabricCanvasRef.current !== canvas ||
        documentRevisionRef.current !== revision ||
        prevToolRef.current !== "marquee"
      ) {
        img.dispose();
        return;
      }
      removeMarquee(canvas);
      canvas.remove(...canvas.getObjects());
      const scale = Math.min(
        (canvas.width! * 0.85) / img.width!,
        (canvas.height! * 0.85) / img.height!
      );
      img.scale(scale);
      img.set({
        left: canvas.width! / 2 - (img.width! * scale) / 2,
        top: canvas.height! / 2 - (img.height! * scale) / 2,
      });
      markBackgroundObject(img);
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      onZoomChange(1);
      canvas.renderAll();
      onToolChange("select");
      if (flattened.limited) {
        toast.warning(
          `Crop was capped at ${flattened.outputWidth}×${flattened.outputHeight} for browser safety.`
        );
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Selection crop failed:", error);
        toast.error(error instanceof Error ? error.message : "Crop failed");
      }
    } finally {
      rasterBusyRef.current = false;
      setIsRasterizing(false);
    }
  }, [loadGeneratedImage, onToolChange, onZoomChange]);

  // Clip the previously-selected image layer to the selection (a
  // non-destructive mask — the pixels are untouched and it can be released).
  const maskToSelection = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const rect = marqueeRef.current;
    const target = preMarqueeTargetRef.current;
    if (!canvas || !rect || !target || rasterBusyRef.current) return;

    const region = rect.getBoundingRect();
    const clip = new Rect({
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
      absolutePositioned: true,
    });
    target.clipPath = clip;

    removeMarquee(canvas);
    canvas.setActiveObject(target);
    canvas.fire("object:modified", { target });
    canvas.renderAll();
    onToolChange("select");
  }, [onToolChange]);

  const cancelMarquee = useCallback(() => {
    generatedImageControllerRef.current?.abort();
    const canvas = fabricCanvasRef.current;
    if (canvas) {
      removeMarquee(canvas);
      canvas.renderAll();
    }
    onToolChange("select");
  }, [onToolChange]);

  // Escape cancels the marquee
  useEffect(() => {
    if (activeTool !== "marquee") return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelMarquee();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTool, cancelMarquee]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-lg overflow-hidden shadow-2xl border border-border"
    >
      <canvas ref={canvasRef} />

      {isRasterizing && (
        <div
          className="absolute inset-0 z-[5] cursor-wait bg-transparent"
          aria-hidden="true"
        />
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {isRasterizing ? "Rendering image operation" : ""}
      </span>

      {/* Crop confirmation controls */}
      {activeTool === "crop" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-lg bg-[hsl(var(--editor-panel))] border border-border shadow-lg px-2 py-1.5">
          <Button
            size="sm"
            className="h-8"
            onClick={() => void applyCrop()}
            disabled={isRasterizing}
          >
            <Check className="h-4 w-4 mr-1" />
            Apply crop
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={cancelCrop}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
        </div>
      )}

      {/* Marquee selection controls */}
      {activeTool === "marquee" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-lg bg-[hsl(var(--editor-panel))] border border-border shadow-lg px-2 py-1.5">
          {!hasMarquee ? (
            <span className="text-xs text-muted-foreground px-1 py-1.5">
              Drag to select a region
            </span>
          ) : (
            <>
              <Button
                size="sm"
                className="h-8"
                onClick={() => void newLayerFromSelection()}
                disabled={isRasterizing}
              >
                <Copy className="h-4 w-4 mr-1" />
                New layer
              </Button>
              {canMask && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={maskToSelection}
                  disabled={isRasterizing}
                >
                  <SquareDashedBottom className="h-4 w-4 mr-1" />
                  Mask
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => void cropToSelection()}
                disabled={isRasterizing}
              >
                <CropIcon className="h-4 w-4 mr-1" />
                Crop to this
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={cancelMarquee}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
