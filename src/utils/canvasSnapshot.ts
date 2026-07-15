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

function reinlineSrcs(objects: unknown, srcs: string[]) {
  if (!Array.isArray(objects)) return;
  for (const entry of objects) {
    if (entry && typeof entry === "object") {
      const obj = entry as PlainObject;
      if (typeof obj.src === "string" && obj.src.startsWith(SRC_PLACEHOLDER)) {
        obj.src = srcs[Number(obj.src.slice(SRC_PLACEHOLDER.length))];
      }
      reinlineSrcs(obj.objects, srcs);
    }
  }
}

/** Rebuild the plain object for loadFromJSON, re-inlining extracted srcs. */
export function parseSnapshot(snapshot: CanvasSnapshot): PlainObject {
  const data = JSON.parse(snapshot.json) as PlainObject;
  reinlineSrcs(data.objects, snapshot.srcs);
  return data;
}
