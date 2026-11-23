import { useEffect, useId, useMemo, useState } from "react";
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
  exportFiles,
  exportImage,
  formatBytes,
  layerExports,
  nativeWidth,
  planExport,
  sanitizeFileName,
  supportsAlpha,
  type ExportFormat,
  type ExportedFile,
} from "@/utils/exportImage";
import { scaleOf, type ExportSize } from "@/export/exportPlan";
import { zipStore } from "@/export/zip";
import { ColorField } from "./ColorPicker";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvas: FabricCanvas | null;
  defaultName?: string;
}

const FORMATS: ExportFormat[] = ["png", "jpeg", "webp", "avif"];
const SCALES = [0.25, 0.5, 1, 2] as const;
/** The widest a custom size may ask for; the render is capped for safety anyway. */
const MAX_CUSTOM_WIDTH = 16_384;
type Content = "document" | "layers";
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
  const [scales, setScales] = useState<readonly number[]>([1]);
  const [custom, setCustom] = useState<{ on: boolean; width: string }>({ on: false, width: "" });
  const [content, setContent] = useState<Content>("document");
  const [matteChoice, setMatteChoice] = useState<MatteChoice>("transparent");
  const [customMatte, setCustomMatte] = useState("#ffffff");
  const [fileName, setFileName] = useState(defaultName ?? "edited-image");
  const [busy, setBusy] = useState<null | "download" | "copy" | "share">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const shareSupported = useMemo(() => canShareFiles(), []);
  const customId = useId();

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

  const documentWidth = useMemo(() => (open && canvas ? safeWidth(canvas) : 0), [open, canvas]);
  const customWidth = Math.round(Number.parseFloat(custom.width));
  const customValid = Number.isFinite(customWidth) && customWidth >= 1 && customWidth <= MAX_CUSTOM_WIDTH;
  const sizes = useMemo<ExportSize[]>(
    () => [
      ...[...scales].sort((a, b) => a - b).map((scale) => ({ scale })),
      ...(custom.on && customValid ? [{ width: customWidth }] : []),
    ],
    [scales, custom.on, customValid, customWidth]
  );
  const plans = useMemo(
    () => (open && canvas ? sizes.map((size) => safePlan(canvas, size)) : []),
    // Recompute when the dialog opens or the sizes change.
    [open, canvas, sizes]
  );
  const layerCount = useMemo(() => (open && canvas && content === "layers" ? safeLayerCount(canvas) : 0), [open, canvas, content]);
  const fileCount = sizes.length * (content === "layers" ? layerCount : 1);
  // Copy and Share take the 1× size when it is chosen, otherwise the first.
  const primary = sizes.find((size) => "scale" in size && size.scale === 1) ?? sizes[0];

  const base = sanitizeFileName(fileName);
  const fullName = fileCount > 1 ? `${base}.zip` : `${base}.${FORMAT_EXTENSION[format]}`;

  const toggleScale = (scale: number) =>
    setScales((current) => {
      if (!current.includes(scale)) return [...current, scale];
      // One size at least: the last one stays on unless the custom width is.
      return current.length > 1 || (custom.on && customValid) ? current.filter((item) => item !== scale) : current;
    });
  const toggleCustom = () =>
    setCustom((current) => {
      if (current.on && scales.length === 0) return current;
      return { on: !current.on, width: current.width || String(documentWidth || 1000) };
    });

  const exportAll = (): Promise<ExportedFile[]> => {
    if (!canvas) throw new Error("Nothing to export yet");
    return exportFiles(
      canvas,
      { format, quality: quality / 100, matte, sizes, layers: content === "layers", baseName: fileName },
      (done, total) => setProgress(total > 1 ? `${done} / ${total}` : null)
    );
  };

  const run = async (kind: "download" | "copy" | "share") => {
    if (busy || !primary) return;
    setBusy(kind);
    savePrefs({ format, quality });
    try {
      if (kind === "copy") {
        if (!canvas) throw new Error("Nothing to export yet");
        const scale = scaleOf(primary, documentWidth);
        const { blob } = await exportImage(canvas, { format: "png", quality: 1, scale, matte });
        await copyImageToClipboard(blob);
        toast.success("Image copied to the clipboard");
      } else {
        const files = await exportAll();
        if (kind === "share") {
          const shared = await shareFiles(files);
          if (!shared) return;
        } else if (files.length === 1) {
          const [file] = files as [ExportedFile];
          downloadBlob(file.blob, file.name);
          toast.success(
            `Exported ${file.width}×${file.height} ${FORMAT_LABEL[format]} · ${formatBytes(file.blob.size)}${
              file.limited ? " (capped for browser safety)" : ""
            }`
          );
        } else {
          const zip = zipStore(
            await Promise.all(files.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()) })))
          );
          downloadBlob(zip, fullName);
          toast.success(`Exported ${files.length} ${FORMAT_LABEL[format]} files in ${fullName} · ${formatBytes(zip.size)}`);
        }
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error(error instanceof Error ? error.message : "The image could not be exported");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const dimensions = plans.every((plan) => plan)
    ? `${plans.map((plan) => `${plan!.outputWidth} × ${plan!.outputHeight}`).join(", ")} px${plans.some((plan) => plan!.limited) ? " (max)" : ""}`
    : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export As</DialogTitle>
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
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">Sizes</Label>
              <span className="truncate text-xs tabular-nums text-muted-foreground" data-testid="export-dimensions">
                {dimensions}
              </span>
            </div>
            <div role="group" aria-label="Sizes" className="grid grid-cols-5 gap-1 rounded-lg bg-muted/70 p-1">
              {SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  aria-pressed={scales.includes(scale)}
                  onClick={() => toggleScale(scale)}
                  className={segmentClass(scales.includes(scale))}
                >
                  {scale * 100}%
                </button>
              ))}
              <button type="button" aria-pressed={custom.on} onClick={toggleCustom} className={segmentClass(custom.on)}>
                Custom
              </button>
            </div>
            {custom.on && (
              <div className="flex items-center gap-2">
                <label htmlFor={customId} className="text-xs text-muted-foreground">
                  Width
                </label>
                <input
                  id={customId}
                  type="number"
                  aria-label="Custom width"
                  min={1}
                  max={MAX_CUSTOM_WIDTH}
                  step={1}
                  value={custom.width}
                  aria-invalid={!customValid}
                  onChange={(event) => setCustom({ on: true, width: event.target.value })}
                  className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums aria-[invalid=true]:border-destructive"
                />
                <span className="text-xs text-muted-foreground">px, the height follows</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Export</Label>
            <Segmented
              label="Export"
              value={content}
              options={["document", "layers"] as const}
              onChange={setContent}
              render={(value) => (value === "document" ? "Document" : "Each layer")}
            />
            {content === "layers" && (
              <p className="text-xs text-muted-foreground" data-testid="export-layer-count">
                {layerCount === 1 ? "1 visible layer" : `${layerCount} visible layers`}, each over the document's area
              </p>
            )}
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
              <span className="pr-3 text-sm text-muted-foreground">.{fileCount > 1 ? "zip" : FORMAT_EXTENSION[format]}</span>
            </div>
            {fileCount > 1 && (
              <p className="text-xs text-muted-foreground">
                {fileCount} files in one zip, each named for its {content === "layers" ? "layer and " : ""}size
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => void run("copy")}
            disabled={!!busy || !primary}
            aria-label="Copy image to clipboard"
          >
            {busy === "copy" ? <Loader2 className="animate-spin" /> : <Copy />}
            Copy
          </Button>
          {shareSupported && (
            <Button variant="outline" onClick={() => void run("share")} disabled={!!busy || fileCount === 0}>
              {busy === "share" ? <Loader2 className="animate-spin" /> : <Share2 />}
              Share
            </Button>
          )}
          <Button onClick={() => void run("download")} disabled={!!busy || fileCount === 0 || plans.some((plan) => !plan)}>
            {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />}
            {busy === "download" && progress ? `Exporting ${progress}` : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const segmentClass = (active: boolean) =>
  cn(
    "h-8 rounded-md px-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
  );

/** Share the files where the system's share sheet takes them all; false when it does not or is cancelled. */
async function shareFiles(files: readonly ExportedFile[]): Promise<boolean> {
  const shared = files.map((file) => new File([file.blob], file.name, { type: file.blob.type }));
  if (!navigator.canShare?.({ files: shared })) {
    toast.error("This device cannot share these files; download them instead");
    return false;
  }
  try {
    await navigator.share({ files: shared, title: files[0]?.name });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    throw error;
  }
}

function safeWidth(canvas: FabricCanvas): number {
  try {
    return nativeWidth(canvas);
  } catch {
    return 0;
  }
}

function safeLayerCount(canvas: FabricCanvas): number {
  try {
    return layerExports(canvas).length;
  } catch {
    return 0;
  }
}

function safePlan(canvas: FabricCanvas, size: ExportSize) {
  try {
    return planExport(canvas, size);
  } catch {
    return null;
  }
}
