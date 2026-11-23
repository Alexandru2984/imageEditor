import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { Brush, Eraser } from "lucide-react";
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
import { addLayerMask, maskLayer, maskTargetOf } from "@/raster/layerMask";
import { copySelectionToLayer } from "@/selection/actions";
import { sampleDocument } from "@/selection/magicWand";
import { Mask } from "@/selection/mask";
import { refineInWorker } from "@/selection/refineClient";
import { DEFAULT_REFINE, type RefineDab, type RefineSettings } from "@/selection/refineEdge";
import { documentGrid, selectionOf, type DocumentGrid, type PixelSelection } from "@/selection/state";

/** The preview's longest side, in pixels. */
const PREVIEW_SIZE = 560;
/** At most this many brush dabs are kept. */
const MAX_DABS = 20_000;

type View = "overlay" | "black" | "white" | "mask";
type Output = "selection" | "layerMask" | "newLayer" | "newLayerMask";

const VIEWS: { value: View; label: string }[] = [
  { value: "overlay", label: "Overlay" },
  { value: "black", label: "On Black" },
  { value: "white", label: "On White" },
  { value: "mask", label: "Black & White" },
];
const OUTPUTS: { value: Output; label: string }[] = [
  { value: "selection", label: "Selection" },
  { value: "layerMask", label: "Layer Mask" },
  { value: "newLayer", label: "New Layer" },
  { value: "newLayerMask", label: "New Layer with Layer Mask" },
];
const CONTROLS: { key: keyof RefineSettings; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: "radius", label: "Radius", min: 0, max: 250, step: 1, unit: "px" },
  { key: "smooth", label: "Smooth", min: 0, max: 100, step: 1, unit: "" },
  { key: "feather", label: "Feather", min: 0, max: 250, step: 0.5, unit: "px" },
  { key: "contrast", label: "Contrast", min: 0, max: 100, step: 1, unit: "%" },
  { key: "shiftEdge", label: "Shift Edge", min: -100, max: 100, step: 1, unit: "%" },
];

interface Opened {
  grid: DocumentGrid;
  selection: PixelSelection;
  pixels: Uint8ClampedArray;
  /** The picture and the selection at the preview's size. */
  small: ImageData;
  smallMask: Uint8Array;
  /** Preview pixels per document pixel. */
  scale: number;
}

/** Pixels (or a selection, as alpha) drawn smaller with the browser's own resampling. */
function shrink(data: Uint8ClampedArray, width: number, height: number, smallWidth: number, smallHeight: number): ImageData {
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  full.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  const small = document.createElement("canvas");
  small.width = smallWidth;
  small.height = smallHeight;
  const context = small.getContext("2d", { willReadFrequently: true })!;
  context.imageSmoothingQuality = "high";
  context.drawImage(full, 0, 0, smallWidth, smallHeight);
  full.width = 0;
  const result = context.getImageData(0, 0, smallWidth, smallHeight);
  small.width = 0;
  return result;
}

function open(canvas: FabricCanvas): Opened | string {
  const grid = documentGrid(canvas);
  if (!grid) return "Open a photo first";
  const selection = selectionOf(canvas).current();
  if (!selection) return "Make a selection first";
  if (selection.mask.width !== grid.width || selection.mask.height !== grid.height) return "The document changed; select again";
  const pixels = sampleDocument(canvas, grid, true);
  if (!pixels) return "The image could not be read";
  const scale = Math.min(1, PREVIEW_SIZE / Math.max(grid.width, grid.height));
  const smallWidth = Math.max(1, Math.round(grid.width * scale));
  const smallHeight = Math.max(1, Math.round(grid.height * scale));
  const small = shrink(pixels, grid.width, grid.height, smallWidth, smallHeight);
  const asAlpha = new Uint8ClampedArray(grid.width * grid.height * 4);
  const data = selection.mask.data;
  for (let index = 0; index < data.length; index += 1) {
    asAlpha[index * 4] = 255;
    asAlpha[index * 4 + 1] = 255;
    asAlpha[index * 4 + 2] = 255;
    asAlpha[index * 4 + 3] = data[index]!;
  }
  const shrunk = shrink(asAlpha, grid.width, grid.height, smallWidth, smallHeight).data;
  const smallMask = new Uint8Array(smallWidth * smallHeight);
  for (let index = 0; index < smallMask.length; index += 1) smallMask[index] = shrunk[index * 4 + 3]!;
  return { grid, selection, pixels, small, smallMask, scale: smallWidth / grid.width };
}

interface SelectAndMaskDialogProps {
  canvas: FabricCanvas | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Select › Select and Mask (Alt+Ctrl+R): the selection's edge made to
 * follow the picture within a radius of it, and where the Refine Edge brush
 * goes (for hair and fur), then smoothed, feathered, sharpened or moved;
 * seen as an overlay, on black, on white or as the mask itself; and given
 * back as a selection, a layer mask or a new layer.
 */
export function SelectAndMaskDialog({ canvas, open: isOpen, onClose }: SelectAndMaskDialogProps) {
  // The settings, view and output carry over between openings; the brush strokes do not.
  const [settings, setSettings] = useState<RefineSettings>(DEFAULT_REFINE);
  const [view, setView] = useState<View>("overlay");
  const [output, setOutput] = useState<Output>("selection");
  const [brushing, setBrushing] = useState(true);
  const [brushSize, setBrushSize] = useState(40);
  const [dabs, setDabs] = useState<RefineDab[]>([]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [refined, setRefined] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<{ erase: boolean; last: { x: number; y: number } | null } | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (!isOpen || !canvas) {
      setOpened(null);
      setRefined(null);
      return;
    }
    setDabs([]);
    setBusy(false);
    try {
      const result = open(canvas);
      if (typeof result === "string") {
        toast.error(result);
        onClose();
        return;
      }
      setOpened(result);
      setRefined(result.smallMask);
    } catch (error) {
      console.error("Select and Mask failed:", error);
      toast.error(error instanceof Error ? error.message : "The image could not be read");
      onClose();
    }
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, canvas]);

  // The preview's selection, worked out shortly after the settings settle.
  useEffect(() => {
    if (!opened) return;
    const token = (request.current += 1);
    const timer = window.setTimeout(() => {
      const { small, smallMask, scale } = opened;
      refineInWorker(small.data, smallMask, small.width, small.height, settings, dabs, scale)
        .then((result) => {
          if (token === request.current) setRefined(result);
        })
        .catch((error: unknown) => console.error("Select and Mask preview failed:", error));
    }, 50);
    return () => window.clearTimeout(timer);
  }, [opened, settings, dabs]);

  // Draw the preview in the chosen view.
  useEffect(() => {
    const element = previewRef.current;
    if (!element || !opened || !refined) return;
    const { small } = opened;
    element.width = small.width;
    element.height = small.height;
    const context = element.getContext("2d");
    if (!context) return;
    const out = context.createImageData(small.width, small.height);
    const source = small.data;
    const target = out.data;
    for (let index = 0; index < refined.length; index += 1) {
      const alpha = refined[index]! / 255;
      const offset = index * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = source[offset + channel]!;
        let shown: number;
        if (view === "mask") shown = refined[index]!;
        else if (view === "black") shown = value * alpha;
        else if (view === "white") shown = value * alpha + 255 * (1 - alpha);
        // Overlay: the unselected part tinted red, as Quick Mask shows it.
        else shown = value * alpha + (value * 0.5 + (channel === 0 ? 255 : 0) * 0.5) * (1 - alpha);
        target[offset + channel] = shown;
      }
      target[offset + 3] = 255;
    }
    context.putImageData(out, 0, 0);
  }, [opened, refined, view]);

  /** The document pixel under the pointer. */
  const pointAt = (event: ReactPointerEvent): { x: number; y: number } | null => {
    const element = previewRef.current;
    if (!element || !opened) return null;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      x: ((event.clientX - box.left) / box.width) * opened.grid.width,
      y: ((event.clientY - box.top) / box.height) * opened.grid.height,
    };
  };

  /** Brush dabs at these points, or take back the dabs near them. */
  const dab = (points: { x: number; y: number }[], erase: boolean) => {
    const radius = brushSize / 2;
    if (erase) {
      setDabs((current) => current.filter((placed) => points.every((point) => Math.hypot(placed.x - point.x, placed.y - point.y) > radius)));
      return;
    }
    setDabs((current) => (current.length >= MAX_DABS ? current : [...current, ...points.map((point) => ({ ...point, radius }))].slice(0, MAX_DABS)));
  };

  const brushDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!brushing || event.button > 0) return;
    const point = pointAt(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    stroke.current = { erase: event.altKey, last: point };
    dab([point], event.altKey);
  };
  const brushMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = stroke.current;
    if (!current?.last) return;
    const point = pointAt(event);
    if (!point) return;
    // A dab every third of the brush along the stroke.
    const spacing = Math.max(1, brushSize / 6);
    const distance = Math.hypot(point.x - current.last.x, point.y - current.last.y);
    if (distance < spacing) return;
    const steps = Math.min(200, Math.floor(distance / spacing));
    const from = current.last;
    const points = Array.from({ length: steps }, (_, index) => {
      const t = (index + 1) / steps;
      return { x: from.x + (point.x - from.x) * t, y: from.y + (point.y - from.y) * t };
    });
    dab(points, current.erase);
    current.last = point;
  };
  const brushUp = () => {
    stroke.current = null;
  };

  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (!canvas || !opened || busy) return;
    const { grid, selection, pixels } = opened;
    const current = documentGrid(canvas);
    if (!current || current.width !== grid.width || current.height !== grid.height) {
      toast.error("The document changed; open Select and Mask again");
      onClose();
      return;
    }
    setBusy(true);
    try {
      const data = await refineInWorker(pixels, selection.mask.data, grid.width, grid.height, settings, dabs, 1);
      const mask = new Mask(grid.width, grid.height, data);
      const refinedSelection: PixelSelection = { grid, mask };
      const store = selectionOf(canvas);
      if (output === "selection") {
        store.set(mask.isEmpty() ? null : mask, grid, "Select and Mask");
      } else if (output === "layerMask") {
        const layer = maskLayer(canvas);
        if (typeof layer === "string") {
          toast.error(layer);
          return;
        }
        if (!(await addLayerMask(canvas, layer, { selection: refinedSelection }))) return;
        store.set(null);
        maskTargetOf(canvas).set(layer);
      } else {
        if (mask.isEmpty()) {
          toast.error("Nothing is selected");
          return;
        }
        const withMask = output === "newLayerMask";
        const copy = await copySelectionToLayer(canvas, withMask ? { grid, mask: Mask.full(grid.width, grid.height) } : refinedSelection);
        if (!copy) return;
        if (withMask) {
          if (!(await addLayerMask(canvas, copy.layer, { selection: refinedSelection }))) return;
          maskTargetOf(canvas).set(copy.layer);
        }
        store.set(null);
      }
      onClose();
    } catch (error) {
      console.error("Select and Mask failed:", error);
      toast.error(error instanceof Error ? error.message : "The selection could not be refined");
    } finally {
      setBusy(false);
    }
  };

  const setValue = (key: keyof RefineSettings, raw: number, min: number, max: number) => {
    if (!Number.isFinite(raw)) return;
    setSettings((current) => ({ ...current, [key]: Math.min(max, Math.max(min, raw)) }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[95dvh] max-w-3xl overflow-y-auto">
        <form onSubmit={apply} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Select and Mask</DialogTitle>
            <DialogDescription>
              Brush over hair and soft edges to refine them; Alt-drag takes the brush back. Radius refines all along the edge.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex max-h-[min(560px,45dvh)] items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                <canvas
                  ref={previewRef}
                  data-testid="select-and-mask-preview"
                  aria-label="Preview; brush here to refine the edge"
                  onPointerDown={brushDown}
                  onPointerMove={brushMove}
                  onPointerUp={brushUp}
                  onPointerCancel={brushUp}
                  className="max-h-[min(560px,45dvh)] max-w-full touch-none object-contain"
                  style={{ cursor: brushing ? "crosshair" : "default" }}
                />
              </div>
              <div role="radiogroup" aria-label="View" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {VIEWS.map((option) => (
                  <label key={option.value} className="flex items-center gap-1.5">
                    <input type="radio" name="select-and-mask-view" checked={view === option.value} onChange={() => setView(option.value)} />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid content-start gap-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={brushing ? "secondary" : "ghost"}
                  aria-pressed={brushing}
                  onClick={() => setBrushing(!brushing)}
                  className="gap-1.5"
                >
                  <Brush className="h-4 w-4" />
                  Refine Edge brush
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="Clear brush strokes"
                  title="Clear brush strokes"
                  disabled={dabs.length === 0}
                  onClick={() => setDabs([])}
                >
                  <Eraser className="h-4 w-4" />
                </Button>
              </div>
              <div className={cn("grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2", !brushing && "opacity-50")}>
                <span className="text-xs text-muted-foreground">Size</span>
                <Slider
                  value={[brushSize]}
                  min={1}
                  max={500}
                  step={1}
                  disabled={!brushing}
                  aria-label="Brush size"
                  onValueChange={(next) => setBrushSize(next[0] ?? brushSize)}
                />
                <span className="text-right text-xs tabular-nums text-muted-foreground">{brushSize} px</span>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Edge</legend>
                {CONTROLS.map((control) => (
                  <div key={control.key} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2">
                    <span className="text-xs text-muted-foreground">{control.label}</span>
                    <Slider
                      value={[settings[control.key]]}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      aria-label={control.label}
                      onValueChange={(next) => setValue(control.key, next[0] ?? settings[control.key], control.min, control.max)}
                    />
                    <input
                      type="number"
                      aria-label={`${control.label} value`}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={settings[control.key]}
                      onChange={(event) => setValue(control.key, event.target.valueAsNumber, control.min, control.max)}
                      title={control.unit}
                      className="h-7 w-full rounded border border-input bg-background px-1 text-right text-xs tabular-nums"
                    />
                  </div>
                ))}
              </fieldset>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Output to</span>
                <select
                  aria-label="Output to"
                  value={output}
                  onChange={(event) => setOutput(event.target.value as Output)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {OUTPUTS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setSettings(DEFAULT_REFINE)}>
                Reset settings
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!opened || busy}>
              {busy ? "Refining…" : "OK"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
