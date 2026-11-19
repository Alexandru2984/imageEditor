import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Canvas as FabricCanvas, TPointerEvent, TPointerEventInfo } from "fabric";
import { RULER_SIZE } from "@/hooks/useGuides";
import { documentGrid } from "@/selection/state";
import { rulerStep } from "@/utils/guideData";
import { guideDraft, guidesOf, placeGuide, setGuideDraft, setGuides } from "@/utils/guides";

/** Screen pixels within which a guide being dragged out snaps to a layer's edge. */
const SNAP_DISTANCE = 6;

/** Draw one ruler: document pixels from the document's top-left corner. */
function paintRuler(element: HTMLCanvasElement, canvas: FabricCanvas, axis: "x" | "y", pointer: number | null) {
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = element.clientWidth;
  const cssHeight = element.clientHeight;
  const width = Math.round(cssWidth * ratio);
  const height = Math.round(cssHeight * ratio);
  if (element.width !== width || element.height !== height) {
    element.width = width;
    element.height = height;
  }
  const ctx = element.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const grid = documentGrid(canvas);
  if (!grid) return;
  const t = canvas.viewportTransform;
  const zoom = axis === "x" ? t[0] : t[3];
  const shift = axis === "x" ? t[4] : t[5];
  const origin = axis === "x" ? grid.left : grid.top;
  const length = axis === "x" ? cssWidth : cssHeight;
  // The ruler starts after the corner square.
  const toRuler = (pixel: number) => shift + (origin + pixel / grid.scale) * zoom - RULER_SIZE;
  const toPixel = (at: number) => ((at + RULER_SIZE - shift) / zoom - origin) * grid.scale;
  const { step, divisions } = rulerStep(zoom / grid.scale);
  const tick = step / divisions;
  const first = Math.floor(toPixel(0) / tick);
  const last = Math.ceil(toPixel(length) / tick);

  const colour = getComputedStyle(element).color;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1;
  ctx.font = "10px 'Inter Variable', system-ui, sans-serif";
  ctx.beginPath();
  for (let index = first; index <= last; index += 1) {
    const at = Math.round(toRuler(index * tick)) + 0.5;
    const major = index % divisions === 0;
    const half = divisions % 2 === 0 && index % (divisions / 2) === 0;
    const size = major ? RULER_SIZE : half ? 8 : 4;
    if (axis === "x") {
      ctx.moveTo(at, RULER_SIZE);
      ctx.lineTo(at, RULER_SIZE - size);
    } else {
      ctx.moveTo(RULER_SIZE, at);
      ctx.lineTo(RULER_SIZE - size, at);
    }
    if (!major) continue;
    const label = String(Math.round(index * tick));
    if (axis === "x") {
      ctx.textAlign = "left";
      ctx.fillText(label, at + 3, 10);
    } else {
      // Read from the bottom up, below its tick.
      ctx.save();
      ctx.translate(10, at + 3);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "right";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
  ctx.stroke();
  ctx.strokeStyle = "#00c2ff";
  ctx.beginPath();
  if (pointer !== null) {
    const at = Math.round(pointer - RULER_SIZE) + 0.5;
    if (axis === "x") {
      ctx.moveTo(at, 0);
      ctx.lineTo(at, RULER_SIZE);
    } else {
      ctx.moveTo(0, at);
      ctx.lineTo(RULER_SIZE, at);
    }
  }
  ctx.stroke();
}

/**
 * View › Rulers: along the top and left of the canvas, in document pixels
 * from the document's top-left corner, with the pointer's place marked.
 * Dragging out of a ruler makes a guide.
 */
export function Rulers({
  canvas,
  snapping,
  onRevealGuides,
}: {
  canvas: FabricCanvas | null;
  snapping: boolean;
  /** Guides are hidden: show them, as one is being made. */
  onRevealGuides: () => void;
}) {
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<"x" | "y" | null>(null);

  useEffect(() => {
    const top = topRef.current;
    const left = leftRef.current;
    if (!canvas || !top || !left) return;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      paintRuler(top, canvas, "x", pointer?.x ?? null);
      paintRuler(left, canvas, "y", pointer?.y ?? null);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onRendered = ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
      if (ctx === canvas.getContext()) paint();
    };
    const onMove = ({ e }: TPointerEventInfo) => {
      const point = canvas.getViewportPoint(e);
      pointer = { x: point.x, y: point.y };
      later();
    };
    const onOut = () => {
      pointer = null;
      later();
    };
    canvas.on("after:render", onRendered);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:out", onOut);
    const observer = new ResizeObserver(later);
    observer.observe(top);
    observer.observe(left);
    paint();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.off("after:render", onRendered);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:out", onOut);
    };
  }, [canvas]);

  const begin = (axis: "x" | "y") => (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canvas || !documentGrid(canvas) || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = axis;
    onRevealGuides();
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const axis = dragRef.current;
    if (!canvas || !axis) return;
    const scene = canvas.getScenePoint(event.nativeEvent as unknown as TPointerEvent);
    const position = placeGuide(canvas, axis, axis === "x" ? scene.x : scene.y, snapping && !event.altKey, SNAP_DISTANCE / canvas.getZoom());
    setGuideDraft(canvas, { guide: { axis, position } });
  };
  const end = (event: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const axis = dragRef.current;
    dragRef.current = null;
    if (!canvas || !axis) return;
    const draft = guideDraft(canvas);
    setGuideDraft(canvas, null);
    if (cancelled || !draft) return;
    // Dropped on the canvas, past the ruler it came from.
    const box = canvas.upperCanvasEl.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const inside = x <= box.width && y <= box.height && (axis === "x" ? x > RULER_SIZE && y >= 0 : y > RULER_SIZE && x >= 0);
    if (inside) setGuides(canvas, [...guidesOf(canvas), draft.guide]);
  };

  const rulerClass = "absolute z-[4] touch-none bg-background/95 text-muted-foreground";
  return (
    <>
      <div aria-hidden="true" className="absolute left-0 top-0 z-[5] h-5 w-5 border-b border-r border-border bg-background" />
      <canvas
        ref={topRef}
        data-testid="ruler-horizontal"
        aria-label="Horizontal ruler: drag down for a guide"
        className={`${rulerClass} left-5 right-0 top-0 h-5 cursor-row-resize border-b border-border`}
        style={{ width: "calc(100% - 20px)" }}
        onPointerDown={begin("y")}
        onPointerMove={move}
        onPointerUp={(event) => end(event, false)}
        onPointerCancel={(event) => end(event, true)}
      />
      <canvas
        ref={leftRef}
        data-testid="ruler-vertical"
        aria-label="Vertical ruler: drag right for a guide"
        className={`${rulerClass} bottom-0 left-0 top-5 w-5 cursor-col-resize border-r border-border`}
        style={{ height: "calc(100% - 20px)" }}
        onPointerDown={begin("x")}
        onPointerMove={move}
        onPointerUp={(event) => end(event, false)}
        onPointerCancel={(event) => end(event, true)}
      />
    </>
  );
}
