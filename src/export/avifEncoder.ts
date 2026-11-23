/**
 * AVIF for exports: the browser's own encoder where its canvas has one
 * (Safari), otherwise libavif in a worker, loaded the first time it is
 * needed (about 3.5 MB, from this site).
 */

let native: Promise<boolean> | null = null;

/** Whether this browser's canvas writes AVIF itself (others fall back to PNG). */
export function canvasEncodesAvif(): Promise<boolean> {
  native ??= new Promise((resolve) => {
    try {
      const probe = document.createElement("canvas");
      probe.width = 2;
      probe.height = 2;
      probe.toBlob((blob) => resolve(blob?.type === "image/avif"), "image/avif", 0.5);
    } catch {
      resolve(false);
    }
  });
  return native;
}

interface Pending {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Pending>();

function avifWorker(): Worker {
  if (worker) return worker;
  const started = new Worker(new URL("./avif.worker.ts", import.meta.url), { type: "module" });
  started.addEventListener("message", (event: MessageEvent) => {
    const { id, buffer, error } = event.data as { id: number; buffer?: ArrayBuffer; error?: string };
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (buffer && buffer.byteLength > 0) request.resolve(new Blob([buffer], { type: "image/avif" }));
    else request.reject(new Error(error ?? "The AVIF encoder failed"));
  });
  started.addEventListener("error", () => {
    started.terminate();
    if (worker === started) worker = null;
    for (const request of pending.values()) request.reject(new Error("The AVIF encoder could not start"));
    pending.clear();
  });
  worker = started;
  return started;
}

/** `quality` 0–1, as for JPEG and WebP. */
export async function encodeAvif(element: HTMLCanvasElement, quality: number): Promise<Blob> {
  const percent = Math.round(Math.min(1, Math.max(0, quality)) * 100);
  if (await canvasEncodesAvif()) {
    const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, "image/avif", percent / 100));
    if (blob?.type === "image/avif" && blob.size > 0) return blob;
  }
  const context = element.getContext("2d");
  if (!context) throw new Error("The browser could not read the image to encode");
  const { data, width, height } = context.getImageData(0, 0, element.width, element.height);
  const id = (sequence += 1);
  const encoder = avifWorker();
  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    encoder.postMessage({ id, pixels: data.buffer, width, height, quality: percent }, [data.buffer]);
  });
}
