import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Canvas as FabricCanvas } from "fabric";
import {
  ArrowLeftToLine,
  Expand,
  Pointer,
  RotateCcw,
  RotateCw,
  Shrink,
  Snowflake,
  Sun,
  Undo2,
  Waves,
  type LucideIcon,
} from "lucide-react";
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
  LiquifyField,
  renderLiquify,
  type Box,
  type LiquifyBrush,
  type LiquifyTool,
  type Point,
  type SourcePixels,
} from "@/raster/liquify";
import { PixelPreview, adjustTarget } from "@/raster/pixelPreview";
import { selectionOf } from "@/selection/state";
import { nameNextStep } from "@/utils/historySteps";

/** The preview's longest side, in its own pixels. */
const PREVIEW_SIZE = 1400;
/** How often a tool held still works again (Twirl, Pucker, Bloat, …). */
const TICK_MS = 30;

const TOOLS: { tool: LiquifyTool; label: string; key: string; Icon: LucideIcon }[] = [
  { tool: "warp", label: "Forward Warp", key: "w", Icon: Pointer },
  { tool: "reconstruct", label: "Reconstruct", key: "r", Icon: RotateCcw },
  { tool: "smooth", label: "Smooth", key: "e", Icon: Waves },
  { tool: "twirl", label: "Twirl Clockwise", key: "c", Icon: RotateCw },
  { tool: "pucker", label: "Pucker", key: "s", Icon: Shrink },
  { tool: "bloat", label: "Bloat", key: "b", Icon: Expand },
  { tool: "pushLeft", label: "Push Left", key: "o", Icon: ArrowLeftToLine },
  { tool: "freeze", label: "Freeze Mask", key: "f", Icon: Snowflake },
  { tool: "thaw", label: "Thaw Mask", key: "d", Icon: Sun },
];
const HINTS: Record<LiquifyTool, string> = {
  warp: "Drag to push the picture along.",
  reconstruct: "Brush to undo the distortion bit by bit.",
  smooth: "Brush to even out a jagged distortion.",
  twirl: "Hold or drag to twirl clockwise; Alt twirls the other way.",
  pucker: "Hold or drag to draw the picture in; Alt bloats.",
  bloat: "Hold or drag to swell the picture out; Alt puckers.",
  pushLeft: "Drag up to push left, down to push right; Alt reverses.",
  freeze: "Paint over what the other tools must leave alone.",
  thaw: "Paint to free frozen parts again.",
};
/** Tools that keep working while the pointer is held still. */
const HELD: ReadonlySet<LiquifyTool> = new Set(["reconstruct", "smooth", "twirl", "pucker", "bloat", "freeze", "thaw"]);

interface Settings {
  /** Brush diameter in layer pixels. */
  size: number;
  density: number;
  pressure: number;
  rate: number;
}
const DEFAULT_SETTINGS: Settings = { size: 100, density: 50, pressure: 100, rate: 80 };
const SETTINGS: { key: keyof Settings; label: string; min: number; max: number }[] = [
  { key: "size", label: "Size", min: 1, max: 3000 },
  { key: "density", label: "Density", min: 0, max: 100 },
  { key: "pressure", label: "Pressure", min: 1, max: 100 },
  { key: "rate", label: "Rate", min: 0, max: 100 },
];

interface Session {
  preview: PixelPreview;
  field: LiquifyField;
  /** The layer around the region, at the preview's sampling size. */
  source: SourcePixels;
  sourceScale: number;
  offsetX: number;
  offsetY: number;
  /** Preview pixels per layer pixel, and the preview's size. */
  scale: number;
  width: number;
  height: number;
  /** The region as it is, at the preview's size, and how much of it the selection takes. */
  base: Uint8ClampedArray;
  weights: Uint8Array | null;
  /** Scratch for the liquified pixels and what is on screen. */
  scratch: Uint8ClampedArray;
  shown: ImageData;
}

/** Pixels drawn smaller with the browser's own resampling. */
function shrink(data: Uint8ClampedArray, width: number, height: number, scale: number): SourcePixels {
  if (scale >= 1) return { data, width, height };
  const smallWidth = Math.max(1, Math.round(width * scale));
  const smallHeight = Math.max(1, Math.round(height * scale));
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
  return { data: result.data, width: smallWidth, height: smallHeight };
}

function startSession(preview: PixelPreview): Session {
  const regionWidth = preview.width;
  const regionHeight = preview.height;
  const field = new LiquifyField(regionWidth, regionHeight);
  // The tools can pull in the layer from around a selection.
  const area = preview.around(Math.min(1024, Math.max(regionWidth, regionHeight)));
  const scale = Math.min(2, PREVIEW_SIZE / Math.max(regionWidth, regionHeight));
  const width = Math.max(1, Math.round(regionWidth * scale));
  const height = Math.max(1, Math.round(regionHeight * scale));
  const sourceScale = Math.min(1, scale);
  const source = shrink(area.data, area.width, area.height, sourceScale);
  const base = new Uint8ClampedArray(width * height * 4);
  renderLiquify(field, source, base, width, height, { scale: width / regionWidth, sourceScale, offsetX: area.x, offsetY: area.y });
  let weights: Uint8Array | null = null;
  if (preview.weights) {
    const full = preview.weights;
    weights = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const row = Math.min(regionHeight - 1, Math.floor(((y + 0.5) * regionHeight) / height)) * regionWidth;
      for (let x = 0; x < width; x += 1) {
        weights[y * width + x] = full[row + Math.min(regionWidth - 1, Math.floor(((x + 0.5) * regionWidth) / width))]!;
      }
    }
  }
  return {
    preview,
    field,
    source,
    sourceScale,
    offsetX: area.x,
    offsetY: area.y,
    scale: width / regionWidth,
    width,
    height,
    base,
    weights,
    scratch: new Uint8ClampedArray(width * height * 4),
    shown: new ImageData(new Uint8ClampedArray(base), width, height),
  };
}

interface LiquifyDialogProps {
  canvas: FabricCanvas | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Filter › Liquify (Shift+Ctrl+X): push, twirl, pucker and bloat the
 * layer's pixels with a brush, freeze what must stay put, and take it back
 * with Reconstruct; applied to the layer (or inside the selection) as one
 * step on OK.
 */
export function LiquifyDialog({ canvas, open, onClose }: LiquifyDialogProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [tool, setTool] = useState<LiquifyTool>("warp");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showMask, setShowMask] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number; diameter: number } | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  // The dialog's content mounts a render after it opens, so the effects wait for these.
  const [previewElement, setPreviewElement] = useState<HTMLCanvasElement | null>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const live = useRef({ tool, settings, showMask });
  live.current = { tool, settings, showMask };
  const stroke = useRef<{ last: Point; alt: boolean; timer: number | null } | null>(null);

  useEffect(() => {
    if (!open || !canvas) return;
    const target = adjustTarget(canvas);
    const preview = typeof target === "string" ? target : PixelPreview.open(canvas, target, selectionOf(canvas).current());
    if (typeof preview === "string") {
      toast.error(preview);
      onClose();
      return;
    }
    let started: Session;
    try {
      started = startSession(preview);
    } catch (error) {
      preview.cancel();
      console.error("Liquify failed:", error);
      toast.error("The layer could not be prepared for Liquify");
      onClose();
      return;
    }
    setSession(started);
    setCanUndo(false);
    setBusy(false);
    return () => {
      if (stroke.current?.timer) window.clearInterval(stroke.current.timer);
      stroke.current = null;
      // Closed without OK: the layer stays as it was.
      preview.cancel();
      setSession(null);
    };
    // onClose is read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canvas]);

  /** Draw again the layer pixels in `box` (all of them without one). */
  const redraw = useCallback(
    (box: Box | null) => {
      const element = previewRef.current;
      if (!session || !element) return;
      const { field, scale, width, height, base, weights, scratch, shown } = session;
      const area = box
        ? {
            left: Math.max(0, Math.floor(box.left * scale) - 1),
            top: Math.max(0, Math.floor(box.top * scale) - 1),
            right: Math.min(width, Math.ceil(box.right * scale) + 1),
            bottom: Math.min(height, Math.ceil(box.bottom * scale) + 1),
          }
        : { left: 0, top: 0, right: width, bottom: height };
      if (area.right <= area.left || area.bottom <= area.top) return;
      renderLiquify(field, session.source, scratch, width, height, {
        scale,
        sourceScale: session.sourceScale,
        offsetX: session.offsetX,
        offsetY: session.offsetY,
        box: area,
      });
      const out = shown.data;
      const tint = live.current.showMask;
      for (let y = area.top; y < area.bottom; y += 1) {
        for (let x = area.left; x < area.right; x += 1) {
          const index = y * width + x;
          const at = index * 4;
          const weight = weights ? weights[index]! / 255 : 1;
          for (let channel = 0; channel < 4; channel += 1) {
            const before = base[at + channel]!;
            out[at + channel] = before + (scratch[at + channel]! - before) * weight;
          }
          if (tint) {
            const frozen = field.freezeAt((x + 0.5) / scale, (y + 0.5) / scale) / 255;
            if (frozen > 0) {
              // Frozen parts show red, as in Photoshop.
              const mix = frozen * 0.5;
              out[at] = out[at]! + (255 - out[at]!) * mix;
              out[at + 1] = out[at + 1]! * (1 - mix);
              out[at + 2] = out[at + 2]! * (1 - mix);
              out[at + 3] = Math.max(out[at + 3]!, 255 * mix);
            }
          }
        }
      }
      element.getContext("2d")?.putImageData(shown, 0, 0, area.left, area.top, area.right - area.left, area.bottom - area.top);
    },
    [session]
  );

  // The preview fits the room it has, however the dialog is sized.
  useEffect(() => {
    if (!frame || !session) return;
    const measure = () => setRoom({ width: frame.clientWidth, height: frame.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [session, frame]);
  const fitted =
    session && room && room.width > 0 && room.height > 0
      ? (() => {
          const fit = Math.min(room.width / session.width, room.height / session.height);
          return { width: Math.floor(session.width * fit), height: Math.floor(session.height * fit) };
        })()
      : null;

  // A new session, or the frozen parts shown or hidden: draw it all.
  useEffect(() => {
    const element = previewElement;
    if (!session || !element) return;
    if (element.width !== session.width || element.height !== session.height) {
      element.width = session.width;
      element.height = session.height;
    }
    redraw(null);
  }, [session, redraw, showMask, previewElement]);

  const brush = (): LiquifyBrush => ({
    radius: Math.max(0.5, live.current.settings.size / 2),
    density: live.current.settings.density,
    pressure: live.current.settings.pressure,
  });

  /** One go of a tool at a point (`from` for the tools that push). */
  const work = (at: Point, from: Point | null, alt: boolean): Box | null => {
    if (!session) return null;
    const { field } = session;
    const { tool: current, settings: set } = live.current;
    const rate = set.rate / 100;
    switch (current) {
      case "warp":
        return from ? field.push(from, at, brush()) : null;
      case "pushLeft":
        return from ? field.push(from, at, brush(), true, alt) : null;
      case "reconstruct":
        return field.reconstruct(at, 0.12 * rate * (set.pressure / 100), brush());
      case "smooth":
        return field.smooth(at, 0.3 * rate * (set.pressure / 100), brush());
      case "twirl":
        return field.twirl(at, (alt ? -1 : 1) * 0.05 * rate, brush());
      case "pucker":
      case "bloat": {
        const inward = (current === "pucker") !== alt;
        return field.pinch(at, (inward ? 1 : -1) * 0.03 * rate, brush());
      }
      case "freeze":
      case "thaw":
        return field.paintFreeze(at, brush(), current === "thaw");
    }
  };

  /** The layer pixel under the pointer. */
  const pointAt = (event: { clientX: number; clientY: number }): Point | null => {
    const element = previewRef.current;
    if (!element || !session) return null;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      x: ((event.clientX - box.left) / box.width) * session.field.width,
      y: ((event.clientY - box.top) / box.height) * session.field.height,
    };
  };

  const showCursor = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const element = previewRef.current;
    if (!element || !session) return;
    const box = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    setCursor({
      x: event.clientX - parent.left,
      y: event.clientY - parent.top,
      diameter: (live.current.settings.size * box.width) / session.field.width,
    });
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!session || busy || event.button > 0) return;
    const point = pointAt(event);
    if (!point) return;
    event.preventDefault();
    // The tool keys work again after typing in a setting.
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    session.field.beginStroke();
    const current = { last: point, alt: event.altKey, timer: null as number | null };
    stroke.current = current;
    if (HELD.has(live.current.tool)) {
      redraw(work(point, null, event.altKey));
      current.timer = window.setInterval(() => redraw(work(current.last, null, current.alt)), TICK_MS);
    }
    showCursor(event);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    showCursor(event);
    const current = stroke.current;
    if (!current || !session) return;
    const point = pointAt(event);
    if (!point) return;
    current.alt = event.altKey;
    const { tool: active } = live.current;
    if (active === "warp" || active === "pushLeft") {
      redraw(work(point, current.last, event.altKey));
      current.last = point;
      return;
    }
    // The held tools work every quarter of the brush along the way.
    const spacing = Math.max(1, live.current.settings.size / 8);
    const distance = Math.hypot(point.x - current.last.x, point.y - current.last.y);
    if (distance < spacing) return;
    const steps = Math.min(64, Math.floor(distance / spacing));
    let box: Box | null = null;
    for (let step = 1; step <= steps; step += 1) {
      const at = {
        x: current.last.x + ((point.x - current.last.x) * step) / steps,
        y: current.last.y + ((point.y - current.last.y) * step) / steps,
      };
      const changed = work(at, null, event.altKey);
      if (changed) {
        box = box
          ? {
              left: Math.min(box.left, changed.left),
              top: Math.min(box.top, changed.top),
              right: Math.max(box.right, changed.right),
              bottom: Math.max(box.bottom, changed.bottom),
            }
          : changed;
      }
    }
    redraw(box);
    current.last = point;
  };

  const pointerUp = () => {
    const current = stroke.current;
    if (!current || !session) return;
    if (current.timer) window.clearInterval(current.timer);
    stroke.current = null;
    session.field.endStroke();
    setCanUndo(session.field.canUndo);
  };

  const undo = () => {
    if (!session || stroke.current) return;
    redraw(session.field.undo());
    setCanUndo(session.field.canUndo);
  };
  const restoreAll = () => {
    if (!session) return;
    redraw(session.field.restoreAll());
    setCanUndo(true);
  };
  const thawAll = () => {
    if (!session) return;
    redraw(session.field.thawAll());
    setCanUndo(true);
  };

  const apply = async () => {
    if (!session || !canvas || busy) return;
    const { field, preview } = session;
    if (field.isIdentity()) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const result = await preview.compute({
        op: "liquify",
        field: field.data.slice(),
        columns: field.columns,
        rows: field.rows,
        cell: field.cell,
        reach: Math.ceil(field.maxDisplacement()) + 2,
      });
      preview.present(result);
      nameNextStep(canvas, "Liquify");
      await preview.commit();
    } catch (error) {
      console.error("Liquify failed:", error);
      toast.error("Liquify could not be applied");
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const keyDown = (event: ReactKeyboardEvent) => {
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA";
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      setSettings((current) => {
        const step = Math.max(1, Math.round(current.size * 0.1));
        const size = Math.min(3000, Math.max(1, current.size + (event.key === "]" ? step : -step)));
        return { ...current, size };
      });
      return;
    }
    const picked = TOOLS.find((entry) => entry.key === event.key.toLowerCase());
    if (picked) {
      event.preventDefault();
      setTool(picked.tool);
    }
  };

  const setValue = (key: keyof Settings, value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) return;
    setSettings((current) => ({ ...current, [key]: Math.min(max, Math.max(min, Math.round(value))) }));
  };

  return (
    <Dialog open={open && session !== null} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        onKeyDown={keyDown}
        className="flex max-h-[96dvh] flex-col gap-3 overflow-y-auto sm:h-[94dvh] sm:max-w-[min(96vw,1400px)]"
      >
        <DialogHeader>
          <DialogTitle>Liquify</DialogTitle>
          <DialogDescription>
            {session?.preview.target.mask ? "On the layer mask. " : ""}
            {HINTS[tool]}
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-col gap-3 md:min-h-0 md:flex-1 md:shrink md:flex-row">
          <div role="toolbar" aria-label="Liquify tools" className="flex shrink-0 flex-wrap gap-1 md:flex-col">
            {TOOLS.map(({ tool: value, label, key, Icon }) => (
              <Button
                key={value}
                type="button"
                size="icon"
                variant={tool === value ? "secondary" : "ghost"}
                className="h-9 w-9"
                aria-label={label}
                aria-pressed={tool === value}
                title={`${label} (${key.toUpperCase()})`}
                onClick={() => setTool(value)}
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
          </div>
          <div
            ref={setFrame}
            className="relative flex min-h-[40dvh] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(#ccc_0_25%,#fff_0_50%)] bg-[length:16px_16px]"
          >
            <canvas
              ref={(element) => {
                previewRef.current = element;
                setPreviewElement(element);
              }}
              data-testid="liquify-preview"
              aria-label="Liquify preview; brush here"
              tabIndex={0}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onPointerLeave={() => setCursor(null)}
              className="absolute touch-none focus-visible:outline-none"
              style={{
                cursor: "none",
                width: fitted?.width ?? 0,
                height: fitted?.height ?? 0,
                left: fitted && room ? (room.width - fitted.width) / 2 : 0,
                top: fitted && room ? (room.height - fitted.height) / 2 : 0,
              }}
            />
            {cursor && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                style={{
                  left: cursor.x - cursor.diameter / 2,
                  top: cursor.y - cursor.diameter / 2,
                  width: cursor.diameter,
                  height: cursor.diameter,
                }}
              />
            )}
          </div>
          <div className="grid shrink-0 content-start gap-3 md:w-60">
            <fieldset className="grid gap-2" disabled={busy}>
              <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Brush</legend>
              {SETTINGS.map((control) => (
                <div key={control.key} className="grid grid-cols-[4rem_1fr_3.5rem] items-center gap-2">
                  <span className="text-xs text-muted-foreground">{control.label}</span>
                  <Slider
                    value={[settings[control.key]]}
                    min={control.min}
                    max={control.key === "size" ? 1000 : control.max}
                    step={1}
                    aria-label={control.label}
                    onValueChange={(next) => setValue(control.key, next[0] ?? settings[control.key], control.min, control.max)}
                  />
                  <input
                    type="number"
                    aria-label={`${control.label} value`}
                    min={control.min}
                    max={control.max}
                    value={settings[control.key]}
                    onChange={(event) => setValue(control.key, event.target.valueAsNumber, control.min, control.max)}
                    className="h-7 w-full rounded border border-input bg-background px-1 text-right text-xs tabular-nums"
                  />
                </div>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showMask} onChange={(event) => setShowMask(event.target.checked)} />
              Show frozen areas
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={!canUndo || busy} onClick={undo} title="Undo stroke (Ctrl+Z)">
                <Undo2 className="h-4 w-4" />
                Undo
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={restoreAll}>
                Restore All
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={thawAll}>
                Thaw All
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!session || busy} onClick={() => void apply()} className={cn(busy && "cursor-wait")}>
            {busy ? "Applying…" : "OK"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
