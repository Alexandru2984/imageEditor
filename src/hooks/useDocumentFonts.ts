import { useEffect } from "react";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { HISTORY_RESTORED, offCanvasEvent, onCanvasEvent } from "@/utils/canvasEvents";
import { loadDocumentFonts } from "@/utils/fonts";

/**
 * Keep text layers measured with their real typeface: load bundled fonts when
 * a document opens, after undo/redo and whenever a text layer is added.
 */
export function useDocumentFonts(canvas: FabricCanvas | null): void {
  useEffect(() => {
    if (!canvas) return;
    const loadAll = () => void loadDocumentFonts(canvas);
    const handleAdded = ({ target }: { target: FabricObject }) => {
      void loadDocumentFonts(canvas, [target]);
    };
    loadAll();
    onCanvasEvent(canvas, HISTORY_RESTORED, loadAll);
    canvas.on("object:added", handleAdded);
    return () => {
      offCanvasEvent(canvas, HISTORY_RESTORED, loadAll);
      canvas.off("object:added", handleAdded);
    };
  }, [canvas]);
}
