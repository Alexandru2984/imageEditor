import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { addSwatch, DEFAULT_SWATCHES, MAX_SWATCHES, removeSwatch } from "@/utils/colorPreferences";
import { useUserSwatches } from "@/hooks/useColorPreferences";

const swatchClass =
  "h-7 w-7 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15";

/**
 * Photoshop's Swatches: colours to paint with in one click. The built-in
 * ones come first, then the user's own, kept in this browser; the + adds the
 * active colour and each of the user's swatches can be deleted.
 */
export function Swatches({ activeColor, onPick, custom }: { activeColor: string; onPick: (color: string) => void; custom?: ReactNode }) {
  const user = useUserSwatches();
  const known = user.includes(activeColor) || DEFAULT_SWATCHES.includes(activeColor);
  const swatch = (color: string) => (
    <button
      key={color}
      type="button"
      aria-label={`Use color ${color}`}
      aria-pressed={activeColor === color}
      title={color}
      onClick={() => onPick(color)}
      className={cn(swatchClass, activeColor === color && "ring-2 ring-primary ring-offset-2 ring-offset-editor-panel")}
      style={{ backgroundColor: color }}
    />
  );
  return (
    <div role="group" aria-label="Swatches" className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {DEFAULT_SWATCHES.map(swatch)}
        {custom}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {user.map((color) => (
          <div key={color} className="group relative">
            {swatch(color)}
            <button
              type="button"
              aria-label={`Delete the swatch ${color}`}
              title="Delete this swatch"
              onClick={() => removeSwatch(color)}
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 [&_svg]:size-2.5"
            >
              <X />
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label="Add the color to the swatches"
          title={known ? "Already in the swatches" : `Add ${activeColor} to the swatches`}
          disabled={known || user.length >= MAX_SWATCHES}
          onClick={() => {
            const result = addSwatch(activeColor);
            if (result === "full") toast.error("The swatches are full; delete some first");
            else if (result === "session") toast.warning("Added for now; this browser would not keep it");
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4"
        >
          <Plus />
        </button>
      </div>
    </div>
  );
}
