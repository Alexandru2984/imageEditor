import { useEffect, useRef, type MutableRefObject } from "react";
import { util, type Canvas as FabricCanvas, type FabricImage, type FabricObject, type TMat2D, type TPointerEventInfo } from "fabric";
import { toast } from "sonner";
import {
  beginPixelEdit,
  commitPixelEdit,
  createPendingLayer,
  discardPendingLayer,
  isPaintableLayer,
  isPendingLayer,
  layerPixelsPerSceneUnit,
  refreshPixelLayer,
  sceneToLayerPixel,
} from "@/raster/pixelLayer";
import { StrokePainter } from "@/raster/painter";
import { symmetryAxes, symmetryTransforms, type SymmetryOptions } from "@/raster/brushEngine";
import { brushTip } from "@/utils/brushPresets";
import { bucketFill, bucketFillPixels, sceneToLayerMatrix, type BucketOptions } from "@/raster/fill";
import { currentMaskPixels, editedMaskLayer, maskTargetOf, type MaskableLayer } from "@/raster/layerMask";
import { isDocumentLayer } from "@/adjustments/documentLayer";
import { onSelectedGroupChange } from "@/layers/layerGroups";
import { greyOf } from "@/raster/maskPixels";
import { constrainAngle, drawGradient, type GradientOptions } from "@/raster/gradient";
import type { PaintOptions } from "@/raster/paintSettings";
import type { StrokePoint } from "@/raster/stroke";
import { ensureLayerId, type EditorFabricObject, isObjectLocked, isTransparencyLocked } from "@/utils/editorObjects";
import { nativeMultiplier } from "@/utils/flatten";
import { releaseCanvas, restrictToClip, selectionClip, snapshotSurface } from "@/selection/clip";
import { documentGrid, sceneToGrid, selectionOf } from "@/selection/state";
import { commitQuickMask, isQuickMaskPixels, quickMaskPixels } from "@/selection/quickMask";
import { toolStepName } from "@/utils/historySteps";
import type { Tool } from "@/types/editor";
import { pressureOf, strokeBrushOutline } from "./brushPointer";

interface UsePaintToolOptions {
  canvasRef: MutableRefObject<FabricCanvas | null>;
  /** Changes whenever a new Fabric canvas instance is created. */
  canvasKey: unknown;
  activeTool: Tool;
  color: string;
  /** The background colour, where a gradient ends. */
  secondaryColor: string;
  paint: PaintOptions;
  bucket: BucketOptions;
  gradient: GradientOptions;
  /** Brush and eraser: paint mirrored or turned copies of each stroke too. */
  symmetry: SymmetryOptions;
  spaceDownRef: MutableRefObject<boolean>;
}

type PointerInfo = TPointerEventInfo<MouseEvent | TouchEvent | PointerEvent>;

interface ActiveStroke {
  layer: FabricImage;
  painter: StrokePainter;
  /** The stroke created the layer; cancelling it removes the layer again. */
  createdLayer: boolean;
  frame: number | null;
}

const findLayer = (canvas: FabricCanvas, id: string | null): FabricObject | undefined =>
  id === null
    ? undefined
    : canvas.getObjects().find((object) => (object as EditorFabricObject).__layerId === id);

const PIXEL_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["brush", "eraser", "bucket", "gradient"]);

/** Below this many screen pixels a gradient drag is taken for a stray click. */
const MIN_GRADIENT_DRAG = 3;

/**
 * Pixel painting for the Brush and the Paint bucket, and for the Eraser when
 * the layer being worked on is a pixel layer. Tools act on the selected
 * layer; with none selected they continue on the last painted layer, and the
 * Brush and bucket otherwise start a new layer, as Photoshop paints on the
 * active layer.
 */
export function usePaintTool({
  canvasRef,
  canvasKey,
  activeTool,
  color,
  secondaryColor,
  paint,
  bucket,
  gradient,
  symmetry,
  spaceDownRef,
}: UsePaintToolOptions): void {
  const settingsRef = useRef({ color, secondaryColor, paint, bucket, gradient, symmetry });
  settingsRef.current = { color, secondaryColor, paint, bucket, gradient, symmetry };
  /** Redraws the brush outline and the symmetry axes, while a painting tool is on. */
  const redrawRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    redrawRef.current?.();
  }, [symmetry.mode, symmetry.segments, paint.dynamics.angle, paint.dynamics.roundness]);
  /** The layer the tools paint on, kept across tool switches. */
  const targetIdRef = useRef<string | null>(null);
  // A layer from a previous document never carries over.
  useEffect(() => {
    targetIdRef.current = null;
  }, [canvasKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!PIXEL_TOOLS.has(activeTool)) return;
    const erasing = activeTool === "eraser";
    const filling = activeTool === "bucket";
    const blending = activeTool === "gradient";

    // A layer's mask is painted instead of its pixels once picked (Layers
    // panel or Ctrl+\); any image layer has one to paint, even the photo. An
    // adjustment layer has only its mask.
    const maskTarget = maskTargetOf(canvas);
    const currentTarget = (): MaskableLayer | null => {
      // Picking another layer drops the mask target, so it is either the
      // selected layer or nothing is selected.
      const masked = editedMaskLayer(canvas);
      if (masked) return masked;
      const layer = findLayer(canvas, targetIdRef.current);
      return isPaintableLayer(layer) ? layer : null;
    };
    const adopt = (object: FabricObject | undefined) => {
      targetIdRef.current =
        object && (isPaintableLayer(object) || maskTarget.isTarget(object)) ? ensureLayerId(object) : null;
    };

    // The selected layer becomes the one to paint on.
    adopt(canvas.getActiveObject() ?? findLayer(canvas, targetIdRef.current));

    const previous = {
      selection: canvas.selection,
      skipTargetFind: canvas.skipTargetFind,
      defaultCursor: canvas.defaultCursor,
      drawControls: Object.prototype.hasOwnProperty.call(canvas, "drawControls"),
    };
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.defaultCursor = "crosshair";
    // The painted layer stays selected (the Layers panel shows it) but its
    // handles would only be in the way of the brush.
    (canvas as unknown as { drawControls: () => void }).drawControls = () => {};

    // The eraser removes drawings with its vector brush unless a pixel layer
    // is being worked on.
    const syncEraserMode = () => {
      if (erasing) canvas.isDrawingMode = !selectionOf(canvas).quickMask && currentTarget() === null;
    };
    const selectTarget = () => {
      const target = currentTarget();
      // An adjustment layer stays picked in the Layers panel only.
      if (target && !isDocumentLayer(target) && canvas.getActiveObject() !== target) canvas.setActiveObject(target);
      syncEraserMode();
      canvas.requestRenderAll();
    };
    selectTarget();
    // Picking the mask (or the pixels again) changes what the tools paint.
    const unsubscribeMask = maskTarget.subscribe(() => {
      if (stroke) return;
      adopt(canvas.getActiveObject() ?? findLayer(canvas, targetIdRef.current));
      syncEraserMode();
    });
    const unsubscribePicks = onSelectedGroupChange(canvas, () => {
      if (!stroke) syncEraserMode();
    });
    // Entering or leaving Quick Mask changes what the eraser does.
    const unsubscribeQuickMask = selectionOf(canvas).subscribe(() => {
      if (!stroke) syncEraserMode();
    });

    let stroke: ActiveStroke | null = null;
    /** Set once the tool is put down; late encodes must not touch the canvas mode. */
    let released = false;
    /** Where the last stroke on each layer ended, for Shift-click lines. */
    const lastPoints = new WeakMap<FabricImage, StrokePoint>();
    let outline: { x: number; y: number } | null = null;

    /** The lines symmetry painting turns about, through the document's middle. */
    const drawAxes = () => {
      const axes = symmetryAxes(settingsRef.current.symmetry);
      const grid = documentGrid(canvas);
      if (!axes.length || !grid) return;
      const top = canvas.contextTop;
      const ratio = canvas.getRetinaScaling();
      const [a, b, c, d, e, f] = canvas.viewportTransform;
      const width = grid.width / grid.scale;
      const height = grid.height / grid.scale;
      const cx = grid.left + width / 2;
      const cy = grid.top + height / 2;
      const reach = Math.hypot(width, height) / 2;
      const screen = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f] as const;
      top.save();
      top.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Kept to the document.
      const corner = screen(grid.left, grid.top);
      const far = screen(grid.left + width, grid.top + height);
      top.beginPath();
      top.rect(corner[0], corner[1], far[0] - corner[0], far[1] - corner[1]);
      top.clip();
      top.setLineDash([6, 4]);
      top.lineWidth = 1.5;
      top.strokeStyle = "rgba(168, 85, 247, 0.85)";
      top.beginPath();
      for (const angle of axes) {
        const from = screen(cx, cy);
        const to = screen(cx + Math.sin(angle) * reach, cy - Math.cos(angle) * reach);
        top.moveTo(from[0], from[1]);
        top.lineTo(to[0], to[1]);
      }
      top.stroke();
      top.restore();
    };

    const drawOutline = () => {
      // The vector eraser draws its own trail on the same layer.
      if (canvas.isDrawingMode || filling || blending) return;
      // Fabric takes the top layer away while it renders an export.
      const top = canvas.contextTop as CanvasRenderingContext2D | undefined;
      if (!top) return;
      canvas.clearContext(top);
      drawAxes();
      if (!outline) return;
      const multiplier = nativeMultiplier(canvas);
      const { size, dynamics } = settingsRef.current.paint;
      const radius = (size / 2 / multiplier) * canvas.getZoom();
      strokeBrushOutline(canvas, outline.x, outline.y, radius, dynamics.roundness / 100, dynamics.angle);
    };
    redrawRef.current = drawOutline;

    const render = () => {
      if (!stroke) return;
      stroke.frame = null;
      const painted = stroke.painter.flush();
      if (painted) refreshPixelLayer(stroke.layer, canvas, painted);
    };
    const scheduleRender = () => {
      if (stroke && stroke.frame === null) stroke.frame = requestAnimationFrame(render);
    };

    const layerPoint = (layer: FabricImage, event: Event): StrokePoint => {
      const scene = canvas.getScenePoint(event as PointerEvent);
      return { ...sceneToLayerPixel(layer, scene), pressure: pressureOf(event) };
    };

    /**
     * The layer to work on, made on the spot when there is none, and the
     * pixels to change: the layer's own, or its mask's.
     */
    const resolveTarget = (): { layer: MaskableLayer; pixels: FabricImage; mask: boolean; created: boolean } | null => {
      // In Quick Mask mode the tools paint the selection, whatever layer is picked.
      if (selectionOf(canvas).quickMask) {
        const pixels = quickMaskPixels(canvas);
        if (!pixels) {
          toast.error("Open a photo before painting");
          return null;
        }
        return { layer: pixels, pixels, mask: true, created: false };
      }
      const layer = currentTarget();
      if (layer && !layer.visible) {
        toast.error("Show the layer before painting on it");
        return null;
      }
      if (layer && isDocumentLayer(layer) && isObjectLocked(layer)) {
        toast.error("Unlock the layer first");
        return null;
      }
      if (layer && (isDocumentLayer(layer) || maskTarget.isTarget(layer))) {
        const pixels = currentMaskPixels(layer);
        if (!pixels) {
          toast.error("The layer mask is still loading");
          return null;
        }
        return { layer, pixels, mask: true, created: false };
      }
      if (layer && !isDocumentLayer(layer)) return { layer, pixels: layer, mask: false, created: isPendingLayer(layer) };
      if (erasing) return null;
      const created = createPendingLayer(canvas);
      if (!created) {
        toast.error("Open a photo before painting");
        return null;
      }
      targetIdRef.current = ensureLayerId(created);
      return { layer: created, pixels: created, mask: false, created: true };
    };
    /** On a mask colours paint as their grey: black hides, white shows. */
    const paintColor = (color: string, mask: boolean) => (mask ? greyOf(color) : color);

    // With a pixel selection, tools only change what is selected (except
    // in Quick Mask mode, where they paint the selection itself).
    const store = selectionOf(canvas);
    const limit = () => (store.quickMask ? null : store.current());
    /** The selection in a layer's pixels, when there is one. */
    const clipFor = (layer: FabricImage, surface: HTMLCanvasElement) => {
      const selection = limit();
      return selection ? selectionClip(layer, selection, surface.width, surface.height) : null;
    };
    /** Run an edit that draws straight onto the layer, then undo it outside the selection. */
    const withinSelection = (layer: FabricImage, change: () => boolean): boolean => {
      const selection = limit();
      if (!selection) return change();
      const { surface } = beginPixelEdit(layer);
      const before = snapshotSurface(surface);
      try {
        const changed = change();
        if (changed) restrictToClip(surface, before, selectionClip(layer, selection, surface.width, surface.height));
        return changed;
      } finally {
        releaseCanvas(before);
      }
    };
    /** Whether a scene point is outside the selection (never, without one). */
    const outsideSelection = (point: { x: number; y: number }) => {
      const selection = limit();
      if (!selection) return false;
      const pixel = sceneToGrid(selection.grid, point.x, point.y);
      return !selection.mask.includes(pixel.x, pixel.y);
    };

    const commit = (layer: FabricImage) => {
      if (isQuickMaskPixels(canvas, layer)) {
        commitQuickMask(canvas, layer, toolStepName(activeTool) ?? "Quick Mask");
        return;
      }
      void commitPixelEdit(canvas, layer)
        .then((committed) => {
          if (!committed || released || canvasRef.current !== canvas) return;
          if (targetIdRef.current === (layer as EditorFabricObject).__layerId) selectTarget();
        })
        .catch((error) => {
          console.error("Could not save the painted layer:", error);
          toast.error("That change could not be saved");
        });
    };

    const fillAt = (event: Event) => {
      const point = canvas.getScenePoint(event as PointerEvent);
      // As in Photoshop, a click outside the selection fills nothing.
      if (outsideSelection(point)) return;
      const target = resolveTarget();
      if (!target) return;
      const { color: fillColor, bucket: options } = settingsRef.current;
      let filled = false;
      try {
        filled = withinSelection(target.pixels, () =>
          target.mask
            ? bucketFillPixels(target.pixels, point, paintColor(fillColor, true), options)
            : bucketFill(canvas, target.pixels, point, fillColor, options)
        );
      } catch (error) {
        console.error("Paint bucket failed:", error);
        toast.error(error instanceof Error ? error.message : "Could not fill there");
      }
      if (!filled) {
        if (target.created) discardPendingLayer(canvas, target.pixels);
        return;
      }
      refreshPixelLayer(target.pixels, canvas);
      commit(target.pixels);
    };

    /** A gradient drag in progress, in scene coordinates. */
    let drag: { start: { x: number; y: number }; end: { x: number; y: number } } | null = null;

    const drawGuide = () => {
      const top = canvas.contextTop;
      canvas.clearContext(top);
      if (!drag) return;
      const transform = canvas.viewportTransform;
      const toScreen = (point: { x: number; y: number }) => ({
        x: transform[0] * point.x + transform[2] * point.y + transform[4],
        y: transform[1] * point.x + transform[3] * point.y + transform[5],
      });
      const start = toScreen(drag.start);
      const end = toScreen(drag.end);
      const ratio = canvas.getRetinaScaling();
      top.save();
      top.setTransform(ratio, 0, 0, ratio, 0, 0);
      for (const [width, style] of [
        [3, "rgba(0, 0, 0, 0.6)"],
        [1, "rgba(255, 255, 255, 0.95)"],
      ] as const) {
        top.lineWidth = width;
        top.strokeStyle = style;
        top.beginPath();
        top.moveTo(start.x, start.y);
        top.lineTo(end.x, end.y);
        top.stroke();
        for (const point of [start, end]) {
          top.beginPath();
          top.arc(point.x, point.y, 4, 0, Math.PI * 2);
          top.stroke();
        }
      }
      top.restore();
    };

    const finishGradient = () => {
      const current = drag;
      drag = null;
      drawGuide();
      if (!current) return;
      const zoom = canvas.getZoom() || 1;
      const length = Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y);
      if (length * zoom < MIN_GRADIENT_DRAG) return;
      const target = resolveTarget();
      if (!target) return;
      const { color: foreground, secondaryColor: background, gradient: options } = settingsRef.current;
      try {
        withinSelection(target.pixels, () => {
          drawGradient(
            target.pixels,
            current.start,
            current.end,
            paintColor(foreground, target.mask),
            paintColor(background, target.mask),
            options
          );
          return true;
        });
      } catch (error) {
        console.error("Gradient failed:", error);
        toast.error("Could not draw the gradient");
        if (target.created) discardPendingLayer(canvas, target.pixels);
        return;
      }
      refreshPixelLayer(target.pixels, canvas);
      commit(target.pixels);
    };

    const startStroke = (event: PointerEvent | MouseEvent | TouchEvent) => {
      const target = resolveTarget();
      if (!target) return;
      const layer = target.pixels;
      const { paint: options, color, secondaryColor } = settingsRef.current;
      const session = beginPixelEdit(layer);
      // With its transparent pixels locked, the eraser paints the background
      // colour instead of taking pixels away, as in Photoshop (and on masks).
      const keepAlpha = !target.mask && isTransparencyLocked(layer);
      // Sizes are in image pixels; this layer may be stored at another scale.
      const layerPerImagePixel = layerPixelsPerSceneUnit(layer) / nativeMultiplier(canvas);
      // Symmetry turns about the document's middle, in this layer's pixels.
      let mirrors: TMat2D[] = [];
      const grid = documentGrid(canvas);
      if (grid && settingsRef.current.symmetry.mode !== "off") {
        const toLayer = sceneToLayerMatrix(layer);
        const fromLayer = util.invertTransform(toLayer);
        const cx = grid.left + grid.width / grid.scale / 2;
        const cy = grid.top + grid.height / grid.scale / 2;
        mirrors = symmetryTransforms(settingsRef.current.symmetry, cx, cy).map((turn) =>
          util.multiplyTransformMatrices(toLayer, util.multiplyTransformMatrices(turn, fromLayer))
        );
      }
      const painter = new StrokePainter(session.surface, {
        diameter: Math.max(0.5, options.size * layerPerImagePixel),
        hardness: options.hardness / 100,
        opacity: options.opacity / 100,
        flow: options.flow / 100,
        // The eraser paints the background colour on a mask, as in Photoshop.
        color: paintColor((target.mask || keepAlpha) && erasing ? secondaryColor : color, target.mask),
        erase: erasing && !target.mask && !keepAlpha,
        // A second finger turns the stroke into a pinch; it must be undone.
        cancellable: (event as PointerEvent).pointerType === "touch",
        clip: clipFor(layer, session.surface),
        dynamics: options.dynamics,
        tip: brushTip(options.tipId),
        mirrors,
      });
      stroke = { layer, painter, createdLayer: target.created, frame: null };
      const point = layerPoint(layer, event);
      const previousEnd = lastPoints.get(layer);
      if (event.shiftKey && previousEnd) painter.add(previousEnd);
      painter.add(point);
      scheduleRender();
    };

    const finishStroke = () => {
      const current = stroke;
      if (!current) return;
      stroke = null;
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      const painted = current.painter.finish();
      if (painted) refreshPixelLayer(current.layer, canvas, painted);
      const end = current.painter.lastPoint;
      if (end) lastPoints.set(current.layer, end);
      commit(current.layer);
    };

    const cancelStroke = () => {
      const current = stroke;
      if (!current) return;
      stroke = null;
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      current.painter.cancel();
      if (current.createdLayer) {
        discardPendingLayer(canvas, current.layer);
      }
      refreshPixelLayer(current.layer, canvas);
    };

    const onDown = (opt: PointerInfo) => {
      const event = opt.e;
      if (spaceDownRef.current || stroke) return;
      if ("button" in event && event.button !== 0) return;
      if (erasing && canvas.isDrawingMode) return;
      if (filling) fillAt(event);
      else if (blending) {
        const point = canvas.getScenePoint(event as PointerEvent);
        drag = { start: point, end: point };
      } else startStroke(event);
    };

    const onMove = (opt: PointerInfo) => {
      const event = opt.e;
      if (blending) {
        if (!drag) return;
        const point = canvas.getScenePoint(event as PointerEvent);
        drag.end = event.shiftKey ? constrainAngle(drag.start, point) : point;
        drawGuide();
        return;
      }
      outline = canvas.getViewportPoint(event);
      drawOutline();
      if (!stroke) return;
      const samples =
        "getCoalescedEvents" in event && typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents()
          : [];
      for (const sample of samples.length > 0 ? samples : [event]) {
        stroke.painter.add(layerPoint(stroke.layer, sample));
      }
      scheduleRender();
    };

    const onOut = () => {
      outline = null;
      drawOutline();
    };

    const onSelection = () => {
      if (stroke) return;
      adopt(canvas.getActiveObject());
      syncEraserMode();
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        cancelStroke();
        drag = null;
        drawGuide();
      }
    };
    const onUp = () => {
      if (blending) finishGradient();
      else finishStroke();
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);
    canvas.on("mouse:out", onOut);
    canvas.on("selection:created", onSelection);
    canvas.on("selection:updated", onSelection);
    // Zooming and panning move the symmetry axes.
    canvas.on("after:render", drawOutline);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    drawOutline();

    return () => {
      finishStroke();
      drag = null;
      released = true;
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      canvas.off("mouse:out", onOut);
      canvas.off("selection:created", onSelection);
      canvas.off("selection:updated", onSelection);
      canvas.off("after:render", drawOutline);
      redrawRef.current = null;
      unsubscribeMask();
      unsubscribeQuickMask();
      unsubscribePicks();
      window.removeEventListener("touchstart", onTouchStart);
      outline = null;
      if (!canvas.disposed && !canvas.isDrawingMode) canvas.clearContext(canvas.contextTop);
      canvas.selection = previous.selection;
      canvas.skipTargetFind = previous.skipTargetFind;
      canvas.defaultCursor = previous.defaultCursor;
      if (!previous.drawControls) delete (canvas as unknown as { drawControls?: unknown }).drawControls;
      canvas.requestRenderAll();
    };
  }, [activeTool, canvasKey, canvasRef, spaceDownRef]);
}
