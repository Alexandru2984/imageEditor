import { runJob, type JobArea, type PixelJob } from "./pixelJobs";

/**
 * Adjustments and filters run in a worker where the browser allows it, and
 * on the main thread otherwise (or if the worker cannot run a job).
 */

interface Pending {
  resolve: (result: Uint8ClampedArray) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null | undefined;
let sequence = 0;
const pending = new Map<number, Pending>();

function jobWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") {
    worker = null;
    return worker;
  }
  try {
    worker = new Worker(new URL("./pixelJobs.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
    return worker;
  }
  worker.addEventListener("message", (event: MessageEvent) => {
    const { id, result, error } = event.data as { id: number; result?: Uint8ClampedArray; error?: string };
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (result) request.resolve(result);
    else request.reject(new Error(error ?? "The worker could not run the filter"));
  });
  worker.addEventListener("error", () => {
    worker?.terminate();
    worker = null;
    for (const request of pending.values()) request.reject(new Error("The filter worker stopped"));
    pending.clear();
  });
  return worker;
}

/**
 * Run a job on pixels around a region of `width` × `height`. The area's
 * pixels are handed over to the worker, so pass a copy you can spare.
 */
export async function runPixelJob(
  job: PixelJob,
  area: JobArea,
  width: number,
  height: number,
  origin: { x: number; y: number }
): Promise<Uint8ClampedArray> {
  const runner = jobWorker();
  if (runner) {
    const id = (sequence += 1);
    const copy = { ...area, data: area.data.slice() };
    try {
      return await new Promise<Uint8ClampedArray>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        runner.postMessage({ id, job, area: copy, width, height, origin }, [copy.data.buffer]);
      });
    } catch {
      // Fall through: the page can always do it, only less smoothly.
    }
  }
  return runJob(job, area, width, height, origin);
}
