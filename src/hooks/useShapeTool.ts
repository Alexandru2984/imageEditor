import { useEffect, useRef, type MutableRefObject } from "react";
import { IText } from "fabric";
import type { Canvas as FabricCanvas, FabricObject, TPointerEventInfo } from "fabric";
import {
  constrainDrag,
  createShape,
  isLineLike,
  isShapeKind,
  type Point2D,
  type ShapeKind,
} from "@/utils/shapes";
import { markEditorChrome } from "@/utils/editorObjects";
import { DEFAULT_TEXT_FONT } from "@/utils/fonts";
import type { Tool } from "@/types/editor";

const CLICK_TOLERANCE_PX = 4;
/** Default on-screen size for a click-placed shape, in CSS pixels. */
const DEFAULT_SCREEN_SIZE = 160;
const DEFAULT_TEXT_SCREEN_SIZE = 36;

interface UseShapeToolOptions {
  canvasRef: MutableRefObject<FabricCanvas | null>;
  /** Changes whenever a new Fabric canvas instance is created. */
  canvasKey: unknown;
  activeTool: Tool;
  color: string;
  strokeWidth: number;
  spaceDownRef: MutableRefObject<boolean>;
  onToolChange: (tool: Tool) => void;
}

type PointerInfo = TPointerEventInfo<MouseEvent | TouchEvent | PointerEvent>;

/**
 * Click-or-drag creation for shapes and text. A drag draws the shape between
 * the two points (Shift constrains), a click drops a default-sized shape that
 * looks the same size on screen at any zoom. The tool then returns to Select
 * with the new object selected, as in mainstream design tools.
 */
export function useShapeTool({
  canvasRef,
  canvasKey,
  activeTool,
  color,
  strokeWidth,
  spaceDownRef,
  onToolChange,
}: UseShapeToolOptions): void {
  // Style is read at creation time so changing colour while a tool is armed
  // does not tear down and re-arm the pointer handlers.
  const styleRef = useRef({ color, strokeWidth });
  styleRef.current = { color, strokeWidth };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const isText = activeTool === "text";
    if (!isText && !isShapeKind(activeTool)) return;
    const kind = activeTool as ShapeKind;

    const previous = {
      selection: canvas.selection,
      skipTargetFind: canvas.skipTargetFind,
      defaultCursor: canvas.defaultCursor,
    };
    canvas.discardActiveObject();
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.defaultCursor = isText ? "text" : "crosshair";
    canvas.setCursor(canvas.defaultCursor);
    canvas.requestRenderAll();

    let start: Point2D | null = null;
    let startScreen: Point2D | null = null;
    let preview: FabricObject | null = null;

    const removePreview = () => {
      if (preview) canvas.remove(preview);
      preview = null;
    };

    const zoom = () => canvas.getZoom() || 1;
    const currentStyle = () => ({
      color: styleRef.current.color,
      strokeWidth: Math.max(1, styleRef.current.strokeWidth),
    });

    const finish = (object: FabricObject) => {
      canvas.add(object);
      canvas.setActiveObject(object);
      canvas.requestRenderAll();
      onToolChange("select");
    };

    const placeText = (point: Point2D) => {
      const fontSize = Math.max(8, Math.round(DEFAULT_TEXT_SCREEN_SIZE / zoom()));
      const text = new IText("Your text", {
        left: point.x,
        top: point.y - fontSize / 2,
        fill: styleRef.current.color,
        fontSize,
        fontFamily: DEFAULT_TEXT_FONT,
      });
      finish(text);
      text.enterEditing();
      text.selectAll();
      canvas.requestRenderAll();
    };

    const onDown = (opt: PointerInfo) => {
      if (spaceDownRef.current) return;
      const point = canvas.getScenePoint(opt.e);
      if (isText) {
        placeText(point);
        return;
      }
      start = { x: point.x, y: point.y };
      startScreen = canvas.getViewportPoint(opt.e);
    };

    const onMove = (opt: PointerInfo) => {
      if (!start || !startScreen || isText) return;
      const screen = canvas.getViewportPoint(opt.e);
      if (
        !preview &&
        Math.hypot(screen.x - startScreen.x, screen.y - startScreen.y) <
          CLICK_TOLERANCE_PX
      ) {
        return;
      }
      const raw = canvas.getScenePoint(opt.e);
      const end = constrainDrag(kind, start, raw, !!opt.e.shiftKey);
      removePreview();
      preview = createShape(kind, start, end, currentStyle());
      preview.set({ selectable: false, evented: false, opacity: 0.85 });
      markEditorChrome(preview);
      canvas.add(preview);
      canvas.requestRenderAll();
    };

    const onUp = (opt: PointerInfo) => {
      if (!start || isText) return;
      const origin = start;
      start = null;
      startScreen = null;
      const hadPreview = !!preview;
      removePreview();

      let end: Point2D;
      if (hadPreview) {
        end = constrainDrag(kind, origin, canvas.getScenePoint(opt.e), !!opt.e.shiftKey);
      } else {
        // A click: centre a default-sized shape on the click point.
        const size = DEFAULT_SCREEN_SIZE / zoom();
        const half = size / 2;
        const heightHalf = isLineLike(kind) ? 0 : kind === "rectangle" ? half * 0.7 : half;
        const from = { x: origin.x - half, y: origin.y - heightHalf };
        end = { x: origin.x + half, y: origin.y + heightHalf };
        finish(createShape(kind, from, end, currentStyle()));
        return;
      }
      finish(createShape(kind, origin, end, currentStyle()));
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);

    return () => {
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      removePreview();
      if (canvas.disposed || canvas.destroyed) return;
      canvas.selection = previous.selection;
      canvas.skipTargetFind = previous.skipTargetFind;
      canvas.defaultCursor = previous.defaultCursor;
      canvas.setCursor(previous.defaultCursor ?? "default");
    };
  }, [activeTool, canvasKey, canvasRef, onToolChange, spaceDownRef]);
}
