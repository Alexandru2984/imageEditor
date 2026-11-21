import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** Where a dragged layer lands, relative to the row under the pointer. */
export type DropTarget = { id: string; where: "above" | "below" | "inside" } | { trash: true };

/** How far the pointer moves before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** How close to the list's top or bottom edge it scrolls, and how fast. */
const SCROLL_EDGE = 28;
const SCROLL_STEP = 10;

/**
 * The drop target at a point of the screen: on a layer's top or bottom half
 * above or below it; on a group, its top part above it, the middle (and the
 * bottom, while it is open) inside it at the top; the trash button deletes.
 */
export function dropTargetAt(list: HTMLElement, x: number, y: number, dragged: readonly string[]): DropTarget | null {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;
  if (element.closest("[data-layer-drop='trash']")) return { trash: true };
  const row = element.closest<HTMLElement>("[data-layer-id]");
  if (!row || !list.contains(row)) return null;
  const id = row.dataset.layerId!;
  if (dragged.includes(id)) return null;
  const box = row.getBoundingClientRect();
  const ratio = box.height > 0 ? (y - box.top) / box.height : 0.5;
  if (row.dataset.layerKind === "group") {
    if (ratio < 0.3) return { id, where: "above" };
    if (row.dataset.collapsed !== "true" || ratio < 0.7) return { id, where: "inside" };
    return { id, where: "below" };
  }
  return { id, where: ratio < 0.5 ? "above" : "below" };
}

interface DragOptions {
  /** The list holding the rows (inside the panel's scroll area). */
  listRef: RefObject<HTMLElement>;
  enabled: boolean;
  onDrop: (ids: string[], target: DropTarget) => void;
}

/**
 * Drag rows of the Layers panel to restack them. A press turns into a drag
 * once the pointer has moved a few pixels; the click that ends a drag is
 * swallowed, so it does not select the row it ends on.
 */
export function useLayerDrag({ listRef, enabled, onDrop }: DragOptions) {
  const [dragged, setDragged] = useState<readonly string[] | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const swallowClick = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => () => stopRef.current?.(), []);

  const begin = useCallback(
    (event: ReactPointerEvent, ids: readonly string[]) => {
      if (!enabled || event.button !== 0 || ids.length === 0) return;
      stopRef.current?.();
      const pointer = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let current: DropTarget | null = null;
      let lastY = startY;
      let frame = 0;

      // Near the top or bottom edge, the list scrolls while the pointer rests.
      const scroll = () => {
        frame = 0;
        const viewport = listRef.current?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
        if (!dragging || !viewport) return;
        const box = viewport.getBoundingClientRect();
        const step = lastY < box.top + SCROLL_EDGE ? -SCROLL_STEP : lastY > box.bottom - SCROLL_EDGE ? SCROLL_STEP : 0;
        if (step === 0) return;
        viewport.scrollTop += step;
        frame = window.requestAnimationFrame(scroll);
      };

      const move = (moved: PointerEvent) => {
        if (moved.pointerId !== pointer) return;
        if (!dragging) {
          if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD) return;
          dragging = true;
          setDragged(ids);
        }
        moved.preventDefault();
        lastY = moved.clientY;
        const list = listRef.current;
        current = list ? dropTargetAt(list, moved.clientX, moved.clientY, ids) : null;
        setTarget(current);
        if (!frame) frame = window.requestAnimationFrame(scroll);
      };

      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("keydown", escape, true);
        if (frame) window.cancelAnimationFrame(frame);
        stopRef.current = null;
        setDragged(null);
        setTarget(null);
      };

      const end = (ended: PointerEvent) => {
        if (ended.pointerId !== pointer) return;
        const drop = dragging && ended.type === "pointerup" ? current : null;
        if (dragging) {
          swallowClick.current = true;
          window.setTimeout(() => (swallowClick.current = false), 0);
        }
        stop();
        if (drop) onDropRef.current([...ids], drop);
      };

      // Escape calls the drag off.
      const escape = (key: KeyboardEvent) => {
        if (key.key !== "Escape" || !dragging) return;
        key.preventDefault();
        key.stopPropagation();
        swallowClick.current = true;
        window.setTimeout(() => (swallowClick.current = false), 0);
        stop();
      };

      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      window.addEventListener("keydown", escape, true);
      stopRef.current = stop;
    },
    [enabled, listRef]
  );

  /** Whether a click is the end of a drag, and should do nothing. */
  const isDragClick = useCallback(() => swallowClick.current, []);

  return { begin, dragged, target, isDragClick };
}
