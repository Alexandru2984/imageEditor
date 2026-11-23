import type { Canvas as FabricCanvas } from "fabric";
import type { Mask } from "./mask";
import { outlineSegments } from "./outline";
import { QUICK_MASK_OPACITY, quickMaskTint } from "./quickMask";
import { drawPathOverlay } from "@/paths/pathOverlay";
import { pathViewOf } from "@/paths/paths";
import { selectionOf, type DocumentGrid, type SelectionPreview } from "./state";

/** Ants march one step this often (milliseconds). */
const STEP_MS = 90;
const DASH = 4;
/** Outlines longer than this are drawn still; animating them costs too much. */
const MAX_ANIMATED_SEGMENTS = 60_000;

type Transform = readonly [number, number, number, number];

const outlines = new WeakMap<Mask, Float32Array | null>();

function outlineOf(mask: Mask): Float32Array | null {
  if (!outlines.has(mask)) outlines.set(mask, outlineSegments(mask));
  return outlines.get(mask)!;
}

/**
 * Draws the selection's marching ants (or, in Quick Mask mode, red over what
 * is not selected), and the shape being drawn, on a canvas laid over the
 * Fabric canvas. It takes no pointer input and is never
 * part of an export.
 */
export function installSelectionOverlay(canvas: FabricCanvas, element: HTMLCanvasElement): () => void {
  const store = selectionOf(canvas);
  const context = element.getContext("2d");
  if (!context) return () => {};

  let frame: number | null = null;
  let phase = 0;
  /** The selection's outline in device pixels, rebuilt when the view changes. */
  let cached: { mask: Mask; key: string; path: Path2D; segments: number } | null = null;

  const deviceTransform = (grid: DocumentGrid, ratio: number): Transform => {
    const [zoom, , , , panX, panY] = canvas.viewportTransform;
    // Grid pixel → scene → screen → device pixel.
    const scale = (zoom / grid.scale) * ratio;
    return [scale, (grid.left * zoom + panX) * ratio, (grid.top * zoom + panY) * ratio, ratio];
  };

  const outlinePath = (mask: Mask, grid: DocumentGrid, ratio: number) => {
    const transform = deviceTransform(grid, ratio);
    const key = transform.join(",");
    if (cached && cached.mask === mask && cached.key === key) return cached;
    const segments = outlineOf(mask);
    if (!segments) return null;
    const [scale, offsetX, offsetY] = transform;
    // Whole device pixels plus a half, so 1px lines stay crisp.
    const snap = (value: number) => Math.round(value) + 0.5;
    const path = new Path2D();
    for (let index = 0; index < segments.length; index += 4) {
      path.moveTo(snap(segments[index]! * scale + offsetX), snap(segments[index + 1]! * scale + offsetY));
      path.lineTo(snap(segments[index + 2]! * scale + offsetX), snap(segments[index + 3]! * scale + offsetY));
    }
    cached = { mask, key, path, segments: segments.length / 4 };
    return cached;
  };

  const previewPath = (preview: SelectionPreview, ratio: number): Path2D | null => {
    const [zoom, , , , panX, panY] = canvas.viewportTransform;
    const toDevice = (x: number, y: number) => [(x * zoom + panX) * ratio, (y * zoom + panY) * ratio] as const;
    const path = new Path2D();
    if (preview.kind === "rect") {
      const [x0, y0] = toDevice(preview.x0, preview.y0);
      const [x1, y1] = toDevice(preview.x1, preview.y1);
      path.rect(Math.round(Math.min(x0, x1)) + 0.5, Math.round(Math.min(y0, y1)) + 0.5, Math.round(Math.abs(x1 - x0)), Math.round(Math.abs(y1 - y0)));
    } else if (preview.kind === "ellipse") {
      const [x0, y0] = toDevice(preview.x0, preview.y0);
      const [x1, y1] = toDevice(preview.x1, preview.y1);
      path.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
    } else if (preview.kind === "path") {
      preview.points.forEach((point, index) => {
        const [x, y] = toDevice(point.x, point.y);
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      if (preview.closed) path.closePath();
    } else {
      return null;
    }
    return path;
  };

  const ants = (path: Path2D, ratio: number) => {
    context.lineWidth = Math.max(1, Math.round(ratio));
    context.setLineDash([]);
    context.strokeStyle = "#ffffff";
    context.stroke(path);
    context.setLineDash([DASH * ratio, DASH * ratio]);
    context.lineDashOffset = -phase * ratio;
    context.strokeStyle = "#000000";
    context.stroke(path);
  };

  /** Whether anything is moving, so the next frame is worth drawing. */
  const draw = (): boolean => {
    if (canvas.disposed) return false;
    const ratio = canvas.getRetinaScaling();
    const width = Math.round(canvas.width * ratio);
    const height = Math.round(canvas.height * ratio);
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
      element.style.width = `${canvas.width}px`;
      element.style.height = `${canvas.height}px`;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);

    const selection = store.peek();
    const preview = store.preview;
    let animate = false;
    const quick = store.quickMask ? quickMaskTint(canvas) : null;
    if (quick) {
      const [scale, offsetX, offsetY] = deviceTransform(quick.grid, ratio);
      context.save();
      context.globalAlpha = QUICK_MASK_OPACITY;
      context.imageSmoothingEnabled = scale < 1;
      context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      context.drawImage(quick.tint, 0, 0);
      context.restore();
    } else if (selection) {
      const outline = outlinePath(selection.mask, selection.grid, ratio);
      if (outline) {
        context.save();
        if (preview?.kind === "move") {
          const [scale] = deviceTransform(selection.grid, ratio);
          context.translate(Math.round(preview.dx * scale), Math.round(preview.dy * scale));
        }
        ants(outline.path, ratio);
        context.restore();
        animate = outline.segments <= MAX_ANIMATED_SEGMENTS;
      }
    }
    const shape = preview ? previewPath(preview, ratio) : null;
    if (shape) {
      ants(shape, ratio);
      animate = true;
    }
    drawPathOverlay(canvas, context, ratio);
    return animate;
  };

  let lastStep = 0;
  const tick = (time: number) => {
    frame = null;
    if (time - lastStep >= STEP_MS) {
      lastStep = time;
      phase = (phase + 1) % (DASH * 2);
      if (!draw()) return;
    }
    frame = requestAnimationFrame(tick);
  };

  const refresh = () => {
    if (draw() && frame === null) frame = requestAnimationFrame(tick);
  };

  // Redraw with the view (zoom, pan, resize); drop a selection the document
  // no longer fits (a crop, a new photo).
  const onRender = () => {
    if (store.peek()) store.current();
    refresh();
  };

  const unsubscribe = store.subscribe(refresh);
  const unsubscribePaths = pathViewOf(canvas).subscribe(refresh);
  canvas.on("after:render", onRender);
  refresh();

  return () => {
    unsubscribe();
    unsubscribePaths();
    canvas.off("after:render", onRender);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    cached = null;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, element.width, element.height);
  };
}
