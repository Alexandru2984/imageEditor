import { useId, useState, type FormEvent, type ReactNode } from "react";
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
import {
  anchoredRect,
  documentSize,
  fitsLimits,
  recanvas,
  resizeImage,
  trim,
  type Anchor,
  type Refusal,
  type ResampleMethod,
  type TrimBasis,
} from "@/raster/documentSize";
import { MAX_RASTER_PIXELS, MAX_RASTER_SIDE } from "@/utils/flatten";
import { cn } from "@/lib/utils";

/** The Image menu's document dialogs. */
export type DocumentDialogKind = "imageSize" | "canvasSize" | "trim";

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

interface FormProps {
  canvas: FabricCanvas | null;
  onClose: () => void;
  /** Run a document change, reporting how it went. */
  run: (label: string, change: (canvas: FabricCanvas) => Promise<boolean | Refusal>) => void;
}

function Footer({ onClose, disabled }: { onClose: () => void; disabled: boolean }) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" disabled={disabled}>
        OK
      </Button>
    </DialogFooter>
  );
}

/** The document's size while a dialog is open. */
function useDocumentSize(canvas: FabricCanvas | null) {
  const [size] = useState(() => (canvas ? documentSize(canvas) : null));
  return size;
}

function ImageSizeForm({ canvas, onClose, run }: FormProps) {
  const original = useDocumentSize(canvas);
  const [width, setWidth] = useState(original ? String(original.width) : "");
  const [height, setHeight] = useState(original ? String(original.height) : "");
  const [linked, setLinked] = useState(true);
  const [method, setMethod] = useState<ResampleMethod>("bicubic");

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

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!fits || same || newWidth === null || newHeight === null) return;
    run("resize", (target) => resizeImage(target, { width: newWidth, height: newHeight, method }));
  };

  return (
    <form onSubmit={apply} className="grid gap-4">
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
      {!fits && newWidth !== null && newHeight !== null && <p className="text-xs text-destructive">{LIMIT_TEXT}</p>}
      <Segmented label="Resample" value={method} options={RESAMPLE_METHODS} onChange={setMethod} />
      <Footer onClose={onClose} disabled={!canvas || !fits || same} />
    </form>
  );
}

const ANCHORS: { anchor: Anchor; label: string }[] = [0, 0.5, 1].flatMap((y) =>
  [0, 0.5, 1].map((x) => ({
    anchor: { x, y } as Anchor,
    label:
      x === 0.5 && y === 0.5
        ? "Centre"
        : `${y === 0 ? "Top" : y === 1 ? "Bottom" : "Middle"} ${x === 0 ? "left" : x === 1 ? "right" : "centre"}`,
  }))
);

type Extension = "background" | "foreground" | "white" | "black" | "transparent";

const EXTENSIONS: { value: Extension; label: string }[] = [
  { value: "background", label: "Background" },
  { value: "foreground", label: "Foreground" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "transparent", label: "Transparent" },
];

function CanvasSizeForm({ canvas, onClose, run, colors }: FormProps & { colors: { foreground: string; background: string } }) {
  const original = useDocumentSize(canvas);
  const [width, setWidth] = useState(original ? String(original.width) : "");
  const [height, setHeight] = useState(original ? String(original.height) : "");
  const [anchor, setAnchor] = useState<Anchor>({ x: 0.5, y: 0.5 });
  const [extension, setExtension] = useState<Extension>("background");

  const newWidth = wholeNumber(width);
  const newHeight = wholeNumber(height);
  const fits = newWidth !== null && newHeight !== null && fitsLimits(newWidth, newHeight);
  const same = original !== null && newWidth === original.width && newHeight === original.height;
  const smaller = original !== null && fits && (newWidth! < original.width || newHeight! < original.height);
  const change = (value: number | null, of: number | undefined) =>
    value !== null && of !== undefined && value !== of ? ` · ${value > of ? "+" : "−"}${Math.abs(value - of)}` : "";

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!original || !fits || same || newWidth === null || newHeight === null) return;
    const fill =
      extension === "transparent"
        ? null
        : extension === "background"
          ? colors.background
          : extension === "foreground"
            ? colors.foreground
            : extension === "white"
              ? "#ffffff"
              : "#000000";
    const rect = anchoredRect(original, { width: newWidth, height: newHeight }, anchor);
    run("resize the canvas", (target) => recanvas(target, rect, fill));
  };

  return (
    <form onSubmit={apply} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Canvas size</DialogTitle>
        <DialogDescription>
          {original
            ? `Now ${original.width} × ${original.height} pixels. The photo grows or is cut at the edges; other layers stay where they are.`
            : "Open a photo first."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid gap-2">
          <PixelField
            label="Width"
            value={width}
            onChange={setWidth}
            invalid={newWidth === null || !fits}
            autoFocus
            suffix={change(newWidth, original?.width)}
          />
          <PixelField
            label="Height"
            value={height}
            onChange={setHeight}
            invalid={newHeight === null || !fits}
            suffix={change(newHeight, original?.height)}
          />
        </div>
        <div role="radiogroup" aria-label="Anchor" className="grid grid-cols-3 gap-1">
          {ANCHORS.map(({ anchor: option, label }) => {
            const checked = option.x === anchor.x && option.y === anchor.y;
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={label}
                title={label}
                onClick={() => setAnchor(option)}
                className={cn(
                  "h-7 w-7 rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  checked ? "border-primary bg-primary" : "border-input hover:bg-accent"
                )}
              />
            );
          })}
        </div>
      </div>
      {!fits && newWidth !== null && newHeight !== null && <p className="text-xs text-destructive">{LIMIT_TEXT}</p>}
      {smaller && <p className="text-xs text-muted-foreground">The canvas is smaller: the photo is cut at the edges.</p>}
      <Segmented label="Extension" value={extension} options={EXTENSIONS} onChange={setExtension} />
      <Footer onClose={onClose} disabled={!canvas || !fits || same} />
    </form>
  );
}

const TRIM_BASES: { value: TrimBasis; label: string }[] = [
  { value: "transparent", label: "Transparent pixels" },
  { value: "topLeft", label: "Top-left colour" },
  { value: "bottomRight", label: "Bottom-right colour" },
];

function TrimForm({ canvas, onClose, run }: FormProps) {
  const [basis, setBasis] = useState<TrimBasis>("transparent");
  const apply = (event: FormEvent) => {
    event.preventDefault();
    run("trim", (target) => trim(target, basis));
  };
  return (
    <form onSubmit={apply} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Trim</DialogTitle>
        <DialogDescription>Cut away the edges of the document that are empty or one plain colour.</DialogDescription>
      </DialogHeader>
      <Segmented label="Based on" value={basis} options={TRIM_BASES} onChange={setBasis} />
      <Footer onClose={onClose} disabled={!canvas} />
    </form>
  );
}

interface DocumentDialogProps {
  canvas: FabricCanvas | null;
  /** The dialog shown, or null when closed. */
  kind: DocumentDialogKind | null;
  /** Foreground and background colours, for the canvas's new area. */
  colors: { foreground: string; background: string };
  onClose: () => void;
  /** The document changed size; the view should fit it again. */
  onResized: () => void;
}

/** Image › Image Size, Canvas Size and Trim. */
export function DocumentDialog({ canvas, kind, colors, onClose, onResized }: DocumentDialogProps) {
  const run: FormProps["run"] = (label, change) => {
    if (!canvas) return;
    onClose();
    const notice = toast.loading("Working…");
    change(canvas)
      .then((result) => {
        if (typeof result === "string") toast.error(result, { id: notice });
        else {
          toast.dismiss(notice);
          if (result) onResized();
        }
      })
      .catch((error: unknown) => {
        console.error(`Could not ${label}:`, error);
        toast.error(`Could not ${label} the image`, { id: notice });
      });
  };
  const props = { canvas, onClose, run };
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {kind === "imageSize" && <ImageSizeForm {...props} />}
        {kind === "canvasSize" && <CanvasSizeForm {...props} colors={colors} />}
        {kind === "trim" && <TrimForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}
