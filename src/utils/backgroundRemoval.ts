// Request-correlated client for the background-removal Web Worker. The heavy
// model stays off the main thread; this module owns lifecycle, cancellation,
// timeout, crash recovery, and response routing.

const DEFAULT_TIMEOUT_MS = 4 * 60 * 1_000;
const MAX_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_PENDING_REQUESTS = 4;
const MAX_BLOB_BYTES = 16 * 1024 * 1024;

type WorkerRequest = { type: "process"; requestId: string; blob: Blob };

export interface RemoveBackgroundOptions {
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface WorkerTransport {
  postMessage(message: WorkerRequest): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  addEventListener(
    type: "error",
    listener: (event: ErrorEvent) => void
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  removeEventListener(
    type: "error",
    listener: (event: ErrorEvent) => void
  ): void;
  terminate(): void;
}

type PendingRequest = {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const abortError = (): Error => {
  const error = new Error("Background removal was cancelled");
  error.name = "AbortError";
  return error;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

export class BackgroundRemovalClient {
  private worker: WorkerTransport | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private requestSequence = 0;

  constructor(
    private readonly createWorker: () => WorkerTransport = () =>
      new Worker(new URL("./backgroundRemoval.worker.ts", import.meta.url), {
        type: "module",
      })
  ) {}

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (!isRecord(data) || typeof data.requestId !== "string") return;
    const pending = this.pending.get(data.requestId);
    if (!pending) return; // stale response from a request already settled

    if (data.type === "progress" && typeof data.message === "string") {
      try {
        pending.onProgress?.(data.message);
      } catch {
        // A presentation callback must never corrupt worker request routing.
      }
      return;
    }
    if (
      data.type === "result" &&
      data.result instanceof Blob &&
      data.result.type === "image/png" &&
      data.result.size > 0 &&
      data.result.size <= MAX_BLOB_BYTES
    ) {
      this.finish(data.requestId, { result: data.result });
      return;
    }
    if (data.type === "error" && typeof data.message === "string") {
      this.finish(data.requestId, {
        error: new Error(`Background removal failed: ${data.message}`),
      });
      return;
    }

    this.stopWorker(new Error("Background removal worker sent an invalid response"));
  };

  private readonly handleError = (event: ErrorEvent) => {
    const detail = event.message ? `: ${event.message}` : "";
    this.stopWorker(new Error(`Background removal worker crashed${detail}`));
  };

  private getWorker(): WorkerTransport {
    if (!this.worker) {
      const worker = this.createWorker();
      try {
        worker.addEventListener("message", this.handleMessage);
        worker.addEventListener("error", this.handleError);
        this.worker = worker;
      } catch (error) {
        worker.removeEventListener("message", this.handleMessage);
        worker.removeEventListener("error", this.handleError);
        worker.terminate();
        throw error;
      }
    }
    return this.worker;
  }

  private finish(
    requestId: string,
    outcome: { result: Blob } | { error: Error }
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timeoutId);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    if ("result" in outcome) pending.resolve(outcome.result);
    else pending.reject(outcome.error);
  }

  private stopWorker(reason: Error): void {
    if (this.worker) {
      this.worker.removeEventListener("message", this.handleMessage);
      this.worker.removeEventListener("error", this.handleError);
      this.worker.terminate();
      this.worker = null;
    }
    for (const requestId of [...this.pending.keys()]) {
      this.finish(requestId, { error: reason });
    }
  }

  remove(
    imageBlob: Blob,
    options: RemoveBackgroundOptions = {}
  ): Promise<Blob> {
    if (
      imageBlob.type !== "image/png" ||
      imageBlob.size === 0 ||
      imageBlob.size > MAX_BLOB_BYTES
    ) {
      return Promise.reject(new Error("Background removal input is invalid"));
    }
    if (options.signal?.aborted) return Promise.reject(abortError());
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error("Too many background removal requests"));
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      return Promise.reject(new Error("Background removal timeout is invalid"));
    }

    this.requestSequence += 1;
    const requestId = `${Date.now().toString(36)}-${this.requestSequence.toString(36)}`;

    return new Promise<Blob>((resolve, reject) => {
      let transport: WorkerTransport;
      try {
        transport = this.getWorker();
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Could not start background removal worker")
        );
        return;
      }

      const timeoutId = setTimeout(() => {
        this.stopWorker(
          new Error(`Background removal timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`)
        );
      }, timeoutMs);
      const pending: PendingRequest = {
        resolve,
        reject,
        onProgress: options.onProgress,
        signal: options.signal,
        timeoutId,
      };
      if (options.signal) {
        pending.abortListener = () => this.stopWorker(abortError());
        options.signal.addEventListener("abort", pending.abortListener, {
          once: true,
        });
      }
      this.pending.set(requestId, pending);

      try {
        transport.postMessage({ type: "process", requestId, blob: imageBlob });
      } catch (error) {
        this.stopWorker(
          error instanceof Error
            ? error
            : new Error("Could not send data to background removal worker")
        );
      }
    });
  }

  dispose(): void {
    this.stopWorker(abortError());
  }
}

const backgroundRemovalClient = new BackgroundRemovalClient();

export const removeBackground = (
  imageBlob: Blob,
  options?: RemoveBackgroundOptions
): Promise<Blob> => backgroundRemovalClient.remove(imageBlob, options);

export const blobToDataURL = (
  blob: Blob,
  signal?: AbortSignal
): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const reader = new FileReader();
    const onAbort = () => {
      reader.abort();
      reject(abortError());
    };
    reader.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read background removal result"));
    };
    reader.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(reader.error ?? new Error("Failed to read blob"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    reader.readAsDataURL(blob);
  });
