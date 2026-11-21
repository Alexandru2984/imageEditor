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
  type EffectName,
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
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
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
        aria-label={label}
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
 * Layer › Layer style: drop shadow, outer glow, colour overlay and stroke,
 * shown on the layer while they are set and recorded as one step on OK.
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
    setEffects({
      dropShadow: { ...DEFAULT_EFFECTS.dropShadow, ...current?.dropShadow },
      outerGlow: { ...DEFAULT_EFFECTS.outerGlow, ...current?.outerGlow },
      colorOverlay: { ...DEFAULT_EFFECTS.colorOverlay, ...current?.colorOverlay },
      stroke: { ...DEFAULT_EFFECTS.stroke, ...current?.stroke },
    });
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

  const colour = (name: EffectName, label: string) => (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">Colour</span>
      <input
        type="color"
        aria-label={`${label} colour`}
        value={effects[name].color}
        onChange={(event) => update(name, { color: event.target.value })}
        className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
    </div>
  );

  const settings: Record<EffectName, ReactNode> = {
    dropShadow: (
      <>
        {colour("dropShadow", "Drop shadow")}
        <NumberSetting
          label="Opacity"
          unit="%"
          value={effects.dropShadow.opacity}
          min={0}
          max={100}
          onChange={(opacity) => update("dropShadow", { opacity })}
        />
        <NumberSetting
          label="Angle"
          unit="°"
          value={effects.dropShadow.angle}
          min={-180}
          max={180}
          onChange={(angle) => update("dropShadow", { angle })}
        />
        <NumberSetting
          label="Distance"
          unit="px"
          value={effects.dropShadow.distance}
          min={0}
          max={200}
          onChange={(distance) => update("dropShadow", { distance })}
        />
        <NumberSetting
          label="Size"
          unit="px"
          value={effects.dropShadow.size}
          min={0}
          max={EFFECT_LIMITS.size[1]}
          onChange={(size) => update("dropShadow", { size })}
        />
      </>
    ),
    outerGlow: (
      <>
        {colour("outerGlow", "Outer glow")}
        <NumberSetting
          label="Opacity"
          unit="%"
          value={effects.outerGlow.opacity}
          min={0}
          max={100}
          onChange={(opacity) => update("outerGlow", { opacity })}
        />
        <NumberSetting
          label="Size"
          unit="px"
          value={effects.outerGlow.size}
          min={0}
          max={EFFECT_LIMITS.size[1]}
          onChange={(size) => update("outerGlow", { size })}
        />
      </>
    ),
    colorOverlay: (
      <>
        {colour("colorOverlay", "Colour overlay")}
        <NumberSetting
          label="Opacity"
          unit="%"
          value={effects.colorOverlay.opacity}
          min={0}
          max={100}
          onChange={(opacity) => update("colorOverlay", { opacity })}
        />
      </>
    ),
    stroke: (
      <>
        {colour("stroke", "Stroke")}
        <NumberSetting
          label="Size"
          unit="px"
          value={effects.stroke.size}
          min={1}
          max={EFFECT_LIMITS.size[1]}
          onChange={(size) => update("stroke", { size })}
        />
        <NumberSetting
          label="Opacity"
          unit="%"
          value={effects.stroke.opacity}
          min={0}
          max={100}
          onChange={(opacity) => update("stroke", { opacity })}
        />
        <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
          <span className="text-xs text-muted-foreground">Position</span>
          <div role="radiogroup" aria-label="Stroke position" className="flex gap-1">
            {POSITIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={effects.stroke.position === option.value}
                onClick={() => update("stroke", { position: option.value })}
                className={cn(
                  "h-7 rounded-md border px-2.5 text-xs transition-colors",
                  effects.stroke.position === option.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
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
