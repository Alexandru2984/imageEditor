import { useCallback, useEffect, useRef, useState } from "react";
import { FabricImage } from "fabric";
import type { Canvas as FabricCanvas } from "fabric";
import { Eye, RotateCcw, SlidersHorizontal, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { findBackgroundImage } from "@/utils/viewport";
import { HISTORY_RESTORED, offCanvasEvent, onCanvasEvent } from "@/utils/canvasEvents";
import { isReadOnlySelection } from "@/utils/editorObjects";
import {
  DEFAULT_FILTERS,
  FILTER_PRESETS,
  FILTER_RANGES,
  analyzePixels,
  applyFilterValues,
  autoEnhanceValues,
  buildFilters,
  hasAdjustments,
  presetValues,
  readFilterValues,
  sameFilterValues,
  type FilterValues,
  type NumericFilterKey,
} from "@/utils/imageFilters";

const SLIDER_GROUPS: { title: string; sliders: { key: NumericFilterKey; label: string }[] }[] = [
  {
    title: "Light",
    sliders: [
      { key: "brightness", label: "Brightness" },
      { key: "contrast", label: "Contrast" },
    ],
  },
  {
    title: "Colour",
    sliders: [
      { key: "saturation", label: "Saturation" },
      { key: "vibrance", label: "Vibrance" },
      { key: "warmth", label: "Warmth" },
      { key: "hue", label: "Hue" },
    ],
  },
  {
    title: "Detail",
    sliders: [
      { key: "sharpen", label: "Sharpen" },
      { key: "blur", label: "Blur" },
      { key: "noise", label: "Grain" },
      { key: "pixelate", label: "Pixelate" },
    ],
  },
];

const THUMB_SIZE = 96;

/** The unfiltered source Fabric keeps for re-applying filters. */
const originalElement = (image: FabricImage): CanvasImageSource & object =>
  (image._originalElement ?? image.getElement()) as CanvasImageSource & object;

/** Small square, centre-cropped copy of an image source for previews. */
function thumbnailSource(image: FabricImage, size: number): HTMLCanvasElement | null {
  const source = originalElement(image) as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    width: number;
    height: number;
  };
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  if (!width || !height) return null;
  const side = Math.min(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
  return canvas;
}

const thumbnailCache = new WeakMap<object, Map<string, string>>();

/** Render every preset over a thumbnail of `image`, a few per frame. */
function usePresetThumbnails(image: FabricImage | null, enabled: boolean) {
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!image || !enabled) {
      setThumbs(new Map());
      return;
    }
    const key = originalElement(image);
    const cached = thumbnailCache.get(key);
    if (cached && cached.size === FILTER_PRESETS.length) {
      setThumbs(new Map(cached));
      return;
    }
    const base = thumbnailSource(image, THUMB_SIZE);
    if (!base) return;
    const results = cached ?? new Map<string, string>();
    thumbnailCache.set(key, results);
    setThumbs(new Map(results));
    let cancelled = false;
    let index = 0;
    const step = () => {
      if (cancelled) return;
      const preset = FILTER_PRESETS[index];
      if (!preset) return;
      index += 1;
      if (!results.has(preset.id)) {
        try {
          const preview = new FabricImage(base);
          preview.filters = buildFilters(presetValues(preset));
          preview.applyFilters();
          const element = preview.getElement() as HTMLCanvasElement | HTMLImageElement;
          const out = document.createElement("canvas");
          out.width = THUMB_SIZE;
          out.height = THUMB_SIZE;
          out.getContext("2d")?.drawImage(element, 0, 0, THUMB_SIZE, THUMB_SIZE);
          results.set(preset.id, out.toDataURL("image/jpeg", 0.82));
          preview.dispose();
        } catch (error) {
          console.warn("Preset preview failed:", error);
        }
        setThumbs(new Map(results));
      }
      window.setTimeout(step, 0);
    };
    const timer = window.setTimeout(step, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [image, enabled]);

  return thumbs;
}

export const AdjustPanel = ({ fabricCanvas }: { fabricCanvas: FabricCanvas | null }) => {
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTERS);
  const [target, setTarget] = useState<FabricImage | null>(null);
  const [targetIsSelection, setTargetIsSelection] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [comparing, setComparing] = useState(false);
  const filtersRef = useRef<FilterValues>(DEFAULT_FILTERS);
  const pendingRef = useRef<{ target: FabricImage; values: FilterValues } | null>(null);
  const timerRef = useRef<number | null>(null);
  const compareRef = useRef<{ target: FabricImage; filters: FabricImage["filters"] } | null>(null);
  const targetRef = useRef<FabricImage | null>(null);

  // Adjustments target the selected image layer if one is selected, else the
  // background photo.
  const getTarget = useCallback((): FabricImage | undefined => {
    if (!fabricCanvas) return undefined;
    const active = fabricCanvas.getActiveObject();
    if (active instanceof FabricImage) return active;
    return findBackgroundImage(fabricCanvas);
  }, [fabricCanvas]);

  // The background stays adjustable even though it is protected from
  // transforms. A selected, explicitly locked image layer does not.
  const isReadOnly = useCallback(
    (image: FabricImage | undefined): boolean =>
      !!image && image === fabricCanvas?.getActiveObject() && isReadOnlySelection(image),
    [fabricCanvas]
  );

  const applyToTarget = useCallback(
    (image: FabricImage, values: FilterValues): boolean => {
      if (!fabricCanvas || !fabricCanvas.getObjects().includes(image) || isReadOnly(image)) {
        return false;
      }
      const previous = [...(image.filters ?? [])];
      try {
        applyFilterValues(image, values);
        fabricCanvas.requestRenderAll();
        return true;
      } catch (error) {
        console.error("Image filter rendering failed:", error);
        image.filters = previous;
        try {
          image.applyFilters();
          fabricCanvas.requestRenderAll();
        } catch (rollbackError) {
          console.error("Image filter rollback failed:", rollbackError);
        }
        const restored = readFilterValues(previous as never);
        filtersRef.current = restored;
        setFilters(restored);
        toast.error("This image is too large for that filter in this browser");
        return false;
      }
    },
    [fabricCanvas, isReadOnly]
  );

  const cancelScheduled = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const flushScheduled = useCallback((): FabricImage | null => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    return pending && applyToTarget(pending.target, pending.values) ? pending.target : null;
  }, [applyToTarget]);

  // Slider work is coalesced; applying pixels and recording the history entry
  // happen together so pointer and keyboard event ordering cannot lose edits.
  const schedule = useCallback(
    (image: FabricImage, values: FilterValues) => {
      pendingRef.current = { target: image, values };
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending && applyToTarget(pending.target, pending.values) && fabricCanvas) {
          fabricCanvas.fire("object:modified", { target: pending.target });
        }
      }, 75);
    },
    [applyToTarget, fabricCanvas]
  );

  const commit = useCallback(() => {
    if (!fabricCanvas) return;
    const image = flushScheduled();
    if (image) fabricCanvas.fire("object:modified", { target: image });
  }, [fabricCanvas, flushScheduled]);

  const endCompare = useCallback(() => {
    const saved = compareRef.current;
    compareRef.current = null;
    setComparing(false);
    if (!saved || !fabricCanvas) return;
    saved.target.filters = saved.filters;
    try {
      saved.target.applyFilters();
    } catch (error) {
      console.error("Restoring filters after compare failed:", error);
    }
    fabricCanvas.requestRenderAll();
  }, [fabricCanvas]);

  // Read the current target's values into the sliders. Runs on selection
  // change and after undo/redo, so the sliders always reflect the canvas.
  const sync = useCallback(() => {
    endCompare();
    cancelScheduled();
    const image = getTarget() ?? null;
    targetRef.current = image;
    setTarget(image);
    setTargetIsSelection(!!image && image === fabricCanvas?.getActiveObject());
    setReadOnly(isReadOnly(image ?? undefined));
    const next = readFilterValues(image?.filters as never);
    filtersRef.current = next;
    setFilters(next);
  }, [cancelScheduled, endCompare, fabricCanvas, getTarget, isReadOnly]);

  useEffect(() => {
    if (!fabricCanvas) return;
    sync();
    const selectionEvents = ["selection:created", "selection:updated", "selection:cleared"] as const;
    // Adding or removing objects only matters when it changes the target,
    // e.g. background removal swapping the photo.
    const handleStructure = () => {
      if ((getTarget() ?? null) !== targetRef.current) sync();
    };
    for (const name of selectionEvents) fabricCanvas.on(name, sync);
    fabricCanvas.on("object:added", handleStructure);
    fabricCanvas.on("object:removed", handleStructure);
    onCanvasEvent(fabricCanvas, HISTORY_RESTORED, sync);
    return () => {
      for (const name of selectionEvents) fabricCanvas.off(name, sync);
      fabricCanvas.off("object:added", handleStructure);
      fabricCanvas.off("object:removed", handleStructure);
      offCanvasEvent(fabricCanvas, HISTORY_RESTORED, sync);
      // Never leave the canvas showing the "before" state.
      endCompare();
      flushScheduled();
    };
  }, [fabricCanvas, sync, endCompare, flushScheduled, getTarget]);

  const setValue = (key: NumericFilterKey) => (value: number[]) => {
    const next = value[0];
    if (next === undefined) return;
    const image = getTarget();
    if (!image || isReadOnly(image)) return;
    const values = { ...filtersRef.current, [key]: next };
    filtersRef.current = values;
    setFilters(values);
    schedule(image, values);
  };

  /** Replace every adjustment at once (presets, auto, reset) as one undo step. */
  const replaceAll = (values: FilterValues, message?: string) => {
    if (!fabricCanvas) return;
    const image = getTarget();
    if (!image || isReadOnly(image)) return;
    endCompare();
    cancelScheduled();
    if (sameFilterValues(values, filtersRef.current)) return;
    filtersRef.current = values;
    setFilters(values);
    if (applyToTarget(image, values)) {
      fabricCanvas.fire("object:modified", { target: image });
      if (message) toast.success(message, { id: "adjust", duration: 1500 });
    }
  };

  const autoEnhance = () => {
    const image = getTarget();
    if (!image) return;
    const sample = thumbnailSource(image, 160);
    const data = sample?.getContext("2d")?.getImageData(0, 0, 160, 160).data;
    const stats = data ? analyzePixels(data) : null;
    if (sample) {
      sample.width = 0;
      sample.height = 0;
    }
    if (!stats) {
      toast("There is nothing to enhance in a fully transparent image");
      return;
    }
    replaceAll(autoEnhanceValues(stats), "Auto enhance applied");
  };

  const startCompare = () => {
    const image = getTarget();
    if (!image || !fabricCanvas || compareRef.current) return;
    commit();
    if (!image.filters?.length) return;
    compareRef.current = { target: image, filters: image.filters };
    image.filters = [];
    image.applyFilters();
    fabricCanvas.requestRenderAll();
    setComparing(true);
  };

  const thumbs = usePresetThumbnails(target, !!target);

  if (!target) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <SlidersHorizontal className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">No image to adjust</p>
        <p className="max-w-[14rem] text-xs text-muted-foreground">
          Select an image layer, or deselect everything to adjust the photo.
        </p>
      </div>
    );
  }

  const active = hasAdjustments(filters);

  return (
    <ScrollArea className="h-full w-full">
      <div className="space-y-5 p-4">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "mr-auto rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              readOnly ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"
            )}
          >
            {readOnly ? "Locked" : targetIsSelection ? "Selected layer" : "Photo"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            disabled={readOnly}
            onClick={autoEnhance}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Auto
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Hold to compare with the original"
            title="Hold to compare with the original"
            aria-pressed={comparing}
            className={cn("h-8 w-8 p-0", comparing && "border-primary text-primary")}
            disabled={!active}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              startCompare();
            }}
            onPointerUp={endCompare}
            onPointerCancel={endCompare}
            onLostPointerCapture={endCompare}
            onKeyDown={(event) => {
              if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                event.preventDefault();
                startCompare();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") endCompare();
            }}
            onBlur={endCompare}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Reset adjustments"
            title="Reset adjustments"
            className="h-8 w-8 p-0"
            disabled={readOnly || !active}
            onClick={() => replaceAll({ ...DEFAULT_FILTERS }, "Adjustments reset")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <section aria-labelledby="presets-heading">
          <h4 id="presets-heading" className="mb-2 text-xs font-medium text-muted-foreground">
            Presets
          </h4>
          <div className="grid grid-cols-4 gap-2">
            {FILTER_PRESETS.map((preset) => {
              const selected = sameFilterValues(filters, presetValues(preset));
              const src = thumbs.get(preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-label={`${preset.label} preset`}
                  aria-pressed={selected}
                  disabled={readOnly}
                  onClick={() => replaceAll(presetValues(preset))}
                  className="group flex min-w-0 flex-col items-center gap-1 rounded-lg p-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span
                    className={cn(
                      "checkerboard block aspect-square w-full overflow-hidden rounded-md ring-2 ring-transparent transition-all group-hover:ring-primary/40",
                      selected && "ring-primary group-hover:ring-primary"
                    )}
                  >
                    {src ? (
                      <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <span className="block h-full w-full animate-pulse bg-muted" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "w-full truncate text-center",
                      selected ? "font-medium text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {preset.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {SLIDER_GROUPS.map((group) => (
          <section key={group.title} className="space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground">{group.title}</h4>
            {group.sliders.map(({ key, label }) => {
              const range = FILTER_RANGES[key];
              const value = filters[key];
              const changed = value !== DEFAULT_FILTERS[key];
              return (
                <div key={key}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <Label className="text-xs font-medium">{label}</Label>
                    <button
                      type="button"
                      title={changed ? `Reset ${label.toLowerCase()}` : undefined}
                      aria-label={changed ? `Reset ${label.toLowerCase()}` : undefined}
                      disabled={!changed || readOnly}
                      onClick={() => replaceAll({ ...filtersRef.current, [key]: DEFAULT_FILTERS[key] })}
                      className={cn(
                        "rounded px-1 text-xs tabular-nums",
                        changed ? "text-primary hover:bg-primary/10" : "text-muted-foreground"
                      )}
                    >
                      {key === "pixelate" ? (value >= 2 ? `${value}px` : "Off") : value > 0 && range.min < 0 ? `+${value}` : value}
                    </button>
                  </div>
                  <Slider
                    value={[value]}
                    aria-label={`${label} filter`}
                    disabled={readOnly}
                    onValueChange={setValue(key)}
                    onValueCommit={commit}
                    min={range.min}
                    max={range.max}
                    step={1}
                    className="w-full"
                  />
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </ScrollArea>
  );
};
