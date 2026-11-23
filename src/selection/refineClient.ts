import { refineSelection, type RefineDab, type RefineSettings } from "./refineEdge";

/**
 * Select and Mask's refinement, in a worker where the browser allows it and
 * on the page otherwise (or if the worker fails).
 */

interface Pending {
  resolve: (result: Uint8Array) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null | undefined;
let sequence = 0;
const pending = new Map<number, Pending>();

function refineWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") {
    worker = null;
    return worker;
  }
  try {
    worker = new Worker(new URL("./refineEdge.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
    return worker;
  }
  worker.addEventListener("message", (event: MessageEvent) => {
    const { id, result, error } = event.data as { id: number; result?: Uint8Array; error?: string };
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (result) request.resolve(result);
    else request.reject(new Error(error ?? "The edge could not be refined"));
  });
  worker.addEventListener("error", () => {
    worker?.terminate();
    worker = null;
    for (const request of pending.values()) request.reject(new Error("The refining worker stopped"));
    pending.clear();
  });
  return worker;
}

/** Refine a selection's edge against the picture (both copied for the worker). */
export async function refineInWorker(
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  settings: RefineSettings,
  dabs: readonly RefineDab[],
  scale: number
): Promise<Uint8Array> {
  const runner = refineWorker();
  if (runner) {
    const id = (sequence += 1);
    const pixelsCopy = pixels.slice();
    const maskCopy = mask.slice();
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        runner.postMessage({ id, pixels: pixelsCopy, mask: maskCopy, width, height, settings, dabs: [...dabs], scale }, [
          pixelsCopy.buffer,
          maskCopy.buffer,
        ]);
      });
    } catch {
      // Fall through: the page can do it too, only less smoothly.
    }
  }
  return refineSelection(pixels, mask, width, height, settings, dabs, scale);
}
