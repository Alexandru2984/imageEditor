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

/**
 * Whether two grids cover the same pixels. Saved documents round positions
 * and scales (undo reloads one), so grids match when every corner lands
 * within a twentieth of a pixel of where it was.
 */
export const sameGrid = (a: DocumentGrid, b: DocumentGrid): boolean => {
  if (a.width !== b.width || a.height !== b.height) return false;
  const tolerance = 0.05 / Math.max(a.scale, b.scale);
  const corners = (grid: DocumentGrid) => [
    grid.left,
    grid.top,
    grid.left + grid.width / grid.scale,
    grid.top + grid.height / grid.scale,
  ];
  const first = corners(a);
  const second = corners(b);
  return first.every((value, index) => Math.abs(value - second[index]!) <= tolerance);
};

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
 * shape being drawn. Each change of the selection is a step in the undo
 * history, named by what made it (useUndoRedo.ts keeps it); it is dropped
 * once it no longer fits the document (after a crop, say).
 */
export class SelectionStore {
  private selection: PixelSelection | null = null;
  private last: PixelSelection | null = null;
  private shownPreview: SelectionPreview | null = null;
  private currentDraft: SelectionDraft | null = null;
  private revision = 0;
  private lastLabel = "Deselect";
  private quick = false;
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly canvas: FabricCanvas) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called when the selection itself changes, not the shape being drawn. */
  onChange = (listener: () => void): (() => void) => {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  };

  /** What made the last change, as the History panel names it ("Lasso", "Deselect"). */
  get label(): string {
    return this.lastLabel;
  }

  /** Quick Mask mode (Q): the selection is shown in red and painted on (quickMask.ts). */
  get quickMask(): boolean {
    return this.quick;
  }

  setQuickMask(on: boolean): void {
    if (on === this.quick) return;
    this.quick = on;
    this.notify();
  }

  /** Changes whenever the selection, the preview or the mode does. */
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
    // Undo and redo reload the document, briefly without a photo; the
    // selection outlives that, as in Photoshop.
    if (!grid) return null;
    if (sameGrid(grid, selection.grid)) return selection;
    this.selection = null;
    this.last = null;
    this.lastLabel = "Deselect";
    this.notify(true);
    return null;
  }

  /**
   * Replace the selection; an empty mask deselects. `label` names the
   * history step (the tool or command that made it).
   */
  set(mask: Mask | null, grid?: DocumentGrid, label?: string): void {
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
    this.lastLabel = label ?? (this.selection ? "Selection" : "Deselect");
    this.notify(true);
  }

  /** Bring back the selection last dropped (Select › Reselect). */
  reselect(): boolean {
    const last = this.last;
    const grid = documentGrid(this.canvas);
    if (!last || !grid || !sameGrid(grid, last.grid)) return false;
    this.set(last.mask, last.grid, "Reselect");
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

  private notify(changed = false) {
    this.revision += 1;
    for (const listener of this.listeners) listener();
    if (changed) for (const listener of this.changeListeners) listener();
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
