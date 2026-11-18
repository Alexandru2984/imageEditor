import { useSyncExternalStore } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { maskTargetOf, type MaskedImage } from "@/raster/layerMask";

const noSubscription = () => () => {};

/** The layer whose mask the paint tools work on, if any. */
export function useMaskTarget(canvas: FabricCanvas | null): MaskedImage | null {
  const store = canvas ? maskTargetOf(canvas) : null;
  useSyncExternalStore(store?.subscribe ?? noSubscription, () => store?.version ?? 0);
  return store?.layer() ?? null;
}
