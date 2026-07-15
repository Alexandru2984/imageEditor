import { describe, expect, it } from "vitest";
import type { FabricObject } from "fabric";
import {
  ensureLayerId,
  isObjectLocked,
  isProtectedObject,
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
});
