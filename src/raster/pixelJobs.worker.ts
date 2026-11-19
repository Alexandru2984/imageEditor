// Web Worker: runs adjustments and filters (see pixelJobs.ts), so a slow
// blur on a large photo does not freeze the page while its settings change.

import { runJob, type JobArea, type PixelJob } from "./pixelJobs";

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

ctx.addEventListener("message", (event) => {
  const { id, job, area, width, height, origin } = event.data as {
    id: number;
    job: PixelJob;
    area: JobArea;
    width: number;
    height: number;
    origin: { x: number; y: number };
  };
  try {
    const result = runJob(job, area, width, height, origin);
    ctx.postMessage({ id, result }, [result.buffer]);
  } catch (error) {
    ctx.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
