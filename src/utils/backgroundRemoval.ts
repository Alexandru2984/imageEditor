// Client for the background-removal Web Worker. The heavy transformers.js
// pipeline lives in backgroundRemoval.worker.ts and runs off the main thread;
// this module just spawns/reuses the worker and adapts its messages back to the
// existing `removeBackground(blob, onProgress)` API callers already use.

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./backgroundRemoval.worker.ts", import.meta.url),
      { type: "module" }
    );
  }
  return worker;
}

type WorkerMessage =
  | { type: "progress"; message: string }
  | { type: "result"; result: Blob }
  | { type: "error"; message: string };

export function removeBackground(
  imageBlob: Blob,
  onProgress?: (message: string) => void
): Promise<Blob> {
  const w = getWorker();

  return new Promise<Blob>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerMessage>) => {
      const data = e.data;
      if (data.type === "progress") {
        onProgress?.(data.message);
      } else if (data.type === "result") {
        cleanup();
        resolve(data.result);
      } else if (data.type === "error") {
        cleanup();
        reject(new Error(`Background removal failed: ${data.message}`));
      }
    };
    const onError = (err: ErrorEvent) => {
      cleanup();
      reject(new Error(`Background removal worker crashed: ${err.message}`));
    };
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ type: "process", blob: imageBlob });
  });
}

export const blobToDataURL = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
