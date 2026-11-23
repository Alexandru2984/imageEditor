import { useEffect, useId, useReducer, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  PaintBucket,
  Paintbrush,
  Plus,
  Shapes,
  Spline,
  SquareDashed,
  Trash2,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  deletePath,
  fillPath,
  newPath,
  renamePath,
  selectionFromPath,
  shapeFromPath,
  strokePath,
  workPathFromSelection,
  type PathResult,
} from "@/paths/pathActions";
import { svgPathData } from "@/paths/pathData";
import { pathsOf, pathViewOf } from "@/paths/paths";
import type { PaintOptions } from "@/raster/paintSettings";
import type { SelectionMode } from "@/selection/mask";
import { documentGrid } from "@/selection/state";
import { HISTORY_RESTORED, offCanvasEvent, onCanvasEvent } from "@/utils/canvasEvents";

interface PathsPanelProps {
  canvas: FabricCanvas | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The foreground colour paths are filled and stroked with. */
  color: string;
  /** The brush paths are stroked with. */
  brush: PaintOptions;
}

const report = (result: PathResult) => {
  if (result !== true) toast.error(result);
};
const failed = (error: unknown) => {
  console.error("Path action failed:", error);
  toast.error(error instanceof Error ? error.message : "That did not work");
};

/** Renders again whenever the paths or what is picked in them change. */
function usePathsVersion(canvas: FabricCanvas | null) {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!canvas) return;
    const view = pathViewOf(canvas);
    const stop = view.subscribe(bump);
    const events = ["object:modified", "object:added", "object:removed"] as const;
    events.forEach((event) => canvas.on(event, bump));
    onCanvasEvent(canvas, HISTORY_RESTORED, bump);
    return () => {
      stop();
      events.forEach((event) => canvas.off(event, bump));
      offCanvasEvent(canvas, HISTORY_RESTORED, bump);
    };
  }, [canvas]);
}

function Thumbnail({ canvas, index }: { canvas: FabricCanvas; index: number }) {
  const grid = documentGrid(canvas);
  const path = pathsOf(canvas)[index];
  if (!grid || !path) return <span className="h-7 w-9 shrink-0 rounded-sm border border-border bg-background" />;
  const width = grid.width / grid.scale;
  const height = grid.height / grid.scale;
  return (
    <svg
      aria-hidden="true"
      viewBox={`${grid.left} ${grid.top} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-7 w-9 shrink-0 rounded-sm border border-border bg-white"
    >
      <path d={svgPathData(path.subpaths)} fill="#6b7280" fillRule="nonzero" stroke="#374151" strokeWidth={Math.max(width, height) / 60} />
    </svg>
  );
}

const MODES: { value: SelectionMode; label: string }[] = [
  { value: "replace", label: "New selection" },
  { value: "add", label: "Add to selection" },
  { value: "subtract", label: "Subtract from selection" },
  { value: "intersect", label: "Intersect with selection" },
];

/**
 * The Paths panel, under the layers: the document's paths (the Work Path
 * and saved ones), picked to show and edit them, double-clicked to rename
 * (renaming the Work Path saves it), Ctrl-clicked to load as a selection;
 * and below, what to do with the picked path.
 */
export function PathsPanel({ canvas, open, onOpenChange, color, brush }: PathsPanelProps) {
  usePathsVersion(canvas);
  const [renaming, setRenaming] = useState<{ index: number; name: string } | null>(null);
  const [makeSelection, setMakeSelection] = useState<{ feather: string; mode: SelectionMode } | null>(null);
  const featherId = useId();
  const paths = canvas ? pathsOf(canvas) : [];
  const view = canvas ? pathViewOf(canvas) : null;
  const shown = view?.shown ?? null;
  const hasPath = shown !== null && (paths[shown]?.subpaths.length ?? 0) > 0;

  const run = (action: (canvas: FabricCanvas, index: number) => PathResult | Promise<PathResult>) => {
    if (!canvas || shown === null) return;
    try {
      const result = action(canvas, shown);
      if (result instanceof Promise) void result.then(report).catch(failed);
      else report(result);
    } catch (error) {
      failed(error);
    }
  };

  const pickRow = (event: ReactMouseEvent, index: number) => {
    if (!canvas) return;
    if (event.ctrlKey || event.metaKey) {
      const mode: SelectionMode = event.shiftKey && event.altKey ? "intersect" : event.shiftKey ? "add" : event.altKey ? "subtract" : "replace";
      try {
        report(selectionFromPath(canvas, index, mode));
      } catch (error) {
        failed(error);
      }
      return;
    }
    pathViewOf(canvas).show(index);
    canvas.requestRenderAll();
  };

  const finishRename = (event?: FormEvent) => {
    event?.preventDefault();
    if (canvas && renaming) renamePath(canvas, renaming.index, renaming.name);
    setRenaming(null);
  };

  const applyMakeSelection = (event: FormEvent) => {
    event.preventDefault();
    if (!makeSelection) return;
    const feather = Number(makeSelection.feather);
    if (!Number.isFinite(feather) || feather < 0 || feather > 250) {
      toast.error("Feather radius must be between 0 and 250 pixels");
      return;
    }
    run((target, index) => selectionFromPath(target, index, makeSelection.mode, feather));
    setMakeSelection(null);
  };

  const iconButton = (label: string, Icon: typeof Plus, onClick: () => void, enabled = hasPath) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground"
      aria-label={label}
      title={label}
      disabled={!canvas || !enabled}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  return (
    <section aria-label="Paths" className={cn("flex min-h-0 shrink-0 flex-col border-t border-border", open && "max-h-[45%]")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex h-9 shrink-0 items-center gap-1.5 px-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Paths
        {paths.length > 0 && <span className="tabular-nums">({paths.length})</span>}
      </button>
      {open && (
        <>
          <ul aria-label="Paths list" className="min-h-0 flex-1 overflow-y-auto px-2">
            {paths.length === 0 && (
              <li className="px-1 py-2 text-xs text-muted-foreground">Draw with the Pen (P) to make a path.</li>
            )}
            {paths.map((path, index) => (
              <li key={`${index}-${path.name}`}>
                {renaming?.index === index ? (
                  <form onSubmit={finishRename} className="flex items-center gap-2 px-1 py-1">
                    {canvas && <Thumbnail canvas={canvas} index={index} />}
                    <input
                      aria-label="Path name"
                      autoFocus
                      value={renaming.name}
                      maxLength={256}
                      onChange={(event) => setRenaming({ index, name: event.target.value })}
                      onBlur={() => finishRename()}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-sm"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    aria-pressed={shown === index}
                    onClick={(event) => pickRow(event, index)}
                    onDoubleClick={() => setRenaming({ index, name: path.name })}
                    title="Click to show and edit · Double-click to rename · Ctrl-click to select its area"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm",
                      shown === index ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    )}
                  >
                    {canvas && <Thumbnail canvas={canvas} index={index} />}
                    <span className={cn("min-w-0 flex-1 truncate", path.name === "Work Path" && "italic")}>{path.name}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div role="toolbar" aria-label="Path actions" className="flex shrink-0 items-center justify-between gap-0.5 px-2 py-1">
            {iconButton("Fill path with the foreground colour", PaintBucket, () => run((target, index) => fillPath(target, index, color)))}
            {iconButton("Stroke path with the brush", Paintbrush, () => run((target, index) => strokePath(target, index, color, brush)))}
            {iconButton("Load path as a selection", SquareDashed, () => run((target, index) => selectionFromPath(target, index)))}
            {iconButton(
              "Make work path from selection",
              Spline,
              () => canvas && report(workPathFromSelection(canvas)),
              true
            )}
            {iconButton("New shape layer from path", Shapes, () => run((target, index) => shapeFromPath(target, index, color)))}
            {iconButton("New path", Plus, () => canvas && report(newPath(canvas)), true)}
            {iconButton("Delete path", Trash2, () => canvas && shown !== null && deletePath(canvas, shown), shown !== null)}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="More path actions" disabled={!canvas}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!hasPath} onSelect={() => setMakeSelection({ feather: "0", mode: "replace" })}>
                  Make Selection…
                </DropdownMenuItem>
                <DropdownMenuItem disabled={shown === null} onSelect={() => shown !== null && setRenaming({ index: shown, name: paths[shown]!.name })}>
                  Rename Path…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={shown === null} onSelect={() => canvas && pathViewOf(canvas).show(null)}>
                  Hide Path
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}
      <Dialog open={makeSelection !== null} onOpenChange={(next) => !next && setMakeSelection(null)}>
        <DialogContent className="max-w-sm">
          {makeSelection && (
            <form onSubmit={applyMakeSelection} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Make Selection</DialogTitle>
                <DialogDescription>Select the area the path encloses.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3">
                <label htmlFor={featherId} className="text-sm">
                  Feather radius
                </label>
                <input
                  id={featherId}
                  type="number"
                  min={0}
                  max={250}
                  step={0.5}
                  value={makeSelection.feather}
                  onChange={(event) => setMakeSelection({ ...makeSelection, feather: event.target.value })}
                  className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                />
                <span className="text-sm text-muted-foreground">px</span>
              </div>
              <fieldset className="grid gap-1.5 text-sm">
                <legend className="mb-1 text-sm">Operation</legend>
                {MODES.map((option) => (
                  <label key={option.value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="make-selection-mode"
                      checked={makeSelection.mode === option.value}
                      onChange={() => setMakeSelection({ ...makeSelection, mode: option.value })}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setMakeSelection(null)}>
                  Cancel
                </Button>
                <Button type="submit">OK</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
