// Web Worker: Select and Mask's edge refinement (see refineEdge.ts), so the
// page stays responsive while a large photo's edge is worked out.

import { refineSelection, type RefineDab, type RefineSettings } from "./refineEdge";

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

ctx.addEventListener("message", (event) => {
  const { id, pixels, mask, width, height, settings, dabs, scale } = event.data as {
    id: number;
    pixels: Uint8ClampedArray;
    mask: Uint8Array;
    width: number;
    height: number;
    settings: RefineSettings;
    dabs: RefineDab[];
    scale: number;
  };
  try {
    const result = refineSelection(pixels, mask, width, height, settings, dabs, scale);
    ctx.postMessage({ id, result }, [result.buffer]);
  } catch (error) {
    ctx.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
