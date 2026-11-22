import type { Canvas as FabricCanvas } from "fabric";
import {
  Check,
  Contrast,
  Copy,
  Crop as CropIcon,
  Droplets,
  EyeOff,
  Grid3x3,
  Square as SquareIcon,
  Sparkles,
  SquareDashedBottom,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSelection } from "@/hooks/useSelection";
import {
  blackOutSelection,
  copySelectionToLayer,
  type RedactEffect,
} from "@/selection/actions";
import { addLayerMask, hasLayerMask, maskLayer, maskTargetOf } from "@/raster/layerMask";
import { selectionOf } from "@/selection/state";
import type { Tool } from "@/types/editor";

interface SelectionTaskBarProps {
  canvas: FabricCanvas | null;
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  /** Runs a pixel operation, blocking the canvas until it ends. */
  runRaster: (task: () => Promise<void>) => Promise<void>;
  busy: boolean;
  onCrop: () => void;
  onSelectSubject: () => void;
  aiBusy: boolean;
}

const HINTS: Partial<Record<Tool, string>> = {
  marquee: "Drag to select a region",
  ellipseMarquee: "Drag to select an ellipse",
  lasso: "Drag around what to select",
  polygonLasso: "Tap corner by corner around what to select",
  magicWand: "Tap a colour to select the area like it",
};

const failure = (error: unknown, fallback: string) => {
  console.error(fallback, error);
  toast.error(error instanceof Error ? error.message : fallback);
};

/**
 * What to do with the selection, floating over the canvas while a selection
 * tool is active (Photoshop's contextual task bar).
 */
export function SelectionTaskBar({
  canvas,
  activeTool,
  onToolChange,
  runRaster,
  busy,
  onCrop,
  onSelectSubject,
  aiBusy,
}: SelectionTaskBarProps) {
  const { selection, draft } = useSelection(canvas);

  const current = () => (canvas ? selectionOf(canvas).current() : null);

  const copy = (effect?: RedactEffect) =>
    runRaster(async () => {
      const chosen = current();
      if (!canvas || !chosen) return;
      try {
        const result = await copySelectionToLayer(canvas, chosen, effect);
        if (!result) return;
        selectionOf(canvas).set(null);
        onToolChange("select");
        if (effect) {
          toast.success("Region redacted on a new layer", {
            description: "Exports are flattened. Project files still contain the original photo.",
          });
        }
        if (result.limited) toast.warning("The copy was rendered smaller to stay within browser limits.");
      } catch (error) {
        failure(error, "Could not create the layer");
      }
    });

  const blackOut = () =>
    runRaster(async () => {
      const chosen = current();
      if (!canvas || !chosen) return;
      try {
        await blackOutSelection(canvas, chosen);
        selectionOf(canvas).set(null);
        onToolChange("select");
      } catch (error) {
        failure(error, "Could not black out the selection");
      }
    });

  /** A layer mask from the selection on the selected layer (or the photo). */
  const mask = () =>
    runRaster(async () => {
      const chosen = current();
      if (!canvas || !chosen) return;
      const layer = maskLayer(canvas);
      if (typeof layer === "string") {
        toast.error(layer);
        return;
      }
      try {
        if (!(await addLayerMask(canvas, layer, { selection: chosen }))) return;
        selectionOf(canvas).set(null);
        maskTargetOf(canvas).set(layer);
        onToolChange("select");
      } catch (error) {
        failure(error, "Could not mask the layer");
      }
    });

  const invert = () => {
    const chosen = current();
    if (!canvas || !chosen) return;
    selectionOf(canvas).set(chosen.mask.inverted(), chosen.grid, "Inverse");
  };

  const deselect = () => {
    if (canvas) selectionOf(canvas).set(null);
  };

  const maskable = canvas ? maskLayer(canvas) : null;
  const canMask = !!maskable && typeof maskable !== "string" && !hasLayerMask(maskable);

  return (
    <div className="absolute left-1/2 top-3 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-border bg-popover/95 px-2 py-1.5 shadow-xl backdrop-blur">
      {draft ? (
        <>
          <span className="px-1 text-xs text-muted-foreground">Tap the first corner to close</span>
          <Button size="sm" className="h-8" onClick={() => draft.finish()}>
            <Check className="mr-1 h-4 w-4" />
            Close shape
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => draft.cancel()}>
            <X className="mr-1 h-4 w-4" />
            Cancel
          </Button>
        </>
      ) : !selection ? (
        <>
          <span className="px-1 py-1.5 text-xs text-muted-foreground">
            {HINTS[activeTool] ?? "Select a region"}
          </span>
          <Button size="sm" variant="ghost" className="h-8" onClick={onSelectSubject} disabled={aiBusy}>
            <Sparkles className="mr-1 h-4 w-4" />
            Select subject
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" className="h-8" onClick={() => void copy()} disabled={busy}>
            <Copy className="mr-1 h-4 w-4" />
            New layer
          </Button>
          {canMask && (
            <Button size="sm" variant="ghost" className="h-8" onClick={() => void mask()} disabled={busy}>
              <SquareDashedBottom className="mr-1 h-4 w-4" />
              Mask
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8" disabled={busy}>
                <EyeOff className="mr-1 h-4 w-4" />
                Redact
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuLabel>Hide what is inside</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void copy("pixelate")}>
                <Grid3x3 /> Pixelate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copy("blur")}>
                <Droplets /> Blur
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void blackOut()}>
                <SquareIcon /> Black out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" className="h-8" onClick={onCrop} disabled={busy}>
            <CropIcon className="mr-1 h-4 w-4" />
            Crop to this
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={invert} disabled={busy}>
            <Contrast className="mr-1 h-4 w-4" />
            Invert
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={deselect}>
            <X className="mr-1 h-4 w-4" />
            Deselect
          </Button>
        </>
      )}
    </div>
  );
}
