import { useCallback, useRef, useState, useEffect } from "react";
import { Canvas as FabricCanvas } from "fabric";
import {
  takeSnapshot,
  parseSnapshot,
  type CanvasSnapshot,
} from "@/utils/canvasSnapshot";
import { fireCanvasEvent, HISTORY_RESTORED } from "@/utils/canvasEvents";
import { isEditorChrome, normalizeEditorObjects } from "@/utils/editorObjects";
import { selectionOf, type PixelSelection } from "@/selection/state";
import {
  restoreSelection,
  sameStoredSelection,
  storedSize,
  storeSelection,
  type StoredSelection,
} from "@/selection/history";
import type { FabricObject } from "fabric";

const MAX_HISTORY = 50;
const MAX_HISTORY_JSON_CHARS = 24 * 1024 * 1024;
const MAX_HISTORY_SOURCE_CHARS = 104 * 1024 * 1024;
/** The selections the steps keep, as kept (most are a few kilobytes). */
const MAX_HISTORY_SELECTION_BYTES = 96 * 1024 * 1024;

interface UseUndoRedoReturn {
  saveState: () => void;
  undo: () => void;
  redo: () => void;
  /** The History panel's steps, oldest first, and which one the document is at. */
  steps: string[];
  currentStep: number;
  /** Go back or forward to any step. */
  goTo: (index: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Live versions for event handlers, which may run before a re-render. */
  hasUndo: () => boolean;
  hasRedo: () => boolean;
}

const snapshotsEqual = (a: CanvasSnapshot, b: CanvasSnapshot): boolean =>
  a.json === b.json &&
  a.srcs.length === b.srcs.length &&
  a.srcs.every((source, index) => source === b.srcs[index]);

const historyFitsBudget = (history: CanvasSnapshot[], selections: (StoredSelection | null)[]): boolean => {
  let selectionBytes = 0;
  for (const record of new Set(selections)) selectionBytes += storedSize(record);
  if (selectionBytes > MAX_HISTORY_SELECTION_BYTES) return false;
  let jsonChars = 0;
  let sourceChars = 0;
  const uniqueSources = new Set<string>();
  for (const snapshot of history) {
    jsonChars += snapshot.json.length;
    for (const source of snapshot.srcs) {
      if (!uniqueSources.has(source)) {
        uniqueSources.add(source);
        sourceChars += source.length;
      }
    }
  }
  return (
    jsonChars <= MAX_HISTORY_JSON_CHARS &&
    sourceChars <= MAX_HISTORY_SOURCE_CHARS
  );
};

export function useUndoRedo(
  canvas: FabricCanvas | null,
  onSnapshot?: (snapshot: CanvasSnapshot) => void,
  onError?: (error: unknown) => void,
  /** What a new step is called, from the state before it (none for the first) and after. */
  nameStep?: (before: CanvasSnapshot | undefined, after: CanvasSnapshot) => string
): UseUndoRedoReturn {
  const historyRef = useRef<CanvasSnapshot[]>([]);
  const namesRef = useRef<string[]>([]);
  /** The pixel selection at each step: changing it is a step of its own. */
  const selectionsRef = useRef<(StoredSelection | null)[]>([]);
  const currentIndexRef = useRef<number>(-1);
  const isRestoringRef = useRef(false);
  const restoreControllerRef = useRef<AbortController | null>(null);
  const pendingSaveRef = useRef<number | null>(null);
  /** What the pending save waits on: a change of the document, of the selection (as it was then), or both. */
  const pendingDocumentRef = useRef(false);
  const pendingSelectionRef = useRef<{ selection: PixelSelection | null; label: string } | null>(null);

  // Kept in a ref so a changing callback identity doesn't resubscribe
  // the canvas listeners below
  const onSnapshotRef = useRef(onSnapshot);
  const onErrorRef = useRef(onError);
  const nameStepRef = useRef(nameStep);
  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
    onErrorRef.current = onError;
    nameStepRef.current = nameStep;
  }, [onError, onSnapshot, nameStep]);

  // Force re-render when history changes so canUndo/canRedo update
  const [, setHistoryVersion] = useState(0);
  const [isRestoring, setIsRestoring] = useState(false);

  const reportError = useCallback((error: unknown) => {
    try {
      onErrorRef.current?.(error);
    } catch {
      // Error presentation must not corrupt the history state machine.
    }
  }, []);

  const saveState = useCallback((selectionThen?: { selection: PixelSelection | null; label: string }) => {
    if (!canvas || isRestoringRef.current) return;

    try {
      // Trim redo states ahead of the current index before appending.
      const history = historyRef.current.slice(
        0,
        currentIndexRef.current + 1
      );
      const names = namesRef.current.slice(0, history.length);
      const selections = selectionsRef.current.slice(0, history.length);
      const snapshot = takeSnapshot(canvas);
      const store = selectionOf(canvas);
      const selection = storeSelection(selectionThen ? selectionThen.selection : store.current());
      const previous = history[history.length - 1];
      const sameDocument = !!previous && snapshotsEqual(previous, snapshot);
      if (sameDocument && sameStoredSelection(selections[selections.length - 1] ?? null, selection)) return;
      let name = previous ? "Change" : "Open";
      if (sameDocument) name = selectionThen?.label ?? store.label;
      else {
        try {
          name = nameStepRef.current?.(previous, snapshot) ?? name;
        } catch {
          // A step without its proper name is still a step.
        }
      }
      // A step that only changes the selection keeps the document as it was.
      history.push(sameDocument ? previous : snapshot);
      names.push(name);
      selections.push(selection);

      // Retain the current state even if it alone exceeds the soft memory
      // budget; discard oldest undo points until the rest fits.
      while (
        history.length > 1 &&
        (history.length > MAX_HISTORY || !historyFitsBudget(history, selections))
      ) {
        history.shift();
        names.shift();
        selections.shift();
      }

      historyRef.current = history;
      namesRef.current = names;
      selectionsRef.current = selections;
      currentIndexRef.current = history.length - 1;
      if (!sameDocument) onSnapshotRef.current?.(snapshot);
      setHistoryVersion((v) => v + 1);
    } catch (error) {
      reportError(error);
    }
  }, [canvas, reportError]);

  const cancelPendingSave = useCallback(() => {
    if (pendingSaveRef.current !== null) {
      window.clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
    pendingDocumentRef.current = false;
    pendingSelectionRef.current = null;
  }, []);

  // Coalesce bursts of canvas events into one history entry per tick —
  // a crop fires N object:removed plus an object:added, but is one user action
  const scheduleSave = useCallback(() => {
    if (!canvas || isRestoringRef.current || pendingSaveRef.current !== null) {
      return;
    }
    pendingSaveRef.current = window.setTimeout(() => {
      pendingSaveRef.current = null;
      pendingDocumentRef.current = false;
      pendingSelectionRef.current = null;
      saveState();
    }, 0);
  }, [canvas, saveState]);

  /**
   * A change of the selection joins a change of the document made with it
   * (a crop drops the selection) in one step; a second change of the
   * selection before the step is saved makes the first one a step of its own.
   */
  const selectionChanged = useCallback(() => {
    if (!canvas || isRestoringRef.current) return;
    const first = pendingSelectionRef.current;
    if (pendingSaveRef.current !== null && first && !pendingDocumentRef.current) {
      cancelPendingSave();
      saveState(first);
    }
    const store = selectionOf(canvas);
    pendingSelectionRef.current = { selection: store.peek(), label: store.label };
    scheduleSave();
  }, [canvas, cancelPendingSave, saveState, scheduleSave]);

  const restoreState = useCallback(
    (snapshot: CanvasSnapshot, targetIndex: number) => {
      if (!canvas) return;

      restoreControllerRef.current?.abort();
      const controller = new AbortController();
      restoreControllerRef.current = controller;
      isRestoringRef.current = true;
      setIsRestoring(true);

      const finish = () => {
        if (restoreControllerRef.current !== controller) return;
        restoreControllerRef.current = null;
        isRestoringRef.current = false;
        setIsRestoring(false);
        setHistoryVersion((v) => v + 1);
      };

      /** The step's selection, as it was then. */
      const selectAsThen = () => {
        const record = selectionsRef.current[targetIndex] ?? null;
        const store = selectionOf(canvas);
        if (!record) {
          if (store.peek()) store.set(null);
          return;
        }
        if (sameStoredSelection(storeSelection(store.peek()), record)) return;
        const selection = restoreSelection(record);
        store.set(selection.mask, selection.grid);
      };

      let document: ReturnType<typeof parseSnapshot>;
      let rollbackDocument: ReturnType<typeof parseSnapshot>;
      try {
        const live = takeSnapshot(canvas);
        if (snapshotsEqual(live, snapshot)) {
          // Only the selection differs: no need to load the document again.
          selectAsThen();
          currentIndexRef.current = targetIndex;
          finish();
          return;
        }
        document = parseSnapshot(snapshot);
        rollbackDocument = parseSnapshot(live);
      } catch (error) {
        reportError(error);
        finish();
        return;
      }

      void canvas
        .loadFromJSON(document, undefined, { signal: controller.signal })
        .then(() => {
          if (controller.signal.aborted) return;
          const background = normalizeEditorObjects(canvas);
          if (background) canvas.sendObjectToBack(background);
          canvas.renderAll();
          currentIndexRef.current = targetIndex;
          try {
            selectAsThen();
            // Let panels resync UI state (e.g. filter sliders) after a restore.
            fireCanvasEvent(canvas, HISTORY_RESTORED);
            // The restored state is now the current document — autosave it too.
            onSnapshotRef.current?.(snapshot);
          } catch (error) {
            reportError(error);
          }
        })
        .catch(async (error) => {
          if (controller.signal.aborted) return;
          try {
            await canvas.loadFromJSON(rollbackDocument, undefined, {
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            const background = normalizeEditorObjects(canvas);
            if (background) canvas.sendObjectToBack(background);
            canvas.renderAll();
            fireCanvasEvent(canvas, HISTORY_RESTORED);
            reportError(error);
          } catch (rollbackError) {
            if (!controller.signal.aborted) {
              const restoreMessage =
                error instanceof Error ? error.message : String(error);
              const rollbackMessage =
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError);
              reportError(
                new Error(
                  `Undo/redo failed (${restoreMessage}); rollback also failed (${rollbackMessage})`
                )
              );
            }
          }
        })
        .finally(finish);
    },
    [canvas, reportError]
  );

  const undo = useCallback(() => {
    if (currentIndexRef.current <= 0 || isRestoringRef.current) return;

    cancelPendingSave();
    const targetIndex = currentIndexRef.current - 1;
    const snapshot = historyRef.current[targetIndex];
    if (snapshot) {
      restoreState(snapshot, targetIndex);
    }
  }, [cancelPendingSave, restoreState]);

  const goTo = useCallback(
    (index: number) => {
      if (
        isRestoringRef.current ||
        index === currentIndexRef.current ||
        index < 0 ||
        index >= historyRef.current.length
      )
        return;
      cancelPendingSave();
      const snapshot = historyRef.current[index];
      if (snapshot) restoreState(snapshot, index);
    },
    [cancelPendingSave, restoreState]
  );

  const redo = useCallback(() => {
    if (
      currentIndexRef.current >= historyRef.current.length - 1 ||
      isRestoringRef.current
    )
      return;

    cancelPendingSave();
    const targetIndex = currentIndexRef.current + 1;
    const snapshot = historyRef.current[targetIndex];
    if (snapshot) {
      restoreState(snapshot, targetIndex);
    }
  }, [cancelPendingSave, restoreState]);

  // Auto-save on canvas events
  useEffect(() => {
    if (!canvas) return;

    // Fresh canvas instance (new project / image reload) — drop stale history
    restoreControllerRef.current?.abort();
    restoreControllerRef.current = null;
    isRestoringRef.current = false;
    setIsRestoring(false);
    historyRef.current = [];
    namesRef.current = [];
    selectionsRef.current = [];
    currentIndexRef.current = -1;

    const handleSave = (e?: { target?: unknown }) => {
      // Crop/marquee overlays and drawing previews are UI chrome
      const target = e?.target as FabricObject | undefined;
      if (target && isEditorChrome(target)) return;
      if (!isRestoringRef.current) pendingDocumentRef.current = true;
      scheduleSave();
    };

    canvas.on("object:added", handleSave);
    canvas.on("object:modified", handleSave);
    canvas.on("object:removed", handleSave);
    const stopWatchingSelection = selectionOf(canvas).onChange(selectionChanged);

    // Save initial state
    saveState();

    return () => {
      restoreControllerRef.current?.abort();
      restoreControllerRef.current = null;
      isRestoringRef.current = false;
      cancelPendingSave();
      stopWatchingSelection();
      canvas.off("object:added", handleSave);
      canvas.off("object:modified", handleSave);
      canvas.off("object:removed", handleSave);
    };
  }, [canvas, saveState, scheduleSave, cancelPendingSave, selectionChanged]);

  const canUndo = !isRestoring && currentIndexRef.current > 0;
  const canRedo =
    !isRestoring && currentIndexRef.current < historyRef.current.length - 1;
  const hasUndo = useCallback(
    () => !isRestoringRef.current && currentIndexRef.current > 0,
    []
  );
  const hasRedo = useCallback(
    () =>
      !isRestoringRef.current &&
      currentIndexRef.current < historyRef.current.length - 1,
    []
  );

  const saveNow = useCallback(() => saveState(), [saveState]);

  return {
    saveState: saveNow,
    undo,
    redo,
    steps: namesRef.current,
    currentStep: currentIndexRef.current,
    goTo,
    canUndo,
    canRedo,
    hasUndo,
    hasRedo,
  };
}
