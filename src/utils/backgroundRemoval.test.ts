import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundRemovalClient,
  type WorkerTransport,
} from "./backgroundRemoval";

class FakeWorker {
  readonly sent: unknown[] = [];
  terminated = false;
  private readonly messageListeners = new Set<
    (event: MessageEvent<unknown>) => void
  >();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === "message") {
      this.messageListeners.add(
        listener as (event: MessageEvent<unknown>) => void
      );
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    if (type === "message") {
      this.messageListeners.delete(
        listener as (event: MessageEvent<unknown>) => void
      );
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    const event = { data } as MessageEvent<unknown>;
    this.messageListeners.forEach((listener) => listener(event));
  }

  emitError(message: string): void {
    const event = { message } as ErrorEvent;
    this.errorListeners.forEach((listener) => listener(event));
  }
}

const inputBlob = () => new Blob(["input"], { type: "image/png" });
const requestIdAt = (worker: FakeWorker, index: number): string =>
  (worker.sent[index] as { requestId: string }).requestId;

afterEach(() => {
  vi.useRealTimers();
});

describe("BackgroundRemovalClient", () => {
  it("routes interleaved responses and progress by request ID", async () => {
    const worker = new FakeWorker();
    const client = new BackgroundRemovalClient(
      () => worker as unknown as WorkerTransport
    );
    const firstProgress = vi.fn();
    const first = client.remove(inputBlob(), { onProgress: firstProgress });
    const second = client.remove(inputBlob());
    const firstId = requestIdAt(worker, 0);
    const secondId = requestIdAt(worker, 1);
    const firstResult = new Blob(["first"], { type: "image/png" });
    const secondResult = new Blob(["second"], { type: "image/png" });

    worker.emitMessage({
      type: "progress",
      requestId: firstId,
      message: "working",
    });
    worker.emitMessage({
      type: "result",
      requestId: secondId,
      result: secondResult,
    });
    worker.emitMessage({
      type: "result",
      requestId: firstId,
      result: firstResult,
    });

    await expect(first).resolves.toBe(firstResult);
    await expect(second).resolves.toBe(secondResult);
    expect(firstProgress).toHaveBeenCalledWith("working");
    client.dispose();
  });

  it("terminates the worker and rejects pending work when aborted", async () => {
    const worker = new FakeWorker();
    const client = new BackgroundRemovalClient(
      () => worker as unknown as WorkerTransport
    );
    const controller = new AbortController();
    const result = client.remove(inputBlob(), { signal: controller.signal });
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });

    controller.abort();

    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it("times out, rejects every queued request, and restarts cleanly", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const client = new BackgroundRemovalClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as WorkerTransport;
    });
    const first = client.remove(inputBlob(), { timeoutMs: 10 });
    const second = client.remove(inputBlob(), { timeoutMs: 20 });
    const firstRejection = expect(first).rejects.toThrow(/timed out/i);
    const secondRejection = expect(second).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(11);

    await firstRejection;
    await secondRejection;
    expect(workers[0]?.terminated).toBe(true);

    const retry = client.remove(inputBlob(), { timeoutMs: 100 });
    expect(workers).toHaveLength(2);
    const retryResult = new Blob(["retry"], { type: "image/png" });
    workers[1]?.emitMessage({
      type: "result",
      requestId: requestIdAt(workers[1]!, 0),
      result: retryResult,
    });
    await expect(retry).resolves.toBe(retryResult);
    client.dispose();
  });

  it("recovers after a worker crash", async () => {
    const workers: FakeWorker[] = [];
    const client = new BackgroundRemovalClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as WorkerTransport;
    });
    const result = client.remove(inputBlob());
    const rejection = expect(result).rejects.toThrow(/crashed: boom/i);

    workers[0]?.emitError("boom");

    await rejection;
    expect(workers[0]?.terminated).toBe(true);
    void client.remove(inputBlob()).catch(() => {});
    expect(workers).toHaveLength(2);
    client.dispose();
  });

  it("rejects invalid input without creating a worker", async () => {
    const factory = vi.fn();
    const client = new BackgroundRemovalClient(factory);

    await expect(
      client.remove(new Blob(["not a png"], { type: "text/plain" }))
    ).rejects.toThrow(/input is invalid/i);
    expect(factory).not.toHaveBeenCalled();
  });
});
