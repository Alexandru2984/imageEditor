import { useEffect, useId, useRef, useState } from "react";
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

/**
 * Image › Adjustments: the settings of one adjustment, shown on the layer as
 * they change and applied to its pixels on OK.
 */
export function AdjustmentDialog({ canvas, kind, colors, onClose }: AdjustmentDialogProps) {
  const previewId = useId();
  const [session, setSession] = useState<{ kind: AdjustmentKind; preview: PixelPreview } | null>(null);
  const [settings, setSettings] = useState<unknown>(null);
  const [showPreview, setShowPreview] = useState(true);
  const frame = useRef(0);

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
    setSession({ kind, preview });
    setSettings(ADJUSTMENTS[kind].initial(colors));
    setShowPreview(true);
    return () => {
      cancelAnimationFrame(frame.current);
      // Closed without OK (or the editor went away): nothing changes.
      preview.cancel();
      setSession(null);
    };
    // onClose and colors are read once per opening; the session follows `kind`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, canvas]);

  // Show the result once per frame, however fast the settings change.
  useEffect(() => {
    if (!session || settings === null) return;
    const spec = ADJUSTMENTS[session.kind];
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const active = showPreview && !spec.isIdentity(settings);
      session.preview.show(active ? spec.process(settings) : null);
    });
  }, [session, settings, showPreview]);

  const apply = () => {
    if (!session || settings === null) return;
    const spec = ADJUSTMENTS[session.kind];
    cancelAnimationFrame(frame.current);
    const { preview } = session;
    if (!spec.isIdentity(settings)) {
      // Applied as set, even if the preview was switched off.
      preview.show(spec.process(settings));
      void preview.commit().catch((error) => {
        console.error(`${spec.title} failed:`, error);
        toast.error(`${spec.title} could not be applied`);
      });
    }
    onClose();
  };

  const spec = session ? ADJUSTMENTS[session.kind] : null;
  const Controls = spec?.Controls;

  return (
    <Dialog open={kind !== null && session !== null} onOpenChange={(open) => !open && onClose()}>
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
            <Controls settings={settings} onChange={setSettings} histogram={session.preview.histogram()} />
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
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="button" onClick={apply}>
                  OK
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
