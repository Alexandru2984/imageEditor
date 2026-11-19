import { useEffect, useMemo, useState, type PointerEvent } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { X } from "lucide-react";
import { histogramStats } from "@/raster/adjustments";
import { documentHistogram, type DocumentHistogram, type HistogramSource } from "@/raster/documentHistogram";
import { selectionOf } from "@/selection/state";
import { HistogramChart } from "./adjustments/HistogramChart";
import { CHANNEL_COLORS } from "./adjustments/controls";

type HistogramView = "rgb" | "red" | "green" | "blue" | "colors";

const VIEWS: { value: HistogramView; label: string }[] = [
  { value: "rgb", label: "Luminosity" },
  { value: "colors", label: "Colors" },
  { value: "red", label: "Red" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
];

/** Measured at most this often while the document keeps changing. */
const REFRESH_MS = 250;

const selectClass = "h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs";

/**
 * View › Histogram: the tones of the document (or of the selected layer, or
 * of the selection) as they change, like Photoshop's Histogram panel.
 */
export function HistogramPanel({ canvas, onClose }: { canvas: FabricCanvas | null; onClose: () => void }) {
  const [view, setView] = useState<HistogramView>("rgb");
  const [source, setSource] = useState<HistogramSource>("document");
  const [result, setResult] = useState<DocumentHistogram | null>(null);
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    if (!canvas) return;
    let timer: number | null = null;
    const measure = () => {
      timer = null;
      try {
        setResult(documentHistogram(canvas, source));
      } catch (error) {
        console.error("The histogram could not be measured:", error);
        setResult(null);
      }
    };
    const schedule = () => {
      timer ??= window.setTimeout(measure, REFRESH_MS);
    };
    // Every change ends in a render of the view; the histogram's own
    // offscreen renders draw elsewhere.
    const onRender = ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
      if (ctx === canvas.getContext()) schedule();
    };
    canvas.on("after:render", onRender);
    const unsubscribe = selectionOf(canvas).subscribe(schedule);
    measure();
    return () => {
      canvas.off("after:render", onRender);
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [canvas, source]);

  const histogram = result?.histogram ?? null;
  const bins = histogram ? histogram[view === "colors" ? "rgb" : view] : null;
  const stats = useMemo(() => (bins ? histogramStats(bins) : null), [bins]);
  const empty = !histogram || histogram.count === 0;

  const inspect = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setLevel(Math.min(255, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * 256))));
  };

  let percentile: string | null = null;
  let share: string | null = null;
  if (level !== null && bins && stats && stats.count > 0) {
    let below = 0;
    for (let index = 0; index <= level; index += 1) below += bins[index]!;
    percentile = `${((below / stats.count) * 100).toFixed(1)}%`;
    share = `${((bins[level]! / stats.count) * 100).toFixed(2)}%`;
  }

  const figure = (label: string, value: string | null) => (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value ?? "—"}</dd>
    </div>
  );

  // On wide screens it sits on the left, clear of the adjustment dialogs.
  return (
    <section
      aria-label="Histogram"
      className="absolute right-2 top-2 z-10 w-56 rounded-lg border border-border bg-popover/95 p-2.5 text-popover-foreground shadow-lg backdrop-blur sm:left-3 sm:right-auto sm:top-3 sm:w-64 sm:p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold">Histogram</h2>
        <button
          type="button"
          aria-label="Close histogram"
          onClick={onClose}
          className="-m-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-2 flex gap-1.5">
        <select
          aria-label="Channel"
          value={view}
          onChange={(event) => setView(event.target.value as HistogramView)}
          className={selectClass}
        >
          {VIEWS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Source"
          value={source}
          onChange={(event) => setSource(event.target.value as HistogramSource)}
          className={selectClass}
        >
          <option value="document">Image</option>
          <option value="layer">Layer</option>
        </select>
      </div>
      <div
        role="img"
        aria-label={
          empty
            ? "Empty histogram"
            : `${VIEWS.find((option) => option.value === view)!.label} histogram, mean ${stats!.mean.toFixed(0)}`
        }
        className="relative h-16 cursor-crosshair overflow-hidden rounded-md border border-border bg-muted/30 sm:h-20"
        onPointerMove={inspect}
        onPointerDown={inspect}
        onPointerLeave={() => setLevel(null)}
      >
        {histogram && !empty && view === "colors" ? (
          (["red", "green", "blue"] as const).map((channel) => (
            <HistogramChart
              key={channel}
              bins={histogram[channel]}
              color={CHANNEL_COLORS[channel]}
              className="absolute inset-0 h-full"
            />
          ))
        ) : bins && !empty ? (
          <HistogramChart
            bins={bins}
            color={view === "rgb" || view === "colors" ? "hsl(var(--foreground) / 0.6)" : CHANNEL_COLORS[view]}
            className="h-full"
          />
        ) : (
          <p className="flex h-full items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
            {source === "layer" && !histogram ? "Select a layer to measure it" : "No pixels to measure"}
          </p>
        )}
        {level !== null && !empty && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-primary"
            style={{ left: `${((level + 0.5) / 256) * 100}%` }}
          />
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        {figure("Mean", stats && !empty ? stats.mean.toFixed(2) : null)}
        {figure("Level", level !== null && !empty ? String(level) : null)}
        {figure("Std Dev", stats && !empty ? stats.stdDev.toFixed(2) : null)}
        {figure("Share", share)}
        {figure("Median", stats && !empty ? String(stats.median) : null)}
        {figure("Percentile", percentile)}
      </dl>
      {result?.selection && <p className="mt-1.5 text-[11px] text-muted-foreground">Selected pixels only</p>}
    </section>
  );
}
