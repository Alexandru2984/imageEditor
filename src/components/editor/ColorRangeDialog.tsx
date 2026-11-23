import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { Minus, Pipette, Plus } from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  COLOR_RANGE_TARGETS,
  colorRangeMask,
  colorRangeTable,
  DEFAULT_COLOR_RANGE,
  usesFuzziness,
  type ColorRangeSettings,
  type ColorRangeTarget,
  type Rgb,
} from "@/selection/colorRange";
import { sampleDocument } from "@/selection/magicWand";
import { Mask } from "@/selection/mask";
import { documentGrid, selectionOf, type DocumentGrid, type PixelSelection } from "@/selection/state";

/** The preview's longest side, in pixels. */
const PREVIEW_SIZE = 280;

type PickMode = "sample" | "add" | "subtract";

interface Sampled {
  grid: DocumentGrid;
  pixels: Uint8ClampedArray;
  /** The document's pixels at the preview's size. */
  small: ImageData;
  /** The selection Color Range works inside, as Photoshop's does. */
  within: PixelSelection | null;
}

const selectClass = "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm";

/** The document at the preview's size. */
function shrink(pixels: Uint8ClampedArray, width: number, height: number): ImageData {
  const scale = Math.min(1, PREVIEW_SIZE / Math.max(width, height));
  const smallWidth = Math.max(1, Math.round(width * scale));
  const smallHeight = Math.max(1, Math.round(height * scale));
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  full.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  const small = document.createElement("canvas");
  small.width = smallWidth;
  small.height = smallHeight;
  const context = small.getContext("2d", { willReadFrequently: true })!;
  context.imageSmoothingQuality = "high";
  context.drawImage(full, 0, 0, smallWidth, smallHeight);
  full.width = 0;
  return context.getImageData(0, 0, smallWidth, smallHeight);
}

interface ColorRangeDialogProps {
  canvas: FabricCanvas | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Select › Color Range: click the preview to pick the colours to select
 * (Shift adds, Alt takes away), or choose a colour family or tone; the
 * preview shows the selection as grey (white is selected) or the image.
 */
export function ColorRangeDialog({ canvas, open, onClose }: ColorRangeDialogProps) {
  // The choice of range, fuzziness and inversion carry over between openings; the samples do not.
  const [settings, setSettings] = useState<ColorRangeSettings>(DEFAULT_COLOR_RANGE);
  const [mode, setMode] = useState<PickMode>("sample");
  const [view, setView] = useState<"selection" | "image">("selection");
  const [sampled, setSampled] = useState<Sampled | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open || !canvas) {
      setSampled(null);
      return;
    }
    setSettings((current) => ({ ...current, samples: [], excluded: [] }));
    const grid = documentGrid(canvas);
    if (!grid) {
      toast.error("Open a photo first");
      onClose();
      return;
    }
    try {
      const pixels = sampleDocument(canvas, grid, true);
      if (!pixels) throw new Error("The image could not be read");
      setSampled({ grid, pixels, small: shrink(pixels, grid.width, grid.height), within: selectionOf(canvas).current() });
    } catch (error) {
      console.error("Color Range failed:", error);
      toast.error(error instanceof Error ? error.message : "The image could not be read");
      onClose();
    }
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canvas]);

  const table = useMemo(() => colorRangeTable(settings), [settings]);

  // Draw the preview: the selection in grey, or the image.
  useEffect(() => {
    const element = previewRef.current;
    if (!element || !sampled) return;
    const { small, within, grid } = sampled;
    element.width = small.width;
    element.height = small.height;
    const context = element.getContext("2d");
    if (!context) return;
    if (view === "image") {
      context.putImageData(small, 0, 0);
      return;
    }
    const values = table ? colorRangeMask(small.data, table) : new Uint8Array(small.width * small.height);
    const out = context.createImageData(small.width, small.height);
    const words = new Uint32Array(out.data.buffer);
    for (let index = 0; index < values.length; index += 1) {
      let value = values[index]!;
      if (within && value) {
        const x = Math.min(grid.width - 1, Math.floor(((index % small.width) + 0.5) * (grid.width / small.width)));
        const y = Math.min(grid.height - 1, Math.floor((Math.floor(index / small.width) + 0.5) * (grid.height / small.height)));
        value = Math.min(value, within.mask.data[y * grid.width + x]!);
      }
      words[index] = 0xff000000 | (value << 16) | (value << 8) | value;
    }
    context.putImageData(out, 0, 0);
  }, [sampled, table, view]);

  const pick = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const element = previewRef.current;
    if (!element || !sampled) return;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    // Around the picture, not on it.
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return;
    const { grid, pixels } = sampled;
    const x = Math.min(grid.width - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * grid.width)));
    const y = Math.min(grid.height - 1, Math.max(0, Math.floor(((event.clientY - box.top) / box.height) * grid.height)));
    const offset = (y * grid.width + x) * 4;
    const colour: Rgb = [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!];
    const chosen: PickMode = event.altKey ? "subtract" : event.shiftKey ? "add" : mode;
    setSettings((current) => {
      const base = current.target === "sampled" ? current : { ...current, samples: [], excluded: [] };
      if (chosen === "add") return { ...base, target: "sampled", samples: [...base.samples, colour] };
      if (chosen === "subtract") return { ...base, target: "sampled", excluded: [...base.excluded, colour] };
      return { ...base, target: "sampled", samples: [colour], excluded: [] };
    });
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!canvas || !sampled) return;
    if (!table) {
      toast.message("Click the preview to pick a colour first");
      return;
    }
    const { grid, pixels, within } = sampled;
    const store = selectionOf(canvas);
    const current = documentGrid(canvas);
    if (!current || current.width !== grid.width || current.height !== grid.height) {
      toast.error("The document changed; open Color Range again");
      onClose();
      return;
    }
    let mask = new Mask(grid.width, grid.height, colorRangeMask(pixels, table));
    if (within && within.mask.width === mask.width && within.mask.height === mask.height) {
      mask = mask.combine(within.mask, "intersect");
    }
    if (mask.isEmpty()) toast.warning("No pixels matched");
    store.set(mask, grid, "Color Range");
    onClose();
  };

  const fuzzy = usesFuzziness(settings.target);
  const tool = (value: PickMode, label: string, Icon: typeof Pipette) => (
    <Button
      type="button"
      size="icon"
      variant={mode === value ? "secondary" : "ghost"}
      className="h-8 w-8"
      aria-label={label}
      aria-pressed={mode === value}
      title={label}
      onClick={() => setMode(value)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <form onSubmit={apply} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Color Range</DialogTitle>
            <DialogDescription>
              {sampled?.within ? "Selects only inside the current selection. " : ""}
              Click the preview to pick colours; Shift-click adds, Alt-click takes away.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <select
              aria-label="Select"
              value={settings.target}
              onChange={(event) => setSettings((current) => ({ ...current, target: event.target.value as ColorRangeTarget }))}
              className={selectClass}
            >
              {COLOR_RANGE_TARGETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div role="group" aria-label="Eyedropper" className="flex gap-0.5">
              {tool("sample", "Sample a colour", Pipette)}
              {tool("add", "Add to sample", Plus)}
              {tool("subtract", "Take from sample", Minus)}
            </div>
          </div>
          <div className={cn("grid grid-cols-[5rem_1fr_2.5rem] items-center gap-2", !fuzzy && "opacity-50")}>
            <span className="text-xs text-muted-foreground">Fuzziness</span>
            <Slider
              value={[settings.fuzziness]}
              min={0}
              max={200}
              step={1}
              disabled={!fuzzy}
              aria-label="Fuzziness"
              onValueChange={(next) => setSettings((current) => ({ ...current, fuzziness: next[0] ?? current.fuzziness }))}
            />
            <span className="text-right text-xs tabular-nums text-muted-foreground">{settings.fuzziness}</span>
          </div>
          <button
            type="button"
            aria-label="Pick a colour from the preview"
            onPointerDown={pick}
            className="mx-auto flex max-h-[min(280px,40vh)] w-full items-center justify-center overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(#ccc_0_25%,#fff_0_50%)] bg-[length:12px_12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ cursor: "crosshair" }}
          >
            <canvas
              ref={previewRef}
              data-testid="color-range-preview"
              className="max-h-[min(280px,40vh)] max-w-full object-contain"
            />
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div role="radiogroup" aria-label="Preview" className="flex gap-3">
              {(["selection", "image"] as const).map((value) => (
                <label key={value} className="flex items-center gap-1.5">
                  <input type="radio" name="color-range-view" checked={view === value} onChange={() => setView(value)} />
                  {value === "selection" ? "Selection" : "Image"}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={settings.invert}
                onChange={(event) => setSettings((current) => ({ ...current, invert: event.target.checked }))}
              />
              Invert
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!sampled || !table}>
              OK
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
