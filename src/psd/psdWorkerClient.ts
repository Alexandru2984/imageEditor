/**
 * One worker per Photoshop file, ended when it is done: reading or writing
 * one can take a lot of memory, which goes back as soon as it is over.
 */
export function runPsdWorker<T>(
  message: unknown,
  transfer: Transferable[],
  options: { signal?: AbortSignal; timeoutMs: number; failure: string }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const { signal, timeoutMs, failure } = options;
    const worker = new Worker(new URL("./psd.worker.ts", import.meta.url), { type: "module" });
    const stop = (error: Error | null, result?: T) => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result as T);
    };
    const onAbort = () => stop(new DOMException("Aborted", "AbortError"));
    const timer = window.setTimeout(() => stop(new Error(`${failure}: it took too long`)), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", (event: MessageEvent) => {
      const { result, error } = event.data as { result?: T; error?: string };
      if (result !== undefined) stop(null, result);
      else stop(new Error(error ?? failure));
    });
    // Out of memory, most likely.
    worker.addEventListener("error", () => stop(new Error(failure)));
    worker.postMessage(message, transfer);
  });
}
