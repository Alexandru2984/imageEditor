import { useEffect, type MutableRefObject } from "react";
import type { Canvas as FabricCanvas, TPointerEventInfo } from "fabric";
import { toast } from "sonner";
import {
  cornerAt,
  flattenSubpath,
  moveHandle,
  smoothAt,
  translateAnchor,
  WORK_PATH,
  type DocumentPath,
  type PathAnchor,
  type Point,
} from "@/paths/pathData";
import { pathsOf, pathViewOf, setPaths, type AnchorRef } from "@/paths/paths";
import { constrainAngle } from "@/raster/gradient";
import { documentGrid } from "@/selection/state";
import type { Tool } from "@/types/editor";

interface UsePenToolOptions {
  canvasRef: MutableRefObject<FabricCanvas | null>;
  canvasKey: unknown;
  activeTool: Tool;
  spaceDownRef: MutableRefObject<boolean>;
}

type PointerInfo = TPointerEventInfo<MouseEvent | TouchEvent | PointerEvent>;

/** How near (screen pixels) a press must be to an anchor, handle or curve to take it. */
const HIT = 7;
/** Below this many screen pixels a press is a click, not a drag. */
const DRAG = 3;

type Drag =
  /** The Pen placing an anchor; dragging pulls out its handles. */
  | { kind: "place"; start: Point; base: DocumentPath[]; path: number; subpath: number; anchor: number; dragged: boolean; step: string }
  /** Direct Selection moving the picked anchors. */
  | { kind: "move"; start: Point; base: DocumentPath[]; path: number; refs: AnchorRef[]; dragged: boolean }
  /** Moving one handle; Alt breaks a smooth anchor into a corner. */
  | { kind: "handle"; base: DocumentPath[]; path: number; ref: AnchorRef; which: "in" | "out"; breakSmooth: boolean }
  /** Alt on an anchor (Convert Point): a click makes a corner, a drag pulls out new handles. */
  | { kind: "convert"; start: Point; base: DocumentPath[]; path: number; ref: AnchorRef; dragged: boolean };

const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
};

const clonePaths = (paths: readonly DocumentPath[]): DocumentPath[] => structuredClone(paths) as DocumentPath[];

const anchorAt = (paths: DocumentPath[], path: number, ref: AnchorRef): PathAnchor | undefined =>
  paths[path]?.subpaths[ref.subpath]?.anchors[ref.anchor];

function setAnchor(paths: DocumentPath[], path: number, ref: AnchorRef, anchor: PathAnchor) {
  const subpath = paths[path]?.subpaths[ref.subpath];
  if (subpath) subpath.anchors[ref.anchor] = anchor;
}

/**
 * The Pen (P) and Direct Selection (A), as in Photoshop. The Pen clicks
 * corners and drags out curves, closes a subpath on its first anchor and
 * ends it with Enter or Escape; Alt on an anchor converts it. Direct
 * Selection picks anchors (Shift adds), drags them, their handles (Alt
 * breaks a smooth anchor) or a curve, nudges them with the arrow keys and
 * deletes them. Each change is a step in the history.
 */
export function usePenTool({ canvasRef, canvasKey, activeTool, spaceDownRef }: UsePenToolOptions): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (activeTool !== "pen" && activeTool !== "directSelect")) return;
    const pen = activeTool === "pen";
    const view = pathViewOf(canvas);

    const previous = {
      selection: canvas.selection,
      skipTargetFind: canvas.skipTargetFind,
      defaultCursor: canvas.defaultCursor,
      drawControls: Object.prototype.hasOwnProperty.call(canvas, "drawControls"),
    };
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.defaultCursor = pen ? "crosshair" : "default";
    (canvas as unknown as { drawControls: () => void }).drawControls = () => {};
    view.setEditing(true);
    canvas.requestRenderAll();

    let drag: Drag | null = null;
    const zoom = () => canvas.getZoom() || 1;
    const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) * zoom() <= HIT;

    /** The anchor of path `index` under a point, the last one drawn first. */
    const anchorHit = (paths: DocumentPath[], index: number, point: Point): AnchorRef | null => {
      const subpaths = paths[index]?.subpaths ?? [];
      for (let s = subpaths.length - 1; s >= 0; s -= 1) {
        const anchors = subpaths[s]!.anchors;
        for (let a = anchors.length - 1; a >= 0; a -= 1) if (near(anchors[a]!, point)) return { subpath: s, anchor: a };
      }
      return null;
    };
    /** A handle of a picked anchor under a point. */
    const handleHit = (paths: DocumentPath[], index: number, point: Point) => {
      for (const ref of view.anchors) {
        const anchor = anchorAt(paths, index, ref);
        if (!anchor) continue;
        for (const which of ["out", "in"] as const) {
          const handle = which === "out" ? { x: anchor.outX, y: anchor.outY } : { x: anchor.inX, y: anchor.inY };
          if ((handle.x !== anchor.x || handle.y !== anchor.y) && near(handle, point)) return { ref, which };
        }
      }
      return null;
    };
    /** The curve of path `index` under a point: the two anchors it joins. */
    const segmentHit = (paths: DocumentPath[], index: number, point: Point): AnchorRef[] | null => {
      const subpaths = paths[index]?.subpaths ?? [];
      const reach = HIT / zoom();
      for (let s = 0; s < subpaths.length; s += 1) {
        const subpath = subpaths[s]!;
        const count = subpath.anchors.length;
        const segments = subpath.closed ? count : count - 1;
        for (let k = 0; k < segments; k += 1) {
          const next = (k + 1) % count;
          const line = flattenSubpath({ closed: false, anchors: [subpath.anchors[k]!, subpath.anchors[next]!] }, 0.5 / zoom());
          for (let p = 0; p + 1 < line.length; p += 1) {
            if (distanceToSegment(point, line[p]!, line[p + 1]!) <= reach) return [{ subpath: s, anchor: k }, { subpath: s, anchor: next }];
          }
        }
      }
      return null;
    };

    /** The path the Pen draws into: the one shown, or the Work Path (made, or emptied as Photoshop does). */
    const penTarget = (paths: DocumentPath[]): number => {
      const shown = view.shown;
      if (shown !== null && paths[shown]) return shown;
      const work = paths.findIndex((path) => path.name === WORK_PATH);
      const fresh: DocumentPath = { name: WORK_PATH, subpaths: [] };
      if (work >= 0) {
        paths[work] = fresh;
        return work;
      }
      paths.push(fresh);
      return paths.length - 1;
    };

    const commit = (paths: DocumentPath[], step: string) => {
      view.setLive(null);
      setPaths(canvas, paths, step);
    };

    const penDown = (point: Point, event: MouseEvent | TouchEvent | PointerEvent) => {
      if (!documentGrid(canvas)) {
        toast.error("Open a photo before drawing a path");
        return;
      }
      const base = clonePaths(pathsOf(canvas));
      const index = penTarget(base);
      if (view.shown !== index) view.show(index);
      const path = base[index]!;
      // Alt on an anchor: Convert Point.
      const hitAnchor = anchorHit(base, index, point);
      if (event.altKey && hitAnchor) {
        drag = { kind: "convert", start: point, base, path: index, ref: hitAnchor, dragged: false };
        return;
      }
      let drawing = view.drawing;
      if (drawing !== null) {
        const subpath = path.subpaths[drawing]!;
        const first = subpath.anchors[0]!;
        if (subpath.anchors.length >= 2 && near(first, point)) {
          subpath.closed = true;
          view.setDrawing(null);
          view.setLive(base);
          drag = { kind: "place", start: { x: first.x, y: first.y }, base, path: index, subpath: drawing, anchor: 0, dragged: false, step: "Close path" };
          return;
        }
        const last = subpath.anchors.at(-1)!;
        const at = event.shiftKey ? constrainAngle(last, point) : point;
        subpath.anchors.push(cornerAt(at));
        view.setLive(base);
        drag = { kind: "place", start: at, base, path: index, subpath: drawing, anchor: subpath.anchors.length - 1, dragged: false, step: "Pen" };
        return;
      }
      // An end of an open subpath carries on from there.
      if (hitAnchor) {
        const subpath = path.subpaths[hitAnchor.subpath]!;
        const atEnd = !subpath.closed && (hitAnchor.anchor === 0 || hitAnchor.anchor === subpath.anchors.length - 1);
        if (atEnd) {
          view.setDrawing(hitAnchor.subpath);
          // From its first anchor: the subpath turns round, so new anchors go on its end.
          if (hitAnchor.anchor === 0 && subpath.anchors.length > 1) {
            subpath.anchors = subpath.anchors
              .reverse()
              .map((anchor) => ({ ...anchor, inX: anchor.outX, inY: anchor.outY, outX: anchor.inX, outY: anchor.inY }));
            commit(base, "Pen");
          }
          return;
        }
      }
      path.subpaths.push({ closed: false, anchors: [cornerAt(point)] });
      drawing = path.subpaths.length - 1;
      view.setDrawing(drawing);
      view.setLive(base);
      drag = { kind: "place", start: point, base, path: index, subpath: drawing, anchor: 0, dragged: false, step: "Pen" };
    };

    const directDown = (point: Point, event: MouseEvent | TouchEvent | PointerEvent) => {
      const base = clonePaths(pathsOf(canvas));
      let index = view.shown;
      // A handle of a picked anchor first, as they sit over everything.
      if (index !== null) {
        const handle = handleHit(base, index, point);
        if (handle) {
          drag = { kind: "handle", base, path: index, ref: handle.ref, which: handle.which, breakSmooth: event.altKey };
          return;
        }
      }
      // Then the shown path's anchors and curves, then any other path's.
      const order = index !== null ? [index, ...base.map((_, i) => i).filter((i) => i !== index)] : base.map((_, i) => i);
      for (const candidate of order) {
        const anchor = anchorHit(base, candidate, point);
        const segment = anchor ? null : segmentHit(base, candidate, point);
        if (!anchor && !segment) continue;
        if (candidate !== index) {
          view.show(candidate);
          index = candidate;
        }
        if (anchor && event.altKey) {
          drag = { kind: "convert", start: point, base, path: candidate, ref: anchor, dragged: false };
          return;
        }
        const hits = anchor ? [anchor] : segment!;
        const already = hits.every((ref) => view.isPicked(ref.subpath, ref.anchor));
        let picked: AnchorRef[];
        if (event.shiftKey) {
          picked = already
            ? view.anchors.filter((ref) => !hits.some((hit) => hit.subpath === ref.subpath && hit.anchor === ref.anchor))
            : [...view.anchors, ...hits];
        } else {
          picked = already ? [...view.anchors] : hits;
        }
        view.pick(picked);
        if (picked.length) drag = { kind: "move", start: point, base, path: candidate, refs: picked, dragged: false };
        return;
      }
      // Nothing there: let go of the anchors (the path stays shown).
      if (!event.shiftKey) view.pick([]);
    };

    const onDown = (opt: PointerInfo) => {
      const event = opt.e;
      if (spaceDownRef.current || drag) return;
      if ("button" in event && event.button !== 0) return;
      if ("touches" in event && event.touches.length > 1) return;
      const point = canvas.getScenePoint(event as PointerEvent);
      if (pen) penDown(point, event);
      else directDown(point, event);
    };

    const onMove = (opt: PointerInfo) => {
      const event = opt.e;
      const point = canvas.getScenePoint(event as PointerEvent);
      if (!drag) {
        if (pen) view.setHover(view.drawing !== null ? point : null);
        return;
      }
      if (drag.kind === "place" || drag.kind === "convert") {
        if (!drag.dragged && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * zoom() < DRAG) return;
        drag.dragged = true;
        const paths = clonePaths(drag.base);
        const ref = drag.kind === "place" ? { subpath: drag.subpath, anchor: drag.anchor } : drag.ref;
        const anchor = anchorAt(paths, drag.path, ref);
        if (!anchor) return;
        const out = event.shiftKey ? constrainAngle(anchor, point) : point;
        setAnchor(paths, drag.path, ref, smoothAt(anchor, out));
        view.setLive(paths);
        return;
      }
      if (drag.kind === "handle") {
        const paths = clonePaths(drag.base);
        const anchor = anchorAt(paths, drag.path, drag.ref);
        if (!anchor) return;
        const to = event.shiftKey ? constrainAngle(anchor, point) : point;
        setAnchor(paths, drag.path, drag.ref, moveHandle(anchor, drag.which, to, drag.breakSmooth));
        view.setLive(paths);
        return;
      }
      if (!drag.dragged && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * zoom() < DRAG) return;
      drag.dragged = true;
      const to = event.shiftKey ? constrainAngle(drag.start, point) : point;
      const dx = to.x - drag.start.x;
      const dy = to.y - drag.start.y;
      const paths = clonePaths(drag.base);
      for (const ref of drag.refs) {
        const anchor = anchorAt(paths, drag.path, ref);
        if (anchor) setAnchor(paths, drag.path, ref, translateAnchor(anchor, dx, dy));
      }
      view.setLive(paths);
    };

    const onUp = () => {
      const current = drag;
      drag = null;
      if (!current) return;
      if (current.kind === "place") {
        commit(view.live ?? current.base, current.step);
        return;
      }
      if (current.kind === "convert") {
        if (current.dragged) {
          commit(view.live ?? current.base, "Convert point");
          return;
        }
        // A click: a corner, its handles back on it.
        const anchor = anchorAt(current.base, current.path, current.ref);
        if (anchor) setAnchor(current.base, current.path, current.ref, cornerAt(anchor));
        commit(current.base, "Convert point");
        return;
      }
      if (current.kind === "handle") {
        if (view.live) commit(view.live, "Direct selection");
        return;
      }
      if (current.dragged && view.live) commit(view.live, "Direct selection");
      else view.setLive(null);
    };

    /** Take the picked anchors out; subpaths left with none go. */
    const deletePicked = () => {
      const index = view.shown;
      const refs = view.anchors;
      if (index === null || refs.length === 0) return false;
      const paths = clonePaths(pathsOf(canvas));
      const path = paths[index]!;
      path.subpaths = path.subpaths
        .map((subpath, s) => ({
          ...subpath,
          anchors: subpath.anchors.filter((_, a) => !refs.some((ref) => ref.subpath === s && ref.anchor === a)),
        }))
        .map((subpath) => (subpath.anchors.length < 3 && subpath.closed ? { ...subpath, closed: subpath.anchors.length > 2 } : subpath))
        .filter((subpath) => subpath.anchors.length > 0);
      view.pick([]);
      commit(paths, "Delete anchor point");
      return true;
    };

    const nudge = (dx: number, dy: number) => {
      const index = view.shown;
      const refs = view.anchors;
      const grid = documentGrid(canvas);
      if (index === null || refs.length === 0 || !grid) return false;
      const step = 1 / grid.scale;
      const paths = clonePaths(pathsOf(canvas));
      for (const ref of refs) {
        const anchor = anchorAt(paths, index, ref);
        if (anchor) setAnchor(paths, index, ref, translateAnchor(anchor, dx * step, dy * step));
      }
      commit(paths, "Nudge anchor point");
      return true;
    };

    const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target) || event.ctrlKey || event.metaKey) return;
      if (pen && view.drawing !== null) {
        if (event.key === "Enter" || event.key === "Escape") {
          view.setDrawing(null);
          view.setHover(null);
        } else if (event.key === "Backspace" || event.key === "Delete") {
          // Take back the last anchor.
          const index = view.shown!;
          const paths = clonePaths(pathsOf(canvas));
          const subpaths = paths[index]!.subpaths;
          const drawing = view.drawing;
          subpaths[drawing]!.anchors.pop();
          if (subpaths[drawing]!.anchors.length === 0) {
            subpaths.splice(drawing, 1);
            view.setDrawing(null);
          }
          commit(paths, "Delete anchor point");
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!pen && (event.key === "Backspace" || event.key === "Delete")) {
        if (!deletePicked()) return;
      } else if (!pen && ARROWS[event.key]) {
        const [dx, dy] = ARROWS[event.key]!;
        const amount = event.shiftKey ? 10 : 1;
        if (!nudge(dx * amount, dy * amount)) return;
      } else if (event.key === "Escape" && view.anchors.length) {
        view.pick([]);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      drag = null;
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      window.removeEventListener("keydown", onKeyDown, true);
      view.setLive(null);
      view.setHover(null);
      view.setDrawing(null);
      view.pick([]);
      view.setEditing(false);
      canvas.selection = previous.selection;
      canvas.skipTargetFind = previous.skipTargetFind;
      canvas.defaultCursor = previous.defaultCursor;
      if (!previous.drawControls) delete (canvas as unknown as { drawControls?: unknown }).drawControls;
      if (!canvas.disposed) canvas.requestRenderAll();
    };
  }, [activeTool, canvasKey, canvasRef, spaceDownRef]);
}

/** The distance from p to the segment a–b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
