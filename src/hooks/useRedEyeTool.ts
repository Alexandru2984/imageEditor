import { useEffect, useRef, type MutableRefObject } from "react";
import type { Canvas as FabricCanvas, TPointerEventInfo } from "fabric";
import { toast } from "sonner";
import { dragBox, type Point } from "@/selection/drag";
import { documentGrid, sceneToGrid, selectionOf } from "@/selection/state";
import { applyRedEye } from "@/raster/patchTool";
import type { RedEyeSettings } from "@/raster/redEye";
import type { Tool } from "@/types/editor";

interface UseRedEyeToolOptions {
  canvasRef: MutableRefObject<FabricCanvas | null>;
  /** Changes whenever a new Fabric canvas instance is created. */
  canvasKey: unknown;
  activeTool: Tool;
  settings: RedEyeSettings;
  spaceDownRef: MutableRefObject<boolean>;
}

type PointerInfo = TPointerEventInfo<MouseEvent | TouchEvent | PointerEvent>;

/** A drag shorter than this (screen pixels) is a click. */
const MIN_DRAG = 4;

/**
 * The Red Eye tool (J): click in a red pupil, or drag a box around the eye;
 * the red pupil there turns grey and dark.
 */
export function useRedEyeTool({ canvasRef, canvasKey, activeTool, settings, spaceDownRef }: UseRedEyeToolOptions): void {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeTool !== "redEye") return;
    const store = selectionOf(canvas);
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

    let drag: { start: Point; end: Point } | null = null;
    const zoom = () => canvas.getZoom() || 1;
    const dragged = (current: { start: Point; end: Point }) =>
      Math.max(Math.abs(current.end.x - current.start.x), Math.abs(current.end.y - current.start.y)) * zoom() >= MIN_DRAG;

    const onDown = (opt: PointerInfo) => {
      const event = opt.e;
      if (spaceDownRef.current || drag) return;
      if ("button" in event && event.button !== 0) return;
      if ("touches" in event && event.touches.length > 1) return;
      const point = canvas.getScenePoint(event as PointerEvent);
      drag = { start: point, end: point };
    };
    const onMove = (opt: PointerInfo) => {
      if (!drag) return;
      drag.end = canvas.getScenePoint(opt.e as PointerEvent);
      if (dragged(drag)) store.setPreview({ kind: "rect", ...dragBox(drag.start, drag.end, { square: false, fromCentre: false }) });
    };
    const onUp = () => {
      const current = drag;
      drag = null;
      store.setPreview(null);
      if (!current) return;
      const grid = documentGrid(canvas);
      if (!grid) {
        toast.error("Open a photo first");
        return;
      }
      const from = sceneToGrid(grid, current.start.x, current.start.y);
      let box: { x0: number; y0: number; x1: number; y1: number };
      if (dragged(current)) {
        const to = sceneToGrid(grid, current.end.x, current.end.y);
        box = { x0: from.x, y0: from.y, x1: to.x, y1: to.y };
      } else {
        // A click: a box around it, about an eye's size on a portrait.
        const half = Math.max(8, Math.round(Math.min(grid.width, grid.height) * 0.03));
        box = { x0: from.x - half, y0: from.y - half, x1: from.x + half, y1: from.y + half };
      }
      void applyRedEye(canvas, box, settingsRef.current)
        .then((result) => {
          if (result !== true) toast.message(result);
        })
        .catch((error: unknown) => {
          console.error("Red eye failed:", error);
          toast.error("The red eye could not be fixed");
        });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag) return;
      drag = null;
      store.setPreview(null);
      event.preventDefault();
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      drag = null;
      store.setPreview(null);
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      window.removeEventListener("keydown", onKeyDown, true);
      canvas.selection = previous.selection;
      canvas.skipTargetFind = previous.skipTargetFind;
      canvas.defaultCursor = previous.defaultCursor;
      if (!previous.drawControls) delete (canvas as unknown as { drawControls?: unknown }).drawControls;
      if (!canvas.disposed) canvas.requestRenderAll();
    };
  }, [activeTool, canvasKey, canvasRef, spaceDownRef]);
}
