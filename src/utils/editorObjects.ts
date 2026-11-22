import { ActiveSelection, FabricImage } from "fabric";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { entriesOf, isGroupMarker } from "@/layers/groupMarkers";
import { isAdjustmentLayer } from "@/adjustments/adjustmentLayer";
import { repaired } from "@/layers/layerTree";

export type EditorFabricObject = FabricObject & {
  __isBackground?: boolean;
  __layerId?: string;
  /** Lock all (Photoshop's padlock): no moving, painting or changing it. */
  __locked?: boolean;
  /** Painting changes colour only where the layer already has pixels. */
  __lockTransparency?: boolean;
  /** No painting, filters or adjustments; it can still move. */
  __lockPixels?: boolean;
  /** No moving or transforming; it can still be painted on. */
  __lockPosition?: boolean;
  /** Fill opacity: the layer's own pixels fade, its effects do not (0–1). */
  __fill?: number;
  __isCropOverlay?: boolean;
  __isMarquee?: boolean;
  __isPreview?: boolean;
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
    editorObject.__isCropOverlay === true ||
    editorObject.__isMarquee === true ||
    editorObject.__isPreview === true
  );
};

/** A document layer: not an editor helper, not a group's marker. */
export const isLayerObject = (object: FabricObject): boolean => !isEditorChrome(object) && !isGroupMarker(object);

/** Flag a transient helper (drawing preview) so history and layers ignore it. */
export function markEditorChrome(object: FabricObject): void {
  (object as EditorFabricObject).__isPreview = true;
}

export const isBackgroundObject = (object: FabricObject): boolean =>
  (object as EditorFabricObject).__isBackground === true;

export const isObjectLocked = (object: FabricObject): boolean => {
  const editorObject = object as EditorFabricObject;
  if (editorObject.__locked === true) return true;
  if (editorObject.__locked === false || editorObject.__lockPosition === true) return false;
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

/**
 * Programmatic property/transform controls must protect an entire multi-layer
 * selection when even one member is locked. Fabric's ActiveSelection itself
 * does not inherit the lock flags from its children, so checking only the
 * wrapper would otherwise let keyboard and panel actions bypass layer locks.
 */
export const isReadOnlySelection = (object: FabricObject): boolean => {
  if (isEditorChrome(object) || isProtectedObject(object)) return true;
  return (
    object instanceof ActiveSelection &&
    object.getObjects().some((child) => isReadOnlySelection(child))
  );
};

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
  // Group markers are never picked on the canvas; their group locks through its layers.
  if (isBackgroundObject(object) || isGroupMarker(object)) return;
  (object as EditorFabricObject).__locked = locked;
  applyLockFlags(object);
}

/** Photoshop's four layer locks. */
export type LayerLock = "transparency" | "pixels" | "position" | "all";

const LOCK_KEYS = {
  transparency: "__lockTransparency",
  pixels: "__lockPixels",
  position: "__lockPosition",
} as const;

/** Whether a layer has that lock itself on (Lock all implies none of the others). */
export function hasLayerLock(object: FabricObject, lock: LayerLock): boolean {
  if (lock === "all") return isObjectLocked(object);
  return (object as EditorFabricObject)[LOCK_KEYS[lock]] === true;
}

/** Turn one of the four locks on or off. */
export function setLayerLock(object: FabricObject, lock: LayerLock, on: boolean): void {
  if (isBackgroundObject(object) || isGroupMarker(object)) return;
  if (lock === "all") {
    setObjectLocked(object, on);
    return;
  }
  // Off is no setting at all, so files only carry the locks in use.
  (object as EditorFabricObject)[LOCK_KEYS[lock]] = on ? true : undefined;
  applyLockFlags(object);
}

/** Its pixels cannot be painted, filtered or adjusted. */
export const isPixelsLocked = (object: FabricObject): boolean =>
  isObjectLocked(object) || (object as EditorFabricObject).__lockPixels === true;

/** Painting keeps its transparent pixels transparent. */
export const isTransparencyLocked = (object: FabricObject): boolean =>
  (object as EditorFabricObject).__lockTransparency === true;

/** It, or any layer of a multiple selection, cannot be moved or transformed. */
export const isMoveLocked = (object: FabricObject): boolean =>
  isObjectLocked(object) ||
  (object as EditorFabricObject).__lockPosition === true ||
  (object instanceof ActiveSelection && object.getObjects().some(isMoveLocked));

/** Fabric's own flags, from the layer's locks. */
function applyLockFlags(object: FabricObject): void {
  const layer = object as EditorFabricObject;
  const all = layer.__locked === true;
  const fixed = all || layer.__lockPosition === true;
  layer.erasable = !(all || layer.__lockPixels === true);
  if (isAdjustmentLayer(object)) {
    // Picked in the Layers panel only, with nothing on the canvas to erase or drag.
    layer.erasable = false;
    object.set({ lockMovementX: fixed, lockMovementY: fixed, selectable: false, evented: false, hasControls: false });
    return;
  }
  object.set({
    lockMovementX: fixed,
    lockMovementY: fixed,
    lockRotation: fixed,
    lockScalingX: fixed,
    lockScalingY: fixed,
    lockSkewingX: fixed,
    lockSkewingY: fixed,
    hasControls: !fixed,
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
  // Older builds stored the dark editor backdrop as the document background,
  // which then leaked into every export. Documents are transparent by design.
  canvas.backgroundColor = "";
  const background = findBackgroundImage(canvas);
  const usedIds = new Set<string>();

  for (const object of canvas.getObjects()) {
    if (isEditorChrome(object)) continue;
    ensureLayerId(object, usedIds);
    if (isGroupMarker(object)) continue;
    if (isAdjustmentLayer(object)) {
      applyLockFlags(object);
      continue;
    }
    if (object === background) {
      markBackgroundObject(background);
    } else if (isObjectLocked(object)) {
      // This also repairs the old lock implementation's selectable=false.
      setObjectLocked(object, true);
    } else if (hasLayerLock(object, "position") || hasLayerLock(object, "pixels")) {
      applyLockFlags(object);
    } else {
      (object as EditorFabricObject).erasable = true;
    }
  }
  // A group marker without its partner (a damaged or hand-edited file) goes.
  const objects = canvas.getObjects().filter((object) => !isEditorChrome(object));
  if (objects.some(isGroupMarker)) {
    const entries = entriesOf(objects);
    const kept = new Set(repaired(entries));
    const stray = objects.filter((object, index) => isGroupMarker(object) && !kept.has(entries[index]!));
    if (stray.length) canvas.remove(...stray);
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
