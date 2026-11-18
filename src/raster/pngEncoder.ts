/**
 * PNG encoding for painted layers, in a worker where the browser allows it
 * and on the main thread otherwise.
 */

interface Pending {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null | undefined;
let sequence = 0;
const pending = new Map<number, Pending>();

function failAll(error: Error) {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function encoderWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    worker = null;
    return worker;
  }
  try {
    worker = new Worker(new URL("./pngEncoder.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
    return worker;
  }
  worker.addEventListener("message", (event: MessageEvent) => {
    const { id, blob, error } = event.data as { id: number; blob?: Blob; error?: string };
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (blob && blob.size > 0) request.resolve(blob);
    else request.reject(new Error(error ?? "The worker could not encode the layer"));
  });
  worker.addEventListener("error", () => {
    // Never usable (blocked, or no 2D canvas in workers): use the main thread.
    worker?.terminate();
    worker = null;
    failAll(new Error("The PNG worker stopped"));
  });
  return worker;
}

const encodeOnMainThread = (surface: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    surface.toBlob((blob) => {
      if (blob && blob.size > 0) resolve(blob);
      else reject(new Error("The browser could not encode the painted layer"));
    }, "image/png");
  });

async function encodeInWorker(encoder: Worker, surface: HTMLCanvasElement): Promise<Blob> {
  const bitmap = await createImageBitmap(surface);
  const id = (sequence += 1);
  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    encoder.postMessage({ id, bitmap }, [bitmap]);
  });
}

export async function encodePng(surface: HTMLCanvasElement): Promise<Blob> {
  const encoder = encoderWorker();
  if (encoder) {
    try {
      return await encodeInWorker(encoder, surface);
    } catch {
      // Fall through: the main thread can always do it, only later.
    }
  }
  return encodeOnMainThread(surface);
}
