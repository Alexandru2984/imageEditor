import { useEffect, useRef, useCallback, useState, type MutableRefObject, type ReactNode } from "react";
import { useWarpTool, type WarpControls } from "@/hooks/useWarpTool";
import type { WarpMode } from "@/raster/warpLayer";
import {
  Canvas as FabricCanvas,
  Rect,
  PencilBrush,
  FabricImage,
  Point,
} from "fabric";
import { EraserBrush } from "@erase2d/fabric";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { clampZoom, fitToScreen, isFitted } from "@/utils/viewport";
import { flattenRegion, nativeMultiplier, planRasterization } from "@/utils/flatten";
import { cropGuides, type Guide } from "@/utils/guideData";
import { guidesOf } from "@/utils/guides";
import { pathsOf } from "@/paths/paths";
import { mapPaths, type DocumentPath } from "@/paths/pathData";
import { styleBrush, type BrushKind } from "@/utils/brushes";
import { CROP_RATIOS, fitRatio, resolveRatio, type CropRatioId } from "@/utils/cropFrame";
import { parseSnapshot, type CanvasSnapshot } from "@/utils/canvasSnapshot";
import { installWorkspaceRenderer } from "@/utils/workspace";
import {
  ensureLayerId,
  isBackgroundObject,
  isEditorChrome,
  isPixelsLocked,
  markBackgroundObject,
  normalizeEditorObjects,
  type EditorFabricObject,
} from "@/utils/editorObjects";
import type { Tool } from "@/types/editor";
import type { FabricObject } from "fabric";
import { useShapeTool } from "@/hooks/useShapeTool";
import { usePaintTool } from "@/hooks/usePaintTool";
import { useRetouchTool } from "@/hooks/useRetouchTool";
import type { RetouchOptions } from "@/raster/retouchSettings";
import { useSelectionTool } from "@/hooks/useSelectionTool";
import { usePenTool } from "@/hooks/usePenTool";
import { installSelectionOverlay } from "@/selection/overlay";
import { OUTSIDE_PHOTO } from "@/selection/actions";
import { gridBoxToScene, selectionOf, type PixelSelection } from "@/selection/state";
import { applyContentAwareMove, applyPatch } from "@/raster/patchTool";
import { useRedEyeTool } from "@/hooks/useRedEyeTool";
import type { SelectionMode } from "@/selection/mask";
import type { WandOptions } from "@/selection/magicWand";
import { SelectionTaskBar } from "./SelectionTaskBar";
import { isSelectionTool } from "./toolGroups";
import type { PaintOptions } from "@/raster/paintSettings";
import type { SymmetryOptions } from "@/raster/brushEngine";
import type { BucketOptions } from "@/raster/fill";
import type { GradientOptions } from "@/raster/gradient";
import { findBackgroundImage } from "@/utils/viewport";

interface CanvasProps {
  activeTool: Tool;
  activeColor: string;
  /** The background colour (gradients end in it). */
  secondaryColor: string;
  brushWidth: number;
  brushHardness: number;
  brushOpacity: number;
  brushKind: BrushKind;
  /** Pixel brush and eraser settings (sizes in image pixels). */
  paint: PaintOptions;
  /** Brush and eraser: paint mirrored or turned copies too. */
  symmetry: SymmetryOptions;
  bucket: BucketOptions;
  gradient: GradientOptions;
  /** How a new selection shape joins the selection. */
  selectionMode: SelectionMode;
  wand: WandOptions;
  retouch: RetouchOptions;
  pickingSource: boolean;
  onPickingSourceChange: (picking: boolean) => void;
  /** Distort or Perspective, while the warp tool is armed. */
  warpMode: WarpMode;
  /** Filled in with what Apply and Cancel do while warping. */
  warpControlsRef: MutableRefObject<WarpControls | null>;
  /** Select › Subject, offered while nothing is selected. */
  onSelectSubject: () => void;
  aiBusy: boolean;
  uploadedImage: string | null;
  /** Autosaved state to restore instead of loading uploadedImage fresh */
  initialSnapshot?: CanvasSnapshot | null;
  onCanvasReady: (canvas: FabricCanvas) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onToolChange: (tool: Tool) => void;
  onLoadError: (error: unknown) => void;
  /** Drawn over the canvas, inside its frame (the rulers). */
  overlay?: ReactNode;
}

// A soft brush is faked with a same-color shadow whose blur grows as hardness
// drops (hardness 100 = crisp edge, 0 = very soft).
const abortError = (): Error => {
  const error = new Error("Canvas operation was cancelled");
  error.name = "AbortError";
  return error;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

/** The scene area inside a crop frame, excluding its dashed stroke. */
const cropFrameRegion = (rect: Rect) => ({
  left: rect.left,
  top: rect.top,
  width: rect.width * rect.scaleX,
  height: rect.height * rect.scaleY,
});

const SIDE_CONTROLS = ["ml", "mr", "mt", "mb"] as const;

/** The eraser's size is in image pixels; its vector brush works in scene units. */
const eraserSceneWidth = (canvas: FabricCanvas, size: number): number => {
  try {
    return Math.max(1, size / nativeMultiplier(canvas));
  } catch {
    return size;
  }
};

export const Canvas = ({
  activeTool,
  activeColor,
  secondaryColor,
  brushWidth,
  brushHardness,
  brushOpacity,
  brushKind,
  paint,
  symmetry,
  bucket,
  gradient,
  selectionMode,
  wand,
  retouch,
  pickingSource,
  onPickingSourceChange,
  warpMode,
  warpControlsRef,
  onSelectSubject,
  aiBusy,
  uploadedImage,
  initialSnapshot,
  onCanvasReady,
  zoom,
  onZoomChange,
  onToolChange,
  onLoadError,
  overlay,
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
  const brushKindRef = useRef(brushKind);
  brushKindRef.current = brushKind;
  const overlayRef = useRef<HTMLCanvasElement>(null);
  /** The live Fabric canvas, for the parts that render from it. */
  const [liveCanvas, setLiveCanvas] = useState<FabricCanvas | null>(null);
  const [cropRatio, setCropRatio] = useState<CropRatioId>("free");
  const [cropSize, setCropSize] = useState<{ width: number; height: number } | null>(null);
  /** Locked width÷height of the crop frame, or null when it is free. */
  const cropRatioRef = useRef<number | null>(null);

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
      // Clicks on image layers test their pixels; allow a little slack.
      targetFindTolerance: 4,
    });

    fabricCanvasRef.current = canvas;
    const uninstallWorkspace = installWorkspaceRenderer(canvas);
    const uninstallOverlay = overlayRef.current
      ? installSelectionOverlay(canvas, overlayRef.current)
      : () => {};
    setLiveCanvas(canvas);
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
        !isBackgroundObject(object) && !isPixelsLocked(object);
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
    const applyStrokeOpacity = (e: { path?: FabricObject }) => {
      if (!e.path) return;
      if (brushOpacityRef.current < 100) {
        e.path.set("opacity", brushOpacityRef.current / 100);
      }
      // Highlighter ink darkens what is under it instead of covering it.
      const brush = canvas.freeDrawingBrush;
      if (
        brushKindRef.current === "highlighter" &&
        brush instanceof PencilBrush &&
        !(brush instanceof EraserBrush)
      ) {
        e.path.set("globalCompositeOperation", "multiply");
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
      uninstallOverlay();
      setLiveCanvas((current) => (current === canvas ? null : current));
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

    // Reset drawing mode
    canvas.isDrawingMode = activeTool === "draw" || activeTool === "eraser";

    if (activeTool === "draw") {
      const brush = new PencilBrush(canvas);
      styleBrush(brush, brushKind, activeColor, brushWidth, brushHardness);
      canvas.freeDrawingBrush = brush;
    } else if (activeTool === "eraser") {
      const eraser = new EraserBrush(canvas);
      eraser.width = eraserSceneWidth(canvas, paint.size);
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
        styleBrush(canvas.freeDrawingBrush, brushKind, activeColor, brushWidth, brushHardness);
      } else {
        canvas.freeDrawingBrush.width = eraserSceneWidth(canvas, paint.size);
      }
    }
  }, [activeColor, brushWidth, brushHardness, brushKind, activeTool, paint.size]);

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
    cropRatioRef.current = null;
    setCropRatio("free");
    updateCropSize();
  };

  const removeCropOverlay = (canvas: FabricCanvas) => {
    const objects = canvas.getObjects();
    for (const obj of objects) {
      if ((obj as unknown as Record<string, unknown>).__isCropOverlay) {
        canvas.remove(obj);
      }
    }
    cropRectRef.current = null;
    cropRatioRef.current = null;
    setCropSize(null);
  };

  /** Show the crop frame's size in output pixels. */
  const updateCropSize = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const rect = cropRectRef.current;
    if (!canvas || !rect) {
      setCropSize(null);
      return;
    }
    try {
      // The same plan the crop will rasterize with, so the label never lies.
      const plan = planRasterization(cropFrameRegion(rect), nativeMultiplier(canvas));
      setCropSize({ width: plan.outputWidth, height: plan.outputHeight });
    } catch {
      setCropSize(null);
    }
  }, []);

  /** Reshape the crop frame to a preset ratio, as large as the photo allows. */
  const chooseCropRatio = useCallback(
    (id: CropRatioId) => {
      const canvas = fabricCanvasRef.current;
      const rect = cropRectRef.current;
      const option = CROP_RATIOS.find((candidate) => candidate.id === id);
      if (!canvas || !rect || !option) return;
      const photo = findBackgroundImage(canvas);
      photo?.setCoords();
      const area = photo ? photo.getBoundingRect() : cropFrameRegion(rect);
      const ratio = resolveRatio(option, area);
      cropRatioRef.current = ratio;
      if (ratio !== null) {
        const frame = fitRatio(area, ratio);
        rect.set({ ...frame, scaleX: 1, scaleY: 1 });
      }
      // A locked ratio scales from the corners only.
      for (const control of SIDE_CONTROLS) rect.setControlVisible(control, ratio === null);
      rect.setCoords();
      canvas.setActiveObject(rect);
      canvas.requestRenderAll();
      setCropRatio(id);
      updateCropSize();
    },
    [updateCropSize]
  );

  // Keep a locked ratio while the frame is scaled, and its size label current.
  useEffect(() => {
    if (activeTool !== "crop") return;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const isFrame = (target: unknown) => !!target && target === cropRectRef.current;
    const handleScaling = ({ target }: { target: FabricObject }) => {
      if (!isFrame(target)) return;
      if (cropRatioRef.current !== null && Math.abs(target.scaleX - target.scaleY) > 1e-9) {
        target.set({ scaleY: target.scaleX });
      }
      updateCropSize();
    };
    const handleChange = ({ target }: { target?: FabricObject }) => {
      if (isFrame(target)) updateCropSize();
    };
    canvas.on("object:scaling", handleScaling);
    canvas.on("object:modified", handleChange);
    return () => {
      canvas.off("object:scaling", handleScaling);
      canvas.off("object:modified", handleChange);
    };
  }, [activeTool, updateCropSize]);

  // ---------- Apply / cancel crop ----------
  const applyCrop = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect || rasterBusyRef.current) return;

    rasterBusyRef.current = true;
    setIsRasterizing(true);
    const revision = documentRevisionRef.current;

    const region = cropFrameRegion(cropRect);
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
      // The guides and paths go with the photo they live on; they are put back on the cropped one.
      const guides = guidesOf(canvas);
      const paths = pathsOf(canvas);
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
      const kept = cropGuides(guides, region, {
        left: img.left!,
        top: img.top!,
        width: img.width! * scale,
        height: img.height! * scale,
      });
      if (kept.length) (img as FabricImage & { guides?: Guide[] }).guides = kept;
      if (paths.length && region.width > 0 && region.height > 0) {
        const k = (img.width! * scale) / region.width;
        const m = (img.height! * scale) / region.height;
        (img as FabricImage & { paths?: DocumentPath[] }).paths = mapPaths(paths, [
          k,
          0,
          0,
          m,
          img.left! - region.left * k,
          img.top! - region.top * m,
        ]);
      }
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

  // ---------- Pixel selection ----------
  /** Run a pixel operation, keeping the canvas from input until it ends. */
  const runRaster = useCallback(async (task: () => Promise<void>) => {
    if (rasterBusyRef.current) return;
    rasterBusyRef.current = true;
    setIsRasterizing(true);
    try {
      await task();
    } finally {
      rasterBusyRef.current = false;
      setIsRasterizing(false);
    }
  }, []);

  /** Image › Crop with a selection: the document becomes its bounding box. */
  const cropToSelection = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || rasterBusyRef.current) return;
    const selection = selectionOf(canvas).current();
    const box = selection?.mask.bounds();
    if (!selection || !box) {
      toast.error(OUTSIDE_PHOTO);
      return;
    }
    const region = gridBoxToScene(selection.grid, box);

    await runRaster(async () => {
      const revision = documentRevisionRef.current;
      try {
        const flattened = flattenRegion(canvas, region);
        const img = await loadGeneratedImage(flattened.dataUrl);
        if (
          fabricCanvasRef.current !== canvas ||
          documentRevisionRef.current !== revision ||
          !isSelectionTool(prevToolRef.current)
        ) {
          img.dispose();
          return;
        }
        selectionOf(canvas).set(null);
        canvas.discardActiveObject();
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
      }
    });
  }, [loadGeneratedImage, onToolChange, onZoomChange, runRaster]);

  const retouchRef = useRef(retouch);
  retouchRef.current = retouch;
  /** Patch and Content-Aware Move act when their selection is dragged. */
  const dropSelection = useCallback(
    (canvas: FabricCanvas, selection: PixelSelection, dx: number, dy: number) => {
      const options = retouchRef.current;
      const done =
        activeTool === "patch"
          ? applyPatch(canvas, selection, dx, dy, options.patchMode)
          : applyContentAwareMove(canvas, selection, dx, dy, options.moveMode === "extend");
      const notice = activeTool === "contentAwareMove" ? toast.loading("Moving…") : undefined;
      void done
        .then((result) => {
          if (notice !== undefined) toast.dismiss(notice);
          if (result !== true) toast.message(result);
        })
        .catch((error: unknown) => {
          if (notice !== undefined) toast.dismiss(notice);
          console.error(`${activeTool} failed:`, error);
          toast.error(activeTool === "patch" ? "The patch could not be applied" : "The move could not be made");
        });
    },
    [activeTool]
  );

  useSelectionTool({
    canvasRef: fabricCanvasRef,
    canvasKey: uploadedImage,
    activeTool,
    mode: selectionMode,
    wand,
    spaceDownRef,
    onDrop: dropSelection,
  });

  useRedEyeTool({
    canvasRef: fabricCanvasRef,
    canvasKey: uploadedImage,
    activeTool,
    settings: { pupilSize: retouch.pupilSize, darken: retouch.darken },
    spaceDownRef,
  });

  usePenTool({ canvasRef: fabricCanvasRef, canvasKey: uploadedImage, activeTool, spaceDownRef });

  usePaintTool({
    canvasRef: fabricCanvasRef,
    canvasKey: uploadedImage,
    activeTool,
    color: activeColor,
    secondaryColor,
    paint,
    bucket,
    gradient,
    symmetry,
    spaceDownRef,
  });

  useRetouchTool({
    canvasRef: fabricCanvasRef,
    canvasKey: uploadedImage,
    activeTool,
    paint,
    retouch,
    pickingSource,
    onPickingSourceChange,
    spaceDownRef,
  });

  useWarpTool({
    canvasRef: fabricCanvasRef,
    canvasKey: uploadedImage,
    activeTool,
    mode: warpMode,
    onToolChange,
    controlsRef: warpControlsRef,
    spaceDownRef,
  });

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
      <canvas
        ref={overlayRef}
        aria-hidden="true"
        data-testid="selection-overlay"
        className="pointer-events-none absolute left-0 top-0"
      />
      {overlay}

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
        <div className="absolute left-1/2 top-3 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col items-stretch gap-1.5 rounded-xl border border-border bg-popover/95 p-1.5 shadow-xl backdrop-blur">
          <div
            role="radiogroup"
            aria-label="Crop shape"
            className="scrollbar-none flex max-w-full gap-1 overflow-x-auto"
          >
            {CROP_RATIOS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={cropRatio === option.id}
                title={option.hint}
                onClick={() => chooseCropRatio(option.id)}
                className={
                  "h-7 shrink-0 rounded-md px-2.5 text-xs font-medium tabular-nums transition-colors " +
                  (cropRatio === option.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground")
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-1.5">
            <span
              className="px-1.5 text-xs tabular-nums text-muted-foreground"
              data-testid="crop-size"
              aria-live="polite"
            >
              {cropSize ? `${cropSize.width} × ${cropSize.height} px` : ""}
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-8" onClick={cancelCrop}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8"
                onClick={() => void applyCrop()}
                disabled={isRasterizing}
              >
                <Check className="h-4 w-4 mr-1" />
                Apply crop
              </Button>
            </div>
          </div>
        </div>
      )}

      {isSelectionTool(activeTool) && (
        <SelectionTaskBar
          canvas={liveCanvas}
          activeTool={activeTool}
          onToolChange={onToolChange}
          runRaster={runRaster}
          busy={isRasterizing}
          onCrop={() => void cropToSelection()}
          onSelectSubject={onSelectSubject}
          aiBusy={aiBusy}
        />
      )}
    </div>
  );
};
