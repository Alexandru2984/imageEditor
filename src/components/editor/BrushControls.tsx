import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DYNAMICS,
  DYNAMICS_LIMITS,
  PRESET_NAME_MAX,
  seededRandom,
  type BrushDynamics,
  type BrushTip,
} from "@/raster/brushEngine";
import { isPresetApplied, presetChange, useBrushPresets } from "@/hooks/useBrushPresets";
import { StrokePainter } from "@/raster/painter";
import {
  PAINT_SLIDER_STEPS,
  paintSizeToSlider,
  sliderToPaintSize,
  type PaintOptions,
} from "@/raster/paintSettings";
import { addBrushPreset, brushTip, deleteBrushPreset } from "@/utils/brushPresets";

/** Draw a tip (round with its hardness, or from pixels) into a square canvas, in `color`. */
function drawTip(
  canvas: HTMLCanvasElement,
  { hardness, dynamics, tip }: { hardness: number; dynamics: BrushDynamics; tip: BrushTip | null },
  color: string
) {
  const side = canvas.width;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, side, side);
  const painter = new StrokePainter(canvas, {
    diameter: side * 0.8,
    hardness: hardness / 100,
    opacity: 1,
    flow: 1,
    color,
    erase: false,
    // One plain stamp: the tip's shape and angle, without jitter.
    dynamics: { ...DEFAULT_DYNAMICS, angle: dynamics.angle, roundness: dynamics.roundness, pressureSize: false },
    tip,
  });
  painter.add({ x: side / 2, y: side / 2, pressure: 1 });
  painter.finish();
}

/** The colour text is drawn in, for drawing brushes that read in both themes. */
const inkOf = (element: Element) => {
  const value = getComputedStyle(element).color;
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (!match) return "#333333";
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
};

/** A small picture of a brush's tip. */
export function TipThumbnail({
  hardness,
  dynamics,
  tipId,
  size = 28,
  className,
}: {
  hardness: number;
  dynamics: BrushDynamics;
  tipId: string | null;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    drawTip(canvas, { hardness, dynamics, tip: brushTip(tipId) }, inkOf(canvas));
  }, [hardness, dynamics, tipId, size]);
  return <canvas ref={ref} aria-hidden="true" className={cn("shrink-0 text-foreground", className)} style={{ width: size, height: size }} />;
}

/** A stroke painted with the brush as it is set, like Photoshop's preview. */
function StrokePreview({ paint }: { paint: PaintOptions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * ratio) || 240;
    const height = Math.round(64 * ratio);
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.clearRect(0, 0, width, height);
    // Sized to fit, whatever the brush's size.
    const diameter = Math.min(height * 0.45, Math.max(4, paint.size * ratio));
    const painter = new StrokePainter(canvas, {
      diameter,
      hardness: paint.hardness / 100,
      opacity: paint.opacity / 100,
      flow: paint.flow / 100,
      color: inkOf(canvas),
      erase: false,
      dynamics: paint.dynamics,
      tip: brushTip(paint.tipId),
      // The same picture each time for the same settings.
      random: seededRandom(1),
    });
    const margin = diameter;
    const steps = 80;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      // A gentle S, with the pen pressing harder in the middle.
      painter.add({
        x: margin + (width - margin * 2) * t,
        y: height / 2 + Math.sin(t * Math.PI * 2) * (height / 2 - margin / 1.5) * 0.6,
        pressure: 0.25 + 0.75 * Math.sin(t * Math.PI),
      });
    }
    painter.finish();
  }, [paint]);
  return (
    <canvas
      ref={ref}
      data-testid="brush-preview"
      aria-label="Brush stroke preview"
      role="img"
      className="h-16 w-full rounded-md border border-border bg-background text-foreground"
    />
  );
}

/** The options bar's brush picker: presets, and saving the brush as one. */
export function BrushPresetPicker({
  paint,
  onPaintChange,
  compact,
}: {
  paint: PaintOptions;
  onPaintChange: (change: Partial<PaintOptions>) => void;
  compact: boolean;
}) {
  const presets = useBrushPresets();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const save = () => {
    const result = addBrushPreset({
      name: name.trim() || `Brush ${presets.length + 1}`,
      size: paint.size,
      hardness: paint.hardness,
      flow: paint.flow,
      dynamics: paint.dynamics,
      tipId: paint.tipId,
    });
    if (typeof result === "string") {
      toast.error(result);
      return;
    }
    setName("");
    if (result.kept) toast.success(`Saved the brush preset “${result.preset.name}”`);
    else toast.message(`Saved “${result.preset.name}” for now; this browser would not keep it`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Brush presets"
          title="Brush presets"
          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-1.5 text-xs hover:bg-accent"
        >
          <TipThumbnail hardness={paint.hardness} dynamics={paint.dynamics} tipId={paint.tipId} size={compact ? 20 : 22} />
          <span className="tabular-nums text-muted-foreground">{paint.size}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1rem)] p-2">
        <div role="listbox" aria-label="Brush presets" className="grid max-h-72 grid-cols-1 gap-0.5 overflow-y-auto">
          {presets.map((preset) => {
            const applied = isPresetApplied(paint, preset);
            return (
              <div key={preset.id} className="flex items-center gap-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={applied}
                  onClick={() => {
                    onPaintChange(presetChange(preset));
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent",
                    applied && "bg-primary/10"
                  )}
                >
                  <TipThumbnail hardness={preset.hardness} dynamics={preset.dynamics} tipId={preset.tipId} />
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{preset.size}</span>
                </button>
                {preset.id.startsWith("user:") && (
                  <button
                    type="button"
                    aria-label={`Delete the brush preset ${preset.name}`}
                    title="Delete"
                    onClick={() => deleteBrushPreset(preset.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <form
          className="mt-2 flex gap-1 border-t border-border pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            value={name}
            maxLength={PRESET_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            aria-label="New preset name"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          />
          <button type="submit" className="h-8 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            Save brush
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      <span className="text-right text-xs tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[hsl(var(--primary))]"
      />
      {label}
    </label>
  );
}

/**
 * Brush Settings, as in Photoshop: the tip's shape, how it varies from stamp
 * to stamp, scattering and transfer, with a stroke drawn as it would paint.
 * A panel over the canvas, so the brush can be tried as it is set.
 */
export function BrushSettingsPanel({
  paint,
  onPaintChange,
  onClose,
}: {
  paint: PaintOptions;
  onPaintChange: (change: Partial<PaintOptions>) => void;
  onClose: () => void;
}) {
  const { dynamics } = paint;
  const sampled = paint.tipId !== null;
  const set = (change: Partial<BrushDynamics>) => onPaintChange({ dynamics: { ...dynamics, ...change } });
  const number = (key: keyof typeof DYNAMICS_LIMITS, label: string, unit: string) => (
    <Row label={label} value={`${dynamics[key]}${unit}`}>
      <Slider
        value={[dynamics[key]]}
        aria-label={label}
        min={DYNAMICS_LIMITS[key][0]}
        max={DYNAMICS_LIMITS[key][1]}
        step={1}
        onValueChange={(value) => set({ [key]: value[0] ?? dynamics[key] })}
      />
    </Row>
  );
  const heading = (text: string) => <h3 className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{text}</h3>;

  return (
    <section
      aria-label="Brush settings"
      className="absolute inset-x-2 top-2 z-20 flex max-h-[55%] flex-col rounded-lg border border-border bg-popover/95 p-2.5 text-popover-foreground shadow-lg backdrop-blur sm:inset-x-auto sm:bottom-3 sm:left-3 sm:top-auto sm:max-h-[calc(100%-1.5rem)] sm:w-80"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold">Brush settings</h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Reset the brush settings"
            title="Round tip, no jitter"
            onClick={() => onPaintChange({ dynamics: { ...DEFAULT_DYNAMICS }, tipId: null })}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close brush settings"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid min-h-0 gap-1.5 overflow-y-auto pr-1">
        {heading("Brush tip shape")}
        <div className="flex items-center gap-2">
          <TipThumbnail hardness={paint.hardness} dynamics={dynamics} tipId={paint.tipId} size={40} className="rounded border border-border" />
          <span className="text-xs text-muted-foreground">{sampled ? "From pixels" : "Round"}</span>
        </div>
        <Row label="Size" value={`${paint.size}px`}>
          <Slider
            value={[paintSizeToSlider(paint.size)]}
            aria-label="Tip size"
            aria-valuetext={`${paint.size} pixels`}
            min={0}
            max={PAINT_SLIDER_STEPS}
            step={1}
            onValueChange={(value) => onPaintChange({ size: sliderToPaintSize(value[0] ?? paintSizeToSlider(paint.size)) })}
          />
        </Row>
        {!sampled && (
          <Row label="Hardness" value={`${paint.hardness}%`}>
            <Slider
              value={[paint.hardness]}
              aria-label="Tip hardness"
              min={0}
              max={100}
              step={1}
              onValueChange={(value) => onPaintChange({ hardness: value[0] ?? paint.hardness })}
            />
          </Row>
        )}
        {number("angle", "Angle", "°")}
        {number("roundness", "Roundness", "%")}
        {number("spacing", "Spacing", "%")}

        {heading("Shape dynamics")}
        {number("sizeJitter", "Size jitter", "%")}
        {number("minimumDiameter", "Minimum diameter", "%")}
        {number("angleJitter", "Angle jitter", "%")}
        <Check label="Pen pressure sets the size" checked={dynamics.pressureSize} onChange={(pressureSize) => set({ pressureSize })} />

        {heading("Scattering")}
        {number("scatter", "Scatter", "%")}
        <Check label="Both axes" checked={dynamics.bothAxes} onChange={(bothAxes) => set({ bothAxes })} />
        {number("count", "Count", "")}

        {heading("Transfer")}
        {number("opacityJitter", "Opacity jitter", "%")}
        {number("flowJitter", "Flow jitter", "%")}
        <Check label="Pen pressure sets the opacity" checked={dynamics.pressureOpacity} onChange={(pressureOpacity) => set({ pressureOpacity })} />
      </div>
      <div className="mt-2">
        <StrokePreview paint={paint} />
      </div>
    </section>
  );
}
