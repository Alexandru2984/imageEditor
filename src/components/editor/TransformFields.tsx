import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActiveSelection, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import { Link2, Unlink2 } from "lucide-react";
import { isEditorChrome, isMoveLocked } from "@/utils/editorObjects";
import { nativeMultiplier } from "@/utils/flatten";
import { cn } from "@/lib/utils";

/** Document pixels per scene unit (1 without a photo). */
const pixelsPerUnit = (canvas: FabricCanvas): number => {
  try {
    return nativeMultiplier(canvas);
  } catch {
    return 1;
  }
};

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

/** A number typed in and applied on Enter or when the field is left. */
function NumberField({
  label,
  name,
  value,
  unit,
  onCommit,
  min,
  max,
}: {
  label: string;
  name: string;
  value: number;
  unit: string;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  // What was typed, read once: Enter applies it and the blur after must not.
  const draft = useRef<string | null>(null);
  const type = (value: string) => {
    draft.current = value;
    setText(value);
  };
  const commit = () => {
    const text = draft.current;
    draft.current = null;
    setText(null);
    if (text === null) return;
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (clamped !== value) onCommit(clamped);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      // Back to the editor's shortcuts (Ctrl+Z undoes the change).
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      draft.current = null;
      setText(null);
      event.currentTarget.blur();
    }
  };
  return (
    <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <span aria-hidden="true">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        aria-label={name}
        value={text ?? String(value)}
        onChange={(event) => type(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="h-7 w-16 rounded-md border border-input bg-background px-1.5 text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span aria-hidden="true">{unit}</span>
    </label>
  );
}

const TRACKED = [
  "selection:created",
  "selection:updated",
  "selection:cleared",
  "object:modified",
  "object:moving",
  "object:scaling",
  "object:rotating",
  "object:skewing",
  "object:removed",
] as const;

/**
 * Free transform by numbers, for the one selected layer: its size in
 * document pixels, its angle and its skew, each changed around its centre
 * as one history step.
 */
export function TransformFields({ canvas }: { canvas: FabricCanvas | null }) {
  const [target, setTarget] = useState<FabricObject | null>(null);
  const [, setVersion] = useState(0);
  const [linked, setLinked] = useState(true);

  useEffect(() => {
    if (!canvas) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = canvas.getActiveObject();
        const single =
          active && !isEditorChrome(active) && !(active instanceof ActiveSelection) && !isMoveLocked(active)
            ? active
            : null;
        setTarget(single ?? null);
        setVersion((version) => version + 1);
      });
    };
    refresh();
    for (const name of TRACKED) canvas.on(name, refresh);
    return () => {
      cancelAnimationFrame(frame);
      for (const name of TRACKED) canvas.off(name, refresh);
    };
  }, [canvas]);

  if (!canvas || !target || !canvas.getObjects().includes(target)) return null;
  const scale = pixelsPerUnit(canvas);
  const width = target.width * Math.abs(target.scaleX) * scale;
  const height = target.height * Math.abs(target.scaleY) * scale;

  const apply = (change: (object: FabricObject) => void) => {
    const centre = target.getCenterPoint();
    change(target);
    target.setPositionByOrigin(centre, "center", "center");
    target.setCoords();
    canvas.requestRenderAll();
    canvas.fire("object:modified", { target });
  };
  const resize = (axis: "x" | "y", size: number) => {
    const current = axis === "x" ? width : height;
    if (current <= 0 || size <= 0) return;
    const factor = size / current;
    apply((object) =>
      object.set(
        linked
          ? { scaleX: object.scaleX * factor, scaleY: object.scaleY * factor }
          : axis === "x"
            ? { scaleX: object.scaleX * factor }
            : { scaleY: object.scaleY * factor }
      )
    );
  };

  return (
    <div role="group" aria-label="Transform" className="flex items-center gap-2">
      <NumberField label="W" name="Layer width" value={round(width)} unit="px" min={0.1} onCommit={(value) => resize("x", value)} />
      <button
        type="button"
        aria-label="Keep proportions"
        aria-pressed={linked}
        title="Keep proportions"
        onClick={() => setLinked(!linked)}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-accent",
          linked ? "text-primary" : "text-muted-foreground"
        )}
      >
        {linked ? <Link2 className="h-3.5 w-3.5" /> : <Unlink2 className="h-3.5 w-3.5" />}
      </button>
      <NumberField label="H" name="Layer height" value={round(height)} unit="px" min={0.1} onCommit={(value) => resize("y", value)} />
      <NumberField
        label="∠"
        name="Layer angle"
        value={round(target.angle ?? 0)}
        unit="°"
        onCommit={(value) => apply((object) => object.set("angle", ((value % 360) + 360) % 360))}
      />
      <NumberField
        label="H skew"
        name="Horizontal skew"
        value={round(target.skewX ?? 0)}
        unit="°"
        min={-80}
        max={80}
        onCommit={(value) => apply((object) => object.set("skewX", value))}
      />
      <NumberField
        label="V skew"
        name="Vertical skew"
        value={round(target.skewY ?? 0)}
        unit="°"
        min={-80}
        max={80}
        onCommit={(value) => apply((object) => object.set("skewY", value))}
      />
    </div>
  );
}
