import { useEffect, useRef, type MutableRefObject } from "react";
import type { Canvas as FabricCanvas, TPointerEventInfo } from "fabric";
import { toast } from "sonner";
import { Mask, type SelectionMode } from "@/selection/mask";
import { ellipseMask } from "@/selection/shapes";
import { HeldModifier, dragBox, modeFor, type Point } from "@/selection/drag";
import {
  documentGrid,
  sceneToGrid,
  selectionOf,
  type PixelSelection,
} from "@/selection/state";
import { isSelectionTool } from "@/components/editor/toolGroups";
import type { Tool } from "@/types/editor";

interface UseSelectionToolOptions {
  canvasRef: MutableRefObject<FabricCanvas | null>;
  /** Changes whenever a new Fabric canvas instance is created. */
  canvasKey: unknown;
  activeTool: Tool;
  /** The options bar's selection mode (modifier keys override it). */
  mode: SelectionMode;
  spaceDownRef: MutableRefObject<boolean>;
}

type PointerInfo = TPointerEventInfo<MouseEvent | TouchEvent | PointerEvent>;

/** Below this many screen pixels a drag is taken for a click. */
const MIN_DRAG = 3;

type Drag =
  | {
      kind: "shape";
      start: Point;
      end: Point;
      mode: SelectionMode;
      square: HeldModifier;
      centre: HeldModifier;
      squareOn: boolean;
      centreOn: boolean;
    }
  | { kind: "move"; start: Point; dx: number; dy: number; selection: PixelSelection };

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    !!target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')
  );
};

/** Join a new shape to the canvas's selection in the given mode. */
export function addToSelection(canvas: FabricCanvas, shape: Mask, mode: SelectionMode): void {
  const store = selectionOf(canvas);
  const current = store.current();
  if (mode === "replace" || !current) {
    // Taking away from or overlapping nothing leaves nothing.
    store.set(mode === "replace" || mode === "add" ? shape : null);
    return;
  }
  store.set(current.mask.combine(shape, mode), current.grid);
}

/**
 * The selection tools: Rectangle and Ellipse select. Dragging draws a shape
 * that replaces, adds to, subtracts from or intersects the selection;
 * dragging inside the selection moves it; a click deselects.
 */
export function useSelectionTool({
  canvasRef,
  canvasKey,
  activeTool,
  mode,
  spaceDownRef,
}: UseSelectionToolOptions): void {
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isSelectionTool(activeTool)) return;
    const store = selectionOf(canvas);
    const ellipse = activeTool === "ellipseMarquee";

    const previous = {
      selection: canvas.selection,
      skipTargetFind: canvas.skipTargetFind,
      defaultCursor: canvas.defaultCursor,
      drawControls: Object.prototype.hasOwnProperty.call(canvas, "drawControls"),
    };
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.defaultCursor = "crosshair";
    // The selected layer stays the one selections act on; its handles would
    // only be in the way.
    (canvas as unknown as { drawControls: () => void }).drawControls = () => {};
    canvas.requestRenderAll();

    let drag: Drag | null = null;

    const shapeBox = (current: Extract<Drag, { kind: "shape" }>) =>
      dragBox(current.start, current.end, { square: current.squareOn, fromCentre: current.centreOn });

    const cancel = () => {
      drag = null;
      store.setPreview(null);
    };

    const onDown = (opt: PointerInfo) => {
      const event = opt.e;
      if (spaceDownRef.current || drag) return;
      if ("button" in event && event.button !== 0) return;
      if ("touches" in event && event.touches.length > 1) return;
      const point = canvas.getScenePoint(event as PointerEvent);
      const chosen = modeFor(event, modeRef.current);
      const selection = store.current();
      if (chosen === "replace" && selection) {
        const pixel = sceneToGrid(selection.grid, point.x, point.y);
        if (selection.mask.includes(pixel.x, pixel.y)) {
          drag = { kind: "move", start: point, dx: 0, dy: 0, selection };
          return;
        }
      }
      drag = {
        kind: "shape",
        start: point,
        end: point,
        mode: chosen,
        square: new HeldModifier(event.shiftKey),
        centre: new HeldModifier(event.altKey),
        squareOn: false,
        centreOn: false,
      };
    };

    const onMove = (opt: PointerInfo) => {
      if (!drag) return;
      const event = opt.e;
      const point = canvas.getScenePoint(event as PointerEvent);
      if (drag.kind === "move") {
        const { scale } = drag.selection.grid;
        drag.dx = Math.round((point.x - drag.start.x) * scale);
        drag.dy = Math.round((point.y - drag.start.y) * scale);
        store.setPreview({ kind: "move", dx: drag.dx, dy: drag.dy });
        return;
      }
      drag.end = point;
      drag.squareOn = drag.square.update(event.shiftKey);
      drag.centreOn = drag.centre.update(event.altKey);
      store.setPreview({ kind: ellipse ? "ellipse" : "rect", ...shapeBox(drag) });
    };

    const onUp = () => {
      const current = drag;
      if (!current) return;
      cancel();
      if (current.kind === "move") {
        const { mask, grid } = current.selection;
        // A click in the selection deselects, like anywhere else.
        if (current.dx === 0 && current.dy === 0) store.set(null);
        else store.set(mask.translated(current.dx, current.dy), grid);
        return;
      }
      const box = shapeBox(current);
      const zoom = canvas.getZoom() || 1;
      if (Math.abs(box.x1 - box.x0) * zoom < MIN_DRAG && Math.abs(box.y1 - box.y0) * zoom < MIN_DRAG) {
        if (current.mode === "replace") store.set(null);
        return;
      }
      const grid = documentGrid(canvas);
      if (!grid) {
        toast.error("Open a photo before selecting");
        return;
      }
      const from = sceneToGrid(grid, box.x0, box.y0);
      const to = sceneToGrid(grid, box.x1, box.y1);
      const shape = ellipse
        ? ellipseMask(grid.width, grid.height, from.x, from.y, to.x, to.y)
        : Mask.rect(grid.width, grid.height, from.x, from.y, to.x, to.y);
      addToSelection(canvas, shape, current.mode);
    };

    // A second finger turns the drag into a pinch.
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 1) cancel();
    };

    // Escape drops the shape being drawn, then the selection. Runs before the
    // editor's own Escape, which would deselect the layer too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isTypingTarget(event.target)) return;
      if (drag) {
        cancel();
      } else if (store.current()) {
        store.set(null);
      } else {
        return;
      }
      event.preventDefault();
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      cancel();
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("keydown", onKeyDown, true);
      canvas.selection = previous.selection;
      canvas.skipTargetFind = previous.skipTargetFind;
      canvas.defaultCursor = previous.defaultCursor;
      if (!previous.drawControls) delete (canvas as unknown as { drawControls?: unknown }).drawControls;
      if (!canvas.disposed) canvas.requestRenderAll();
    };
  }, [activeTool, canvasKey, canvasRef, spaceDownRef]);
}
