import { useEffect, useId, useState } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { selectionOf } from "@/selection/state";
import { PixelPreview, adjustTarget } from "@/raster/pixelPreview";
import type { PixelJob } from "@/raster/pixelJobs";
import { ADJUSTMENTS, type AdjustmentContext, type AdjustmentKind } from "./specs";

export type { AdjustmentKind } from "./specs";

interface AdjustmentDialogProps {
  canvas: FabricCanvas | null;
  /** The adjustment being set up, or null when the dialog is closed. */
  kind: AdjustmentKind | null;
  /** The colour wells, which some adjustments start from. */
  colors: AdjustmentContext;
  onClose: () => void;
}

/** Stands for the layer's own pixels, shown with the preview off. */
const ORIGINAL = Symbol("original");

/**
 * Works out previews one at a time. While one runs, newer settings wait,
 * and only the latest of them runs next, so dragging a slider over a large
 * photo never queues up work.
 */
class PreviewRunner {
  private running = false;
  private closed = false;
  private wanted: { job: PixelJob | null; key: unknown } | null = null;
  /** Whose result the layer shows. */
  private shownKey: unknown = ORIGINAL;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly preview: PixelPreview,
    private readonly title: string
  ) {}

  /** Show `job`'s result for `key` (with a null job, the layer's own pixels). */
  request(job: PixelJob | null, key: unknown): void {
    this.wanted = { job, key };
    void this.pump();
  }

  shows(key: unknown): boolean {
    return this.shownKey === key;
  }

  /** Resolves once nothing is waiting or running. */
  idle(): Promise<void> {
    if (!this.running && !this.wanted) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    this.wanted = null;
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.wanted && !this.closed) {
        const { job, key } = this.wanted;
        this.wanted = null;
        if (key === this.shownKey) continue;
        try {
          const result = job ? await this.preview.compute(job) : null;
          if (this.closed) break;
          this.preview.present(result);
          this.shownKey = key;
        } catch (error) {
          console.error(`${this.title} preview failed:`, error);
          toast.error(`${this.title} could not be worked out`);
        }
      }
    } finally {
      this.running = false;
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve();
    }
  }
}

interface Session {
  kind: AdjustmentKind;
  preview: PixelPreview;
  runner: PreviewRunner;
}

/**
 * Image › Adjustments and the Filter menu: the settings of one adjustment,
 * shown on the layer as they change and applied to its pixels on OK.
 */
export function AdjustmentDialog({ canvas, kind, colors, onClose }: AdjustmentDialogProps) {
  const previewId = useId();
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<unknown>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [applying, setApplying] = useState(false);

  // Opening starts a preview on the target's pixels; closing ends it.
  useEffect(() => {
    if (!kind || !canvas) return;
    const target = adjustTarget(canvas);
    const preview =
      typeof target === "string" ? target : PixelPreview.open(canvas, target, selectionOf(canvas).current());
    if (typeof preview === "string") {
      toast.error(preview);
      onClose();
      return;
    }
    const spec = ADJUSTMENTS[kind];
    const runner = new PreviewRunner(preview, spec.title);
    setSession({ kind, preview, runner });
    setSettings(spec.initial(colors));
    setShowPreview(true);
    setApplying(false);
    return () => {
      runner.close();
      // Closed without OK (or the editor went away): nothing changes.
      preview.cancel();
      setSession(null);
    };
    // onClose and colors are read once per opening; the session follows `kind`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, canvas]);

  // At most one new preview a frame, however fast the settings change.
  useEffect(() => {
    if (!session || settings === null || applying) return;
    const spec = ADJUSTMENTS[session.kind];
    const frame = requestAnimationFrame(() => {
      if (showPreview && !spec.isIdentity(settings)) session.runner.request(spec.job(settings), settings);
      else session.runner.request(null, ORIGINAL);
    });
    return () => cancelAnimationFrame(frame);
  }, [session, settings, showPreview, applying]);

  const apply = async () => {
    if (!session || settings === null || applying) return;
    const spec = ADJUSTMENTS[session.kind];
    if (spec.isIdentity(settings)) {
      onClose();
      return;
    }
    setApplying(true);
    try {
      // Applied as set, even with the preview off.
      session.runner.request(spec.job(settings), settings);
      await session.runner.idle();
      if (!session.runner.shows(settings)) return;
      await session.preview.commit();
    } catch (error) {
      console.error(`${spec.title} failed:`, error);
      toast.error(`${spec.title} could not be applied`);
    } finally {
      setApplying(false);
      onClose();
    }
  };

  const spec = session ? ADJUSTMENTS[session.kind] : null;
  const Controls = spec?.Controls;

  return (
    <Dialog open={kind !== null && session !== null} onOpenChange={(open) => !open && !applying && onClose()}>
      <DialogContent
        // The layer stays in view, to judge the result as it changes.
        overlayClassName="bg-transparent backdrop-blur-none"
        className="max-h-[60dvh] max-w-md overflow-y-auto sm:left-auto sm:right-4 sm:max-h-[calc(100dvh-2rem)] sm:max-w-sm sm:translate-x-0"
      >
        {spec && Controls && session && settings !== null && (
          <>
            <DialogHeader>
              <DialogTitle>{spec.title}</DialogTitle>
              <DialogDescription>
                {session.preview.target.mask ? "On the layer mask. " : ""}
                {spec.description}
              </DialogDescription>
            </DialogHeader>
            <fieldset disabled={applying} className="contents">
              <Controls settings={settings} onChange={setSettings} histogram={session.preview.histogram()} />
            </fieldset>
            <DialogFooter className="items-center sm:justify-between">
              <label htmlFor={previewId} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  id={previewId}
                  type="checkbox"
                  checked={showPreview}
                  onChange={(event) => setShowPreview(event.target.checked)}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                Preview
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="ghost" onClick={onClose} disabled={applying}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void apply()} disabled={applying}>
                  {applying ? "Applying…" : "OK"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
