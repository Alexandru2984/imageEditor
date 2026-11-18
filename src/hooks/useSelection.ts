import { useCallback, useSyncExternalStore } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { selectionOf, type PixelSelection } from "@/selection/state";

const noSubscription = () => () => {};

/** The canvas's pixel selection, re-rendering when it changes. */
export function useSelection(canvas: FabricCanvas | null): PixelSelection | null {
  const store = canvas ? selectionOf(canvas) : null;
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : noSubscription()),
    [store]
  );
  useSyncExternalStore(subscribe, () => store?.version ?? -1);
  return store?.peek() ?? null;
}
