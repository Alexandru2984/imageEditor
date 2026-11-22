import type { Canvas as FabricCanvas } from "fabric";
import { takeSnapshot, type CanvasSnapshot } from "./canvasSnapshot";
import {
  MAX_EMBEDDED_IMAGE_BYTES,
  inspectRasterDataUrl,
} from "./imageFile";
import { downloadBlob } from "./download";
import { throwIfAborted } from "./abort";
import { isValidLayerStyle } from "@/raster/layerStyleData";
import { readAdjustment } from "@/adjustments/adjustmentData";
import { isGuideList } from "./guideData";

const FILE_VERSION = 1;
const SRC_PLACEHOLDER_PATTERN = /^__snapshot_src_(0|[1-9]\d*)$/;
const MAX_PROJECT_BYTES = 96 * 1024 * 1024;
const MAX_SNAPSHOT_JSON_CHARS = 8 * 1024 * 1024;
const MAX_IMAGE_SOURCES = 256;
const MAX_TOTAL_IMAGE_BYTES = 72 * 1024 * 1024;
const MAX_TYPED_OBJECTS = 2_000;
const MAX_NODES = 100_000;
const MAX_DEPTH = 64;
const MAX_ARRAY_ENTRIES = 50_000;
const MAX_FILTERS_PER_IMAGE = 16;
const MAX_STROKE_DASH_ENTRIES = 256;
const MAX_STRING_CHARS = 100_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_ABSOLUTE_NUMBER = 10_000_000;
const MAX_OBJECT_DIMENSION = 100_000;
const MAX_OBJECT_SCALE = 10_000;
const MAX_BLUR = 4_096;

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ALLOWED_SERIALIZED_TYPES = new Set([
  "object",
  "fabricobject",
  "image",
  "rect",
  "circle",
  "ellipse",
  "line",
  "triangle",
  "group",
  "activeselection",
  "i-text",
  "itext",
  "text",
  "textbox",
  "path",
  "polygon",
  "polyline",
  "shadow",
  "clipping",
  "layoutmanager",
  "fixed",
  "fit-content",
  "clip-path",
  // Layer groups: the header above a group's layers and the marker below them.
  "layergroup",
  "layergroupend",
  // Adjustment layers: their settings are checked one by one (adjustmentData.ts).
  "adjustmentlayer",
]);

type FilterParameterRule = (value: unknown) => boolean;

const numberIn =
  (min: number, max: number): FilterParameterRule =>
  (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const booleanValue: FilterParameterRule = (value) => typeof value === "boolean";

const numberArray =
  (length: number, min: number, max: number): FilterParameterRule =>
  (value) =>
    Array.isArray(value) && value.length === length && value.every(numberIn(min, max));

// Fixed colour-matrix looks serialise only their colorsOnly flag; the matrix
// itself comes from the class, so a project cannot smuggle one in.
const LOOK_FILTER: Record<string, FilterParameterRule> = { colorsOnly: booleanValue };

/**
 * Every filter the editor can create, with each serialised parameter and its
 * safe range. Anything else (unknown types, extra properties such as shader
 * sources, out-of-range values) rejects the whole project.
 */
const FILTER_RULES = new Map<string, Record<string, FilterParameterRule>>([
  ["brightness", { brightness: numberIn(-1, 1) }],
  ["contrast", { contrast: numberIn(-1, 1) }],
  ["saturation", { saturation: numberIn(-1, 1) }],
  ["vibrance", { vibrance: numberIn(-1, 1) }],
  ["blur", { blur: numberIn(0, 1) }],
  ["huerotation", { rotation: numberIn(-1, 1) }],
  ["noise", { noise: numberIn(0, 1_000) }],
  ["pixelate", { blocksize: numberIn(1, 256) }],
  ["colormatrix", { matrix: numberArray(20, -4, 4), colorsOnly: booleanValue }],
  ["convolute", { matrix: numberArray(9, -8, 8), opaque: booleanValue }],
  ["blackwhite", LOOK_FILTER],
  ["sepia", LOOK_FILTER],
  ["vintage", LOOK_FILTER],
  ["kodachrome", LOOK_FILTER],
  ["technicolor", LOOK_FILTER],
  ["polaroid", LOOK_FILTER],
  ["brownie", LOOK_FILTER],
]);

const NUMERIC_PROPERTY_LIMITS = new Map<
  string,
  { min: number; max: number }
>([
  ["opacity", { min: 0, max: 1 }],
  ["__fill", { min: 0, max: 1 }],
  ["width", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["height", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["radius", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["rx", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["ry", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["strokeWidth", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["strokeMiterLimit", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["fontSize", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["lineHeight", { min: 0, max: 1_000 }],
  ["charSpacing", { min: -100_000, max: 100_000 }],
  ["deltaY", { min: -MAX_OBJECT_DIMENSION, max: MAX_OBJECT_DIMENSION }],
  ["scaleX", { min: -MAX_OBJECT_SCALE, max: MAX_OBJECT_SCALE }],
  ["scaleY", { min: -MAX_OBJECT_SCALE, max: MAX_OBJECT_SCALE }],
  ["cropX", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["cropY", { min: 0, max: MAX_OBJECT_DIMENSION }],
  ["blur", { min: 0, max: MAX_BLUR }],
]);

const STRING_PROPERTY_LIMITS = new Map<string, number>([
  ["text", MAX_TEXT_CHARS],
  ["name", 256],
  ["fontFamily", 256],
  ["fontStyle", 64],
  ["textAlign", 64],
  ["globalCompositeOperation", 64],
]);

function assertSafeNumericProperty(key: string, value: unknown): void {
  const limits = NUMERIC_PROPERTY_LIMITS.get(key);
  if (!limits) return;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < limits.min ||
    value > limits.max
  ) {
    throw new Error(`Project contains an unsafe ${key} value`);
  }
}

function assertSafeStringProperty(key: string, value: unknown): void {
  const maxLength = STRING_PROPERTY_LIMITS.get(key);
  if (!maxLength) return;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Project contains an unsafe ${key} value`);
  }
}

function assertSafeFilter(object: Record<string, unknown>): void {
  const type = typeof object.type === "string" ? object.type.toLowerCase() : "";
  const rules = FILTER_RULES.get(type);
  if (!rules) throw new Error(`Project contains unsupported filter type: ${type}`);

  for (const key of Object.keys(object)) {
    if (key === "type") continue;
    const rule = Object.prototype.hasOwnProperty.call(rules, key) ? rules[key] : undefined;
    if (!rule) {
      throw new Error(`Project contains an unsupported ${type} filter property`);
    }
    if (object[key] !== undefined && !rule(object[key])) {
      throw new Error(`Project contains an unsafe ${type} filter value`);
    }
  }
}

// Formal shape of a project file:
//   { version?: 1, snapshot: { json: string, srcs: string[] } }
// with no other keys. These guards check the structure; assertSafeSources
// (below) enforces the security invariant that every image source is inline.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

/** A copy of `value` if it is exactly a bounded snapshot, otherwise null. */
function parseSnapshot(value: unknown): CanvasSnapshot | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["json", "srcs"])) return null;
  const { json, srcs } = value;
  if (typeof json !== "string" || json.length > MAX_SNAPSHOT_JSON_CHARS) return null;
  if (!Array.isArray(srcs) || srcs.length > MAX_IMAGE_SOURCES) return null;
  // Index every slot: a sparse array (possible from IndexedDB) has holes that
  // Array#every would skip.
  for (let index = 0; index < srcs.length; index += 1) {
    if (typeof srcs[index] !== "string") return null;
  }
  return { json, srcs: [...(srcs as string[])] };
}

/** The snapshot inside a project file, if the file has exactly the expected shape. */
function parseProjectFile(value: unknown): unknown {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "snapshot"])) return null;
  if (value.version !== undefined && value.version !== FILE_VERSION) return null;
  return "snapshot" in value ? value.snapshot : null;
}

/**
 * Reject oversized collections before anything walks their elements.
 * parseSnapshot enforces the same bound; this keeps the cost of a hostile
 * multi-million-entry array O(1) and its error message specific.
 */
function assertBoundedSnapshotShape(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const srcs = (value as Record<string, unknown>).srcs;
  if (Array.isArray(srcs) && srcs.length > MAX_IMAGE_SOURCES) {
    throw new Error("Project contains too many embedded images");
  }
}

const estimatedDecodedBytes = (dataUrl: string): number => {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  return Math.ceil((dataUrl.length - comma - 1) / 4) * 3;
};

/**
 * Cheap limits for trusted, freshly generated snapshots. Full signature and
 * object-graph validation is intentionally reserved for the load boundary so
 * autosaving a large document does not rescan megabytes of base64 every time.
 */
export function assertProjectSnapshotStorageLimits(
  value: CanvasSnapshot
): CanvasSnapshot {
  const snapshot = parseSnapshot(value);
  if (!snapshot) throw new Error("Project snapshot is too large to autosave");

  let totalImageBytes = 0;
  for (const source of snapshot.srcs) {
    const byteLength = estimatedDecodedBytes(source);
    if (byteLength > MAX_EMBEDDED_IMAGE_BYTES) {
      throw new Error("Project contains an oversized embedded image");
    }
    totalImageBytes += byteLength;
    if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error("Project contains too much embedded image data");
    }
  }
  return snapshot;
}

// A portable project file: the same snapshot format used for undo/autosave,
// wrapped with a version tag and written to disk so projects survive beyond
// this browser's IndexedDB.
// A project file comes from disk and is therefore untrusted input. The app only
// ever writes `data:image/...` sources, so any other scheme (e.g. an http(s)
// URL) in a tampered file would make the browser fetch an attacker-controlled
// resource when the project loads. Reject anything that isn't a data-image.
function assertSafeSources(snapshot: CanvasSnapshot): void {
  const validatedSources = new Set<string>();
  let totalImageBytes = 0;

  const validateInlineImage = (source: string): void => {
    if (validatedSources.has(source)) return;
    const metadata = inspectRasterDataUrl(source);
    totalImageBytes += metadata.byteLength;
    if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error("Project contains too much embedded image data");
    }
    validatedSources.add(source);
  };

  for (const src of snapshot.srcs) validateInlineImage(src);

  let document: unknown;
  try {
    document = JSON.parse(snapshot.json);
  } catch {
    throw new Error("Project snapshot is not valid JSON");
  }
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    !Array.isArray((document as Record<string, unknown>).objects)
  ) {
    throw new Error("Project snapshot does not contain a canvas object list");
  }

  const pending: Array<{
    value: unknown;
    depth: number;
    kind: "canvas" | "filter";
  }> = [
    { value: document, depth: 0, kind: "canvas" },
  ];
  let nodeCount = 0;
  let typedObjectCount = 0;

  while (pending.length > 0) {
    const { value, depth, kind } = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > MAX_NODES) throw new Error("Project is too complex");
    if (depth > MAX_DEPTH) throw new Error("Project nesting is too deep");

    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_NUMBER) {
        throw new Error("Project contains an invalid numeric value");
      }
      continue;
    }
    if (typeof value === "string") {
      if (value.length > MAX_STRING_CHARS) {
        throw new Error("Project contains an oversized text value");
      }
      continue;
    }
    if (!value || typeof value !== "object") continue;

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ENTRIES) {
        throw new Error("Project contains an oversized collection");
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: value[index], depth: depth + 1, kind });
      }
      continue;
    }

    const object = value as Record<string, unknown>;
    if (typeof object.type === "string") {
      typedObjectCount += 1;
      if (typedObjectCount > MAX_TYPED_OBJECTS) {
        throw new Error("Project contains too many canvas objects");
      }
      const normalizedType = object.type.toLowerCase();
      if (kind === "filter") {
        assertSafeFilter(object);
      } else if (!ALLOWED_SERIALIZED_TYPES.has(normalizedType)) {
        throw new Error(`Project contains unsupported object type: ${object.type}`);
      }
    } else if (kind === "filter") {
      throw new Error("Project contains an invalid serialized filter entry");
    }

    for (const key of Object.keys(object)) {
      if (DANGEROUS_KEYS.has(key)) {
        throw new Error("Project contains an unsafe property name");
      }
      const child = object[key];
      assertSafeNumericProperty(key, child);
      assertSafeStringProperty(key, child);

      if (key === "objects" || key === "filters") {
        if (!Array.isArray(child)) {
          throw new Error(`Project contains an invalid ${key} collection`);
        }
        if (key === "filters" && child.length > MAX_FILTERS_PER_IMAGE) {
          throw new Error("Project contains too many image filters");
        }
        for (const entry of child) {
          if (
            !entry ||
            typeof entry !== "object" ||
            Array.isArray(entry) ||
            typeof (entry as Record<string, unknown>).type !== "string"
          ) {
            throw new Error(`Project contains an invalid serialized ${key} entry`);
          }
          pending.push({
            value: entry,
            depth: depth + 1,
            kind: key === "filters" ? "filter" : "canvas",
          });
        }
        continue;
      }
      if (key === "strokeDashArray" && child !== null) {
        if (
          !Array.isArray(child) ||
          child.length > MAX_STROKE_DASH_ENTRIES ||
          child.some(
            (entry) =>
              typeof entry !== "number" ||
              !Number.isFinite(entry) ||
              entry < 0 ||
              entry > MAX_OBJECT_DIMENSION
          )
        ) {
          throw new Error("Project contains an unsafe stroke dash pattern");
        }
      }
      if (key === "transformMatrix" || key === "viewportTransform") {
        if (
          child !== null &&
          (!Array.isArray(child) ||
            child.length !== 6 ||
            child.some(
              (entry) =>
                typeof entry !== "number" ||
                !Number.isFinite(entry) ||
                Math.abs(entry) > MAX_ABSOLUTE_NUMBER
            ))
        ) {
          throw new Error(`Project contains an unsafe ${key}`);
        }
      }
      if (key === "layerMask") {
        // { src, enabled }; src is checked like any image source below.
        if (
          !child ||
          typeof child !== "object" ||
          Array.isArray(child) ||
          !hasOnlyKeys(child as Record<string, unknown>, ["src", "enabled"]) ||
          typeof (child as Record<string, unknown>).src !== "string" ||
          typeof (child as Record<string, unknown>).enabled !== "boolean"
        ) {
          throw new Error("Project contains an invalid layer mask");
        }
      }
      if (key === "guides") {
        if (!isGuideList(child)) throw new Error("Project contains invalid guides");
        continue;
      }
      if ((key === "__clipped" || key === "passThrough" || key === "collapsed") && typeof child !== "boolean") {
        throw new Error("Project contains an invalid layer group setting");
      }
      if ((key === "__lockTransparency" || key === "__lockPixels" || key === "__lockPosition") && typeof child !== "boolean") {
        throw new Error("Project contains an invalid layer lock");
      }
      if (key === "layerStyle") {
        if (!isValidLayerStyle(child)) throw new Error("Project contains an invalid layer style");
        continue;
      }
      if (key === "adjustment") {
        if (!readAdjustment(child)) throw new Error("Project contains an invalid adjustment layer");
        continue;
      }
      if (key === "src") {
        if (typeof child !== "string") {
          throw new Error("Project contains an invalid image source");
        }
        const placeholder = SRC_PLACEHOLDER_PATTERN.exec(child);
        if (placeholder) {
          const index = Number(placeholder[1]);
          if (index >= snapshot.srcs.length) {
            throw new Error("Project contains an invalid image placeholder");
          }
        } else {
          validateInlineImage(child);
        }
        continue;
      }
      if (key === "source" && typeof child === "string") {
        // Fabric patterns use `source` (not `src`) and load it as a URL.
        validateInlineImage(child);
        continue;
      }
      pending.push({ value: child, depth: depth + 1, kind });
    }
  }
}

/** Validate an untrusted snapshot before Fabric is allowed to deserialize it. */
export function validateProjectSnapshot(value: unknown): CanvasSnapshot {
  assertBoundedSnapshotShape(value);
  const snapshot = parseSnapshot(value);
  if (!snapshot) throw new Error("Not a valid project snapshot");
  assertSafeSources(snapshot);
  return snapshot;
}

export function downloadProjectFile(canvas: FabricCanvas): void {
  const snapshot = takeSnapshot(canvas);
  assertSafeSources(snapshot);
  const payload = JSON.stringify({ version: FILE_VERSION, snapshot });
  const blob = new Blob([payload], { type: "application/json" });
  if (blob.size > MAX_PROJECT_BYTES) {
    throw new Error("Project is too large to save safely");
  }
  downloadBlob(blob, `project-${Date.now()}.imgedit.json`);
}

export async function readProjectFile(
  file: File,
  signal?: AbortSignal
): Promise<CanvasSnapshot> {
  throwIfAborted(signal);
  if (file.size > MAX_PROJECT_BYTES) {
    throw new Error("Project file is too large");
  }
  const text = await file.text();
  throwIfAborted(signal);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Project file is not valid JSON");
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    assertBoundedSnapshotShape((payload as Record<string, unknown>).snapshot);
  }
  const inner = parseProjectFile(payload);
  if (!parseSnapshot(inner)) {
    throw new Error("Not a valid project file");
  }
  const snapshot = validateProjectSnapshot(inner);
  throwIfAborted(signal);
  return snapshot;
}
