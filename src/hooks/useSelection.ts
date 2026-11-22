import { useCallback, useSyncExternalStore } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { selectionOf, type PixelSelection, type SelectionDraft } from "@/selection/state";

const noSubscription = () => () => {};

/** The canvas's pixel selection and any shape still being built, kept current. */
export function useSelection(canvas: FabricCanvas | null): {
  selection: PixelSelection | null;
  draft: SelectionDraft | null;
} {
  const store = canvas ? selectionOf(canvas) : null;
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : noSubscription()),
    [store]
  );
  useSyncExternalStore(subscribe, () => store?.version ?? -1);
  return { selection: store?.peek() ?? null, draft: store?.draft ?? null };
}

/** Whether the canvas is in Quick Mask mode; renders again only when that changes. */
export function useQuickMask(canvas: FabricCanvas | null): boolean {
  const store = canvas ? selectionOf(canvas) : null;
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : noSubscription()),
    [store]
  );
  return useSyncExternalStore(subscribe, () => store?.quickMask ?? false);
}
