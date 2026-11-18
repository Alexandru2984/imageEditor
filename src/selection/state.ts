import type { Canvas as FabricCanvas } from "fabric";
import { findBackgroundImage } from "@/utils/editorObjects";
import { nativeMultiplier, planRasterization } from "@/utils/flatten";
import { Mask, type PixelBounds } from "./mask";

/**
 * The document's pixel grid, which selections are drawn on: the photo's
 * frame at its own resolution (capped like every render).
 */
export interface DocumentGrid {
  /** Scene position of pixel (0, 0)'s top-left corner. */
  left: number;
  top: number;
  /** Pixels per scene unit. */
  scale: number;
  width: number;
  height: number;
}

export interface PixelSelection {
  grid: DocumentGrid;
  mask: Mask;
}

/** A shape being drawn, shown with marching ants before it joins the selection. */
export type SelectionPreview =
  | { kind: "rect" | "ellipse"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "path"; points: { x: number; y: number }[]; closed: boolean }
  /** The selection being dragged by whole pixels. */
  | { kind: "move"; dx: number; dy: number };

/** A shape built step by step (the polygonal lasso), finished or dropped from outside. */
export interface SelectionDraft {
  finish(): void;
  cancel(): void;
}

export function documentGrid(canvas: FabricCanvas): DocumentGrid | null {
  const photo = findBackgroundImage(canvas);
  if (!photo) return null;
  photo.setCoords();
  const bounds = photo.getBoundingRect();
  try {
    const plan = planRasterization(bounds, nativeMultiplier(canvas));
    return {
      left: bounds.left,
      top: bounds.top,
      scale: plan.multiplier,
      width: plan.outputWidth,
      height: plan.outputHeight,
    };
  } catch {
    return null;
  }
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

export const sameGrid = (a: DocumentGrid, b: DocumentGrid): boolean =>
  a.width === b.width &&
  a.height === b.height &&
  near(a.left, b.left) &&
  near(a.top, b.top) &&
  near(a.scale, b.scale);

/** Scene coordinates of a point on the grid, and back. */
export const gridToScene = (grid: DocumentGrid, x: number, y: number) => ({
  x: grid.left + x / grid.scale,
  y: grid.top + y / grid.scale,
});
export const sceneToGrid = (grid: DocumentGrid, x: number, y: number) => ({
  x: (x - grid.left) * grid.scale,
  y: (y - grid.top) * grid.scale,
});

/** The scene area of whole grid pixels. */
export const gridBoxToScene = (grid: DocumentGrid, box: PixelBounds) => ({
  left: grid.left + box.x / grid.scale,
  top: grid.top + box.y / grid.scale,
  width: box.width / grid.scale,
  height: box.height / grid.scale,
});

/**
 * One canvas's pixel selection, plus the last one dropped (Reselect) and the
 * shape being drawn. The selection is not part of the undo history; it is
 * dropped once it no longer fits the document (after a crop, say).
 */
export class SelectionStore {
  private selection: PixelSelection | null = null;
  private last: PixelSelection | null = null;
  private shownPreview: SelectionPreview | null = null;
  private currentDraft: SelectionDraft | null = null;
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly canvas: FabricCanvas) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever the selection or the preview does. */
  get version(): number {
    return this.revision;
  }

  /** The selection as last set, without checking it against the document. */
  peek(): PixelSelection | null {
    return this.selection;
  }

  /** The selection, if it still fits the document. */
  current(): PixelSelection | null {
    const selection = this.selection;
    if (!selection) return null;
    const grid = documentGrid(this.canvas);
    if (grid && sameGrid(grid, selection.grid)) return selection;
    this.selection = null;
    this.last = null;
    this.notify();
    return null;
  }

  /** Replace the selection; an empty mask deselects. */
  set(mask: Mask | null, grid?: DocumentGrid): void {
    const previous = this.selection;
    const onGrid = grid ?? previous?.grid ?? documentGrid(this.canvas);
    if (mask && onGrid && !mask.isEmpty()) {
      if (mask.width !== onGrid.width || mask.height !== onGrid.height) {
        throw new RangeError("The selection does not fit the document");
      }
      this.selection = { grid: onGrid, mask };
    } else {
      this.selection = null;
    }
    if (previous && !this.selection) this.last = previous;
    this.notify();
  }

  /** Bring back the selection last dropped (Select › Reselect). */
  reselect(): boolean {
    const last = this.last;
    const grid = documentGrid(this.canvas);
    if (!last || !grid || !sameGrid(grid, last.grid)) return false;
    this.set(last.mask, last.grid);
    return true;
  }

  canReselect(): boolean {
    return this.last !== null;
  }

  get preview(): SelectionPreview | null {
    return this.shownPreview;
  }

  setPreview(preview: SelectionPreview | null): void {
    if (preview === null && this.shownPreview === null) return;
    this.shownPreview = preview;
    this.notify();
  }

  get draft(): SelectionDraft | null {
    return this.currentDraft;
  }

  setDraft(draft: SelectionDraft | null): void {
    if (draft === this.currentDraft) return;
    this.currentDraft = draft;
    this.notify();
  }

  private notify() {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

const stores = new WeakMap<FabricCanvas, SelectionStore>();

export function selectionOf(canvas: FabricCanvas): SelectionStore {
  let store = stores.get(canvas);
  if (!store) {
    store = new SelectionStore(canvas);
    stores.set(canvas, store);
  }
  return store;
}
