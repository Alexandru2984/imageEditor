import type { Canvas as FabricCanvas } from "fabric";
import { takeSnapshot, type CanvasSnapshot } from "./canvasSnapshot";

// A portable project file: the same snapshot format used for undo/autosave,
// wrapped with a version tag and written to disk so projects survive beyond
// this browser's IndexedDB.
const FILE_VERSION = 1;

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
  const parsed = JSON.parse(await file.text());
  const snapshot = parsed?.snapshot;
  if (
    !snapshot ||
    typeof snapshot.json !== "string" ||
    !Array.isArray(snapshot.srcs)
  ) {
    throw new Error("Not a valid project file");
  }
  return snapshot as CanvasSnapshot;
}
