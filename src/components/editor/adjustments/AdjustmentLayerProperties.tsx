import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AdjustmentLayer } from "@/adjustments/adjustmentLayer";
import { ADJUSTMENT_TITLES, initialAdjustment, type AdjustmentData } from "@/adjustments/adjustmentData";
import { histogramBelow, setAdjustment } from "@/adjustments/adjustmentCommands";
import { ADJUSTMENT_ICONS } from "@/components/editor/layers/adjustmentIcons";
import { ADJUSTMENTS } from "./specs";

interface AdjustmentLayerPropertiesProps {
  canvas: FabricCanvas;
  layer: AdjustmentLayer;
  /** The colour wells, which a reset Gradient Map starts from. */
  colors: { foreground: string; background: string };
}

/** How long settings rest before they make one history step. */
const COMMIT_DELAY_MS = 250;

/**
 * The Properties panel of an adjustment layer: its settings, with the same
 * controls as Image › Adjustments, shown on the document as they change.
 */
export function AdjustmentLayerProperties({ canvas, layer, colors }: AdjustmentLayerPropertiesProps) {
  const [adjustment, setLocal] = useState<AdjustmentData>(layer.adjustment);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);

  // Another layer, or the same one after an undo.
  useEffect(() => setLocal(layer.adjustment), [layer]);

  const commit = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    pending.current = false;
    if (canvas.getObjects().includes(layer)) canvas.fire("object:modified", { target: layer });
  }, [canvas, layer]);

  // Leaving the panel (or the layer) keeps what was set.
  useEffect(() => commit, [commit]);

  const change = (next: AdjustmentData) => {
    setLocal(next);
    setAdjustment(canvas, layer, next);
    pending.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(commit, COMMIT_DELAY_MS);
  };

  // What shows below the layer, for Levels and Curves; taken once a layer.
  const histogram = useMemo(() => histogramBelow(canvas, layer), [canvas, layer]);

  const { kind } = adjustment;
  const Icon = ADJUSTMENT_ICONS[kind];
  const spec = kind === "invert" ? null : ADJUSTMENTS[kind];
  const Controls = spec?.Controls;

  return (
    <ScrollArea className="h-full">
      <section aria-label="Adjustment settings" className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{ADJUSTMENT_TITLES[kind]}</h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Reset the adjustment"
            title="Reset the adjustment"
            disabled={kind === "invert"}
            onClick={() => {
              change(initialAdjustment(kind, colors));
              commit();
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {spec ? spec.description : "Reverses every colour."}{" "}
          {layer.__clipped ? "Applies to the layer it is clipped to" : "Applies to the layers below"}, leaving their pixels as they are.
        </p>
        <p className="text-xs text-muted-foreground">
          Paint black on the document to hide it there, white to show it again.
        </p>
        {Controls && (
          <Controls
            settings={adjustment.settings}
            onChange={(settings) => change({ kind, settings } as AdjustmentData)}
            histogram={histogram}
          />
        )}
      </section>
    </ScrollArea>
  );
}
