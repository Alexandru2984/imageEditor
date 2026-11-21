import { arrangeLayers, selectedGroup } from "@/layers/layerGroups";
import { transformGuides } from "./guides";
import { ActiveSelection, FabricImage, Point } from "fabric";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import {
  SNAPSHOT_EXTRA_PROPS,
} from "./canvasSnapshot";
import {
  ensureLayerId,
  findBackgroundImage,
  isBackgroundObject,
  isEditorChrome,
  isObjectLocked,
  isProtectedObject,
  isReadOnlySelection,
  setObjectLocked,
  type EditorFabricObject,
  isLayerObject,
} from "./editorObjects";
import { fitToScreen } from "./viewport";

/** Selected document objects (an ActiveSelection is expanded). */
export function selectedObjects(canvas: FabricCanvas): FabricObject[] {
  const active = canvas.getActiveObject();
  if (!active) return [];
  const objects = active instanceof ActiveSelection ? active.getObjects() : [active];
  return objects.filter((object) => !isEditorChrome(object));
}

const notifyModified = (canvas: FabricCanvas, target?: FabricObject) => {
  canvas.fire("object:modified", target ? { target } : undefined);
  canvas.requestRenderAll();
};

/**
 * Rotate the selection by `degrees`, or the whole document around the photo
 * when nothing is selected so annotations keep their place on it.
 */
export function rotate(canvas: FabricCanvas, degrees: number): "selection" | "canvas" | null {
  const active = canvas.getActiveObject();
  if (active) {
    if (isReadOnlySelection(active)) return null;
    active.rotate((((active.angle || 0) + degrees) % 360 + 360) % 360);
    active.setCoords();
    notifyModified(canvas, active);
    return "selection";
  }

  const objects = canvas.getObjects().filter(isLayerObject);
  if (objects.length === 0) return null;
  const background = findBackgroundImage(canvas);
  const pivot = background
    ? background.getCenterPoint()
    : new Point(canvas.width / 2, canvas.height / 2);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.round(Math.cos(radians) * 1e9) / 1e9;
  const sin = Math.round(Math.sin(radians) * 1e9) / 1e9;
  transformGuides(canvas, [cos, sin, -sin, cos, pivot.x - cos * pivot.x + sin * pivot.y, pivot.y - sin * pivot.x - cos * pivot.y]);
  for (const object of objects) {
    const center = object.getCenterPoint();
    const dx = center.x - pivot.x;
    const dy = center.y - pivot.y;
    const next = new Point(pivot.x + dx * cos - dy * sin, pivot.y + dx * sin + dy * cos);
    object.rotate((((object.angle || 0) + degrees) % 360 + 360) % 360);
    object.setPositionByOrigin(next, "center", "center");
    object.setCoords();
  }
  notifyModified(canvas);
  fitToScreen(canvas);
  return "canvas";
}

/**
 * Mirror the selection, or the whole document (photo included) when nothing
 * is selected. Objects are mirrored around the photo's centre line.
 */
export function flip(canvas: FabricCanvas, axis: "x" | "y"): "selection" | "canvas" | null {
  const active = canvas.getActiveObject();
  const key = axis === "x" ? "flipX" : "flipY";
  if (active) {
    if (isReadOnlySelection(active)) return null;
    active.set(key, !active[key]);
    active.setCoords();
    notifyModified(canvas, active);
    return "selection";
  }

  const objects = canvas.getObjects().filter(isLayerObject);
  if (objects.length === 0) return null;
  const background = findBackgroundImage(canvas);
  const pivot = background
    ? background.getCenterPoint()
    : new Point(canvas.width / 2, canvas.height / 2);
  transformGuides(canvas, axis === "x" ? [-1, 0, 0, 1, 2 * pivot.x, 0] : [1, 0, 0, -1, 0, 2 * pivot.y]);
  for (const object of objects) {
    const center = object.getCenterPoint();
    const next =
      axis === "x"
        ? new Point(2 * pivot.x - center.x, center.y)
        : new Point(center.x, 2 * pivot.y - center.y);
    object.set(key, !object[key]);
    // Mirroring also reverses the sense of rotation.
    object.set("angle", (360 - (object.angle || 0)) % 360);
    object.setPositionByOrigin(next, "center", "center");
    object.setCoords();
  }
  notifyModified(canvas);
  return "canvas";
}

export type ArrangeAction = "front" | "forward" | "backward" | "back";

/**
 * Change stacking order without ever moving below the background photo, as
 * Photoshop's Arrange: within the layer's group, past whole groups, and out
 * of a group at its top or bottom. A group picked in the panel moves whole.
 */
export function arrange(canvas: FabricCanvas, action: ArrangeAction): boolean {
  const group = selectedGroup(canvas);
  const targets = group ? [group] : selectedObjects(canvas).filter((object) => !isProtectedObject(object));
  if (targets.length === 0) return false;
  for (const target of targets) ensureLayerId(target);
  arrangeLayers(
    canvas,
    targets.map((target) => (target as EditorFabricObject).__layerId!),
    action
  );
  return true;
}

const CLONE_PROPS = SNAPSHOT_EXTRA_PROPS.filter((prop) => prop !== "__layerId");

/** Deep-copy objects with editor metadata, giving every copy a new layer id. */
export async function cloneObjects(objects: FabricObject[]): Promise<FabricObject[]> {
  const copies: FabricObject[] = [];
  for (const object of objects) {
    if (isBackgroundObject(object) || isEditorChrome(object)) continue;
    const copy = await object.clone(CLONE_PROPS);
    const editorCopy = copy as EditorFabricObject;
    delete editorCopy.__layerId;
    editorCopy.__isBackground = false;
    ensureLayerId(copy);
    // A copy is a fresh, editable layer even when its source was locked.
    setObjectLocked(copy, false);
    if (editorCopy.name) editorCopy.name = `${editorCopy.name} copy`;
    copies.push(copy);
  }
  return copies;
}

/**
 * Add copies to the canvas offset by `offset` scene units (screen-constant)
 * and select them as one selection.
 */
export function placeCopies(
  canvas: FabricCanvas,
  copies: FabricObject[],
  offset: number
): void {
  if (copies.length === 0) return;
  canvas.discardActiveObject();
  for (const copy of copies) {
    copy.set({ left: (copy.left ?? 0) + offset, top: (copy.top ?? 0) + offset });
    copy.setCoords();
    canvas.add(copy);
  }
  if (copies.length === 1) {
    canvas.setActiveObject(copies[0]!);
  } else {
    canvas.setActiveObject(new ActiveSelection(copies, { canvas }));
  }
  canvas.requestRenderAll();
}

/**
 * Snapshot the selection for a later paste. Objects inside an ActiveSelection
 * carry group-relative coordinates, so the selection is briefly dissolved to
 * clone absolute transforms and then restored.
 */
export async function copySelection(canvas: FabricCanvas): Promise<FabricObject[]> {
  const active = canvas.getActiveObject();
  const objects = selectedObjects(canvas);
  if (objects.length === 0) return [];
  const multi = active instanceof ActiveSelection;
  if (multi) canvas.discardActiveObject();
  const copies = await cloneObjects(objects);
  if (multi && objects.every((object) => canvas.getObjects().includes(object))) {
    canvas.setActiveObject(new ActiveSelection(objects, { canvas }));
    canvas.requestRenderAll();
  }
  return copies;
}

export async function duplicateSelection(canvas: FabricCanvas): Promise<number> {
  const objects = selectedObjects(canvas);
  if (objects.length === 0) return 0;
  // Objects inside an ActiveSelection carry group-relative coordinates; drop
  // the selection first so each object reports its absolute transform.
  canvas.discardActiveObject();
  const copies = await cloneObjects(objects);
  placeCopies(canvas, copies, 16 / (canvas.getZoom() || 1));
  return copies.length;
}

/**
 * Add a decoded image as a new layer, at most half the visible area and
 * centred in the current view (or at `at`, a scene point, when given).
 */
export async function addImageLayer(
  canvas: FabricCanvas,
  dataUrl: string,
  options: { signal?: AbortSignal; at?: Point; name?: string } = {}
): Promise<FabricImage | null> {
  const image = await FabricImage.fromURL(dataUrl, { signal: options.signal });
  if (options.signal?.aborted || canvas.disposed || canvas.destroyed) {
    image.dispose();
    return null;
  }
  const zoom = canvas.getZoom() || 1;
  const scale = Math.min(
    ((canvas.width / zoom) * 0.5) / image.width,
    ((canvas.height / zoom) * 0.5) / image.height,
    1
  );
  image.scale(scale);
  const center = options.at ?? canvas.getVpCenter();
  image.set({
    left: center.x - (image.width * scale) / 2,
    top: center.y - (image.height * scale) / 2,
  });
  if (options.name) (image as EditorFabricObject).name = options.name;
  canvas.add(image);
  canvas.setActiveObject(image);
  canvas.requestRenderAll();
  return image;
}

/** Select every unlocked layer above the photo. Returns how many. */
export function selectAllLayers(canvas: FabricCanvas): number {
  const objects = canvas
    .getObjects()
    .filter((object) => isLayerObject(object) && !isProtectedObject(object));
  if (objects.length === 0) return 0;
  canvas.setActiveObject(
    objects.length === 1 ? objects[0]! : new ActiveSelection(objects, { canvas })
  );
  canvas.requestRenderAll();
  return objects.length;
}

/** Drop the selection. Returns whether anything was selected. */
export function deselect(canvas: FabricCanvas): boolean {
  if (!canvas.getActiveObject()) return false;
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  return true;
}

/**
 * Lock the selected layers, or unlock them when all are already locked.
 * Returns the new state, or null when no layer (other than the photo) is
 * selected.
 */
export function toggleSelectionLock(canvas: FabricCanvas): boolean | null {
  const objects = selectedObjects(canvas).filter((object) => !isBackgroundObject(object));
  if (objects.length === 0) return null;
  const lock = !objects.every((object) => isObjectLocked(object));
  for (const object of objects) setObjectLocked(object, lock);
  notifyModified(canvas, canvas.getActiveObject() ?? objects[0]);
  return lock;
}

/** Remove every unlocked layer, keeping the photo. Returns how many. */
export function clearUnlockedLayers(canvas: FabricCanvas): number {
  const removable = canvas
    .getObjects()
    .filter((object) => isLayerObject(object) && !isProtectedObject(object));
  if (removable.length === 0) return 0;
  canvas.discardActiveObject();
  canvas.remove(...removable);
  canvas.requestRenderAll();
  return removable.length;
}
