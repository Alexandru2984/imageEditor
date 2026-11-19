import { useEffect } from "react";
import type { Canvas as FabricCanvas, TPointerEvent } from "fabric";
import type { Tool } from "@/types/editor";
import type { GridSettings, Guide } from "@/utils/guideData";
import { gridGeometry, guideDraft, guidesOf, placeGuide, setGuideDraft, setGuides } from "@/utils/guides";

export const GUIDE_COLOR = "#00c2ff";
// Indigo: apart from the cyan guides, and seen on grey photos too.
const GRID_MAJOR = "rgba(99, 102, 241, 0.75)";
const GRID_MINOR = "rgba(99, 102, 241, 0.3)";
/** Grid lines closer than this on screen are left out. */
const GRID_MIN_GAP = 6;
/** How near (in screen pixels) a press must be to pick a guide up. */
const GRAB = 4;
const GRAB_TOUCH = 10;
/** Screen pixels within which a dragged guide snaps to a layer's edge. */
const SNAP_DISTANCE = 6;
/** The rulers' thickness: a guide dropped on them goes away. */
export const RULER_SIZE = 20;

interface Options {
  showGuides: boolean;
  showGrid: boolean;
  grid: GridSettings;
  locked: boolean;
  rulers: boolean;
  snapping: boolean;
  activeTool: Tool;
}

/** A guide's place on screen, in the canvas element's pixels. */
const onScreen = (canvas: FabricCanvas, guide: Guide) => {
  const t = canvas.viewportTransform;
  return guide.axis === "x" ? guide.position * t[0] + t[4] : guide.position * t[3] + t[5];
};

/** The guide (by index) within reach of a point on the canvas element, if any. */
function guideAt(canvas: FabricCanvas, x: number, y: number, reach: number): number {
  let nearest = -1;
  let distance = reach;
  guidesOf(canvas).forEach((guide, index) => {
    const away = Math.abs(onScreen(canvas, guide) - (guide.axis === "x" ? x : y));
    if (away <= distance) {
      distance = away;
      nearest = index;
    }
  });
  return nearest;
}

/**
 * The grid and the guides, drawn over the layers on screen only; with the
 * Move tool a guide is dragged to move it, and dropped on a ruler or off the
 * canvas to remove it.
 */
export function useGuides(canvas: FabricCanvas | null, options: Options): void {
  const { showGuides, showGrid, grid, locked, rulers, snapping, activeTool } = options;

  useEffect(() => {
    if (!canvas) return;
    const draw = ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
      // Exports render into detached canvases; guides belong on screen only.
      if (ctx !== canvas.getContext()) return;
      const draft = guideDraft(canvas);
      const guides = showGuides ? guidesOf(canvas) : [];
      const geometry = showGrid ? gridGeometry(canvas, grid) : null;
      if (!draft && guides.length === 0 && !geometry) return;
      const t = canvas.viewportTransform;
      const width = canvas.getWidth();
      const height = canvas.getHeight();
      const crisp = (value: number) => Math.round(value) + 0.5;
      ctx.save();
      ctx.lineWidth = 1;

      if (geometry) {
        const left = geometry.left * t[0] + t[4];
        const top = geometry.top * t[3] + t[5];
        const right = geometry.right * t[0] + t[4];
        const bottom = geometry.bottom * t[3] + t[5];
        const minor = geometry.step * t[0];
        const subdivisions = grid.subdivisions;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.clip();
        for (const major of [false, true]) {
          const gap = major ? minor * subdivisions : minor;
          if (gap < GRID_MIN_GAP || (!major && subdivisions === 1)) continue;
          ctx.beginPath();
          const lines = (start: number, end: number, from: number, to: number, vertical: boolean) => {
            const first = Math.max(0, Math.ceil((from - start) / gap));
            const last = Math.floor((Math.min(end, to) - start) / gap);
            for (let index = first; index <= last; index += 1) {
              if (!major && index % subdivisions === 0) continue;
              const at = crisp(start + index * gap);
              if (vertical) {
                ctx.moveTo(at, Math.max(top, 0));
                ctx.lineTo(at, Math.min(bottom, height));
              } else {
                ctx.moveTo(Math.max(left, 0), at);
                ctx.lineTo(Math.min(right, width), at);
              }
            }
          };
          lines(left, right, 0, width, true);
          lines(top, bottom, 0, height, false);
          ctx.strokeStyle = major ? GRID_MAJOR : GRID_MINOR;
          ctx.stroke();
        }
        ctx.restore();
      }

      const shown = guides.filter((_, index) => index !== draft?.replacing);
      if (draft) shown.push(draft.guide);
      if (shown.length) {
        ctx.beginPath();
        for (const guide of shown) {
          const at = crisp(onScreen(canvas, guide));
          if (guide.axis === "x") {
            ctx.moveTo(at, 0);
            ctx.lineTo(at, height);
          } else {
            ctx.moveTo(0, at);
            ctx.lineTo(width, at);
          }
        }
        ctx.strokeStyle = GUIDE_COLOR;
        ctx.stroke();
      }
      ctx.restore();
    };
    canvas.on("after:render", draw);
    canvas.requestRenderAll();
    return () => {
      canvas.off("after:render", draw);
      canvas.requestRenderAll();
    };
  }, [canvas, showGuides, showGrid, grid]);

  // Moving guides, with the Move tool.
  useEffect(() => {
    if (!canvas || activeTool !== "select" || !showGuides || locked) return;
    const wrapper = canvas.wrapperEl;
    const upper = canvas.upperCanvasEl;
    let drag: { index: number; guide: Guide } | null = null;
    // Fabric listens for mouse and touch events: those of a guide's drag are its own.
    let swallowing = false;
    let spaceDown = false;

    const local = (event: { clientX: number; clientY: number }) => {
      const box = upper.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top, box };
    };

    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      const scene = canvas.getScenePoint(event as unknown as TPointerEvent);
      const axis = drag.guide.axis;
      const position = placeGuide(canvas, axis, axis === "x" ? scene.x : scene.y, snapping && !event.altKey, SNAP_DISTANCE / canvas.getZoom());
      setGuideDraft(canvas, { guide: { axis, position }, replacing: drag.index });
    };
    const finish = (event: PointerEvent | null) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      const moved = drag;
      const draft = guideDraft(canvas);
      drag = null;
      setGuideDraft(canvas, null);
      // The mouse and touch events of this press come after its pointer events.
      setTimeout(() => {
        swallowing = false;
      }, 0);
      if (!moved || !event) return;
      const { x, y, box } = local(event);
      const gone = x < 0 || y < 0 || x > box.width || y > box.height || (rulers && (x < RULER_SIZE || y < RULER_SIZE));
      const guides = guidesOf(canvas).slice();
      if (gone) guides.splice(moved.index, 1);
      else if (draft && draft.guide.position !== moved.guide.position) guides[moved.index] = draft.guide;
      else return;
      setGuides(canvas, guides);
    };
    const onUp = (event: PointerEvent) => finish(event);
    const onCancel = () => finish(null);

    const onDown = (event: PointerEvent) => {
      if (drag || spaceDown || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      const { x, y } = local(event);
      const index = guideAt(canvas, x, y, event.pointerType === "touch" ? GRAB_TOUCH : GRAB);
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      swallowing = true;
      drag = { index, guide: guidesOf(canvas)[index]! };
      setGuideDraft(canvas, { guide: drag.guide, replacing: index });
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };
    const swallow = (event: Event) => {
      if (!swallowing) return;
      event.stopPropagation();
      if (event.type === "touchstart") event.preventDefault();
    };
    // After Fabric has set its cursor for the move.
    const onHover = (event: MouseEvent) => {
      if (event.buttons || drag || spaceDown) return;
      const { x, y } = local(event);
      const index = guideAt(canvas, x, y, GRAB);
      if (index >= 0) upper.style.cursor = guidesOf(canvas)[index]!.axis === "x" ? "ew-resize" : "ns-resize";
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === " ") spaceDown = event.type === "keydown";
    };

    wrapper.addEventListener("pointerdown", onDown, { capture: true });
    wrapper.addEventListener("mousedown", swallow, { capture: true });
    wrapper.addEventListener("touchstart", swallow, { capture: true, passive: false });
    wrapper.addEventListener("mousemove", onHover);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      wrapper.removeEventListener("pointerdown", onDown, { capture: true });
      wrapper.removeEventListener("mousedown", swallow, { capture: true });
      wrapper.removeEventListener("touchstart", swallow, { capture: true });
      wrapper.removeEventListener("mousemove", onHover);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      if (drag) finish(null);
    };
  }, [canvas, activeTool, showGuides, locked, rulers, snapping]);
}
