import { useEffect } from "react";
import {
  ActiveSelection,
  type Canvas as FabricCanvas,
  type FabricObject,
  type TPointerEvent,
  type Transform,
} from "fabric";
import { findBackgroundImage, isLayerObject } from "@/utils/editorObjects";
import { computeSnap, type Box, type SnapLine } from "@/utils/snapping";

/** Screen pixels within which a layer snaps to a guide. */
const SNAP_DISTANCE = 6;
/** Rotation snaps to multiples of this many degrees… */
const ANGLE_STEP = 45;
/** …when it is within this many degrees of one. */
const ANGLE_THRESHOLD = 4;
const GUIDE_COLOR = "#ec4899";

const toBox = (object: FabricObject): Box => {
  const { left, top, width, height } = object.getBoundingRect();
  return { left, top, width, height };
};

/** Alt, Ctrl or ⌘ held during a drag moves freely, without snapping. */
const snappingSuspended = (event: TPointerEvent | undefined): boolean =>
  !!event && (event.altKey || event.ctrlKey || event.metaKey);

function referenceBoxes(canvas: FabricCanvas, target: FabricObject): Box[] {
  const moving = new Set<FabricObject>([target]);
  if (target instanceof ActiveSelection) {
    for (const child of target.getObjects()) moving.add(child);
  }
  const boxes: Box[] = [];
  const photo = findBackgroundImage(canvas);
  if (photo) boxes.push(toBox(photo));
  for (const object of canvas.getObjects()) {
    if (object === photo || moving.has(object) || !object.visible || !isLayerObject(object)) {
      continue;
    }
    boxes.push(toBox(object));
  }
  return boxes;
}

/**
 * Smart guides: while a layer is dragged it snaps to the photo's edges and
 * centre and to the edges and centres of other layers, with pink guides
 * showing what it lined up with. Rotation snaps to 45° steps. Holding Alt,
 * Ctrl or ⌘ suspends snapping for that drag.
 */
export function useSmartGuides(
  canvas: FabricCanvas | null,
  enabled: boolean,
  /** Lines besides other layers to snap to (guides, the grid). */
  extraLines?: (moving: Box) => { x: number[]; y: number[] }
): void {
  useEffect(() => {
    if (!canvas) return;
    let lines: SnapLine[] = [];
    let rotation: { target: FabricObject; angle: number } | null = null;

    const clear = () => {
      if (lines.length === 0 && !rotation) return;
      lines = [];
      rotation = null;
      canvas.requestRenderAll();
    };

    const handleMoving = ({ target, e }: { target: FabricObject; e: TPointerEvent }) => {
      if (!enabled || snappingSuspended(e)) {
        lines = [];
        return;
      }
      target.setCoords();
      const zoom = canvas.getZoom() || 1;
      const moving = toBox(target);
      const result = computeSnap(moving, referenceBoxes(canvas, target), SNAP_DISTANCE / zoom, extraLines?.(moving));
      if (result.dx !== 0 || result.dy !== 0) {
        target.set({ left: target.left + result.dx, top: target.top + result.dy });
        target.setCoords();
      }
      lines = result.lines;
    };

    const handleBeforeTransform = ({ transform }: { transform: Transform }) => {
      const target = transform.target;
      target.snapAngle = enabled ? ANGLE_STEP : 0;
      target.snapThreshold = ANGLE_THRESHOLD;
    };

    const handleRotating = ({ target, e }: { target: FabricObject; e: TPointerEvent }) => {
      // Fabric reads snapAngle on every pointer move, so modifiers apply live.
      target.snapAngle = enabled && !snappingSuspended(e) ? ANGLE_STEP : 0;
      rotation = { target, angle: target.angle };
    };

    const drawGuides = ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
      // Exports render into detached canvases; guides belong on screen only.
      if (ctx !== canvas.getContext()) return;
      if (lines.length === 0 && !rotation) return;
      const [scaleX, , , scaleY, translateX, translateY] = canvas.viewportTransform;
      const sx = (x: number) => x * scaleX + translateX;
      const sy = (y: number) => y * scaleY + translateY;

      ctx.save();
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of lines) {
        if (line.axis === "x") {
          const x = Math.round(sx(line.position)) + 0.5;
          ctx.moveTo(x, sy(line.from) - 8);
          ctx.lineTo(x, sy(line.to) + 8);
        } else {
          const y = Math.round(sy(line.position)) + 0.5;
          ctx.moveTo(sx(line.from) - 8, y);
          ctx.lineTo(sx(line.to) + 8, y);
        }
      }
      ctx.stroke();

      if (rotation) {
        const bounds = rotation.target.getBoundingRect();
        const label = `${Math.round(rotation.angle) % 360}°`;
        ctx.font = "600 12px 'Inter Variable', system-ui, sans-serif";
        const width = ctx.measureText(label).width + 14;
        const x = sx(bounds.left + bounds.width / 2) - width / 2;
        const y = Math.max(4, sy(bounds.top) - 34);
        ctx.fillStyle = "rgba(17, 17, 24, 0.85)";
        ctx.beginPath();
        ctx.roundRect(x, y, width, 22, 11);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x + 7, y + 11);
      }
      ctx.restore();
    };

    canvas.on("object:moving", handleMoving);
    canvas.on("before:transform", handleBeforeTransform);
    canvas.on("object:rotating", handleRotating);
    canvas.on("mouse:up", clear);
    canvas.on("selection:cleared", clear);
    canvas.on("after:render", drawGuides);
    return () => {
      canvas.off("object:moving", handleMoving);
      canvas.off("before:transform", handleBeforeTransform);
      canvas.off("object:rotating", handleRotating);
      canvas.off("mouse:up", clear);
      canvas.off("selection:cleared", clear);
      canvas.off("after:render", drawGuides);
      lines = [];
      rotation = null;
    };
  }, [canvas, enabled, extraLines]);
}
