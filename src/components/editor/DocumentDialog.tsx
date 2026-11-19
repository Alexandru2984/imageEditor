import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { Link2, Unlink2 } from "lucide-react";
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
import { documentSize, fitsLimits, resizeImage, type ResampleMethod } from "@/raster/documentSize";
import { MAX_RASTER_PIXELS, MAX_RASTER_SIDE } from "@/utils/flatten";
import { cn } from "@/lib/utils";

/** The Image menu's document dialogs. */
export type DocumentDialogKind = "imageSize";

const RESAMPLE_METHODS: { value: ResampleMethod; label: string }[] = [
  { value: "bicubic", label: "Smooth" },
  { value: "bilinear", label: "Bilinear" },
  { value: "nearest", label: "Hard edges" },
];

const LIMIT_TEXT = `At most ${MAX_RASTER_SIDE.toLocaleString("en")} pixels a side and ${Math.round(MAX_RASTER_PIXELS / 1e6)} megapixels`;

const inputClass =
  "h-9 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive";

/** A row of mutually exclusive buttons. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="mr-2 text-sm">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 rounded-md border px-2.5 text-xs transition-colors",
            value === option.value
              ? "border-primary bg-primary/10 text-foreground"
              : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled number of pixels. */
function PixelField({
  label,
  value,
  onChange,
  invalid,
  autoFocus,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  autoFocus?: boolean;
  suffix?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-14 text-sm">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_RASTER_SIDE}
        step={1}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        className={inputClass}
      />
      <span className="text-sm text-muted-foreground">pixels{suffix}</span>
    </div>
  );
}

const wholeNumber = (text: string): number | null => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= 1 ? value : null;
};

interface DocumentDialogProps {
  canvas: FabricCanvas | null;
  /** The dialog shown, or null when closed. */
  kind: DocumentDialogKind | null;
  onClose: () => void;
  /** The document changed size; the view should fit it again. */
  onResized: () => void;
}

/** Image › Image Size. */
export function DocumentDialog({ canvas, kind, onClose, onResized }: DocumentDialogProps) {
  const [original, setOriginal] = useState<{ width: number; height: number } | null>(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [linked, setLinked] = useState(true);
  const [method, setMethod] = useState<ResampleMethod>("bicubic");

  useEffect(() => {
    if (!kind || !canvas) return;
    const size = documentSize(canvas);
    setOriginal(size);
    setWidth(size ? String(size.width) : "");
    setHeight(size ? String(size.height) : "");
  }, [kind, canvas]);

  const newWidth = wholeNumber(width);
  const newHeight = wholeNumber(height);
  const fits = newWidth !== null && newHeight !== null && fitsLimits(newWidth, newHeight);
  const same = original !== null && newWidth === original.width && newHeight === original.height;

  const changeWidth = (text: string) => {
    setWidth(text);
    const value = wholeNumber(text);
    if (linked && value !== null && original) {
      setHeight(String(Math.max(1, Math.round((value * original.height) / original.width))));
    }
  };
  const changeHeight = (text: string) => {
    setHeight(text);
    const value = wholeNumber(text);
    if (linked && value !== null && original) {
      setWidth(String(Math.max(1, Math.round((value * original.width) / original.height))));
    }
  };
  const percent = (value: number | null, of: number | undefined) =>
    value !== null && of ? ` · ${Math.round((value / of) * 1000) / 10}%` : "";

  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (!canvas || !fits || same || newWidth === null || newHeight === null) return;
    onClose();
    const notice = toast.loading("Resizing…");
    try {
      const result = await resizeImage(canvas, { width: newWidth, height: newHeight, method });
      if (typeof result === "string") toast.error(result, { id: notice });
      else {
        toast.dismiss(notice);
        if (result) onResized();
      }
    } catch (error) {
      console.error("Image size failed:", error);
      toast.error("The image could not be resized", { id: notice });
    }
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {kind === "imageSize" && (
          <form onSubmit={(event) => void apply(event)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Image size</DialogTitle>
              <DialogDescription>
                {original
                  ? `Now ${original.width} × ${original.height} pixels. Every pixel layer and mask is resampled; text and shapes stay sharp.`
                  : "Open a photo first."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <div className="grid gap-2">
                <PixelField
                  label="Width"
                  value={width}
                  onChange={changeWidth}
                  invalid={newWidth === null || !fits}
                  autoFocus
                  suffix={percent(newWidth, original?.width)}
                />
                <PixelField
                  label="Height"
                  value={height}
                  onChange={changeHeight}
                  invalid={newHeight === null || !fits}
                  suffix={percent(newHeight, original?.height)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Keep proportions"
                aria-pressed={linked}
                title="Keep proportions"
                onClick={() => setLinked(!linked)}
                className={cn("h-9 w-9 shrink-0", linked && "text-primary")}
              >
                {linked ? <Link2 className="h-4 w-4" /> : <Unlink2 className="h-4 w-4" />}
              </Button>
            </div>
            {!fits && newWidth !== null && newHeight !== null && (
              <p className="text-xs text-destructive">{LIMIT_TEXT}</p>
            )}
            <Segmented label="Resample" value={method} options={RESAMPLE_METHODS} onChange={setMethod} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canvas || !fits || same}>
                OK
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
