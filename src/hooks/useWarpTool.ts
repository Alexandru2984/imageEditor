import { useEffect, useRef, type MutableRefObject } from "react";
import { forgetStepName, nameNextStep } from "@/utils/historySteps";
import type { Canvas as FabricCanvas, FabricImage, TPointerEventInfo } from "fabric";
import { toast } from "sonner";
import type { Tool } from "@/types/editor";
import { shownRect } from "@/raster/documentSize";
import { releaseSurface } from "@/raster/pixelLayer";
import { isConvex, mapPoint, perspectiveDrag, rectToQuad, type Corner, type Quad } from "@/raster/warp";
import { applyWarp, layerQuad, warpTarget, type WarpMode } from "@/raster/warpLayer";

/** What the options bar's buttons do while a layer is being distorted. */
export interface WarpControls {
  apply: () => void;
  cancel: () => void;
}

/** The preview is drawn from a copy at most this many pixels across. */
const PREVIEW_SIDE = 1024;
/** The preview's mesh: this many cells a side, two triangles each. */
const MESH = 12;
/** How near (in screen pixels) a press must be to grab a corner. */
const GRAB = 14;
const GRAB_TOUCH = 24;

interface Options {
  canvasRef: MutableRefObject<FabricCanvas | null>;
  canvasKey: unknown;
  activeTool: Tool;
  mode: WarpMode;
  onToolChange: (tool: Tool) => void;
  controlsRef: MutableRefObject<WarpControls | null>;
  spaceDownRef: MutableRefObject<boolean>;
}

type Renderable = FabricImage & { render: (ctx: CanvasRenderingContext2D) => void };

/** Draw `source` so its triangle (s0, s1, s2) lands on (d0, d1, d2). */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  s: [Corner, Corner, Corner],
  d: [Corner, Corner, Corner],
  grow: number
) {
  const [s0, s1, s2] = s;
  const [d0, d1, d2] = d;
  const determinant = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (!determinant || d.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / determinant;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / determinant;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / determinant;
  const dd = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / determinant;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - dd * s0.y;
  // Each triangle reaches a little past its edges so no seams show.
  const cx = (d0.x + d1.x + d2.x) / 3;
  const cy = (d0.y + d1.y + d2.y) / 3;
  const out = (point: Corner) => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / length) * grow, y: point.y + (dy / length) * grow };
  };
  const [p0, p1, p2] = [out(d0), out(d1), out(d2)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

/**
 * Distort and Perspective: the selected image layer shows on its new shape
 * as its corners are dragged (or the whole shape is), and Enter (or Apply)
 * resamples it onto that shape; Escape (or Cancel, or another tool) leaves it.
 */
export function useWarpTool({ canvasRef, canvasKey, activeTool, mode, onToolChange, controlsRef, spaceDownRef }: Options) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const toolChangeRef = useRef(onToolChange);
  toolChangeRef.current = onToolChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeTool !== "warp") return;
    const target = warpTarget(canvas);
    if (typeof target === "string") {
      toast.error(target);
      toolChangeRef.current("select");
      return;
    }
    const image = target as Renderable;

    // A small copy of what the layer shows, for the preview.
    const from = shownRect(image);
    const previewScale = Math.min(1, PREVIEW_SIDE / Math.max(from.width, from.height));
    const preview = document.createElement("canvas");
    preview.width = Math.max(1, Math.round(from.width * previewScale));
    preview.height = Math.max(1, Math.round(from.height * previewScale));
    preview.getContext("2d")?.drawImage(image.getElement(), from.x, from.y, from.width, from.height, 0, 0, preview.width, preview.height);

    const original = layerQuad(image);
    let quad: Quad = original;
    let drag: { index: number | "all"; start: Quad; from: Corner } | null = null;
    let busy = false;
    let finished = false;

    // The layer draws on its new shape, in its place among the layers.
    const ownRender = Object.getOwnPropertyDescriptor(image, "render");
    image.render = (ctx: CanvasRenderingContext2D) => {
      if (!image.visible) return;
      const toScene = rectToQuad(preview.width, preview.height, quad);
      const grow = 0.75 / canvas.getZoom();
      ctx.save();
      ctx.globalAlpha *= image.opacity;
      ctx.globalCompositeOperation = image.globalCompositeOperation;
      const at = (i: number, j: number) => {
        const source = { x: (i * preview.width) / MESH, y: (j * preview.height) / MESH };
        return { source, scene: mapPoint(toScene, source.x, source.y) };
      };
      for (let j = 0; j < MESH; j += 1) {
        for (let i = 0; i < MESH; i += 1) {
          const p00 = at(i, j);
          const p10 = at(i + 1, j);
          const p11 = at(i + 1, j + 1);
          const p01 = at(i, j + 1);
          drawTriangle(ctx, preview, [p00.source, p10.source, p11.source], [p00.scene, p10.scene, p11.scene], grow);
          drawTriangle(ctx, preview, [p00.source, p11.source, p01.source], [p00.scene, p11.scene, p01.scene], grow);
        }
      }
      ctx.restore();
    };

    const previous = {
      selection: canvas.selection,
      skipTargetFind: canvas.skipTargetFind,
      defaultCursor: canvas.defaultCursor,
    };
    canvas.discardActiveObject();
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.defaultCursor = "default";

    const toView = (point: Corner) => {
      const t = canvas.viewportTransform;
      return { x: t[0] * point.x + t[2] * point.y + t[4], y: t[1] * point.x + t[3] * point.y + t[5] };
    };

    const drawHandles = () => {
      const top = canvas.contextTop;
      canvas.clearContext(top);
      if (finished) return;
      const ratio = canvas.getRetinaScaling();
      const points = quad.map(toView);
      top.save();
      top.setTransform(ratio, 0, 0, ratio, 0, 0);
      top.beginPath();
      points.forEach((point, index) => (index === 0 ? top.moveTo(point.x, point.y) : top.lineTo(point.x, point.y)));
      top.closePath();
      const bad = !isConvex(quad);
      for (const [width, style] of [
        [3, "rgba(255,255,255,0.9)"],
        [1.5, bad ? "#ef4444" : "#7c3aed"],
      ] as const) {
        top.lineWidth = width;
        top.strokeStyle = style;
        top.stroke();
      }
      for (const point of points) {
        top.fillStyle = "#ffffff";
        top.strokeStyle = "#7c3aed";
        top.lineWidth = 1.5;
        top.fillRect(point.x - 5, point.y - 5, 10, 10);
        top.strokeRect(point.x - 5, point.y - 5, 10, 10);
      }
      top.restore();
    };
    const onRendered = ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
      if (ctx === canvas.getContext()) drawHandles();
    };

    const inside = (point: Corner) => {
      // Same side of every edge.
      let sign = 0;
      for (let index = 0; index < 4; index += 1) {
        const a = quad[index]!;
        const b = quad[(index + 1) % 4]!;
        const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        if (cross === 0) continue;
        if (sign === 0) sign = Math.sign(cross);
        else if (Math.sign(cross) !== sign) return false;
      }
      return true;
    };

    const onDown = (event: TPointerEventInfo) => {
      if (busy || spaceDownRef.current) return;
      const scene = canvas.getScenePoint(event.e);
      const view = toView(scene);
      const reach = "pointerType" in event.e && event.e.pointerType === "touch" ? GRAB_TOUCH : GRAB;
      let nearest = -1;
      let distance = reach;
      quad.forEach((corner, index) => {
        const point = toView(corner);
        const away = Math.hypot(point.x - view.x, point.y - view.y);
        if (away <= distance) {
          distance = away;
          nearest = index;
        }
      });
      if (nearest >= 0) drag = { index: nearest, start: quad, from: scene };
      else if (inside(scene)) drag = { index: "all", start: quad, from: scene };
    };
    const onMove = (event: TPointerEventInfo) => {
      if (!drag) return;
      const scene = canvas.getScenePoint(event.e);
      const dx = scene.x - drag.from.x;
      const dy = scene.y - drag.from.y;
      const { index, start } = drag;
      if (index === "all") {
        quad = start.map((corner) => ({ x: corner.x + dx, y: corner.y + dy })) as unknown as Quad;
      } else if (modeRef.current === "perspective") {
        quad = perspectiveDrag(start, index, dx, dy);
      } else {
        quad = start.map((corner, at) => (at === index ? { x: corner.x + dx, y: corner.y + dy } : corner)) as unknown as Quad;
      }
      canvas.requestRenderAll();
    };
    const onUp = () => {
      drag = null;
    };

    const restore = () => {
      if (ownRender) Object.defineProperty(image, "render", ownRender);
      else delete (image as Partial<Renderable>).render;
      releaseSurface(preview);
    };
    const finish = (select: boolean) => {
      if (finished) return;
      finished = true;
      restore();
      if (select && canvas.getObjects().includes(image)) canvas.setActiveObject(image);
      canvas.requestRenderAll();
      toolChangeRef.current("select");
    };
    const apply = () => {
      if (busy || finished) return;
      busy = true;
      nameNextStep(canvas, modeRef.current === "perspective" ? "Perspective" : "Distort");
      applyWarp(canvas, image, quad)
        .then((result) => {
          if (typeof result === "string") {
            forgetStepName(canvas);
            toast.error(result);
            return;
          }
          finish(true);
        })
        .catch((error: unknown) => {
          forgetStepName(canvas);
          console.error("Distort failed:", error);
          toast.error("The layer could not be distorted");
        })
        .finally(() => {
          busy = false;
        });
    };
    const cancel = () => {
      if (!busy) finish(true);
    };
    controlsRef.current = { apply, cancel };

    const onKey = (event: KeyboardEvent) => {
      const field = event.target as HTMLElement | null;
      if (field && (field.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName))) return;
      if (event.key === "Enter") apply();
      else if (event.key === "Escape") cancel();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);
    canvas.on("after:render", onRendered);
    window.addEventListener("keydown", onKey, true);
    canvas.requestRenderAll();

    return () => {
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      canvas.off("after:render", onRendered);
      window.removeEventListener("keydown", onKey, true);
      if (controlsRef.current?.apply === apply) controlsRef.current = null;
      if (!finished) {
        finished = true;
        restore();
      }
      canvas.selection = previous.selection;
      canvas.skipTargetFind = previous.skipTargetFind;
      canvas.defaultCursor = previous.defaultCursor;
      if (!canvas.disposed) {
        canvas.clearContext(canvas.contextTop);
        canvas.requestRenderAll();
      }
    };
  }, [activeTool, canvasKey, canvasRef, controlsRef, spaceDownRef]);
}
