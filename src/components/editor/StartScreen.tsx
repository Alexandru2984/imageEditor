import { useRef, useState } from "react";
import {
  Crop,
  Download,
  FolderOpen,
  History,
  ImagePlus,
  Layers,
  Loader2,
  ScanFace,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Type,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SavedProject } from "@/utils/projectStore";
import { MAX_IMAGE_FILE_BYTES, RASTER_FILE_ACCEPT } from "@/utils/imageFile";
import { CANVAS_PRESETS, createBlankImage, createSampleImage } from "@/utils/starterImages";
import { toast } from "sonner";

interface StartScreenProps {
  /** Open an image file as a new document. Resolves once it is decoded. */
  onFile: (file: File) => Promise<void> | void;
  savedProject?: SavedProject | null;
  onRestore?: () => void;
  onOpenProject?: (file: File) => void;
  dragActive?: boolean;
}

const FEATURES = [
  {
    icon: ScanFace,
    title: "AI background removal",
    text: "Cut out people, products and pets in one click. The model runs on your device.",
  },
  {
    icon: Layers,
    title: "Layers and masks",
    text: "Stack photos, reorder, lock, blend and mask any layer non-destructively.",
  },
  {
    icon: Type,
    title: "Text, shapes, drawing",
    text: "Annotate with arrows, stars and text, or sketch freehand with soft brushes.",
  },
  {
    icon: SlidersHorizontal,
    title: "Adjustments",
    text: "Brightness, contrast, saturation, hue and blur, always re-editable.",
  },
  {
    icon: Crop,
    title: "Crop and transform",
    text: "Crop, rotate, flip and align with pixel-precise exports at full resolution.",
  },
  {
    icon: Download,
    title: "Export anywhere",
    text: "PNG, JPG or WebP at any size, copy to the clipboard, or share from your phone.",
  },
];

const formatSavedAt = (savedAt: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      savedAt
    );
  } catch {
    return new Date(savedAt).toLocaleString();
  }
};

export const StartScreen = ({
  onFile,
  savedProject,
  onRestore,
  onOpenProject,
  dragActive = false,
}: StartScreenProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [transparentBlank, setTransparentBlank] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, makeFile: () => Promise<File>) => {
    if (busy) return;
    setBusy(id);
    try {
      await onFile(await makeFile());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the image");
    } finally {
      setBusy(null);
    }
  };

  const openPicker = () => fileInputRef.current?.click();

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 pb-12 pt-6 sm:px-6 sm:pt-10 lg:gap-16 lg:pt-14">
        <section className="grid items-center gap-6 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              Free · No sign-up · Runs on your device
            </span>
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl sm:leading-[1.05]">
              Free photo editor{" "}
              <span className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
                right in your browser
              </span>
            </h1>
            <p className="max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
              Remove backgrounds with on-device AI, add text, shapes and drawings, adjust colours,
              crop and export. Your photos never leave your device.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="gap-2"
                disabled={!!busy}
                onClick={() => void run("sample", () => createSampleImage())}
              >
                {busy === "sample" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Try a sample photo
              </Button>
              {onOpenProject && (
                <Button
                  variant="ghost"
                  className="gap-2 text-muted-foreground hover:text-foreground"
                  onClick={() => projectInputRef.current?.click()}
                >
                  <FolderOpen className="h-4 w-4" />
                  Open a saved project file
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {savedProject && onRestore && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <History className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Continue last project</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Autosaved {formatSavedAt(savedProject.savedAt)}
                    </p>
                  </div>
                </div>
                <Button size="sm" onClick={onRestore} className="shrink-0">
                  Continue
                </Button>
              </div>
            )}

            <div
              role="button"
              tabIndex={0}
              aria-label="Upload an image"
              onClick={openPicker}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openPicker();
                }
              }}
              className={cn(
                "group relative flex cursor-pointer select-none flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-14",
                dragActive
                  ? "scale-[1.01] border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/60 hover:bg-primary/[0.04]"
              )}
            >
              <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(60%_50%_at_50%_0%,hsl(var(--primary)/0.14),transparent)]" />
              <span
                className={cn(
                  "relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary transition-transform duration-200 group-hover:scale-105",
                  dragActive && "scale-110"
                )}
              >
                {dragActive ? <Upload className="h-8 w-8 animate-bounce" /> : <ImagePlus className="h-8 w-8" />}
              </span>
              <h2 className="relative text-xl font-semibold">
                {dragActive ? "Drop your image here" : "Upload an Image"}
              </h2>
              <p className="relative mt-1.5 max-w-xs text-sm text-muted-foreground">
                Drag and drop, paste from the clipboard, or browse your files
              </p>
              <span className="relative mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-colors group-hover:bg-primary/90">
                <Upload className="h-4 w-4" />
                Choose image
              </span>
              <p className="relative mt-5 text-xs text-muted-foreground">
                JPG, PNG, GIF, WebP · up to {Math.round(MAX_IMAGE_FILE_BYTES / (1024 * 1024))} MB / 50 MP
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={RASTER_FILE_ACCEPT}
                data-testid="image-input"
                className="hidden"
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void onFile(file);
                }}
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="blank-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="blank-heading" className="text-lg font-semibold tracking-tight">
                Or start from a blank canvas
              </h2>
              <p className="text-sm text-muted-foreground">
                Perfect for posters, thumbnails, memes and social posts.
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Blank canvas background"
              className="inline-flex rounded-lg bg-muted/70 p-1 text-xs font-medium"
            >
              {[
                { value: false, label: "White" },
                { value: true, label: "Transparent" },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={transparentBlank === option.value}
                  onClick={() => setTransparentBlank(option.value)}
                  className={cn(
                    "h-7 rounded-md px-3 transition-colors",
                    transparentBlank === option.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {CANVAS_PRESETS.map((preset) => {
              const ratio = preset.width / preset.height;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!!busy}
                  aria-label={`New ${preset.label} canvas, ${preset.width} by ${preset.height} pixels`}
                  onClick={() =>
                    void run(preset.id, () =>
                      createBlankImage(preset.width, preset.height, transparentBlank ? null : "#ffffff")
                    )
                  }
                  className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-4 text-center transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span className="flex h-16 w-16 items-center justify-center">
                    <span
                      className={cn(
                        "rounded-[4px] border border-border shadow-sm transition-colors group-hover:border-primary/60",
                        transparentBlank ? "checkerboard" : "bg-white"
                      )}
                      style={
                        ratio >= 1
                          ? { width: 56, height: Math.max(20, 56 / ratio) }
                          : { height: 56, width: Math.max(20, 56 * ratio) }
                      }
                    />
                  </span>
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {busy === preset.id ? "Creating…" : preset.label}
                    </span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {preset.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="features-heading" className="space-y-4">
          <h2 id="features-heading" className="text-lg font-semibold tracking-tight">
            Everything you need, nothing to install
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl border border-border bg-card p-5">
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Images are processed locally and autosaved only in this browser.
          </p>
          <p className="hidden sm:block">
            Press <kbd className="rounded border border-border bg-muted px-1">?</kbd> in the editor for
            keyboard shortcuts
          </p>
        </footer>
      </div>

      {onOpenProject && (
        <input
          ref={projectInputRef}
          type="file"
          accept=".json,application/json"
          data-testid="project-input"
          className="hidden"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onOpenProject(file);
          }}
        />
      )}
    </div>
  );
};
