import { useId, useState, type FormEvent } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { documentGrid } from "@/selection/state";
import { isGridSettings, type GridSettings } from "@/utils/guideData";
import { guidesOf, setGuides } from "@/utils/guides";
import { Segmented } from "./DocumentDialog";

/** View › New Guide and View › Grid Settings. */
export type GuideDialogKind = "newGuide" | "grid";

const inputClass =
  "h-9 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive";

function NumberRow({
  label,
  value,
  onChange,
  invalid,
  unit,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  unit: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-28 text-sm">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        className={inputClass}
      />
      <span className="text-sm text-muted-foreground">{unit}</span>
    </div>
  );
}

function Footer({ onClose, disabled }: { onClose: () => void; disabled: boolean }) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" disabled={disabled}>
        OK
      </Button>
    </DialogFooter>
  );
}

function NewGuideForm({ canvas, onClose, onRevealGuides }: { canvas: FabricCanvas | null; onClose: () => void; onRevealGuides: () => void }) {
  const [axis, setAxis] = useState<"x" | "y">("y");
  const [position, setPosition] = useState("0");
  const value = Number(position);
  const valid = position.trim() !== "" && Number.isFinite(value) && Math.abs(value) <= 100_000;
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const grid = canvas ? documentGrid(canvas) : null;
    if (!canvas || !grid || !valid) return;
    const origin = axis === "x" ? grid.left : grid.top;
    setGuides(canvas, [...guidesOf(canvas), { axis, position: origin + value / grid.scale }]);
    onRevealGuides();
    onClose();
  };
  return (
    <form onSubmit={apply} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New guide</DialogTitle>
        <DialogDescription>A guide at an exact place, measured from the document's top-left corner.</DialogDescription>
      </DialogHeader>
      <Segmented
        label="Orientation"
        value={axis}
        options={[
          { value: "y", label: "Horizontal" },
          { value: "x", label: "Vertical" },
        ]}
        onChange={setAxis}
      />
      <NumberRow label="Position" value={position} onChange={setPosition} invalid={!valid} unit="pixels" autoFocus />
      <Footer onClose={onClose} disabled={!canvas || !valid} />
    </form>
  );
}

function GridForm({ grid, onChange, onClose }: { grid: GridSettings; onChange: (grid: GridSettings) => void; onClose: () => void }) {
  const [spacing, setSpacing] = useState(String(grid.spacing));
  const [subdivisions, setSubdivisions] = useState(String(grid.subdivisions));
  const next = { spacing: Number(spacing), subdivisions: Number(subdivisions) };
  const spacingValid = spacing.trim() !== "" && isGridSettings({ spacing: next.spacing, subdivisions: 1 });
  const subdivisionsValid = subdivisions.trim() !== "" && isGridSettings({ spacing: 1, subdivisions: next.subdivisions });
  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!spacingValid || !subdivisionsValid) return;
    onChange(next);
    onClose();
  };
  return (
    <form onSubmit={apply} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Grid</DialogTitle>
        <DialogDescription>Lines from the document's top-left corner; layers snap to every one of them.</DialogDescription>
      </DialogHeader>
      <NumberRow label="Gridline every" value={spacing} onChange={setSpacing} invalid={!spacingValid} unit="pixels" autoFocus />
      <NumberRow label="Subdivisions" value={subdivisions} onChange={setSubdivisions} invalid={!subdivisionsValid} unit="per square" />
      <Footer onClose={onClose} disabled={!spacingValid || !subdivisionsValid} />
    </form>
  );
}

export function GuideDialog({
  canvas,
  kind,
  grid,
  onGridChange,
  onRevealGuides,
  onClose,
}: {
  canvas: FabricCanvas | null;
  kind: GuideDialogKind | null;
  grid: GridSettings;
  /** New grid settings; the grid shows. */
  onGridChange: (grid: GridSettings) => void;
  onRevealGuides: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {kind === "newGuide" && <NewGuideForm canvas={canvas} onClose={onClose} onRevealGuides={onRevealGuides} />}
        {kind === "grid" && <GridForm grid={grid} onChange={onGridChange} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
