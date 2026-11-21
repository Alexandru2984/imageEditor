import { describe, expect, it } from "vitest";
import { ActiveSelection, Rect, type FabricObject } from "fabric";
import {
  hasLayerLock,
  isMoveLocked,
  isPixelsLocked,
  isTransparencyLocked,
  setLayerLock,
  ensureLayerId,
  isObjectLocked,
  isProtectedObject,
  isReadOnlySelection,
  setObjectLocked,
  type EditorFabricObject,
} from "./editorObjects";

function fakeObject(
  values: Partial<EditorFabricObject> = {}
): EditorFabricObject {
  const object = {
    ...values,
    set(next: Record<string, unknown>) {
      Object.assign(this, next);
      return this;
    },
  };
  return object as unknown as EditorFabricObject;
}

describe("editor object metadata", () => {
  it("assigns stable IDs and repairs duplicates from imported projects", () => {
    const used = new Set<string>();
    const first = fakeObject({ __layerId: "same-id" });
    const second = fakeObject({ __layerId: "same-id" });

    expect(ensureLayerId(first as FabricObject, used)).toBe("same-id");
    const repaired = ensureLayerId(second as FabricObject, used);
    expect(repaired).not.toBe("same-id");
    expect(ensureLayerId(second as FabricObject)).toBe(repaired);
  });

  it("keeps locked layers selectable while preventing transforms", () => {
    const object = fakeObject();
    setObjectLocked(object as FabricObject, true);

    expect(isObjectLocked(object as FabricObject)).toBe(true);
    expect(isProtectedObject(object as FabricObject)).toBe(true);
    expect(object.selectable).toBe(true);
    expect(object.evented).toBe(true);
    expect(object.hasControls).toBe(false);
    expect(object.erasable).toBe(false);

    setObjectLocked(object as FabricObject, false);
    expect(isObjectLocked(object as FabricObject)).toBe(false);
    expect(object.hasControls).toBe(true);
    expect(object.erasable).toBe(true);
  });

  it("recognizes lock flags persisted by legacy builds", () => {
    const object = fakeObject({
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
    });
    expect(isObjectLocked(object as FabricObject)).toBe(true);
  });

  it("makes a multi-layer selection read-only when one child is locked", () => {
    const editable = new Rect({ width: 10, height: 10 });
    const locked = new Rect({ width: 10, height: 10 });
    setObjectLocked(locked, true);

    const selection = new ActiveSelection([editable, locked]);
    expect(isProtectedObject(selection)).toBe(false);
    expect(isReadOnlySelection(selection)).toBe(true);
  });

  it("treats editor chrome as read-only", () => {
    const cropOverlay = fakeObject({ __isCropOverlay: true });
    expect(isReadOnlySelection(cropOverlay as FabricObject)).toBe(true);
  });
});

describe("Photoshop's four layer locks", () => {
  it("keep position, pixels and transparency apart from Lock all", () => {
    const rect = new Rect({ width: 10, height: 10 });
    setLayerLock(rect, "position", true);
    // The movement flags alone once meant an older build's full lock.
    expect(rect.lockMovementX).toBe(true);
    expect(isObjectLocked(rect)).toBe(false);
    expect(isMoveLocked(rect)).toBe(true);
    expect(isPixelsLocked(rect)).toBe(false);
    expect(rect.hasControls).toBe(false);

    setLayerLock(rect, "pixels", true);
    expect(isPixelsLocked(rect)).toBe(true);
    expect((rect as FabricObject & { erasable?: boolean }).erasable).toBe(false);
    setLayerLock(rect, "transparency", true);
    expect(isTransparencyLocked(rect)).toBe(true);

    // Lock all on and off leaves the others as they were.
    setLayerLock(rect, "all", true);
    expect(isObjectLocked(rect)).toBe(true);
    setLayerLock(rect, "all", false);
    expect(isMoveLocked(rect)).toBe(true);
    expect(isPixelsLocked(rect)).toBe(true);

    setLayerLock(rect, "position", false);
    setLayerLock(rect, "pixels", false);
    expect(rect.lockMovementX).toBe(false);
    expect(rect.hasControls).toBe(true);
    expect(isMoveLocked(rect)).toBe(false);
    expect(hasLayerLock(rect, "position")).toBe(false);
    expect((rect as FabricObject & { __lockPosition?: boolean }).__lockPosition).toBeUndefined();
  });

  it("make a multiple selection immovable when one of its layers is", () => {
    const free = new Rect({ width: 10, height: 10 });
    const fixed = new Rect({ width: 10, height: 10 });
    setLayerLock(fixed, "position", true);
    expect(isMoveLocked(new ActiveSelection([free, fixed]))).toBe(true);
    expect(isMoveLocked(new ActiveSelection([free]))).toBe(false);
  });
});

describe("fabric object defaults", () => {
  it("places new objects by their top-left corner like earlier builds", () => {
    const rect = new Rect({ left: 10, top: 20, width: 100, height: 50 });
    expect(rect.originX).toBe("left");
    expect(rect.originY).toBe("top");
    const bounds = rect.getBoundingRect();
    expect(Math.round(bounds.left)).toBe(10);
    expect(Math.round(bounds.top)).toBe(20);
  });
});
