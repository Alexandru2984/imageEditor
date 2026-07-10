import type { Canvas as FabricCanvas } from "fabric";

// Canvas properties beyond toObject() defaults that the editor relies on:
// `selectable` marks the background photo, the lock* flags back layer locking.
export const SNAPSHOT_EXTRA_PROPS = [
  "selectable",
  "evented",
  "lockMovementX",
  "lockMovementY",
  "lockRotation",
  "lockScalingX",
  "lockScalingY",
  "hasControls",
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

function walkObjects(objects: unknown, visit: (obj: PlainObject) => void) {
  if (!Array.isArray(objects)) return;
  for (const entry of objects) {
    if (entry && typeof entry === "object") {
      const obj = entry as PlainObject;
      visit(obj);
      walkObjects(obj.objects, visit);
    }
  }
}

export function takeSnapshot(canvas: FabricCanvas): CanvasSnapshot {
  const data = canvas.toObject(SNAPSHOT_EXTRA_PROPS) as PlainObject;
  const srcs: string[] = [];
  walkObjects(data.objects, (obj) => {
    if (typeof obj.src === "string") {
      srcs.push(obj.src);
      obj.src = `${SRC_PLACEHOLDER}${srcs.length - 1}`;
    }
  });
  return { json: JSON.stringify(data), srcs };
}

/** Rebuild the plain object for loadFromJSON, re-inlining extracted srcs. */
export function parseSnapshot(snapshot: CanvasSnapshot): PlainObject {
  const data = JSON.parse(snapshot.json) as PlainObject;
  walkObjects(data.objects, (obj) => {
    if (typeof obj.src === "string" && obj.src.startsWith(SRC_PLACEHOLDER)) {
      obj.src = snapshot.srcs[Number(obj.src.slice(SRC_PLACEHOLDER.length))];
    }
  });
  return data;
}
