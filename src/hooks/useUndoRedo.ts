import { useCallback, useRef, useState, useEffect } from "react";
import { Canvas as FabricCanvas, FabricImage } from "fabric";

const MAX_HISTORY = 50;

// Properties not serialized by default toObject() but load-bearing for us:
// selectable marks the background image, lock* back the layer lock feature.
const EXTRA_PROPS = [
  "selectable",
  "evented",
  "lockMovementX",
  "lockMovementY",
  "lockRotation",
  "lockScalingX",
  "lockScalingY",
  "hasControls",
];

interface UseUndoRedoReturn {
  saveState: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoRedo(canvas: FabricCanvas | null): UseUndoRedoReturn {
  const historyRef = useRef<string[]>([]);
  const currentIndexRef = useRef<number>(-1);
  const isRestoringRef = useRef(false);

  // Force re-render when history changes so canUndo/canRedo update
  const [, setHistoryVersion] = useState(0);

  const saveState = useCallback(() => {
    if (!canvas || isRestoringRef.current) return;

    const json = JSON.stringify(canvas.toObject(EXTRA_PROPS));

    // Trim any redo states ahead of current index
    historyRef.current = historyRef.current.slice(0, currentIndexRef.current + 1);

    historyRef.current.push(json);

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

  const restoreState = useCallback(
    (json: string) => {
      if (!canvas) return;

      isRestoringRef.current = true;

      canvas.loadFromJSON(JSON.parse(json)).then(() => {
        // Preserve background image: find FabricImage objects that are non-selectable
        // and send them to back
        const objects = canvas.getObjects();
        for (const obj of objects) {
          if (obj instanceof FabricImage && !obj.selectable) {
            canvas.sendObjectToBack(obj);
          }
        }
        canvas.renderAll();
        isRestoringRef.current = false;
        setHistoryVersion((v) => v + 1);
      });
    },
    [canvas]
  );

  const undo = useCallback(() => {
    if (currentIndexRef.current <= 0 || isRestoringRef.current) return;

    currentIndexRef.current -= 1;
    const state = historyRef.current[currentIndexRef.current];
    if (state) {
      restoreState(state);
    }
  }, [restoreState]);

  const redo = useCallback(() => {
    if (
      currentIndexRef.current >= historyRef.current.length - 1 ||
      isRestoringRef.current
    )
      return;

    currentIndexRef.current += 1;
    const state = historyRef.current[currentIndexRef.current];
    if (state) {
      restoreState(state);
    }
  }, [restoreState]);

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
      if (!isRestoringRef.current) {
        saveState();
      }
    };

    canvas.on("object:added", handleSave);
    canvas.on("object:modified", handleSave);
    canvas.on("object:removed", handleSave);

    // Save initial state
    saveState();

    return () => {
      canvas.off("object:added", handleSave);
      canvas.off("object:modified", handleSave);
      canvas.off("object:removed", handleSave);
    };
  }, [canvas, saveState]);

  const canUndo = currentIndexRef.current > 0;
  const canRedo = currentIndexRef.current < historyRef.current.length - 1;

  return { saveState, undo, redo, canUndo, canRedo };
}
