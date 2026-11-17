import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

// Interface choices (open panel, colours, brush settings) outlive a document:
// the editor workspace is remounted for every document, and these should not
// reset when the user starts a new one. Memory only, for this page session.
const sessionValues = new Map<string, unknown>();

export function useSessionState<T>(
  key: string,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (sessionValues.has(key)) return sessionValues.get(key) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((current) => {
        const resolved =
          typeof next === "function" ? (next as (previous: T) => T)(current) : next;
        sessionValues.set(key, resolved);
        return resolved;
      });
    },
    [key]
  );
  return [value, update];
}

/** For tests: forget every remembered value. */
export function resetSessionState(): void {
  sessionValues.clear();
}
