import type { Canvas as FabricCanvas } from "fabric";
import { segmentsOf, type DocumentPath, type PathAnchor } from "./pathData";
import { pathViewOf } from "./paths";

const LINE = "#1e6ff0";
const ANCHOR_SIZE = 7;
const HANDLE_RADIUS = 3.5;

type ToDevice = (x: number, y: number) => [number, number];

function tracePath(path: DocumentPath, toDevice: ToDevice): Path2D {
  const shape = new Path2D();
  for (const subpath of path.subpaths) {
    const first = subpath.anchors[0];
    if (!first) continue;
    shape.moveTo(...toDevice(first.x, first.y));
    for (const [from, to] of segmentsOf(subpath)) {
      shape.bezierCurveTo(...toDevice(from.outX, from.outY), ...toDevice(to.inX, to.inY), ...toDevice(to.x, to.y));
    }
    if (subpath.closed) shape.closePath();
  }
  return shape;
}

function drawHandles(context: CanvasRenderingContext2D, anchor: PathAnchor, toDevice: ToDevice, ratio: number) {
  const [x, y] = toDevice(anchor.x, anchor.y);
  for (const [hx, hy] of [toDevice(anchor.inX, anchor.inY), toDevice(anchor.outX, anchor.outY)]) {
    if (Math.hypot(hx - x, hy - y) < 0.5) continue;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(hx, hy);
    context.stroke();
    context.beginPath();
    context.arc(hx, hy, HANDLE_RADIUS * ratio, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

/**
 * Draws the path being shown (the one picked in the Paths panel or being
 * drawn) over the canvas, in device pixels: its curves, and while the Pen
 * or Direct Selection is in use its anchors, the picked anchors' handles
 * and the Pen's next segment.
 */
export function drawPathOverlay(canvas: FabricCanvas, context: CanvasRenderingContext2D, ratio: number): void {
  const view = pathViewOf(canvas);
  const index = view.shown;
  if (index === null) return;
  const path = view.paths()[index];
  if (!path) return;
  const [zoom, , , , panX, panY] = canvas.viewportTransform;
  const toDevice: ToDevice = (x, y) => [(x * zoom + panX) * ratio, (y * zoom + panY) * ratio];

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.lineJoin = "round";
  // A light halo keeps the line visible on dark and light pictures alike.
  const shape = tracePath(path, toDevice);
  context.lineWidth = 3 * ratio;
  context.strokeStyle = "rgba(255, 255, 255, 0.7)";
  context.stroke(shape);
  context.lineWidth = 1.25 * ratio;
  context.strokeStyle = LINE;
  context.stroke(shape);

  if (view.editing) {
    const drawing = view.drawing;
    // The Pen's next segment, from the last anchor to the pointer.
    const hover = view.hover;
    const open = drawing !== null ? path.subpaths[drawing] : undefined;
    const last = open?.anchors.at(-1);
    if (last && hover) {
      context.setLineDash([4 * ratio, 4 * ratio]);
      context.beginPath();
      context.moveTo(...toDevice(last.x, last.y));
      context.bezierCurveTo(...toDevice(last.outX, last.outY), ...toDevice(hover.x, hover.y), ...toDevice(hover.x, hover.y));
      context.stroke();
      context.setLineDash([]);
    }

    context.lineWidth = Math.max(1, ratio);
    context.strokeStyle = LINE;
    context.fillStyle = "#ffffff";
    path.subpaths.forEach((subpath, subpathIndex) => {
      subpath.anchors.forEach((anchor, anchorIndex) => {
        const picked = view.isPicked(subpathIndex, anchorIndex);
        const lastDrawn = subpathIndex === drawing && anchorIndex === subpath.anchors.length - 1;
        if (picked || lastDrawn) drawHandles(context, anchor, toDevice, ratio);
      });
    });
    const size = ANCHOR_SIZE * ratio;
    path.subpaths.forEach((subpath, subpathIndex) => {
      subpath.anchors.forEach((anchor, anchorIndex) => {
        const [x, y] = toDevice(anchor.x, anchor.y);
        const picked = view.isPicked(subpathIndex, anchorIndex);
        context.fillStyle = picked ? LINE : "#ffffff";
        context.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
        context.strokeRect(Math.round(x - size / 2) + 0.5, Math.round(y - size / 2) + 0.5, size - 1, size - 1);
      });
    });
  }
  context.restore();
}
