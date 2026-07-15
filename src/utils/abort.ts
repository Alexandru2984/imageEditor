export const createAbortError = (
  message = "The operation was cancelled"
): Error => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}
