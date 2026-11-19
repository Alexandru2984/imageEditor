import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/** A labelled slider with its value, for adjustment settings. */
export function ValueSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format = (current) => String(Math.round(current)),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onValueChange={(next) => onChange(next[0] ?? value)}
      />
      <span className="text-right text-xs tabular-nums text-muted-foreground">{format(value)}</span>
    </div>
  );
}

/** One of a few options as a row of toggle buttons. */
export function OptionRow<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-md border px-2.5 text-xs transition-colors",
            value === option.value
              ? "border-primary bg-primary/10 text-foreground"
              : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const CHANNEL_OPTIONS = [
  { value: "rgb", label: "RGB" },
  { value: "red", label: "Red" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
] as const;

/** Histogram and curve colours per channel. */
export const CHANNEL_COLORS = {
  rgb: "hsl(var(--muted-foreground) / 0.45)",
  red: "rgb(239 68 68 / 0.5)",
  green: "rgb(34 197 94 / 0.5)",
  blue: "rgb(59 130 246 / 0.5)",
} as const;
