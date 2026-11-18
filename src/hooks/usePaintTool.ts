import { useEffect, useRef, type MutableRefObject } from "react";
import type { Canvas as FabricCanvas, FabricImage, FabricObject, TPointerEventInfo } from "fabric";
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
import { bucketFill, type BucketOptions } from "@/raster/fill";
import { constrainAngle, drawGradient, type GradientOptions } from "@/raster/gradient";
import type { PaintOptions } from "@/raster/paintSettings";
import type { StrokePoint } from "@/raster/stroke";
import { ensureLayerId, type EditorFabricObject } from "@/utils/editorObjects";
import { nativeMultiplier } from "@/utils/flatten";
import { releaseCanvas, restrictToClip, selectionClip, snapshotSurface } from "@/selection/clip";
import { sceneToGrid, selectionOf } from "@/selection/state";
import type { Tool } from "@/types/editor";

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

function pressureOf(event: Event): number {
  const pointer = event as PointerEvent;
  // Only pens report real pressure; mice and fingers paint at full size.
  return pointer.pointerType === "pen" && pointer.pressure > 0 ? pointer.pressure : 1;
}

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
  spaceDownRef,
}: UsePaintToolOptions): void {
  const settingsRef = useRef({ color, secondaryColor, paint, bucket, gradient });
  settingsRef.current = { color, secondaryColor, paint, bucket, gradient };
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

    const currentTarget = (): FabricImage | null => {
      const layer = findLayer(canvas, targetIdRef.current);
      return isPaintableLayer(layer) ? layer : null;
    };
    const adopt = (object: FabricObject | undefined) => {
      targetIdRef.current = isPaintableLayer(object) ? ensureLayerId(object) : null;
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
      if (erasing) canvas.isDrawingMode = currentTarget() === null;
    };
    const selectTarget = () => {
      const target = currentTarget();
      if (target && canvas.getActiveObject() !== target) canvas.setActiveObject(target);
      syncEraserMode();
      canvas.requestRenderAll();
    };
    selectTarget();

    let stroke: ActiveStroke | null = null;
    /** Set once the tool is put down; late encodes must not touch the canvas mode. */
    let released = false;
    /** Where the last stroke on each layer ended, for Shift-click lines. */
    const lastPoints = new WeakMap<FabricImage, StrokePoint>();
    let outline: { x: number; y: number } | null = null;

    const drawOutline = () => {
      // The vector eraser draws its own trail on the same layer.
      if (canvas.isDrawingMode || filling || blending) return;
      const top = canvas.contextTop;
      canvas.clearContext(top);
      if (!outline) return;
      const multiplier = nativeMultiplier(canvas);
      const radius = (settingsRef.current.paint.size / 2 / multiplier) * canvas.getZoom();
      if (radius < 2) return;
      const ratio = canvas.getRetinaScaling();
      top.save();
      top.setTransform(ratio, 0, 0, ratio, 0, 0);
      top.lineWidth = 1;
      top.beginPath();
      top.arc(outline.x, outline.y, radius, 0, Math.PI * 2);
      top.strokeStyle = "rgba(0, 0, 0, 0.7)";
      top.stroke();
      top.beginPath();
      top.arc(outline.x, outline.y, radius + 1, 0, Math.PI * 2);
      top.strokeStyle = "rgba(255, 255, 255, 0.8)";
      top.stroke();
      top.restore();
    };

    const render = () => {
      if (!stroke) return;
      stroke.frame = null;
      if (stroke.painter.flush()) refreshPixelLayer(stroke.layer, canvas);
    };
    const scheduleRender = () => {
      if (stroke && stroke.frame === null) stroke.frame = requestAnimationFrame(render);
    };

    const layerPoint = (layer: FabricImage, event: Event): StrokePoint => {
      const scene = canvas.getScenePoint(event as PointerEvent);
      return { ...sceneToLayerPixel(layer, scene), pressure: pressureOf(event) };
    };

    /** The layer to work on, made on the spot when there is none. */
    const resolveTarget = (): { layer: FabricImage; created: boolean } | null => {
      const layer = currentTarget();
      if (layer && !layer.visible) {
        toast.error("Show the layer before painting on it");
        return null;
      }
      if (layer) return { layer, created: isPendingLayer(layer) };
      if (erasing) return null;
      const created = createPendingLayer(canvas);
      if (!created) {
        toast.error("Open a photo before painting");
        return null;
      }
      targetIdRef.current = ensureLayerId(created);
      return { layer: created, created: true };
    };

    // With a pixel selection, tools only change what is selected.
    const store = selectionOf(canvas);
    /** The selection in a layer's pixels, when there is one. */
    const clipFor = (layer: FabricImage, surface: HTMLCanvasElement) => {
      const selection = store.current();
      return selection ? selectionClip(layer, selection, surface.width, surface.height) : null;
    };
    /** Run an edit that draws straight onto the layer, then undo it outside the selection. */
    const withinSelection = (layer: FabricImage, change: () => boolean): boolean => {
      const selection = store.current();
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
      const selection = store.current();
      if (!selection) return false;
      const pixel = sceneToGrid(selection.grid, point.x, point.y);
      return !selection.mask.includes(pixel.x, pixel.y);
    };

    const commit = (layer: FabricImage) => {
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
        filled = withinSelection(target.layer, () =>
          bucketFill(canvas, target.layer, point, fillColor, options)
        );
      } catch (error) {
        console.error("Paint bucket failed:", error);
        toast.error(error instanceof Error ? error.message : "Could not fill there");
      }
      if (!filled) {
        if (target.created) discardPendingLayer(canvas, target.layer);
        return;
      }
      refreshPixelLayer(target.layer, canvas);
      commit(target.layer);
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
        withinSelection(target.layer, () => {
          drawGradient(target.layer, current.start, current.end, foreground, background, options);
          return true;
        });
      } catch (error) {
        console.error("Gradient failed:", error);
        toast.error("Could not draw the gradient");
        if (target.created) discardPendingLayer(canvas, target.layer);
        return;
      }
      refreshPixelLayer(target.layer, canvas);
      commit(target.layer);
    };

    const startStroke = (event: PointerEvent | MouseEvent | TouchEvent) => {
      const target = resolveTarget();
      if (!target) return;
      const { layer } = target;
      const { paint: options, color: paintColor } = settingsRef.current;
      const session = beginPixelEdit(layer);
      // Sizes are in image pixels; this layer may be stored at another scale.
      const layerPerImagePixel = layerPixelsPerSceneUnit(layer) / nativeMultiplier(canvas);
      const painter = new StrokePainter(session.surface, {
        diameter: Math.max(0.5, options.size * layerPerImagePixel),
        hardness: options.hardness / 100,
        opacity: options.opacity / 100,
        flow: options.flow / 100,
        color: paintColor,
        erase: erasing,
        // A second finger turns the stroke into a pinch; it must be undone.
        cancellable: (event as PointerEvent).pointerType === "touch",
        clip: clipFor(layer, session.surface),
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
      current.painter.finish();
      refreshPixelLayer(current.layer, canvas);
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
    window.addEventListener("touchstart", onTouchStart, { passive: true });

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
