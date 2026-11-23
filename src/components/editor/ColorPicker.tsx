import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Pipette, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { addSwatch, DEFAULT_SWATCHES, pushRecentColor } from "@/utils/colorPreferences";
import { hexToRgb, hsbToRgb, labToRgb, parseHex, rgbToHex, rgbToHsb, rgbToLab, type Hsb, type Rgb } from "@/utils/colorSpaces";
import { nativeEyeDropper, normalizeHex } from "@/hooks/useEyedropper";
import { useRecentColors, useUserSwatches } from "@/hooks/useColorPreferences";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** A whole-number field that applies what is typed once it is a number. */
function NumberBox({
  label,
  short,
  value,
  min,
  max,
  unit,
  onValue,
}: {
  label: string;
  short: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onValue: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="grid grid-cols-[1.25rem_1fr_1rem] items-center gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{short}</span>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={draft ?? String(Math.round(value))}
        onChange={(event) => {
          setDraft(event.target.value);
          const number = Number.parseFloat(event.target.value);
          if (Number.isFinite(number)) onValue(clamp(number, min, max));
        }}
        onBlur={() => setDraft(null)}
        className="h-7 w-full min-w-0 rounded border border-input bg-background px-1.5 text-right text-xs tabular-nums"
      />
      <span className="text-muted-foreground">{unit}</span>
    </label>
  );
}

/** Follow a pointer across `element` from press to release. */
function dragOver(event: PointerEvent<HTMLElement>, onPoint: (x: number, y: number) => void) {
  const element = event.currentTarget;
  element.setPointerCapture(event.pointerId);
  element.focus();
  const at = (clientX: number, clientY: number) => {
    const box = element.getBoundingClientRect();
    onPoint(clamp((clientX - box.left) / box.width, 0, 1), clamp((clientY - box.top) / box.height, 0, 1));
  };
  at(event.clientX, event.clientY);
  const move = (next: globalThis.PointerEvent) => at(next.clientX, next.clientY);
  const end = () => {
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", end);
    element.removeEventListener("pointercancel", end);
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
}

/** Arrow keys move by one, with Shift by ten. */
const step = (event: KeyboardEvent) => (event.shiftKey ? 10 : 1);

interface ColorPickerDialogProps {
  /** What the colour is for, e.g. "Foreground color". */
  label: string;
  /** The colour as it was when the picker opened. */
  initial: string;
  /** Each change while picking (to show it), and the colour chosen on OK. */
  onChange: (hex: string) => void;
  /** OK (the chosen colour) or Cancel (null, after the initial colour is restored). */
  onClose: (hex: string | null) => void;
}

/**
 * Photoshop's colour picker: a saturation/brightness field beside a hue
 * strip, the new colour over the current one, and the colour as HSB, RGB,
 * Lab and hex, each editable. Recent colours and the swatches are a click
 * away, and on browsers that have one the eyedropper picks from the screen.
 */
export function ColorPickerDialog({ label, initial, onChange, onClose }: ColorPickerDialogProps) {
  const [hsb, setHsb] = useState<Hsb>(() => rgbToHsb(hexToRgb(initial)));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const recent = useRecentColors();
  const swatches = useUserSwatches();
  const rgb = hsbToRgb(hsb);
  const hex = rgbToHex(rgb);
  const lab = rgbToLab(rgb);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const reported = useRef(initial);

  useEffect(() => {
    if (reported.current === hex) return;
    reported.current = hex;
    onChangeRef.current(hex);
  }, [hex]);

  /** A colour from outside the field, keeping the hue of greys. */
  const takeRgb = (value: Rgb) => {
    const next = rgbToHsb(value);
    setHsb((current) => ({ h: next.s === 0 || next.b === 0 ? current.h : next.h, s: next.b === 0 ? current.s : next.s, b: next.b }));
  };
  const take = (color: string) => {
    const parsed = parseHex(color);
    if (parsed) takeRgb(hexToRgb(parsed));
  };
  const setChannel = (index: 0 | 1 | 2, value: number) => {
    const next = [...rgb] as Rgb;
    next[index] = value;
    takeRgb(next);
  };
  const setLab = (change: Partial<typeof lab>) => takeRgb(labToRgb({ ...lab, ...change }).rgb);

  const eyedropper = nativeEyeDropper();
  const pickFromScreen = () => {
    if (!eyedropper) return;
    new eyedropper()
      .open()
      .then((result) => {
        const picked = normalizeHex(result.sRGBHex);
        if (picked) take(picked);
      })
      .catch(() => {
        // Escape: nothing picked.
      });
  };

  const known = swatches.includes(hex) || DEFAULT_SWATCHES.includes(hex);
  const hue = `hsl(${hsb.h}, 100%, 50%)`;

  const fieldKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = step(event);
    const moves: Record<string, Partial<Hsb>> = {
      ArrowLeft: { s: hsb.s - by },
      ArrowRight: { s: hsb.s + by },
      ArrowUp: { b: hsb.b + by },
      ArrowDown: { b: hsb.b - by },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setHsb((current) => ({ ...current, s: clamp(move.s ?? current.s, 0, 100), b: clamp(move.b ?? current.b, 0, 100) }));
  };
  const hueKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = step(event);
    const moves: Record<string, number> = { ArrowUp: by, ArrowRight: by, ArrowDown: -by, ArrowLeft: -by, Home: -360, End: 360 };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    setHsb((current) => ({ ...current, h: clamp(current.h + move, 0, 360) }));
  };

  const apply = () => {
    pushRecentColor(hex);
    onClose(hex);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        onChangeRef.current(initial);
        onClose(null);
      }}
    >
      <DialogContent className="max-h-[96dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Color picker</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="flex gap-3 self-start">
              <div
                role="slider"
                tabIndex={0}
                aria-label="Saturation and brightness"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(hsb.s)}
                aria-valuetext={`Saturation ${Math.round(hsb.s)}%, brightness ${Math.round(hsb.b)}%`}
                data-testid="color-field"
                onPointerDown={(event) => dragOver(event, (x, y) => setHsb((current) => ({ ...current, s: x * 100, b: (1 - y) * 100 })))}
                onKeyDown={fieldKeys}
                className="relative aspect-square w-full min-w-0 max-w-64 flex-1 cursor-crosshair self-start touch-none rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
                style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})` }}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                  style={{ left: `${hsb.s}%`, top: `${100 - hsb.b}%` }}
                />
              </div>
              <div
                role="slider"
                tabIndex={0}
                aria-label="Hue"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={Math.round(hsb.h)}
                aria-valuetext={`${Math.round(hsb.h)}°`}
                data-testid="hue-strip"
                onPointerDown={(event) => dragOver(event, (_x, y) => setHsb((current) => ({ ...current, h: (1 - y) * 360 })))}
                onKeyDown={hueKeys}
                className="relative w-5 shrink-0 cursor-ns-resize touch-none rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ background: "linear-gradient(to top, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)" }}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-x-1 h-1.5 -translate-y-1/2 rounded-sm border border-white bg-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                  style={{ top: `${(1 - hsb.h / 360) * 100}%` }}
                />
              </div>
            </div>

            <div className="grid content-start gap-3">
              <div className="flex items-start gap-3">
                <div className="grid w-16 overflow-hidden rounded-md border border-border text-center text-[10px]">
                  <span className="bg-muted py-0.5 text-muted-foreground">new</span>
                  <div data-testid="new-color" data-color={hex} className="h-9" style={{ backgroundColor: hex }} />
                  <button
                    type="button"
                    aria-label={`Back to the current color ${initial}`}
                    title="Back to the current color"
                    onClick={() => take(initial)}
                    className="h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    style={{ backgroundColor: initial }}
                  />
                  <span className="bg-muted py-0.5 text-muted-foreground">current</span>
                </div>
                <div className="grid gap-1.5">
                  {eyedropper && (
                    <Button type="button" size="sm" variant="outline" className="justify-start gap-1.5" onClick={pickFromScreen}>
                      <Pipette className="h-4 w-4" /> Pick from the screen
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="justify-start gap-1.5"
                    disabled={known}
                    onClick={() => {
                      const result = addSwatch(hex);
                      if (result === "full") toast.error("The swatches are full; delete some first");
                      else if (result === "session") toast.warning("Added for now; this browser would not keep it");
                    }}
                  >
                    <Plus className="h-4 w-4" /> {known ? "In the swatches" : "Add to swatches"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4">
                <div className="grid content-start gap-1.5">
                  <NumberBox label="Hue degrees" short="H" unit="°" value={hsb.h} min={0} max={360} onValue={(h) => setHsb((current) => ({ ...current, h }))} />
                  <NumberBox label="Saturation" short="S" unit="%" value={hsb.s} min={0} max={100} onValue={(s) => setHsb((current) => ({ ...current, s }))} />
                  <NumberBox label="Brightness" short="B" unit="%" value={hsb.b} min={0} max={100} onValue={(b) => setHsb((current) => ({ ...current, b }))} />
                  <div className="h-1" />
                  <NumberBox label="Red" short="R" value={rgb[0]} min={0} max={255} onValue={(value) => setChannel(0, value)} />
                  <NumberBox label="Green" short="G" value={rgb[1]} min={0} max={255} onValue={(value) => setChannel(1, value)} />
                  <NumberBox label="Blue" short="B" value={rgb[2]} min={0} max={255} onValue={(value) => setChannel(2, value)} />
                </div>
                <div className="grid content-start gap-1.5">
                  <NumberBox label="Lightness" short="L" value={lab.l} min={0} max={100} onValue={(l) => setLab({ l })} />
                  <NumberBox label="Lab a" short="a" value={lab.a} min={-128} max={127} onValue={(a) => setLab({ a })} />
                  <NumberBox label="Lab b" short="b" value={lab.b} min={-128} max={127} onValue={(b) => setLab({ b })} />
                  <div className="h-1" />
                  <label className="grid grid-cols-[1.25rem_1fr_1rem] items-center gap-1 text-xs">
                    <span className="font-medium text-muted-foreground">#</span>
                    <input
                      aria-label="Hex"
                      spellCheck={false}
                      autoComplete="off"
                      maxLength={7}
                      value={hexDraft ?? hex.slice(1)}
                      onChange={(event) => {
                        setHexDraft(event.target.value);
                        const parsed = parseHex(event.target.value);
                        if (parsed && event.target.value.replace("#", "").length === 6) take(parsed);
                      }}
                      onBlur={() => {
                        if (hexDraft !== null) take(hexDraft);
                        setHexDraft(null);
                      }}
                      className="h-7 w-full min-w-0 rounded border border-input bg-background px-1.5 font-mono text-xs"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {(recent.length > 0 || swatches.length > 0) && (
            <div className="grid gap-2">
              {recent.length > 0 && <ColorRow title="Recent" colors={recent} name={(color) => `Recent color ${color}`} onPick={take} />}
              {swatches.length > 0 && <ColorRow title="Swatches" colors={swatches} name={(color) => `Swatch ${color}`} onPick={take} />}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => {
              onChangeRef.current(initial);
              onClose(null);
            }}>
              Cancel
            </Button>
            <Button type="submit">OK</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ColorRow({ title, colors, name, onPick }: { title: string; colors: readonly string[]; name: (color: string) => string; onPick: (color: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{title}</span>
      <div className="flex flex-wrap gap-1">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={name(color)}
            title={color}
            onClick={() => onPick(color)}
            className="h-5 w-5 rounded-sm border border-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/20"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}

interface ColorFieldProps {
  /** Names the swatch and the picker it opens. */
  label: string;
  value: string;
  /** Each change while picking when `live`, and the chosen colour on OK; the old one back on Cancel. */
  onChange: (hex: string) => void;
  /** After OK or Cancel: the change is finished (one undo step). */
  onDone?: () => void;
  /** Show changes while picking (default) or only on OK. */
  live?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * A colour swatch that opens the colour picker, in place of the browser's
 * own colour input. Its `data-color` is the colour it shows.
 */
export function ColorField({ label, value, onChange, onDone, live = true, disabled, className, style, children }: ColorFieldProps) {
  const [opened, setOpened] = useState<string | null>(null);
  // Whether a live change reached the document since the picker opened.
  const previewed = useRef(false);
  const shown = parseHex(value) ?? "#000000";
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={`${label}: ${shown}`}
        data-color={shown}
        disabled={disabled}
        onClick={() => {
          previewed.current = false;
          setOpened(shown);
        }}
        className={cn(
          "h-7 w-12 shrink-0 cursor-pointer rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        style={{ backgroundColor: shown, ...style }}
      >
        {children}
      </button>
      {opened !== null && (
        <ColorPickerDialog
          label={label}
          initial={opened}
          onChange={(hex) => {
            if (!live) return;
            previewed.current = true;
            onChange(hex);
          }}
          onClose={(hex) => {
            setOpened(null);
            const chosen = hex !== null && hex !== opened;
            if (chosen && !live) onChange(hex);
            if (chosen || previewed.current) onDone?.();
          }}
        />
      )}
    </>
  );
}
