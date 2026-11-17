import { useEffect, useRef, useCallback, useState } from "react";
import {
  Canvas as FabricCanvas,
  Rect,
  PencilBrush,
  FabricImage,
  Point,
  Shadow,
  filters,
} from "fabric";
import { EraserBrush } from "@erase2d/fabric";
import {
  Check,
  X,
  Copy,
  Crop as CropIcon,
  SquareDashedBottom,
  EyeOff,
  Grid3x3,
  Droplets,
  Square as SquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { clampZoom, fitToScreen, isFitted } from "@/utils/viewport";
import { flattenRegion } from "@/utils/flatten";
import { parseSnapshot, type CanvasSnapshot } from "@/utils/canvasSnapshot";
import { installWorkspaceRenderer } from "@/utils/workspace";
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
import { useShapeTool } from "@/hooks/useShapeTool";
import { findBackgroundImage } from "@/utils/viewport";

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

/**
 * The scene-space area a marquee covers. Read straight from its geometry:
 * the bounding box would include the dashed stroke and depends on cached
 * corner coordinates that Fabric only refreshes on setCoords().
 */
function marqueeRegion(canvas: FabricCanvas, rect: Rect) {
  let left = rect.left;
  let top = rect.top;
  let right = left + rect.width;
  let bottom = top + rect.height;
  // Pixels outside the photo are never exported, so neither copy nor crop
  // should reach past its edges.
  const photo = findBackgroundImage(canvas);
  if (photo) {
    photo.setCoords();
    const bounds = photo.getBoundingRect();
    left = Math.max(left, bounds.left);
    top = Math.max(top, bounds.top);
    right = Math.min(right, bounds.left + bounds.width);
    bottom = Math.min(bottom, bounds.top + bounds.height);
  }
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, width: right - left, height: bottom - top };
}

const OUTSIDE_PHOTO = "The selection is outside the photo";

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
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
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
    const previousWidth = canvas.width;
    const previousHeight = canvas.height;
    if (previousWidth === clientWidth && previousHeight === clientHeight) return;

    // A fitted view stays fitted (rotating a phone, opening the bottom
    // sheet); otherwise keep whatever was at the centre of the view there.
    const wasFitted = isFitted(canvas);
    canvas.setDimensions({ width: clientWidth, height: clientHeight });
    if (wasFitted) {
      onZoomChangeRef.current(fitToScreen(canvas));
    } else {
      const vpt = [...canvas.viewportTransform] as typeof canvas.viewportTransform;
      vpt[4] += (clientWidth - previousWidth) / 2;
      vpt[5] += (clientHeight - previousHeight) / 2;
      canvas.setViewportTransform(vpt);
    }
    canvas.requestRenderAll();
  }, []);

  // ---------- Initialize canvas ----------
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const { clientWidth, clientHeight } = container;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: clientWidth || 800,
      height: clientHeight || 600,
      // Transparent on purpose: the workspace colour is CSS and the
      // transparency checkerboard is drawn on screen only (see workspace.ts).
      backgroundColor: "",
    });

    fabricCanvasRef.current = canvas;
    const uninstallWorkspace = installWorkspaceRenderer(canvas);
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
      uninstallWorkspace();
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
      eraser.on("end", (e) => {
        e.preventDefault();
        void eraser
          .commit(e.detail)
          .then(() => {
            if (
              fabricCanvasRef.current !== canvas ||
              canvas.disposed ||
              canvas.destroyed
            ) {
              return;
            }
            // Let listeners (undo history) know the document changed.
            canvas.fire("object:modified");
            canvas.requestRenderAll();
          })
          .catch((error) => {
            if (fabricCanvasRef.current !== canvas) return;
            console.error("Eraser commit failed:", error);
            toast.error("The eraser could not finish that stroke safely");
          });
      });
      canvas.freeDrawingBrush = eraser;
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

    // Frame the photo itself (scene coordinates), falling back to the visible
    // area. Viewport pixels would misplace the frame after zoom or pan.
    const background = findBackgroundImage(canvas);
    const zoom = canvas.getZoom() || 1;
    const vpt = canvas.viewportTransform;
    const area = background
      ? background.getBoundingRect()
      : {
          left: -vpt[4] / zoom,
          top: -vpt[5] / zoom,
          width: canvas.width / zoom,
          height: canvas.height / zoom,
        };
    const inset = 0.1;
    const cropRect = new Rect({
      left: area.left + area.width * inset,
      top: area.top + area.height * inset,
      width: area.width * (1 - inset * 2),
      height: area.height * (1 - inset * 2),
      fill: "rgba(255, 255, 255, 0.05)",
      stroke: "#a855f7",
      strokeWidth: 2,
      strokeUniform: true,
      strokeDashArray: [8, 4],
      cornerColor: "#a855f7",
      cornerSize: 12,
      touchCornerSize: 28,
      transparentCorners: false,
      lockRotation: true,
    });
    cropRect.setControlVisible("mtr", false);
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
      // Keep cached corners in sync for anything that hit-tests the marquee.
      marqueeRef.current.setCoords();
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

  const newLayerFromSelection = useCallback(async (effect?: "pixelate" | "blur") => {
    const canvas = fabricCanvasRef.current;
    const rect = marqueeRef.current;
    if (!canvas || !rect || rasterBusyRef.current) return;
    const region = marqueeRegion(canvas, rect);
    if (!region) {
      toast.error(OUTSIDE_PHOTO);
      return;
    }

    rasterBusyRef.current = true;
    setIsRasterizing(true);
    const revision = documentRevisionRef.current;

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
      if (effect) {
        // A redaction is a copy of the region with the effect baked into its
        // filter stack, stacked over the original pixels.
        const side = Math.max(img.width, img.height);
        img.filters = [
          effect === "pixelate"
            ? new filters.Pixelate({ blocksize: Math.min(64, Math.max(8, Math.round(side / 14))) })
            : new filters.Blur({ blur: 0.6 }),
        ];
        img.applyFilters();
        (img as EditorFabricObject).name = effect === "pixelate" ? "Pixelated" : "Blurred";
      }
      removeMarquee(canvas);
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
      onToolChange("select");
      if (effect) {
        toast.success("Region redacted on a new layer", {
          description: "Exports are flattened. Project files still contain the original photo.",
        });
      }
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

  const blackOutSelection = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const rect = marqueeRef.current;
    if (!canvas || !rect) return;
    const region = marqueeRegion(canvas, rect);
    if (!region) {
      toast.error(OUTSIDE_PHOTO);
      return;
    }
    const box = new Rect({
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
      fill: "#000000",
      strokeWidth: 0,
    });
    (box as EditorFabricObject).name = "Redaction";
    removeMarquee(canvas);
    canvas.add(box);
    canvas.setActiveObject(box);
    canvas.requestRenderAll();
    onToolChange("select");
  }, [onToolChange]);

  const cropToSelection = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    const rect = marqueeRef.current;
    if (!canvas || !rect || rasterBusyRef.current) return;
    const region = marqueeRegion(canvas, rect);
    if (!region) {
      toast.error(OUTSIDE_PHOTO);
      return;
    }

    rasterBusyRef.current = true;
    setIsRasterizing(true);
    const revision = documentRevisionRef.current;

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

    const region = marqueeRegion(canvas, rect);
    if (!region) {
      toast.error(OUTSIDE_PHOTO);
      return;
    }
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

  useShapeTool({
    canvasRef: fabricCanvasRef,
    canvasKey: uploadedImage,
    activeTool,
    color: activeColor,
    strokeWidth: brushWidth,
    spaceDownRef,
    onToolChange,
  });

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden bg-editor-canvas"
    >
      <canvas ref={canvasRef} role="img" aria-label="Image editing canvas" />

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
        <div className="absolute left-1/2 top-3 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-border bg-popover/95 px-2 py-1.5 shadow-xl backdrop-blur">
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
        <div className="absolute left-1/2 top-3 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-border bg-popover/95 px-2 py-1.5 shadow-xl backdrop-blur">
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8" disabled={isRasterizing}>
                    <EyeOff className="h-4 w-4 mr-1" />
                    Redact
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuLabel>Hide what is inside</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => void newLayerFromSelection("pixelate")}>
                    <Grid3x3 /> Pixelate
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void newLayerFromSelection("blur")}>
                    <Droplets /> Blur
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={blackOutSelection}>
                    <SquareIcon /> Black out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
