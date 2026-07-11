import { z } from "zod";
import type { Canvas as FabricCanvas } from "fabric";
import { takeSnapshot, type CanvasSnapshot } from "./canvasSnapshot";

// Formal shape of a project file. Zod guards the structure; assertSafeSources
// (below) enforces the security invariant that every image source is inline.
const ProjectFileSchema = z.object({
  version: z.number().optional(),
  snapshot: z.object({
    json: z.string(),
    srcs: z.array(z.string()),
  }),
});

// A portable project file: the same snapshot format used for undo/autosave,
// wrapped with a version tag and written to disk so projects survive beyond
// this browser's IndexedDB.
const FILE_VERSION = 1;

// A project file comes from disk and is therefore untrusted input. The app only
// ever writes `data:image/...` sources, so any other scheme (e.g. an http(s)
// URL) in a tampered file would make the browser fetch an attacker-controlled
// resource when the project loads. Reject anything that isn't a data-image.
const SRC_PLACEHOLDER = "__snapshot_src_";
const MAX_PROJECT_BYTES = 100 * 1024 * 1024;

const isSafeImageSrc = (src: unknown): boolean =>
  typeof src === "string" &&
  (src.startsWith(SRC_PLACEHOLDER) || src.startsWith("data:image/"));

function assertSafeSources(snapshot: CanvasSnapshot): void {
  // Extracted sources must all be inline data images
  for (const src of snapshot.srcs) {
    if (typeof src !== "string" || !src.startsWith("data:image/")) {
      throw new Error("Project file contains an unexpected image source");
    }
  }
  // ...and any `src` still embedded in the JSON must be a placeholder into that
  // validated list or itself a data image (never an external URL)
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if ("src" in obj && !isSafeImageSrc(obj.src)) {
        throw new Error("Project file contains an unexpected image source");
      }
      Object.values(obj).forEach(walk);
    }
  };
  walk(JSON.parse(snapshot.json));
}

export function downloadProjectFile(canvas: FabricCanvas): void {
  const snapshot = takeSnapshot(canvas);
  const payload = JSON.stringify({ version: FILE_VERSION, snapshot });
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `project-${Date.now()}.imgedit.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file: File): Promise<CanvasSnapshot> {
  if (file.size > MAX_PROJECT_BYTES) {
    throw new Error("Project file is too large");
  }
  const result = ProjectFileSchema.safeParse(JSON.parse(await file.text()));
  if (!result.success) {
    throw new Error("Not a valid project file");
  }
  const snapshot = result.data.snapshot as CanvasSnapshot;
  assertSafeSources(snapshot);
  return snapshot;
}
