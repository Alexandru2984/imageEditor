import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

interface ColorWellsProps {
  foreground: string;
  background: string;
  onForegroundChange: (color: string) => void;
  onBackgroundChange: (color: string) => void;
  onSwap: () => void;
  onReset: () => void;
  /** Larger wells for touch. */
  large?: boolean;
}

const wellClass =
  "absolute cursor-pointer rounded-[5px] border border-black/20 shadow-sm ring-1 ring-white/70 focus-within:ring-2 focus-within:ring-ring dark:border-white/25 dark:ring-black/40";

/**
 * Photoshop's foreground and background colours: the front square paints,
 * the back one waits its turn. X swaps them and D restores black on white.
 */
export function ColorWells({
  foreground,
  background,
  onForegroundChange,
  onBackgroundChange,
  onSwap,
  onReset,
  large = false,
}: ColorWellsProps) {
  const well = large ? "h-7 w-7" : "h-6 w-6";
  return (
    <div
      role="group"
      aria-label="Colors"
      className={cn("relative shrink-0", large ? "h-11 w-11" : "h-10 w-10")}
    >
      <label
        title="Background color"
        className={cn(wellClass, well, "bottom-0 right-0")}
        style={{ backgroundColor: background }}
      >
        <input
          type="color"
          aria-label="Background color"
          value={background}
          onChange={(event) => onBackgroundChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <label
        title="Foreground color"
        className={cn(wellClass, well, "left-0 top-0 z-10")}
        style={{ backgroundColor: foreground }}
      >
        <input
          type="color"
          aria-label="Foreground color"
          value={foreground}
          onChange={(event) => onForegroundChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      {!large && (
        <>
          <button
            type="button"
            aria-label="Swap colors"
            title="Swap colors (X)"
            onClick={onSwap}
            className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
          >
            <Repeat />
          </button>
          <button
            type="button"
            aria-label="Default colors"
            title="Default colors (D)"
            onClick={onReset}
            className="absolute -bottom-0.5 -left-0.5 h-3.5 w-3.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="absolute bottom-0.5 right-0.5 h-2 w-2 border border-foreground/60 bg-white" />
            <span className="absolute left-0.5 top-0.5 h-2 w-2 border border-foreground/60 bg-black" />
          </button>
        </>
      )}
    </div>
  );
}
