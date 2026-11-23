import { useEffect, useMemo, useState } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { Copy, Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/utils/download";
import {
  FORMAT_EXTENSION,
  FORMAT_LABEL,
  canShareFiles,
  copyImageToClipboard,
  exportImage,
  formatBytes,
  planExport,
  sanitizeFileName,
  shareImage,
  supportsAlpha,
  type ExportFormat,
} from "@/utils/exportImage";
import { ColorField } from "./ColorPicker";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvas: FabricCanvas | null;
  defaultName?: string;
}

const FORMATS: ExportFormat[] = ["png", "jpeg", "webp"];
const SCALES = [0.25, 0.5, 1, 2] as const;
type MatteChoice = "transparent" | "white" | "custom";

const PREFS_KEY = "ie-export-prefs";

interface ExportPrefs {
  format: ExportFormat;
  quality: number;
}

function loadPrefs(): ExportPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ExportPrefs>) : {};
    return {
      format: FORMATS.includes(parsed.format as ExportFormat)
        ? (parsed.format as ExportFormat)
        : "png",
      quality:
        typeof parsed.quality === "number" && parsed.quality >= 10 && parsed.quality <= 100
          ? Math.round(parsed.quality)
          : 92,
    };
  } catch {
    return { format: "png", quality: 92 };
  }
}

function savePrefs(prefs: ExportPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience only.
  }
}

const Segmented = <T extends string | number>({
  label,
  value,
  options,
  onChange,
  render,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  render: (value: T) => string;
}) => (
  <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted/70 p-1">
    {options.map((option) => (
      <button
        key={String(option)}
        type="button"
        role="radio"
        aria-checked={option === value}
        onClick={() => onChange(option)}
        className={cn(
          "h-8 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          option === value
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        {render(option)}
      </button>
    ))}
  </div>
);

export function ExportDialog({ open, onOpenChange, canvas, defaultName }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(() => loadPrefs().format);
  const [quality, setQuality] = useState(() => loadPrefs().quality);
  const [scale, setScale] = useState<number>(1);
  const [matteChoice, setMatteChoice] = useState<MatteChoice>("transparent");
  const [customMatte, setCustomMatte] = useState("#ffffff");
  const [fileName, setFileName] = useState(defaultName ?? "edited-image");
  const [busy, setBusy] = useState<null | "download" | "copy" | "share">(null);
  const shareSupported = useMemo(() => canShareFiles(), []);

  useEffect(() => {
    if (open && defaultName) setFileName(defaultName);
  }, [open, defaultName]);

  const alpha = supportsAlpha(format);
  const effectiveMatteChoice: MatteChoice =
    !alpha && matteChoice === "transparent" ? "white" : matteChoice;
  const matte =
    effectiveMatteChoice === "transparent"
      ? null
      : effectiveMatteChoice === "white"
        ? "#ffffff"
        : customMatte;

  const plan = useMemo(
    () => (open && canvas ? safePlan(canvas, scale) : null),
    // Recompute when the dialog opens or the scale changes.
    [open, canvas, scale]
  );

  const fullName = `${sanitizeFileName(fileName)}.${FORMAT_EXTENSION[format]}`;

  const render = async (forceFormat?: ExportFormat) => {
    if (!canvas) throw new Error("Nothing to export yet");
    return exportImage(canvas, {
      format: forceFormat ?? format,
      quality: quality / 100,
      scale,
      matte,
    });
  };

  const run = async (kind: "download" | "copy" | "share") => {
    if (busy) return;
    setBusy(kind);
    savePrefs({ format, quality });
    try {
      if (kind === "copy") {
        const { blob } = await render("png");
        await copyImageToClipboard(blob);
        toast.success("Image copied to the clipboard");
      } else {
        const { blob, plan: result } = await render();
        if (kind === "share") {
          const shared = await shareImage(blob, fullName);
          if (!shared) return;
        } else {
          downloadBlob(blob, fullName);
          toast.success(
            `Exported ${result.outputWidth}×${result.outputHeight} ${FORMAT_LABEL[format]} · ${formatBytes(blob.size)}${
              result.limited ? " (capped for browser safety)" : ""
            }`
          );
        }
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error(error instanceof Error ? error.message : "The image could not be exported");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export image</DialogTitle>
          <DialogDescription>
            Rendered on your device at full photo resolution. Nothing is uploaded.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Format</Label>
            <Segmented
              label="Format"
              value={format}
              options={FORMATS}
              onChange={setFormat}
              render={(value) => FORMAT_LABEL[value]}
            />
          </div>

          {format !== "png" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Quality</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{quality}%</span>
              </div>
              <Slider
                aria-label="Export quality"
                min={10}
                max={100}
                step={1}
                value={[quality]}
                onValueChange={(value) => setQuality(value[0] ?? quality)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Size</Label>
              <span className="text-xs tabular-nums text-muted-foreground" data-testid="export-dimensions">
                {plan ? `${plan.outputWidth} × ${plan.outputHeight} px${plan.limited ? " (max)" : ""}` : "—"}
              </span>
            </div>
            <Segmented
              label="Size"
              value={scale}
              options={SCALES}
              onChange={setScale}
              render={(value) => `${value * 100}%`}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Background</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Segmented
                  label="Background"
                  value={effectiveMatteChoice}
                  options={alpha ? (["transparent", "white", "custom"] as const) : (["white", "custom"] as const)}
                  onChange={setMatteChoice}
                  render={(value) =>
                    value === "transparent" ? "Transparent" : value === "white" ? "White" : "Color"
                  }
                />
              </div>
              {effectiveMatteChoice === "custom" && (
                <ColorField
                  label="Background color"
                  value={customMatte}
                  onChange={setCustomMatte}
                  className="h-10 w-10 rounded-md"
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-name" className="text-xs text-muted-foreground">
              File name
            </Label>
            <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
              <input
                id="export-name"
                value={fileName}
                maxLength={80}
                onChange={(event) => setFileName(event.target.value)}
                className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
              />
              <span className="pr-3 text-sm text-muted-foreground">.{FORMAT_EXTENSION[format]}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => void run("copy")}
            disabled={!!busy}
            aria-label="Copy image to clipboard"
          >
            {busy === "copy" ? <Loader2 className="animate-spin" /> : <Copy />}
            Copy
          </Button>
          {shareSupported && (
            <Button variant="outline" onClick={() => void run("share")} disabled={!!busy}>
              {busy === "share" ? <Loader2 className="animate-spin" /> : <Share2 />}
              Share
            </Button>
          )}
          <Button onClick={() => void run("download")} disabled={!!busy || !plan}>
            {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />}
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function safePlan(canvas: FabricCanvas, scale: number) {
  try {
    return planExport(canvas, scale);
  } catch {
    return null;
  }
}
