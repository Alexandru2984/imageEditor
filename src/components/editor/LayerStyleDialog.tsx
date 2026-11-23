import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
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
  DEFAULT_EFFECTS,
  EFFECTS,
  EFFECT_LIMITS,
  hasEffects,
  type BevelKind,
  type EffectName,
  type GlowSource,
  type GradientShape,
  type LayerStyle,
  type StrokePosition,
} from "@/raster/layerStyleData";

type Styled = FabricObject & { layerStyle?: LayerStyle };
type Effects = Required<LayerStyle>;

const POSITIONS: { value: StrokePosition; label: string }[] = [
  { value: "outside", label: "Outside" },
  { value: "center", label: "Centre" },
  { value: "inside", label: "Inside" },
];
const BEVEL_KINDS: { value: BevelKind; label: string }[] = [
  { value: "innerBevel", label: "Inner bevel" },
  { value: "outerBevel", label: "Outer bevel" },
  { value: "emboss", label: "Emboss" },
  { value: "pillowEmboss", label: "Pillow emboss" },
];
const DIRECTIONS: { value: "up" | "down"; label: string }[] = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];
const SOURCES: { value: GlowSource; label: string }[] = [
  { value: "edge", label: "Edge" },
  { value: "center", label: "Centre" },
];
const GRADIENTS: { value: GradientShape; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
  { value: "reflected", label: "Reflected" },
];

/** One of a few words, as a row of radio buttons. */
function Choices<T extends string>({
  label,
  title,
  value,
  options,
  onChange,
}: {
  label: string;
  title: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-md border px-2 text-xs transition-colors",
              value === option.value
                ? "border-primary bg-primary/10 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The effects as the layer keeps them: only those that are on. */
function compact(effects: Effects): LayerStyle | undefined {
  const style: LayerStyle = {};
  for (const { name } of EFFECTS) {
    const effect = effects[name];
    if (effect.enabled) (style as Record<EffectName, unknown>)[name] = { ...effect };
  }
  return hasEffects(style) ? style : undefined;
}

const sameStyle = (a: LayerStyle | undefined, b: LayerStyle | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

interface LayerStyleDialogProps {
  canvas: FabricCanvas | null;
  /** The layer being styled, or null when the dialog is closed. */
  layer: FabricObject | null;
  onClose: () => void;
}

function NumberSetting({
  label,
  aria = label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  /** What it is called to a screen reader, when the label alone is not enough. */
  aria?: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        aria-label={aria}
        onValueChange={(next) => onChange(next[0] ?? value)}
      />
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {Math.round(value)}
        {unit}
      </span>
    </div>
  );
}

/**
 * Layer › Layer style: Photoshop's effects (bevel and emboss, stroke, inner
 * shadow and glow, satin, colour and gradient overlays, outer glow, drop
 * shadow), shown on the layer while they are set and recorded as one step
 * on OK.
 */
export function LayerStyleDialog({ canvas, layer, onClose }: LayerStyleDialogProps) {
  const idPrefix = useId();
  const [effects, setEffects] = useState<Effects>(DEFAULT_EFFECTS);
  const original = useRef<LayerStyle | undefined>(undefined);

  // Each opening starts from the layer's own style.
  useEffect(() => {
    if (!layer) return;
    const current = (layer as Styled).layerStyle;
    original.current = current;
    const next = { ...DEFAULT_EFFECTS };
    for (const { name } of EFFECTS) {
      (next as Record<EffectName, unknown>)[name] = { ...DEFAULT_EFFECTS[name], ...current?.[name] };
    }
    setEffects(next);
  }, [layer]);

  const preview = (next: Effects) => {
    setEffects(next);
    if (!layer || !canvas) return;
    (layer as Styled).layerStyle = compact(next);
    layer.dirty = true;
    canvas.requestRenderAll();
  };

  const update = <Name extends EffectName>(name: Name, change: Partial<Effects[Name]>) =>
    preview({ ...effects, [name]: { ...effects[name], ...change } });

  const close = (keep: boolean) => {
    if (layer && canvas) {
      const styled = layer as Styled;
      if (!keep) {
        styled.layerStyle = original.current;
        layer.dirty = true;
        canvas.requestRenderAll();
      } else {
        styled.layerStyle = compact(effects);
        layer.dirty = true;
        canvas.requestRenderAll();
        if (!sameStyle(styled.layerStyle, original.current)) canvas.fire("object:modified", { target: layer });
      }
    }
    onClose();
  };

  const colour = (name: EffectName, label: string, key: "color" | "endColor" | "shadowColor" = "color", title = "Colour") => (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      <input
        type="color"
        aria-label={`${label} ${title.toLowerCase()}`}
        value={(effects[name] as unknown as Record<string, string>)[key]}
        onChange={(event) => update(name, { [key]: event.target.value } as Partial<Effects[typeof name]>)}
        className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
    </div>
  );

  /** A slider for one of an effect's numbers. */
  const number = <Name extends EffectName>(
    name: Name,
    key: keyof Effects[Name] & string,
    label: string,
    unit: string,
    min: number,
    max: number,
    aria = label
  ) => (
    <NumberSetting
      label={label}
      aria={aria}
      unit={unit}
      value={effects[name][key] as number}
      min={min}
      max={max}
      onChange={(value) => update(name, { [key]: value } as unknown as Partial<Effects[Name]>)}
    />
  );
  const opacity = (name: EffectName) => number(name, "opacity", "Opacity", "%", 0, 100);
  const angle = (name: "dropShadow" | "innerShadow" | "satin" | "gradientOverlay" | "bevel") =>
    number(name, "angle", "Angle", "°", -180, 180);
  const size = (name: EffectName, min = 0) => number(name, "size" as never, "Size", "px", min, EFFECT_LIMITS.size[1]);

  const settings: Record<EffectName, ReactNode> = {
    bevel: (
      <>
        <Choices
          label="Bevel style"
          title="Style"
          value={effects.bevel.kind}
          options={BEVEL_KINDS}
          onChange={(kind) => update("bevel", { kind })}
        />
        {number("bevel", "depth", "Depth", "%", 1, 1000)}
        <Choices
          label="Bevel direction"
          title="Direction"
          value={effects.bevel.direction}
          options={DIRECTIONS}
          onChange={(direction) => update("bevel", { direction })}
        />
        {size("bevel")}
        {number("bevel", "soften", "Soften", "px", 0, EFFECT_LIMITS.soften[1])}
        {angle("bevel")}
        {number("bevel", "altitude", "Altitude", "°", 0, 90)}
        {colour("bevel", "Bevel", "color", "Highlight")}
        {number("bevel", "opacity", "Opacity", "%", 0, 100, "Highlight opacity")}
        {colour("bevel", "Bevel", "shadowColor", "Shadow")}
        {number("bevel", "shadowOpacity", "Opacity", "%", 0, 100, "Shadow opacity")}
      </>
    ),
    stroke: (
      <>
        {colour("stroke", "Stroke")}
        {size("stroke", 1)}
        {opacity("stroke")}
        <Choices
          label="Stroke position"
          title="Position"
          value={effects.stroke.position}
          options={POSITIONS}
          onChange={(position) => update("stroke", { position })}
        />
      </>
    ),
    innerShadow: (
      <>
        {colour("innerShadow", "Inner shadow")}
        {opacity("innerShadow")}
        {angle("innerShadow")}
        {number("innerShadow", "distance", "Distance", "px", 0, 200)}
        {size("innerShadow")}
      </>
    ),
    innerGlow: (
      <>
        {colour("innerGlow", "Inner glow")}
        {opacity("innerGlow")}
        {size("innerGlow")}
        <Choices
          label="Inner glow source"
          title="Source"
          value={effects.innerGlow.source}
          options={SOURCES}
          onChange={(source) => update("innerGlow", { source })}
        />
      </>
    ),
    satin: (
      <>
        {colour("satin", "Satin")}
        {opacity("satin")}
        {angle("satin")}
        {number("satin", "distance", "Distance", "px", 0, 250)}
        {size("satin")}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={effects.satin.invert}
            onChange={(event) => update("satin", { invert: event.target.checked })}
            className="h-4 w-4 accent-[hsl(var(--primary))]"
          />
          Invert
        </label>
      </>
    ),
    colorOverlay: (
      <>
        {colour("colorOverlay", "Colour overlay")}
        {opacity("colorOverlay")}
      </>
    ),
    gradientOverlay: (
      <>
        {colour("gradientOverlay", "Gradient", "color", "Start")}
        {colour("gradientOverlay", "Gradient", "endColor", "End")}
        {opacity("gradientOverlay")}
        <Choices
          label="Gradient style"
          title="Style"
          value={effects.gradientOverlay.gradient}
          options={GRADIENTS}
          onChange={(gradient) => update("gradientOverlay", { gradient })}
        />
        {angle("gradientOverlay")}
      </>
    ),
    outerGlow: (
      <>
        {colour("outerGlow", "Outer glow")}
        {opacity("outerGlow")}
        {size("outerGlow")}
      </>
    ),
    dropShadow: (
      <>
        {colour("dropShadow", "Drop shadow")}
        {opacity("dropShadow")}
        {angle("dropShadow")}
        {number("dropShadow", "distance", "Distance", "px", 0, 200)}
        {size("dropShadow")}
      </>
    ),
  };

  return (
    <Dialog open={layer !== null} onOpenChange={(open) => !open && close(false)}>
      <DialogContent
        // The layer stays in view, so the effects can be judged as they change.
        overlayClassName="bg-transparent backdrop-blur-none"
        className="max-h-[60dvh] max-w-md overflow-y-auto sm:left-auto sm:right-4 sm:max-h-[calc(100dvh-2rem)] sm:translate-x-0 sm:max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>Layer style</DialogTitle>
          <DialogDescription>Effects that follow the layer's shape. Sizes are in image pixels.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {EFFECTS.map(({ name, label }) => {
            const id = `${idPrefix}-${name}`;
            const enabled = effects[name].enabled;
            return (
              <section key={name} className="rounded-lg border border-border px-3 py-2">
                <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    id={id}
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => update(name, { enabled: event.target.checked })}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  {label}
                </label>
                {enabled && <div className="mt-2 grid gap-2">{settings[name]}</div>}
              </section>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => close(true)}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
