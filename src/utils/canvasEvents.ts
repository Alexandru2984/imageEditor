import type { Canvas as FabricCanvas } from "fabric";

// Fabric's typed event map doesn't include app-specific events. `history:restored`
// is fired by the undo/redo hook after it reloads a snapshot, so panels can
// resync UI state (e.g. filter sliders) that the canvas doesn't drive itself.
export const HISTORY_RESTORED = "history:restored";

type CustomEventCanvas = {
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
  fire(event: string): void;
};

const asCustom = (canvas: FabricCanvas): CustomEventCanvas =>
  canvas as unknown as CustomEventCanvas;

export const onCanvasEvent = (
  canvas: FabricCanvas,
  event: string,
  handler: () => void
): void => asCustom(canvas).on(event, handler);

export const offCanvasEvent = (
  canvas: FabricCanvas,
  event: string,
  handler: () => void
): void => asCustom(canvas).off(event, handler);

export const fireCanvasEvent = (canvas: FabricCanvas, event: string): void =>
  asCustom(canvas).fire(event);
