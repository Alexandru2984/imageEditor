import { useCallback, useEffect, useRef, useState } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { Blend, PaintBucket } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { setFill } from "@/adjustments/adjustmentCommands";
import {
  FILL_TITLES,
  fillSwatch,
  MAX_GRADIENT_SCALE,
  MIN_GRADIENT_SCALE,
  type FillContent,
  type FillLayer,
  type GradientStyle,
} from "@/adjustments/fillLayer";
import { Check, OptionRow, ValueSlider } from "./controls";

interface FillLayerPropertiesProps {
  canvas: FabricCanvas;
  layer: FillLayer;
}

/** How long settings rest before they make one history step. */
const COMMIT_DELAY_MS = 250;

const STYLES: readonly { value: GradientStyle; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
  { value: "reflected", label: "Reflected" },
];

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      {label}
    </label>
  );
}

/**
 * The Properties panel of a fill layer: its colour, or its gradient's
 * colours and layout, shown on the document as they change.
 */
export function FillLayerProperties({ canvas, layer }: FillLayerPropertiesProps) {
  const [content, setLocal] = useState<FillContent>(layer.fillContent);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);

  // Another layer, or the same one after an undo.
  useEffect(() => setLocal(layer.fillContent), [layer]);

  const commit = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    pending.current = false;
    if (canvas.getObjects().includes(layer)) canvas.fire("object:modified", { target: layer });
  }, [canvas, layer]);

  // Leaving the panel (or the layer) keeps what was set.
  useEffect(() => commit, [commit]);

  const change = (next: FillContent) => {
    setLocal(next);
    setFill(canvas, layer, next);
    pending.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(commit, COMMIT_DELAY_MS);
  };

  const Icon = content.kind === "solid" ? PaintBucket : Blend;

  return (
    <ScrollArea className="h-full">
      <section aria-label="Fill settings" className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{FILL_TITLES[content.kind]}</h3>
        </div>
        <div aria-hidden="true" className="h-8 rounded-md border border-border" style={{ background: fillSwatch(content) }} />
        {content.kind === "solid" ? (
          <ColorField label="Fill colour" value={content.color} onChange={(color) => change({ ...content, color })} />
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <ColorField label="Start colour" value={content.from} onChange={(from) => change({ ...content, from })} />
              <ColorField label="End colour" value={content.to} onChange={(to) => change({ ...content, to })} />
            </div>
            <OptionRow label="Gradient style" value={content.style} options={STYLES} onChange={(style) => change({ ...content, style })} />
            <ValueSlider
              label="Angle"
              value={content.angle}
              min={-180}
              max={180}
              format={(value) => `${Math.round(value)}°`}
              onChange={(angle) => change({ ...content, angle })}
            />
            <ValueSlider
              label="Scale"
              value={content.scale}
              min={MIN_GRADIENT_SCALE}
              max={MAX_GRADIENT_SCALE}
              format={(value) => `${Math.round(value)}%`}
              onChange={(scale) => change({ ...content, scale })}
            />
            <Check label="Reverse" checked={content.reverse} onChange={(reverse) => change({ ...content, reverse })} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Covers the document{layer.__clipped ? " where the layer it is clipped to has pixels" : ""}. Paint black on the
          document to hide it there, white to show it again.
        </p>
      </section>
    </ScrollArea>
  );
}
