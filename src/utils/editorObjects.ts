import { ActiveSelection, FabricImage } from "fabric";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";

export type EditorFabricObject = FabricObject & {
  __isBackground?: boolean;
  __layerId?: string;
  __locked?: boolean;
  __isCropOverlay?: boolean;
  __isMarquee?: boolean;
  erasable?: boolean;
  name?: string;
};

let layerSequence = 0;

const createLayerId = (): string => {
  layerSequence += 1;
  return `layer-${Date.now().toString(36)}-${layerSequence.toString(36)}`;
};

const hasUsableLayerId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  /^[A-Za-z0-9_-]+$/.test(value);

export function ensureLayerId(
  object: FabricObject,
  usedIds?: Set<string>
): string {
  const editorObject = object as EditorFabricObject;
  let id = editorObject.__layerId;
  if (!hasUsableLayerId(id) || usedIds?.has(id)) {
    do {
      id = createLayerId();
    } while (usedIds?.has(id));
    editorObject.__layerId = id;
  }
  usedIds?.add(id);
  return id;
}

export const isEditorChrome = (object: FabricObject): boolean => {
  const editorObject = object as EditorFabricObject;
  return (
    editorObject.__isCropOverlay === true || editorObject.__isMarquee === true
  );
};

export const isBackgroundObject = (object: FabricObject): boolean =>
  (object as EditorFabricObject).__isBackground === true;

export const isObjectLocked = (object: FabricObject): boolean => {
  const editorObject = object as EditorFabricObject;
  if (editorObject.__locked === true) return true;
  // Migrate layers locked by older builds, which did not persist __locked.
  return (
    object.lockMovementX === true &&
    object.lockMovementY === true &&
    object.lockRotation === true &&
    object.lockScalingX === true &&
    object.lockScalingY === true
  );
};

export const isProtectedObject = (object: FabricObject): boolean =>
  isBackgroundObject(object) || isObjectLocked(object);

export function markBackgroundObject(image: FabricImage): void {
  const object = image as EditorFabricObject;
  object.__isBackground = true;
  object.__locked = false;
  object.erasable = false;
  ensureLayerId(image);
  image.set({ selectable: false, evented: false, hasControls: false });
  if (!object.name) object.name = "Background";
}

export function setObjectLocked(object: FabricObject, locked: boolean): void {
  if (isBackgroundObject(object)) return;
  const editorObject = object as EditorFabricObject;
  editorObject.__locked = locked;
  editorObject.erasable = !locked;
  object.set({
    lockMovementX: locked,
    lockMovementY: locked,
    lockRotation: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    hasControls: !locked,
    // A locked layer remains selectable from the canvas and Layers panel.
    // The lock flags prevent transforms while selection enables inspection.
    selectable: true,
    evented: true,
  });
}

/**
 * Find the explicit background marker. For projects created by older builds,
 * migrate only the bottom-most non-selectable image instead of treating every
 * locked image layer as a background.
 */
export function findBackgroundImage(
  canvas: FabricCanvas
): FabricImage | undefined {
  const images = canvas
    .getObjects()
    .filter((object): object is FabricImage => object instanceof FabricImage);
  const marked = images.find(isBackgroundObject);
  if (marked) return marked;

  const legacy = images.find((image) => image.selectable === false);
  if (legacy) markBackgroundObject(legacy);
  return legacy;
}

/** Normalize markers and IDs after loading an untrusted or legacy snapshot. */
export function normalizeEditorObjects(
  canvas: FabricCanvas
): FabricImage | undefined {
  const background = findBackgroundImage(canvas);
  const usedIds = new Set<string>();

  for (const object of canvas.getObjects()) {
    if (isEditorChrome(object)) continue;
    ensureLayerId(object, usedIds);
    if (object === background) {
      markBackgroundObject(background);
    } else if (isObjectLocked(object)) {
      // This also repairs the old lock implementation's selectable=false.
      setObjectLocked(object, true);
    } else {
      (object as EditorFabricObject).erasable = true;
    }
  }
  return background;
}

/** Remove only unlocked document objects from the current selection. */
export function removeSelectedObjects(canvas: FabricCanvas): number {
  const active = canvas.getActiveObject();
  if (!active) return 0;
  const selected =
    active instanceof ActiveSelection ? active.getObjects() : [active];
  const removable = selected.filter(
    (object) => !isEditorChrome(object) && !isProtectedObject(object)
  );
  if (removable.length > 0) canvas.remove(...removable);
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  return removable.length;
}
