import { useCallback, useRef, useState, useEffect } from "react";
import { Canvas as FabricCanvas, FabricImage } from "fabric";
import {
  takeSnapshot,
  parseSnapshot,
  type CanvasSnapshot,
} from "@/utils/canvasSnapshot";
import { fireCanvasEvent, HISTORY_RESTORED } from "@/utils/canvasEvents";

const MAX_HISTORY = 50;

interface UseUndoRedoReturn {
  saveState: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoRedo(
  canvas: FabricCanvas | null,
  onSnapshot?: (snapshot: CanvasSnapshot) => void
): UseUndoRedoReturn {
  const historyRef = useRef<CanvasSnapshot[]>([]);
  const currentIndexRef = useRef<number>(-1);
  const isRestoringRef = useRef(false);
  const pendingSaveRef = useRef<number | null>(null);

  // Kept in a ref so a changing callback identity doesn't resubscribe
  // the canvas listeners below
  const onSnapshotRef = useRef(onSnapshot);
  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  // Force re-render when history changes so canUndo/canRedo update
  const [, setHistoryVersion] = useState(0);

  const saveState = useCallback(() => {
    if (!canvas || isRestoringRef.current) return;

    // Trim any redo states ahead of current index
    historyRef.current = historyRef.current.slice(0, currentIndexRef.current + 1);

    const snapshot = takeSnapshot(canvas);
    historyRef.current.push(snapshot);
    onSnapshotRef.current?.(snapshot);

    // Enforce max history
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      currentIndexRef.current += 1;
    }

    // If we shifted, current index stays the same (pointing to new end)
    if (historyRef.current.length === MAX_HISTORY) {
      currentIndexRef.current = MAX_HISTORY - 1;
    }

    setHistoryVersion((v) => v + 1);
  }, [canvas]);

  const cancelPendingSave = useCallback(() => {
    if (pendingSaveRef.current !== null) {
      window.clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
  }, []);

  // Coalesce bursts of canvas events into one history entry per tick —
  // a crop fires N object:removed plus an object:added, but is one user action
  const scheduleSave = useCallback(() => {
    if (!canvas || isRestoringRef.current || pendingSaveRef.current !== null) {
      return;
    }
    pendingSaveRef.current = window.setTimeout(() => {
      pendingSaveRef.current = null;
      saveState();
    }, 0);
  }, [canvas, saveState]);

  const restoreState = useCallback(
    (snapshot: CanvasSnapshot) => {
      if (!canvas) return;

      isRestoringRef.current = true;

      canvas.loadFromJSON(parseSnapshot(snapshot)).then(() => {
        // Preserve background image: find FabricImage objects that are
        // non-selectable and send them to back
        const objects = canvas.getObjects();
        for (const obj of objects) {
          if (obj instanceof FabricImage && !obj.selectable) {
            canvas.sendObjectToBack(obj);
          }
        }
        canvas.renderAll();
        isRestoringRef.current = false;
        // Let panels resync UI state (e.g. filter sliders) after a restore
        fireCanvasEvent(canvas, HISTORY_RESTORED);
        // The restored state is now the current document — autosave it too
        onSnapshotRef.current?.(snapshot);
        setHistoryVersion((v) => v + 1);
      });
    },
    [canvas]
  );

  const undo = useCallback(() => {
    if (currentIndexRef.current <= 0 || isRestoringRef.current) return;

    cancelPendingSave();
    currentIndexRef.current -= 1;
    const snapshot = historyRef.current[currentIndexRef.current];
    if (snapshot) {
      restoreState(snapshot);
    }
  }, [cancelPendingSave, restoreState]);

  const redo = useCallback(() => {
    if (
      currentIndexRef.current >= historyRef.current.length - 1 ||
      isRestoringRef.current
    )
      return;

    cancelPendingSave();
    currentIndexRef.current += 1;
    const snapshot = historyRef.current[currentIndexRef.current];
    if (snapshot) {
      restoreState(snapshot);
    }
  }, [cancelPendingSave, restoreState]);

  // Auto-save on canvas events
  useEffect(() => {
    if (!canvas) return;

    // Fresh canvas instance (new project / image reload) — drop stale history
    historyRef.current = [];
    currentIndexRef.current = -1;

    const handleSave = (e?: { target?: unknown }) => {
      // The crop selection overlay is UI chrome, not document content
      const target = e?.target as Record<string, unknown> | undefined;
      if (target?.__isCropOverlay) return;
      scheduleSave();
    };

    canvas.on("object:added", handleSave);
    canvas.on("object:modified", handleSave);
    canvas.on("object:removed", handleSave);

    // Save initial state
    saveState();

    return () => {
      cancelPendingSave();
      canvas.off("object:added", handleSave);
      canvas.off("object:modified", handleSave);
      canvas.off("object:removed", handleSave);
    };
  }, [canvas, saveState, scheduleSave, cancelPendingSave]);

  const canUndo = currentIndexRef.current > 0;
  const canRedo = currentIndexRef.current < historyRef.current.length - 1;

  return { saveState, undo, redo, canUndo, canRedo };
}
