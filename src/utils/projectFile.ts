import { z } from "zod";
import type { Canvas as FabricCanvas } from "fabric";
import { takeSnapshot, type CanvasSnapshot } from "./canvasSnapshot";
import {
  MAX_EMBEDDED_IMAGE_BYTES,
  inspectRasterDataUrl,
} from "./imageFile";
import { downloadBlob } from "./download";
import { throwIfAborted } from "./abort";

const FILE_VERSION = 1;
const SRC_PLACEHOLDER_PATTERN = /^__snapshot_src_(0|[1-9]\d*)$/;
const MAX_PROJECT_BYTES = 96 * 1024 * 1024;
const MAX_SNAPSHOT_JSON_CHARS = 8 * 1024 * 1024;
const MAX_IMAGE_SOURCES = 256;
const MAX_TOTAL_IMAGE_BYTES = 72 * 1024 * 1024;
const MAX_TYPED_OBJECTS = 5_000;
const MAX_NODES = 100_000;
const MAX_DEPTH = 64;
const MAX_ARRAY_ENTRIES = 50_000;
const MAX_STRING_CHARS = 1_000_000;
const MAX_ABSOLUTE_NUMBER = 1_000_000_000;

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
  "brightness",
  "contrast",
  "saturation",
  "blur",
  "huerotation",
]);

// Formal shape of a project file. Zod guards the structure; assertSafeSources
// (below) enforces the security invariant that every image source is inline.
const SnapshotSchema = z
  .object({
    json: z.string().max(MAX_SNAPSHOT_JSON_CHARS),
    srcs: z.array(z.string()).max(MAX_IMAGE_SOURCES),
  })
  .strict();

const ProjectFileSchema = z
  .object({
    version: z.literal(FILE_VERSION).optional(),
    snapshot: SnapshotSchema,
  })
  .strict();

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
  const result = SnapshotSchema.safeParse(value);
  if (!result.success) throw new Error("Project snapshot is too large to autosave");

  let totalImageBytes = 0;
  for (const source of result.data.srcs) {
    const byteLength = estimatedDecodedBytes(source);
    if (byteLength > MAX_EMBEDDED_IMAGE_BYTES) {
      throw new Error("Project contains an oversized embedded image");
    }
    totalImageBytes += byteLength;
    if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error("Project contains too much embedded image data");
    }
  }
  return result.data as CanvasSnapshot;
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

  const pending: Array<{ value: unknown; depth: number }> = [
    { value: document, depth: 0 },
  ];
  let nodeCount = 0;
  let typedObjectCount = 0;

  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
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
        pending.push({ value: value[index], depth: depth + 1 });
      }
      continue;
    }

    const object = value as Record<string, unknown>;
    if (typeof object.type === "string") {
      typedObjectCount += 1;
      if (typedObjectCount > MAX_TYPED_OBJECTS) {
        throw new Error("Project contains too many canvas objects");
      }
      if (!ALLOWED_SERIALIZED_TYPES.has(object.type.toLowerCase())) {
        throw new Error(`Project contains unsupported object type: ${object.type}`);
      }
    }

    for (const key of Object.keys(object)) {
      if (DANGEROUS_KEYS.has(key)) {
        throw new Error("Project contains an unsafe property name");
      }
      const child = object[key];
      if (key === "objects" || key === "filters") {
        if (!Array.isArray(child)) {
          throw new Error(`Project contains an invalid ${key} collection`);
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
        }
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
      pending.push({ value: child, depth: depth + 1 });
    }
  }
}

/** Validate an untrusted snapshot before Fabric is allowed to deserialize it. */
export function validateProjectSnapshot(value: unknown): CanvasSnapshot {
  const result = SnapshotSchema.safeParse(value);
  if (!result.success) throw new Error("Not a valid project snapshot");
  const snapshot = result.data as CanvasSnapshot;
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
  const result = ProjectFileSchema.safeParse(payload);
  if (!result.success) {
    throw new Error("Not a valid project file");
  }
  const snapshot = validateProjectSnapshot(result.data.snapshot);
  throwIfAborted(signal);
  return snapshot;
}
