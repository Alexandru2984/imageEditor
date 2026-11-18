import { useEffect, useId, useState, type FormEvent } from "react";
import type { Canvas as FabricCanvas } from "fabric";
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
import { selectionOf } from "@/selection/state";
import { paintTarget, strokeSelection, type StrokeLocation } from "@/selection/edits";
import { cn } from "@/lib/utils";

export type SelectionModification = "feather" | "expand" | "contract" | "stroke";

const STROKE_LOCATIONS: { value: StrokeLocation; label: string }[] = [
  { value: "inside", label: "Inside" },
  { value: "center", label: "Centre" },
  { value: "outside", label: "Outside" },
];

const MODIFICATIONS: Record<
  SelectionModification,
  { title: string; description: string; label: string; min: number; max: number; initial: number }
> = {
  feather: {
    title: "Feather selection",
    description: "Soften the selection's edge so changes fade out across it.",
    label: "Feather radius",
    min: 0.5,
    max: 250,
    initial: 5,
  },
  expand: {
    title: "Expand selection",
    description: "Grow the selection outwards.",
    label: "Expand by",
    min: 1,
    max: 500,
    initial: 5,
  },
  contract: {
    title: "Contract selection",
    description: "Shrink the selection inwards.",
    label: "Contract by",
    min: 1,
    max: 500,
    initial: 5,
  },
  stroke: {
    title: "Stroke",
    description: "Paint a line along the selection's edge in the foreground colour.",
    label: "Width",
    min: 1,
    max: 250,
    initial: 4,
  },
};

interface SelectionModifyDialogProps {
  canvas: FabricCanvas | null;
  /** The modification being set up, or null when the dialog is closed. */
  modification: SelectionModification | null;
  /** The foreground colour a stroke is painted in. */
  strokeColor: string;
  onClose: () => void;
}

/**
 * Select › Modify (Feather, Expand, Contract) and Edit › Stroke, each by a
 * number of pixels.
 */
export function SelectionModifyDialog({ canvas, modification, strokeColor, onClose }: SelectionModifyDialogProps) {
  const inputId = useId();
  const settings = modification ? MODIFICATIONS[modification] : null;
  const [value, setValue] = useState("");
  const [location, setLocation] = useState<StrokeLocation>("center");
  // Each opening starts from the last amount used for that modification.
  const [remembered, setRemembered] = useState<Partial<Record<SelectionModification, number>>>({});
  useEffect(() => {
    if (modification) setValue(String(remembered[modification] ?? MODIFICATIONS[modification].initial));
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modification]);

  const amount = Number(value);
  const valid =
    settings !== null && value.trim() !== "" && Number.isFinite(amount) && amount >= settings.min && amount <= settings.max;

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!canvas || !modification || !valid) return;
    const store = selectionOf(canvas);
    const selection = store.current();
    if (!selection) {
      toast.error("Make a selection first");
      onClose();
      return;
    }
    if (modification === "stroke") {
      const target = paintTarget(canvas);
      if (typeof target === "string") {
        toast.error(target);
      } else {
        void strokeSelection(canvas, target, selection, strokeColor, Math.round(amount), location).catch((error) => {
          console.error("Stroke failed:", error);
          toast.error("The stroke could not be painted");
        });
      }
      setRemembered((current) => ({ ...current, stroke: amount }));
      onClose();
      return;
    }
    const { mask, grid } = selection;
    const changed =
      modification === "feather"
        ? mask.feathered(amount)
        : modification === "expand"
          ? mask.expanded(amount)
          : mask.contracted(amount);
    if (changed.isEmpty()) toast.warning("Nothing is left selected");
    store.set(changed, grid);
    setRemembered((current) => ({ ...current, [modification]: amount }));
    onClose();
  };

  return (
    <Dialog open={modification !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {settings && (
          <form onSubmit={apply} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{settings.title}</DialogTitle>
              <DialogDescription>{settings.description}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-3">
              <label htmlFor={inputId} className="text-sm">
                {settings.label}
              </label>
              <input
                id={inputId}
                type="number"
                inputMode="decimal"
                min={settings.min}
                max={settings.max}
                step={modification === "feather" ? 0.5 : 1}
                value={value}
                autoFocus
                onChange={(event) => setValue(event.target.value)}
                aria-invalid={!valid}
                className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
              />
              <span className="text-sm text-muted-foreground">pixels</span>
            </div>
            {modification === "stroke" && (
              <div role="radiogroup" aria-label="Stroke location" className="flex items-center gap-1">
                <span className="mr-2 text-sm">Location</span>
                {STROKE_LOCATIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={location === option.value}
                    onClick={() => setLocation(option.value)}
                    className={cn(
                      "h-8 rounded-md border px-2.5 text-xs transition-colors",
                      location === option.value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid}>
                OK
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
