import { useEffect, useRef, type MutableRefObject } from "react";
import type { Canvas as FabricCanvas, TPointerEventInfo } from "fabric";
import { toast } from "sonner";
import { Mask, type SelectionMode } from "@/selection/mask";
import { ellipseMask, polygonMask } from "@/selection/shapes";
import { HeldModifier, dragBox, modeFor, type Point } from "@/selection/drag";
import { wandSelect, type WandOptions } from "@/selection/magicWand";
import {
  documentGrid,
  sceneToGrid,
  selectionOf,
  type DocumentGrid,
  type PixelSelection,
} from "@/selection/state";
import { constrainAngle } from "@/raster/gradient";
import { isSelectionTool } from "@/components/editor/toolGroups";
import type { Tool } from "@/types/editor";

interface UseSelectionToolOptions {
  canvasRef: MutableRefObject<FabricCanvas | null>;
  /** Changes whenever a new Fabric canvas instance is created. */
  canvasKey: unknown;
  activeTool: Tool;
  /** The options bar's selection mode (modifier keys override it). */
  mode: SelectionMode;
  wand: WandOptions;
  spaceDownRef: MutableRefObject<boolean>;
}

type PointerInfo = TPointerEventInfo<MouseEvent | TouchEvent | PointerEvent>;

/** Below this many screen pixels a drag is taken for a click. */
const MIN_DRAG = 3;
/** A polygon closes when a click lands this close (screen pixels) to its start. */
const CLOSE_DISTANCE = 8;
/** A freehand lasso records a point once the pointer moves this far (screen pixels). */
const LASSO_STEP = 1.5;

type ShapeDrag = {
  kind: "shape";
  start: Point;
  end: Point;
  mode: SelectionMode;
  square: HeldModifier;
  centre: HeldModifier;
  squareOn: boolean;
  centreOn: boolean;
};
type Drag =
  | ShapeDrag
  | { kind: "lasso"; points: Point[]; mode: SelectionMode }
  | { kind: "move"; start: Point; dx: number; dy: number; selection: PixelSelection };

interface Polygon {
  points: Point[];
  mode: SelectionMode;
  /** Shift keeps sides to 45° steps, unless it chose the mode. */
  shift: HeldModifier;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    !!target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')
  );
};

/** Join a new shape to the canvas's selection in the given mode; `label` names the history step. */
export function addToSelection(canvas: FabricCanvas, shape: Mask, mode: SelectionMode, grid?: DocumentGrid, label?: string): void {
  const store = selectionOf(canvas);
  const current = store.current();
  if (mode === "replace" || !current) {
    // Taking away from or overlapping nothing leaves nothing.
    store.set(mode === "replace" || mode === "add" ? shape : null, grid, label);
    return;
  }
  store.set(current.mask.combine(shape, mode), current.grid, label);
}

/** Photoshop's names for the selection tools, as its History panel shows them. */
const TOOL_STEPS: Record<string, string> = {
  marquee: "Rectangular Marquee",
  ellipseMarquee: "Elliptical Marquee",
  lasso: "Lasso",
  polygonLasso: "Polygonal Lasso",
  magicWand: "Magic Wand",
};

/**
 * The selection tools: Rectangle and Ellipse select, Lasso, Polygonal lasso
 * and Magic wand. Each new shape replaces, adds to, subtracts from or
 * intersects the selection; dragging inside the selection moves it; a click
 * elsewhere deselects.
 */
export function useSelectionTool({
  canvasRef,
  canvasKey,
  activeTool,
  mode,
  wand,
  spaceDownRef,
}: UseSelectionToolOptions): void {
  const settingsRef = useRef({ mode, wand });
  settingsRef.current = { mode, wand };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isSelectionTool(activeTool)) return;
    const store = selectionOf(canvas);
    const tool = activeTool;
    const step = TOOL_STEPS[tool] ?? "Selection";

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
    let polygon: Polygon | null = null;
    /**
     * A press of the wand or polygonal lasso, acted on when released so a
     * pinch (a second finger) can still call it off.
     */
    let tap: { point: Point; keys: { shiftKey: boolean; altKey: boolean }; cancelled: boolean } | null = null;

    const zoom = () => canvas.getZoom() || 1;
    const shapeBox = (current: ShapeDrag) =>
      dragBox(current.start, current.end, { square: current.squareOn, fromCentre: current.centreOn });

    const gridOrComplain = (): DocumentGrid | null => {
      const grid = documentGrid(canvas);
      if (!grid) toast.error("Open a photo before selecting");
      return grid;
    };

    /** A closed outline in scene coordinates, as a selection shape. */
    const outlineMask = (points: Point[]): { mask: Mask; grid: DocumentGrid } | null => {
      const grid = gridOrComplain();
      if (!grid) return null;
      const onGrid = points.map((point) => sceneToGrid(grid, point.x, point.y));
      return { mask: polygonMask(grid.width, grid.height, onGrid), grid };
    };

    const tinyExtent = (points: Point[]) => {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return (
        (Math.max(...xs) - Math.min(...xs)) * zoom() < MIN_DRAG &&
        (Math.max(...ys) - Math.min(...ys)) * zoom() < MIN_DRAG
      );
    };

    // ---------- Polygonal lasso ----------
    const showPolygon = (hover?: Point) => {
      if (!polygon) return;
      store.setPreview({ kind: "path", points: hover ? [...polygon.points, hover] : polygon.points, closed: false });
    };
    const cancelPolygon = () => {
      polygon = null;
      store.setPreview(null);
      store.setDraft(null);
    };
    const finishPolygon = () => {
      const current = polygon;
      cancelPolygon();
      if (!current || current.points.length < 3) return;
      const shape = outlineMask(current.points);
      if (shape) addToSelection(canvas, shape.mask, current.mode, shape.grid, step);
    };
    const draft = { finish: finishPolygon, cancel: cancelPolygon };
    const polygonPoint = (point: Point, event: { shiftKey: boolean }) => {
      if (!polygon) return point;
      const last = polygon.points.at(-1)!;
      return polygon.shift.update(event.shiftKey) ? constrainAngle(last, point) : point;
    };
    const addPolygonPoint = (point: Point, event: { shiftKey: boolean; altKey: boolean }) => {
      if (!polygon) {
        polygon = { points: [point], mode: modeFor(event, settingsRef.current.mode), shift: new HeldModifier(event.shiftKey) };
        store.setDraft(draft);
        showPolygon();
        return;
      }
      const first = polygon.points[0]!;
      const closing =
        polygon.points.length >= 3 &&
        Math.hypot(point.x - first.x, point.y - first.y) * zoom() <= CLOSE_DISTANCE;
      if (closing) {
        finishPolygon();
        return;
      }
      polygon.points.push(polygonPoint(point, event));
      showPolygon();
    };

    // ---------- Magic wand ----------
    const wandAt = (point: Point, chosen: SelectionMode) => {
      const grid = gridOrComplain();
      if (!grid) return;
      let shape: Mask | null;
      try {
        shape = wandSelect(canvas, grid, point, settingsRef.current.wand);
      } catch (error) {
        console.error("Magic wand failed:", error);
        toast.error(error instanceof Error ? error.message : "Could not select there");
        return;
      }
      // Outside the document: as with any click, a new selection deselects.
      if (!shape) {
        if (chosen === "replace") store.set(null);
        return;
      }
      addToSelection(canvas, shape, chosen, grid, step);
    };

    const cancelDrag = () => {
      drag = null;
      if (!polygon) store.setPreview(null);
    };

    const onDown = (opt: PointerInfo) => {
      const event = opt.e;
      if (spaceDownRef.current || drag) return;
      if ("button" in event && event.button !== 0) return;
      if ("touches" in event && event.touches.length > 1) return;
      const point = canvas.getScenePoint(event as PointerEvent);

      if (tool === "polygonLasso" || tool === "magicWand") {
        tap = { point, keys: { shiftKey: event.shiftKey, altKey: event.altKey }, cancelled: false };
        return;
      }
      const chosen = modeFor(event, settingsRef.current.mode);
      const selection = store.current();
      if (chosen === "replace" && selection) {
        const pixel = sceneToGrid(selection.grid, point.x, point.y);
        if (selection.mask.includes(pixel.x, pixel.y)) {
          drag = { kind: "move", start: point, dx: 0, dy: 0, selection };
          return;
        }
      }
      if (tool === "lasso") {
        drag = { kind: "lasso", points: [point], mode: chosen };
        return;
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
      const event = opt.e;
      const point = canvas.getScenePoint(event as PointerEvent);
      if (polygon) {
        showPolygon(polygonPoint(point, event));
        return;
      }
      if (!drag) return;
      if (drag.kind === "move") {
        const { scale } = drag.selection.grid;
        drag.dx = Math.round((point.x - drag.start.x) * scale);
        drag.dy = Math.round((point.y - drag.start.y) * scale);
        store.setPreview({ kind: "move", dx: drag.dx, dy: drag.dy });
        return;
      }
      if (drag.kind === "lasso") {
        const last = drag.points.at(-1)!;
        if (Math.hypot(point.x - last.x, point.y - last.y) * zoom() < LASSO_STEP) return;
        drag.points.push(point);
        store.setPreview({ kind: "path", points: drag.points, closed: false });
        return;
      }
      drag.end = point;
      drag.squareOn = drag.square.update(event.shiftKey);
      drag.centreOn = drag.centre.update(event.altKey);
      store.setPreview({ kind: tool === "ellipseMarquee" ? "ellipse" : "rect", ...shapeBox(drag) });
    };

    const onUp = () => {
      const pressed = tap;
      tap = null;
      if (pressed && !pressed.cancelled) {
        if (tool === "polygonLasso") addPolygonPoint(pressed.point, pressed.keys);
        else wandAt(pressed.point, modeFor(pressed.keys, settingsRef.current.mode));
        return;
      }
      const current = drag;
      if (!current) return;
      cancelDrag();
      if (current.kind === "move") {
        const { mask, grid } = current.selection;
        // A click in the selection deselects, like anywhere else.
        if (current.dx === 0 && current.dy === 0) store.set(null);
        else store.set(mask.translated(current.dx, current.dy), grid, "Move Selection");
        return;
      }
      if (current.kind === "lasso") {
        if (current.points.length < 3 || tinyExtent(current.points)) {
          if (current.mode === "replace") store.set(null);
          return;
        }
        const shape = outlineMask(current.points);
        if (shape) addToSelection(canvas, shape.mask, current.mode, shape.grid, step);
        return;
      }
      const box = shapeBox(current);
      if (Math.abs(box.x1 - box.x0) * zoom() < MIN_DRAG && Math.abs(box.y1 - box.y0) * zoom() < MIN_DRAG) {
        if (current.mode === "replace") store.set(null);
        return;
      }
      const grid = gridOrComplain();
      if (!grid) return;
      const from = sceneToGrid(grid, box.x0, box.y0);
      const to = sceneToGrid(grid, box.x1, box.y1);
      const shape =
        tool === "ellipseMarquee"
          ? ellipseMask(grid.width, grid.height, from.x, from.y, to.x, to.y)
          : Mask.rect(grid.width, grid.height, from.x, from.y, to.x, to.y);
      addToSelection(canvas, shape, current.mode, grid, step);
    };

    const onDoubleClick = () => {
      if (polygon) finishPolygon();
    };

    // A second finger turns the gesture into a pinch.
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      cancelDrag();
      if (tap) tap.cancelled = true;
    };

    // Escape drops the shape being drawn, then the selection; Enter closes a
    // polygon and Backspace takes back its last corner. Runs before the
    // editor's own keys (Escape would deselect the layer, Backspace delete it).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        if (drag) cancelDrag();
        else if (polygon) cancelPolygon();
        else if (store.current()) store.set(null);
        else return;
      } else if (polygon && event.key === "Enter") {
        finishPolygon();
      } else if (polygon && (event.key === "Backspace" || event.key === "Delete")) {
        polygon.points.pop();
        if (polygon.points.length === 0) cancelPolygon();
        else showPolygon();
      } else {
        return;
      }
      event.preventDefault();
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);
    canvas.on("mouse:dblclick", onDoubleClick);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      drag = null;
      polygon = null;
      tap = null;
      store.setPreview(null);
      store.setDraft(null);
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      canvas.off("mouse:dblclick", onDoubleClick);
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
