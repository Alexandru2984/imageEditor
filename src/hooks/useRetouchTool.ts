import { useEffect, useRef, type MutableRefObject } from "react";
import type { Canvas as FabricCanvas, FabricImage, TPointerEventInfo } from "fabric";
import { toast } from "sonner";
import {
  abandonPixelEdit,
  beginPixelEdit,
  commitPixelEdit,
  editSession,
  layerPixelsPerSceneUnit,
  refreshPixelLayer,
  sceneToLayerPixel,
  type PixelRect,
} from "@/raster/pixelLayer";
import { adjustTarget } from "@/raster/pixelPreview";
import { runPixelJob } from "@/raster/pixelJobClient";
import { RetouchPainter, type RetouchStroke } from "@/raster/retouchPainter";
import type { RetouchOptions } from "@/raster/retouchSettings";
import { visibleInLayerPixels } from "@/raster/sampleAll";
import type { PaintOptions } from "@/raster/paintSettings";
import type { StrokePoint } from "@/raster/stroke";
import { nativeMultiplier } from "@/utils/flatten";
import { selectionClip } from "@/selection/clip";
import { selectionOf } from "@/selection/state";
import { isRetouchTool, needsCloneSource } from "@/components/editor/toolGroups";
import type { Tool } from "@/types/editor";
import { pressureOf, strokeBrushOutline } from "./brushPointer";

interface UseRetouchToolOptions {
  canvasRef: MutableRefObject<FabricCanvas | null>;
  /** Changes whenever a new Fabric canvas instance is created. */
  canvasKey: unknown;
  activeTool: Tool;
  paint: PaintOptions;
  retouch: RetouchOptions;
  /** The next click sets the clone source (phones have no Alt key). */
  pickingSource: boolean;
  onPickingSourceChange: (picking: boolean) => void;
  spaceDownRef: MutableRefObject<boolean>;
}

type PointerInfo = TPointerEventInfo<MouseEvent | TouchEvent | PointerEvent>;
type ScenePoint = { x: number; y: number };

interface ActiveStroke {
  pixels: FabricImage;
  context: CanvasRenderingContext2D;
  image: ImageData;
  painter: RetouchPainter;
  /** No edit was open on the layer before this stroke. */
  fresh: boolean;
  /** Scene offset from the brush to the pixels it copies. */
  sourceOffset: ScenePoint | null;
  frame: number | null;
  /** Tip diameter in layer pixels. */
  diameter: number;
}

/** The clone source: where it was set, and once a stroke ties it to the brush, the offset. */
interface CloneSource {
  scene: ScenePoint;
  offset: ScenePoint | null;
}

/**
 * The retouching tools (Clone stamp, Healing brushes): strokes that rework the selected
 * layer's own pixels, or the photo's when no layer is selected.
 */
export function useRetouchTool({
  canvasRef,
  canvasKey,
  activeTool,
  paint,
  retouch,
  pickingSource,
  onPickingSourceChange,
  spaceDownRef,
}: UseRetouchToolOptions): void {
  const settingsRef = useRef({ paint, retouch, pickingSource, onPickingSourceChange });
  settingsRef.current = { paint, retouch, pickingSource, onPickingSourceChange };
  const sourceRef = useRef<CloneSource | null>(null);
  // A source on a previous document means nothing on this one.
  useEffect(() => {
    sourceRef.current = null;
  }, [canvasKey]);
  // A new source starts over: the next stroke ties it to the brush again.
  useEffect(() => {
    const source = sourceRef.current;
    if (source && !retouch.aligned) source.offset = null;
  }, [retouch.aligned]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isRetouchTool(activeTool)) return;
    const cloning = needsCloneSource(activeTool);

    const previous = {
      selection: canvas.selection,
      skipTargetFind: canvas.skipTargetFind,
      defaultCursor: canvas.defaultCursor,
      drawControls: Object.prototype.hasOwnProperty.call(canvas, "drawControls"),
    };
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.defaultCursor = "crosshair";
    (canvas as unknown as { drawControls: () => void }).drawControls = () => {};
    canvas.requestRenderAll();

    let stroke: ActiveStroke | null = null;
    /** Spot heals still being rebuilt. */
    let busy = 0;
    let released = false;
    /** Where the pointer is, in screen and scene pixels. */
    let pointer: { view: ScenePoint; scene: ScenePoint } | null = null;
    const lastPoints = new WeakMap<FabricImage, StrokePoint>();

    const toView = (point: ScenePoint) => {
      const transform = canvas.viewportTransform;
      return {
        x: transform[0] * point.x + transform[2] * point.y + transform[4],
        y: transform[1] * point.x + transform[3] * point.y + transform[5],
      };
    };

    /** Where the source crosshair belongs, in the scene. */
    const sourceMark = (): ScenePoint | null => {
      const source = sourceRef.current;
      if (!cloning || !source) return null;
      const offset = stroke?.sourceOffset ?? (settingsRef.current.retouch.aligned ? source.offset : null);
      if (offset && pointer) return { x: pointer.scene.x + offset.x, y: pointer.scene.y + offset.y };
      return source.scene;
    };

    const drawOverlay = () => {
      const top = canvas.contextTop;
      canvas.clearContext(top);
      if (pointer) {
        const radius = (settingsRef.current.paint.size / 2 / nativeMultiplier(canvas)) * canvas.getZoom();
        strokeBrushOutline(canvas, pointer.view.x, pointer.view.y, radius);
      }
      const mark = sourceMark();
      if (!mark) return;
      const { x, y } = toView(mark);
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
        top.moveTo(x - 7, y);
        top.lineTo(x + 7, y);
        top.moveTo(x, y - 7);
        top.lineTo(x, y + 7);
        top.stroke();
      }
      top.restore();
    };

    const flush = () => {
      if (!stroke) return;
      stroke.frame = null;
      const changed = stroke.painter.takeChanged();
      if (changed) show(stroke, changed);
    };
    const show = (current: ActiveStroke, rect: PixelRect) => {
      current.context.putImageData(
        current.image,
        0,
        0,
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top
      );
      refreshPixelLayer(current.pixels, canvas, rect);
    };
    const scheduleFlush = () => {
      if (stroke && stroke.frame === null) stroke.frame = requestAnimationFrame(flush);
    };

    const layerPoint = (pixels: FabricImage, event: Event): StrokePoint => ({
      ...sceneToLayerPixel(pixels, canvas.getScenePoint(event as PointerEvent)),
      pressure: pressureOf(event),
    });

    const setSource = (scene: ScenePoint) => {
      sourceRef.current = { scene, offset: null };
      settingsRef.current.onPickingSourceChange(false);
      drawOverlay();
    };

    const startStroke = (event: PointerEvent | MouseEvent | TouchEvent) => {
      const down = canvas.getScenePoint(event as PointerEvent);
      const { paint: brush, retouch: options } = settingsRef.current;
      const source = sourceRef.current;
      if (cloning && !source) {
        toast.message("Alt-click (or use Set source) where to copy from first");
        return;
      }
      const target = adjustTarget(canvas);
      if (typeof target === "string") {
        toast.error(target);
        return;
      }
      if (!target.layer.visible) {
        toast.error("Show the layer before retouching it");
        return;
      }
      const { pixels } = target;
      const fresh = !editSession(pixels);
      const { surface, context } = beginPixelEdit(pixels);
      const { width, height } = surface;
      let image: ImageData;
      let clip: Uint8Array | null = null;
      let sample: Uint8ClampedArray | null = null;
      try {
        image = context.getImageData(0, 0, width, height);
        const selection = selectionOf(canvas).current();
        if (selection) {
          const alpha = selectionClip(pixels, selection, width, height).getContext("2d")!.getImageData(0, 0, width, height).data;
          clip = new Uint8Array(width * height);
          for (let index = 0; index < clip.length; index += 1) clip[index] = alpha[index * 4 + 3]!;
        }
        // A mask is retouched from itself.
        if (cloning && options.sampleAll && !target.mask) sample = visibleInLayerPixels(canvas, pixels, width, height);
      } catch (error) {
        console.error("Could not start retouching:", error);
        toast.error("Could not read the layer's pixels");
        if (fresh) abandonPixelEdit(canvas, pixels);
        return;
      }

      let sourceOffset: ScenePoint | null = null;
      let retouchStroke: RetouchStroke;
      if (activeTool === "spotHealing") {
        retouchStroke = { kind: "spot" };
      } else if (cloning && source) {
        if (options.aligned && source.offset) {
          sourceOffset = source.offset;
        } else {
          sourceOffset = { x: source.scene.x - down.x, y: source.scene.y - down.y };
          if (options.aligned) source.offset = sourceOffset;
        }
        const from = sceneToLayerPixel(pixels, { x: down.x + sourceOffset.x, y: down.y + sourceOffset.y });
        const to = sceneToLayerPixel(pixels, down);
        const offset = { x: Math.round(from.x - to.x), y: Math.round(from.y - to.y) };
        retouchStroke =
          activeTool === "healingBrush"
            ? { kind: "heal", offset, sample }
            : { kind: "clone", opacity: options.opacity / 100, flow: options.flow / 100, offset, sample };
      } else {
        if (fresh) abandonPixelEdit(canvas, pixels);
        return;
      }

      // Sizes are in image pixels; this layer may be stored at another scale.
      const layerPerImagePixel = layerPixelsPerSceneUnit(pixels) / nativeMultiplier(canvas);
      const painter = new RetouchPainter(
        { data: image.data, width, height },
        {
          diameter: Math.max(1, brush.size * layerPerImagePixel),
          hardness: brush.hardness / 100,
          clip,
          stroke: retouchStroke,
        }
      );
      stroke = { pixels, context, image, painter, fresh, sourceOffset, frame: null, diameter: Math.max(1, brush.size * layerPerImagePixel) };
      const previousEnd = lastPoints.get(pixels);
      if (event.shiftKey && previousEnd) painter.add(previousEnd);
      painter.add(layerPoint(pixels, event));
      scheduleFlush();
    };

    const commit = (current: ActiveStroke) => {
      void commitPixelEdit(canvas, current.pixels).catch((error) => {
        console.error("Could not save the retouched layer:", error);
        toast.error("That change could not be saved");
      });
    };

    /** Spot healing: rebuild the stroke from around it, in a worker. */
    const rebuild = (current: ActiveStroke) => {
      const request = current.painter.spotRequest(Math.max(24, Math.round(current.diameter * 2)));
      if (!request) return;
      const width = request.rect.right - request.rect.left;
      const height = request.rect.bottom - request.rect.top;
      busy += 1;
      canvas.defaultCursor = "progress";
      void runPixelJob(
        { op: "inpaint", hole: request.hole, reach: 0 },
        { data: request.pixels, width, height, x: 0, y: 0 },
        width,
        height,
        { x: 0, y: 0 }
      )
        .then((rebuilt) => {
          if (canvas.disposed) return;
          current.painter.applySpot(request.rect, rebuilt);
          show(current, current.painter.takeChanged() ?? request.rect);
          commit(current);
        })
        .catch((error) => {
          console.error("Spot healing failed:", error);
          toast.error("That spot could not be healed");
          if (canvas.disposed) return;
          current.painter.cancel();
          const changed = current.painter.takeChanged();
          if (changed) show(current, changed);
          if (current.fresh) abandonPixelEdit(canvas, current.pixels);
        })
        .finally(() => {
          busy -= 1;
          if (busy === 0 && !released) canvas.defaultCursor = "crosshair";
        });
    };

    const finishStroke = () => {
      const current = stroke;
      if (!current) return;
      stroke = null;
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      current.painter.heal();
      const changed = current.painter.takeChanged();
      if (changed) show(current, changed);
      const end = current.painter.lastPoint;
      if (end) lastPoints.set(current.pixels, end);
      drawOverlay();
      if (!current.painter.area) {
        if (current.fresh) abandonPixelEdit(canvas, current.pixels);
        return;
      }
      if (activeTool === "spotHealing") rebuild(current);
      else commit(current);
    };

    const cancelStroke = () => {
      const current = stroke;
      if (!current) return;
      stroke = null;
      if (current.frame !== null) cancelAnimationFrame(current.frame);
      current.painter.cancel();
      const changed = current.painter.takeChanged();
      if (changed) show(current, changed);
      if (current.fresh) abandonPixelEdit(canvas, current.pixels);
    };

    const onDown = (opt: PointerInfo) => {
      const event = opt.e;
      if (spaceDownRef.current || stroke || busy > 0) return;
      if ("button" in event && event.button !== 0) return;
      if (cloning && (event.altKey || settingsRef.current.pickingSource)) {
        setSource(canvas.getScenePoint(event as PointerEvent));
        return;
      }
      startStroke(event);
    };

    const onMove = (opt: PointerInfo) => {
      const event = opt.e;
      const scene = canvas.getScenePoint(event as PointerEvent);
      pointer = { view: canvas.getViewportPoint(event), scene };
      if (stroke) {
        const samples =
          "getCoalescedEvents" in event && typeof event.getCoalescedEvents === "function"
            ? event.getCoalescedEvents()
            : [];
        for (const sample of samples.length > 0 ? samples : [event]) {
          stroke.painter.add(layerPoint(stroke.pixels, sample));
        }
        scheduleFlush();
      }
      drawOverlay();
    };

    const onOut = () => {
      pointer = null;
      drawOverlay();
    };

    const onTouchStart = (event: TouchEvent) => {
      // A second finger turns the stroke into a pinch.
      if (event.touches.length > 1) cancelStroke();
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", finishStroke);
    canvas.on("mouse:out", onOut);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    drawOverlay();

    return () => {
      finishStroke();
      released = true;
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", finishStroke);
      canvas.off("mouse:out", onOut);
      window.removeEventListener("touchstart", onTouchStart);
      if (!canvas.disposed) canvas.clearContext(canvas.contextTop);
      canvas.selection = previous.selection;
      canvas.skipTargetFind = previous.skipTargetFind;
      canvas.defaultCursor = previous.defaultCursor;
      if (!previous.drawControls) delete (canvas as unknown as { drawControls?: unknown }).drawControls;
      canvas.requestRenderAll();
    };
  }, [activeTool, canvasKey, canvasRef, spaceDownRef]);
}
