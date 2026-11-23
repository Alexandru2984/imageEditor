import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { findBackgroundImage } from "@/utils/editorObjects";
import { nameNextStep } from "@/utils/historySteps";
import { isPathList, MAX_PATHS, mapPaths, type DocumentPath, type SceneMatrix } from "./pathData";

/**
 * The document's paths live on the photo, as its guides do, so they are
 * saved with it, come back with it on undo and are carried along when it
 * turns, flips or is cropped. What is picked in them (the path shown, its
 * picked anchors, the subpath the Pen is adding to) is the view's own.
 */
type PathHolder = FabricObject & { paths?: unknown };

export function pathsOf(canvas: FabricCanvas): DocumentPath[] {
  const photo = findBackgroundImage(canvas) as PathHolder | undefined;
  return photo && isPathList(photo.paths) ? photo.paths : [];
}

/** Replace the document's paths as one undo step named `step`. False without a document. */
export function setPaths(canvas: FabricCanvas, paths: readonly DocumentPath[], step: string): boolean {
  const photo = findBackgroundImage(canvas) as PathHolder | undefined;
  if (!photo) return false;
  nameNextStep(canvas, step);
  photo.paths = paths.length ? paths.slice(0, MAX_PATHS) : undefined;
  canvas.fire("object:modified", { target: photo });
  pathViewOf(canvas).changed();
  return true;
}

/** Carry the paths through a change of the whole scene, inside that change's undo step. */
export function transformPaths(canvas: FabricCanvas, matrix: SceneMatrix): void {
  const photo = findBackgroundImage(canvas) as PathHolder | undefined;
  if (photo && isPathList(photo.paths) && photo.paths.length) photo.paths = mapPaths(photo.paths, matrix);
}

/** A picked anchor: subpath and anchor index. */
export interface AnchorRef {
  subpath: number;
  anchor: number;
}

/** What the view shows of the paths and what is picked in them. */
export class PathView {
  /** The path shown and worked on, by index. */
  private shownIndex: number | null = null;
  private picked: AnchorRef[] = [];
  /** The open subpath the Pen adds anchors to. */
  private drawingIndex: number | null = null;
  /** Paths being dragged, shown in place of the saved ones until the drag ends. */
  private livePaths: DocumentPath[] | null = null;
  /** Where the Pen's next segment would go, for its preview. */
  private hoverPoint: { x: number; y: number } | null = null;
  private editingNow = false;
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly canvas: FabricCanvas) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get version(): number {
    return this.revision;
  }

  /** The paths to show: the ones being dragged, else the document's. */
  paths(): DocumentPath[] {
    return this.livePaths ?? pathsOf(this.canvas);
  }

  /** The shown path's index, if it still exists (undo may have taken it away). */
  get shown(): number | null {
    const count = pathsOf(this.canvas).length;
    return this.shownIndex !== null && this.shownIndex < count ? this.shownIndex : null;
  }

  show(index: number | null): void {
    if (index === this.shownIndex) return;
    this.shownIndex = index;
    this.picked = [];
    this.drawingIndex = null;
    this.changed();
  }

  get anchors(): readonly AnchorRef[] {
    const index = this.shown;
    if (index === null) return [];
    const path = this.paths()[index];
    return this.picked.filter((ref) => !!path?.subpaths[ref.subpath]?.anchors[ref.anchor]);
  }

  pick(anchors: AnchorRef[]): void {
    this.picked = anchors;
    this.changed();
  }

  isPicked(subpath: number, anchor: number): boolean {
    return this.picked.some((ref) => ref.subpath === subpath && ref.anchor === anchor);
  }

  /** The open subpath the Pen continues, if it is still there and open. */
  get drawing(): number | null {
    const index = this.shown;
    if (index === null || this.drawingIndex === null) return null;
    const subpath = this.paths()[index]?.subpaths[this.drawingIndex];
    return subpath && !subpath.closed ? this.drawingIndex : null;
  }

  setDrawing(subpath: number | null): void {
    this.drawingIndex = subpath;
    this.changed();
  }

  get live(): DocumentPath[] | null {
    return this.livePaths;
  }

  setLive(paths: DocumentPath[] | null): void {
    this.livePaths = paths;
    this.changed();
  }

  get hover(): { x: number; y: number } | null {
    return this.hoverPoint;
  }

  setHover(point: { x: number; y: number } | null): void {
    if (point === null && this.hoverPoint === null) return;
    this.hoverPoint = point;
    this.changed();
  }

  /** The Pen or Direct Selection is in use: anchors and handles are shown. */
  get editing(): boolean {
    return this.editingNow;
  }

  setEditing(on: boolean): void {
    if (on === this.editingNow) return;
    this.editingNow = on;
    this.changed();
  }

  changed(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

const views = new WeakMap<FabricCanvas, PathView>();

export function pathViewOf(canvas: FabricCanvas): PathView {
  let view = views.get(canvas);
  if (!view) {
    view = new PathView(canvas);
    views.set(canvas, view);
  }
  return view;
}
