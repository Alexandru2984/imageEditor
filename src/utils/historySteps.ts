import type { Canvas as FabricCanvas } from "fabric";
import type { Tool } from "@/types/editor";
import type { CanvasSnapshot } from "./canvasSnapshot";

/**
 * What each step in the History panel is called, as in Photoshop: the
 * command that made it (named when it runs, or when its dialog applies),
 * else the tool used on the canvas, else what the change itself was.
 */

/** How long a command's name waits for the change it makes (dialogs take a while). */
const NAME_WAITS_MS = 5 * 60_000;

const pending = new WeakMap<FabricCanvas, { name: string; until: number }>();

/** Call the next history step `name` (the change being prepared or about to be made). */
export function nameNextStep(canvas: FabricCanvas, name: string): void {
  pending.set(canvas, { name: name.replace(/…$/, "").trim(), until: Date.now() + NAME_WAITS_MS });
}

/** A new interaction began: a name waiting from before no longer applies. */
export function forgetStepName(canvas: FabricCanvas): void {
  pending.delete(canvas);
}

/** The waiting name, once. */
export function takeStepName(canvas: FabricCanvas): string | null {
  const waiting = pending.get(canvas);
  pending.delete(canvas);
  return waiting && Date.now() <= waiting.until ? waiting.name : null;
}

const TOOL_STEPS: Partial<Record<Tool, string>> = {
  brush: "Brush",
  draw: "Marker",
  eraser: "Eraser",
  bucket: "Paint bucket",
  gradient: "Gradient",
  rectangle: "Rectangle",
  circle: "Ellipse",
  triangle: "Triangle",
  star: "Star",
  line: "Line",
  arrow: "Arrow",
  text: "Text",
  crop: "Crop",
  cloneStamp: "Clone stamp",
  spotHealing: "Spot healing brush",
  healingBrush: "Healing brush",
  dodge: "Dodge",
  burn: "Burn",
  sponge: "Sponge",
  blur: "Blur",
  sharpen: "Sharpen",
  smudge: "Smudge",
};

/** The step a tool makes on the canvas, for tools that make one. */
export const toolStepName = (tool: Tool): string | null => TOOL_STEPS[tool] ?? null;

/** Whether a change added or took away layers, edited pixels, or something else. */
export type ChangeKind = "added" | "removed" | "pixels" | "other";

type SavedObject = Record<string, unknown>;

const objectsOf = (snapshot: CanvasSnapshot): SavedObject[] => {
  try {
    const parsed = JSON.parse(snapshot.json) as { objects?: unknown };
    return Array.isArray(parsed.objects) ? (parsed.objects as SavedObject[]) : [];
  } catch {
    return [];
  }
};

const PLACEHOLDER = /^__snapshot_src_(\d+)$/;

/** An object's own property, with image placeholders resolved to their sources. */
function valueOf(object: SavedObject, key: string, snapshot: CanvasSnapshot): unknown {
  const value = object[key];
  if (key === "src" && typeof value === "string") {
    const placeholder = PLACEHOLDER.exec(value);
    return placeholder ? snapshot.srcs[Number(placeholder[1])] : value;
  }
  if (key === "layerMask" && value && typeof value === "object") {
    const mask = value as { src?: unknown; enabled?: unknown };
    return { src: typeof mask.src === "string" ? valueOf({ src: mask.src }, "src", snapshot) : mask.src, enabled: mask.enabled };
  }
  return value;
}

const same = (a: unknown, b: unknown): boolean =>
  a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

const TEXT_TYPES = new Set(["textbox", "i-text", "itext", "text"]);
const SHAPE_TYPES = new Set(["rect", "ellipse", "circle", "triangle", "polygon", "path", "line", "group", "polyline"]);

function addedName(object: SavedObject): string {
  const type = String(object.type ?? "").toLowerCase();
  if (type === "layergroup" || type === "layergroupend") return "New group";
  if (TEXT_TYPES.has(type)) return "Text";
  if (SHAPE_TYPES.has(type)) return "Shape";
  return "New layer";
}

/** Changed properties, in the order they name the step. */
const PROPERTY_STEPS: [keys: string[], name: string, kind: ChangeKind][] = [
  [["src"], "Edit pixels", "pixels"],
  [["layerMask"], "Layer mask", "pixels"],
  [["filters"], "Adjustment", "other"],
  [["layerStyle"], "Layer style", "other"],
  [["text"], "Edit text", "other"],
  [["guides"], "Guides", "other"],
  [["__clipped"], "Clipping mask", "other"],
  [["visible"], "Visibility", "other"],
  [["opacity"], "Opacity", "other"],
  [["globalCompositeOperation", "passThrough"], "Blend mode", "other"],
  [["name"], "Rename layer", "other"],
  [["__locked", "lockMovementX", "lockMovementY", "lockRotation", "lockScalingX", "lockScalingY", "selectable", "evented"], "Lock", "other"],
  [["fill", "stroke", "strokeWidth", "strokeDashArray"], "Colour", "other"],
  [["fontFamily", "fontSize", "fontWeight", "fontStyle", "textAlign", "lineHeight", "charSpacing", "underline", "linethrough"], "Text style", "other"],
  [["scaleX", "scaleY", "angle", "skewX", "skewY", "flipX", "flipY", "width", "height", "cropX", "cropY"], "Transform", "other"],
  [["left", "top"], "Move", "other"],
];

/** What changed between two saved states. */
export function describeChange(before: CanvasSnapshot | undefined, after: CanvasSnapshot): { name: string; kind: ChangeKind } {
  if (!before) return { name: "Open", kind: "other" };
  const previous = objectsOf(before);
  const next = objectsOf(after);
  const idOf = (object: SavedObject, index: number) => (typeof object.__layerId === "string" ? object.__layerId : `#${index}`);
  const previousIds = previous.map(idOf);
  const nextIds = next.map(idOf);
  const added = next.filter((_, index) => !previousIds.includes(nextIds[index]!));
  const removed = previous.filter((_, index) => !nextIds.includes(previousIds[index]!));
  if (added.length && removed.length) {
    return { name: removed.length > added.length ? "Merge layers" : "Replace layers", kind: "pixels" };
  }
  if (added.length) return { name: added.length > 1 ? "Add layers" : addedName(added[0]!), kind: "added" };
  if (removed.length) return { name: removed.length > 1 ? "Delete layers" : "Delete layer", kind: "removed" };
  if (previousIds.some((id, index) => nextIds[index] !== id)) return { name: "Arrange", kind: "other" };

  const changed = new Set<string>();
  let photoPixels = false;
  next.forEach((object, index) => {
    const old = previous[index]!;
    for (const key of new Set([...Object.keys(old), ...Object.keys(object)])) {
      if (!same(valueOf(old, key, before), valueOf(object, key, after))) {
        changed.add(key);
        if (key === "src" && object.__isBackground) photoPixels = true;
      }
    }
  });
  for (const [keys, name, kind] of PROPERTY_STEPS) {
    if (keys.some((key) => changed.has(key))) return { name: name === "Edit pixels" && photoPixels ? "Edit image" : name, kind };
  }
  return { name: "Change", kind: "other" };
}
