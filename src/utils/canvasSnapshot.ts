import type { Canvas as FabricCanvas } from "fabric";

// Canvas properties beyond toObject() defaults that the editor relies on.
// Explicit metadata avoids inferring "background" from selectable=false, which
// previously made locked image layers disappear after save/restore.
export const SNAPSHOT_EXTRA_PROPS = [
  "__isBackground",
  "__layerId",
  "__locked",
  "erasable",
  "selectable",
  "evented",
  "lockMovementX",
  "lockMovementY",
  "lockRotation",
  "lockScalingX",
  "lockScalingY",
  "hasControls",
  "name",
  "globalCompositeOperation",
];

export interface CanvasSnapshot {
  json: string;
  /**
   * Image sources extracted from the JSON. A data-URL photo weighs megabytes;
   * since JS strings are copied by reference, every snapshot holding the same
   * src costs a pointer instead of a full copy of the image.
   */
  srcs: string[];
}

const SRC_PLACEHOLDER = "__snapshot_src_";

type PlainObject = Record<string, unknown>;

export function takeSnapshot(canvas: FabricCanvas): CanvasSnapshot {
  const data = canvas.toObject(SNAPSHOT_EXTRA_PROPS);
  const srcs: string[] = [];
  const srcIndexes = new Map<string, number>();

  // A JSON.stringify replacer swaps each image `src` for an index placeholder
  // without mutating the source object. The placeholder carries its own index,
  // so parseSnapshot can re-inline regardless of traversal order.
  const json = JSON.stringify(data, (key, value) => {
    if (key === "src" && typeof value === "string") {
      let index = srcIndexes.get(value);
      if (index === undefined) {
        index = srcs.length;
        srcIndexes.set(value, index);
        srcs.push(value);
      }
      return `${SRC_PLACEHOLDER}${index}`;
    }
    return value;
  });

  return { json, srcs };
}

function reinlineSrcs(value: unknown, srcs: string[]): void {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry);
      continue;
    }

    const object = current as PlainObject;
    if (
      typeof object.src === "string" &&
      object.src.startsWith(SRC_PLACEHOLDER)
    ) {
      const index = Number(object.src.slice(SRC_PLACEHOLDER.length));
      const source = srcs[index];
      if (!Number.isSafeInteger(index) || index < 0 || source === undefined) {
        throw new Error("Snapshot contains an invalid image placeholder");
      }
      object.src = source;
    }
    for (const entry of Object.values(object)) pending.push(entry);
  }
}

/** Rebuild the plain object for loadFromJSON, re-inlining extracted srcs. */
export function parseSnapshot(snapshot: CanvasSnapshot): PlainObject {
  const data = JSON.parse(snapshot.json) as PlainObject;
  reinlineSrcs(data, snapshot.srcs);
  return data;
}
