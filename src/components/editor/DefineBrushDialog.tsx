import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRESET_NAME_MAX, type BrushTip } from "@/raster/brushEngine";

/**
 * Edit › Define Brush Preset: the tip taken from the document, shown as it
 * will paint, and a name for the new preset.
 */
export function DefineBrushDialog({
  defining,
  onDefine,
  onCancel,
}: {
  /** The tip and its size in image pixels, or null when closed. */
  defining: { tip: BrushTip; size: number } | null;
  onDefine: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("Sampled brush");
  // The dialog's content mounts a render after it opens.
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (defining && !opened.current) setName("Sampled brush");
    opened.current = !!defining;
  }, [defining]);

  useEffect(() => {
    if (!preview || !defining) return;
    const { tip } = defining;
    const side = 112;
    preview.width = side;
    preview.height = side;
    const context = preview.getContext("2d");
    if (!context) return;
    const scale = Math.min(1, (side - 8) / Math.max(tip.width, tip.height));
    const source = document.createElement("canvas");
    source.width = tip.width;
    source.height = tip.height;
    const pixels = source.getContext("2d")!.createImageData(tip.width, tip.height);
    for (let index = 0; index < tip.alpha.length; index += 1) pixels.data[index * 4 + 3] = tip.alpha[index]!;
    source.getContext("2d")!.putImageData(pixels, 0, 0);
    context.clearRect(0, 0, side, side);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, side, side);
    const width = tip.width * scale;
    const height = tip.height * scale;
    context.drawImage(source, (side - width) / 2, (side - height) / 2, width, height);
  }, [preview, defining]);

  return (
    <Dialog open={defining !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Define brush preset</DialogTitle>
          <DialogDescription>
            A brush from what is selected: dark pixels paint, white and clear ones do not.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onDefine(name.trim() || "Sampled brush");
          }}
        >
          <div className="flex items-center gap-3">
            <canvas
              ref={setPreview}
              data-testid="brush-tip-preview"
              role="img"
              aria-label="The new brush's tip"
              className="h-28 w-28 shrink-0 rounded-md border border-border"
            />
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span>{defining ? `${defining.size} px` : ""}</span>
            </div>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Name</span>
            <input
              value={name}
              maxLength={PRESET_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              aria-label="Brush name"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              autoFocus
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">OK</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
