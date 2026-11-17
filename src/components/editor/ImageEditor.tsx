import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StartScreen } from "./StartScreen";
import { StartHeader } from "./StartHeader";
import { Logo } from "./Logo";
import {
  saveProject,
  loadProject,
  clearProject,
  InvalidAutosaveError,
  type SavedProject,
} from "@/utils/projectStore";
import { readProjectFile } from "@/utils/projectFile";
import type { CanvasSnapshot } from "@/utils/canvasSnapshot";
import { isAbortError } from "@/utils/abort";
import { readSafeRasterImage } from "@/utils/imageFile";
import { documentNameFromFile } from "@/utils/fileName";

// Re-export Tool so existing consumers that import from ./ImageEditor still work
export type { Tool } from "@/types/editor";

const AUTOSAVE_DELAY_MS = 800;

// The editing engine (Fabric and every tool) is a separate chunk. The start
// screen renders without it and fetches it once the page is idle, so opening
// a photo is still instant.
const loadWorkspace = () => import("./EditorWorkspace");
const EditorWorkspace = lazy(loadWorkspace);

const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return (
    !!element &&
    (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable)
  );
};

const isProjectFile = (file: File): boolean =>
  file.type === "application/json" || /\.json$/i.test(file.name);

const dragHasFiles = (event: DragEvent): boolean =>
  !!event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");

interface OpenDocument {
  /** Changes for every document, so the workspace starts fresh. */
  id: number;
  image: string;
  snapshot: CanvasSnapshot | null;
  name: string;
}

const EditorLoading = () => (
  <div className="flex h-dvh flex-col overflow-hidden bg-editor-bg text-foreground">
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-editor-panel px-3">
      <Logo className="h-7 w-7" />
    </header>
    <main
      aria-label="Canvas"
      aria-busy="true"
      className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      Opening the editor…
    </main>
  </div>
);

export const ImageEditor = () => {
  const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // Autosaved session found in IndexedDB, offered on the start screen
  const [savedProject, setSavedProject] = useState<SavedProject | null>(null);

  const documentIdRef = useRef(0);
  const autosaveTimerRef = useRef<number | null>(null);
  const latestSnapshotRef = useRef<{
    snapshot: CanvasSnapshot;
    changedAt: number;
  } | null>(null);
  const lastSnapshotTimestampRef = useRef(0);
  const autosaveGenerationRef = useRef(0);
  const autosaveFailureShownRef = useRef(false);
  const autosaveConflictShownRef = useRef(false);
  const documentLoadControllerRef = useRef<AbortController | null>(null);
  const dragDepthRef = useRef(0);

  const hasDocument = openDocument !== null;

  const showDocument = useCallback(
    (image: string, snapshot: CanvasSnapshot | null, name: string) => {
      documentIdRef.current += 1;
      setOpenDocument({ id: documentIdRef.current, image, snapshot, name });
    },
    []
  );

  const cancelDocumentLoad = useCallback(() => {
    documentLoadControllerRef.current?.abort();
    documentLoadControllerRef.current = null;
  }, []);

  const beginDocumentLoad = useCallback((): AbortSignal => {
    documentLoadControllerRef.current?.abort();
    const controller = new AbortController();
    documentLoadControllerRef.current = controller;
    return controller.signal;
  }, []);

  useEffect(() => cancelDocumentLoad, [cancelDocumentLoad]);

  // Fetch the editor while the visitor reads the start screen.
  useEffect(() => {
    const prefetch = () => void loadWorkspace().catch(() => {});
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(prefetch, { timeout: 4_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(prefetch, 1_500);
    return () => clearTimeout(timer);
  }, []);

  // ---------- Autosave ----------

  const cancelScheduledAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    latestSnapshotRef.current = null;
    autosaveGenerationRef.current += 1;
  }, []);

  const flushAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const pending = latestSnapshotRef.current;
    if (!pending) return;

    const generation = autosaveGenerationRef.current;
    const project: SavedProject = {
      snapshot: pending.snapshot,
      savedAt: pending.changedAt,
    };
    // Start in a microtask so a synchronous size-limit failure follows the
    // same error path as an IndexedDB transaction failure.
    void Promise.resolve()
      .then(() => saveProject(project))
      .then((written) => {
        if (generation !== autosaveGenerationRef.current) return;
        if (latestSnapshotRef.current === pending) {
          latestSnapshotRef.current = null;
        }
        if (!written) {
          if (!autosaveConflictShownRef.current) {
            autosaveConflictShownRef.current = true;
            // One notice at a time: a second conflict refreshes it rather
            // than stacking an identical copy.
            toast.warning(
              "A newer autosave exists in another tab. Your next edit will become the latest version.",
              { id: "autosave-conflict" }
            );
          }
          return;
        }
        autosaveFailureShownRef.current = false;
        autosaveConflictShownRef.current = false;
        setSavedProject(project);
      })
      .catch((error) => {
        if (generation === autosaveGenerationRef.current && !autosaveFailureShownRef.current) {
          autosaveFailureShownRef.current = true;
          console.warn("Autosave failed:", error);
          toast.error("Autosave failed. Save a project file before leaving.");
        }
      });
  }, []);

  const handleSnapshot = useCallback(
    (snapshot: CanvasSnapshot) => {
      const changedAt = Math.max(Date.now(), lastSnapshotTimestampRef.current + 1);
      lastSnapshotTimestampRef.current = changedAt;
      latestSnapshotRef.current = { snapshot, changedAt };
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = window.setTimeout(() => {
        flushAutosave();
      }, AUTOSAVE_DELAY_MS);
    },
    [flushAutosave]
  );

  // Offer to continue the last session
  useEffect(() => {
    let active = true;
    const generation = autosaveGenerationRef.current;
    loadProject()
      .then((project) => {
        if (active && generation === autosaveGenerationRef.current) {
          setSavedProject(project ?? null);
        }
      })
      .catch((error) => {
        if (!active || generation !== autosaveGenerationRef.current) return;
        setSavedProject(null);
        console.warn("Could not load autosave:", error);
        if (error instanceof InvalidAutosaveError) {
          void clearProject().catch(() => {});
          toast.error("A corrupt local autosave was removed for safety.");
        } else {
          toast.error("Local autosave is unavailable in this browser.");
        }
      });
    return () => {
      active = false;
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  // Flush the latest snapshot when the page is backgrounded. This is the last
  // reliable lifecycle signal on mobile browsers, where tabs are often killed
  // without a conventional unload.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushAutosave();
    };
    const handlePageHide = () => flushAutosave();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flushAutosave]);

  // ---------- Opening and closing documents ----------

  const handleCanvasLoadError = useCallback(
    (error: unknown) => {
      console.error("Failed to load canvas document:", error);
      toast.error("The image or project could not be decoded safely");
      cancelDocumentLoad();
      cancelScheduledAutosave();
      setOpenDocument(null);
    },
    [cancelDocumentLoad, cancelScheduledAutosave]
  );

  /** Decode and validate an image file, then open it as a new document. */
  const openImageFile = useCallback(
    async (file: File) => {
      const signal = beginDocumentLoad();
      try {
        const { dataUrl } = await readSafeRasterImage(file, signal);
        if (signal.aborted) return;
        cancelScheduledAutosave();
        setSavedProject(null);
        void clearProject().catch((error) => {
          console.warn("Could not clear previous autosave:", error);
        });
        showDocument(dataUrl, null, documentNameFromFile(file));
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        toast.error(
          error instanceof Error ? error.message : "Failed to read the image. Please try again."
        );
      }
    },
    [beginDocumentLoad, cancelScheduledAutosave, showDocument]
  );

  const handleRestoreProject = useCallback(() => {
    if (!savedProject) return;
    cancelDocumentLoad();
    cancelScheduledAutosave();
    showDocument(
      savedProject.snapshot.srcs[0] ?? "restored-project",
      savedProject.snapshot,
      "edited-image"
    );
  }, [cancelDocumentLoad, cancelScheduledAutosave, savedProject, showDocument]);

  const handleOpenProjectFile = useCallback(
    async (file: File) => {
      const signal = beginDocumentLoad();
      try {
        const snapshot = await readProjectFile(file, signal);
        if (signal.aborted) return;
        cancelScheduledAutosave();
        setSavedProject(null);
        void clearProject().catch((error) => {
          console.warn("Could not clear previous autosave:", error);
        });
        // The image only needs to be truthy to show the editor; reuse the
        // project's first image so AI actions still have a source
        showDocument(snapshot.srcs[0] ?? "loaded-project", snapshot, documentNameFromFile(file));
        toast.success("Project opened");
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        toast.error(
          error instanceof Error ? error.message : "Couldn't open that file. Is it a project file?"
        );
      }
    },
    [beginDocumentLoad, cancelScheduledAutosave, showDocument]
  );

  const handleNewProject = useCallback(() => {
    cancelDocumentLoad();
    cancelScheduledAutosave();
    void clearProject().catch((error) => {
      console.warn("Could not clear autosave:", error);
      toast.error("The local autosave could not be cleared.");
    });
    setSavedProject(null);
    setOpenDocument(null);
  }, [cancelDocumentLoad, cancelScheduledAutosave]);

  // ---------- Paste and drop on the start screen ----------
  // With a document open, the workspace handles both (as new layers).

  useEffect(() => {
    if (hasDocument) return;
    const handlePaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const imageItem = Array.from(event.clipboardData?.items ?? []).find(
        (item) => item.kind === "file" && item.type.startsWith("image/")
      );
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void openImageFile(file);
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [hasDocument, openImageFile]);

  useEffect(() => {
    if (hasDocument) return;
    const handleDragEnter = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const handleDragOver = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const handleDrop = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      if (isProjectFile(file)) void handleOpenProjectFile(file);
      else void openImageFile(file);
    };
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      dragDepthRef.current = 0;
      setDragActive(false);
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [handleOpenProjectFile, hasDocument, openImageFile]);

  if (openDocument) {
    return (
      <Suspense fallback={<EditorLoading />}>
        <EditorWorkspace
          key={openDocument.id}
          uploadedImage={openDocument.image}
          initialSnapshot={openDocument.snapshot}
          documentName={openDocument.name}
          onSnapshot={handleSnapshot}
          onLoadError={handleCanvasLoadError}
          onOpenProjectFile={(file) => void handleOpenProjectFile(file)}
          onNewProject={handleNewProject}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-editor-bg text-foreground">
      <StartHeader onOpenProject={(file) => void handleOpenProjectFile(file)} />
      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1" aria-label="Start">
          <StartScreen
            onFile={openImageFile}
            savedProject={savedProject}
            onRestore={handleRestoreProject}
            onOpenProject={(file) => void handleOpenProjectFile(file)}
            dragActive={dragActive}
          />
        </main>
      </div>
    </div>
  );
};
