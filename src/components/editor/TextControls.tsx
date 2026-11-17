import { useState } from "react";
import { Shadow, type FabricObject } from "fabric";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  Italic,
  Underline,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FONT_OPTIONS, cssFontFamily, ensureFontLoaded, isBundledFont } from "@/utils/fonts";
import { TEXT_STYLES, type TextStyleProps } from "@/utils/textStyles";

export type TextObject = FabricObject & {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  underline?: boolean;
  textAlign?: string;
  charSpacing?: number;
  lineHeight?: number;
  textBackgroundColor?: string;
  paintFirst?: string;
  isEditing?: boolean;
  exitEditing?: () => void;
};

export type ApplyMode = "commit" | "schedule";

interface TextControlsProps {
  object: TextObject;
  readOnly: boolean;
  activeColor: string;
  apply: (changes: TextStyleProps, mode: ApplyMode) => void;
  /** Flush a scheduled change into history (slider release, picker close). */
  commit: () => void;
}

const HEX = /^#[0-9a-f]{6}$/i;
const asHex = (value: unknown, fallback: string): string =>
  typeof value === "string" && HEX.test(value) ? value : fallback;

const toggleClass = (active: boolean) =>
  cn(
    "flex h-8 flex-1 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    active
      ? "border-primary bg-primary/15 text-foreground"
      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
  );

const SliderRow = ({
  label,
  value,
  display,
  min,
  max,
  step,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
}) => (
  <div>
    <div className="mb-1.5 flex items-center justify-between">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <span className="text-xs tabular-nums text-muted-foreground">{display}</span>
    </div>
    <Slider
      value={[value]}
      aria-label={label}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => next[0] !== undefined && onChange(next[0])}
      onValueCommit={onCommit}
    />
  </div>
);

export const TextControls = ({ object, readOnly, activeColor, apply, commit }: TextControlsProps) => {
  const [fontsOpen, setFontsOpen] = useState(false);
  const fontSize = object.fontSize ?? 36;
  const family = object.fontFamily ?? "Inter Variable";
  const familyLabel = FONT_OPTIONS.find((font) => font.family === family)?.label ?? family;
  const shadow = object.shadow instanceof Shadow ? object.shadow : null;
  const hasOutline = !!object.stroke && (object.strokeWidth ?? 0) > 0;
  const hasHighlight = !!object.textBackgroundColor;

  const leaveEditing = () => {
    if (object.isEditing) object.exitEditing?.();
  };

  const setFont = async (next: string) => {
    setFontsOpen(false);
    const weight = object.fontWeight ?? 400;
    await ensureFontLoaded(next, weight, object.fontStyle ?? "normal");
    apply({ fontFamily: next }, "commit");
  };

  const applyStyle = async (id: string) => {
    const style = TEXT_STYLES.find((candidate) => candidate.id === id);
    if (!style) return;
    leaveEditing();
    const changes = style.build({ color: activeColor, fontSize });
    const fontFamily = typeof changes.fontFamily === "string" ? changes.fontFamily : family;
    await ensureFontLoaded(
      fontFamily,
      (changes.fontWeight as string | undefined) ?? 400,
      (changes.fontStyle as string | undefined) ?? "normal"
    );
    if (style.uppercase && typeof object.text === "string") {
      changes.text = object.text.toLocaleUpperCase();
    }
    apply(changes, "commit");
  };

  const updateShadow = (patch: Partial<{ color: string; blur: number }>, mode: ApplyMode) => {
    const base = shadow ?? new Shadow({ color: "#000000", blur: 0, offsetX: 0, offsetY: 0 });
    apply(
      {
        shadow: new Shadow({
          color: patch.color ?? base.color,
          blur: patch.blur ?? base.blur,
          offsetX: base.offsetX,
          offsetY: base.offsetY,
        }),
      },
      mode
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="mb-2 block text-xs font-medium text-muted-foreground">Text style</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {TEXT_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              aria-label={`${style.label} text style`}
              disabled={readOnly}
              onClick={() => void applyStyle(style.id)}
              className="h-10 truncate rounded-md border border-border bg-background px-1 text-[13px] text-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ fontFamily: cssFontFamily(style.previewFont) }}
            >
              {style.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Font</Label>
        <Popover open={fontsOpen} onOpenChange={setFontsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Font family"
              disabled={readOnly}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="truncate" style={{ fontFamily: cssFontFamily(family) }}>
                {familyLabel}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-80 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1">
            {!isBundledFont(family) && (
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground">
                <Check className="h-4 w-4" />
                <span className="truncate">{family} (not bundled)</span>
              </div>
            )}
            {FONT_OPTIONS.map((font) => (
              <button
                key={font.family}
                type="button"
                role="option"
                aria-selected={font.family === family}
                onClick={() => void setFont(font.family)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Check className={cn("h-4 w-4 shrink-0", font.family === family ? "opacity-100" : "opacity-0")} />
                <span className="flex-1 truncate text-[15px]" style={{ fontFamily: cssFontFamily(font.family) }}>
                  {font.label}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {font.category}
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <SliderRow
        label="Font size"
        value={Math.round(fontSize)}
        display={`${Math.round(fontSize)}px`}
        min={8}
        max={400}
        step={1}
        disabled={readOnly}
        onChange={(value) => apply({ fontSize: value }, "schedule")}
        onCommit={commit}
      />

      <div className="flex items-center gap-1">
        {(
          [
            ["Bold", Bold, object.fontWeight === "bold" || object.fontWeight === 700, () => ({
              fontWeight: object.fontWeight === "bold" || object.fontWeight === 700 ? "normal" : "bold",
            })],
            ["Italic", Italic, object.fontStyle === "italic", () => ({
              fontStyle: object.fontStyle === "italic" ? "normal" : "italic",
            })],
            ["Underline", Underline, !!object.underline, () => ({ underline: !object.underline })],
          ] as const
        ).map(([label, Icon, active, changes]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={active}
            disabled={readOnly}
            onClick={async () => {
              const next = changes();
              if ("fontWeight" in next || "fontStyle" in next) {
                await ensureFontLoaded(
                  family,
                  "fontWeight" in next ? next.fontWeight : (object.fontWeight ?? 400),
                  "fontStyle" in next ? next.fontStyle : (object.fontStyle ?? "normal")
                );
              }
              apply(next, "commit");
            }}
            className={toggleClass(active)}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <div className="mx-0.5 h-6 w-px bg-border" />
        {(
          [
            ["left", AlignLeft],
            ["center", AlignCenter],
            ["right", AlignRight],
          ] as const
        ).map(([align, Icon]) => (
          <button
            key={align}
            type="button"
            aria-label={`Align text ${align}`}
            aria-pressed={object.textAlign === align}
            disabled={readOnly}
            onClick={() => apply({ textAlign: align }, "commit")}
            className={toggleClass(object.textAlign === align)}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SliderRow
          label="Letter spacing"
          value={Math.round(object.charSpacing ?? 0)}
          display={`${Math.round(object.charSpacing ?? 0)}`}
          min={-100}
          max={800}
          step={10}
          disabled={readOnly}
          onChange={(value) => apply({ charSpacing: value }, "schedule")}
          onCommit={commit}
        />
        <SliderRow
          label="Line height"
          value={Math.round((object.lineHeight ?? 1.16) * 100)}
          display={(object.lineHeight ?? 1.16).toFixed(2)}
          min={70}
          max={300}
          step={5}
          disabled={readOnly}
          onChange={(value) => apply({ lineHeight: value / 100 }, "schedule")}
          onCommit={commit}
        />
      </div>

      <div className="space-y-2.5">
        <Label className="block text-xs font-medium text-muted-foreground">Effects</Label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={hasOutline}
            disabled={readOnly}
            onClick={() =>
              apply(
                hasOutline
                  ? { stroke: null, strokeWidth: 0, paintFirst: "fill" }
                  : {
                      stroke: activeColor === "#000000" ? "#ffffff" : "#000000",
                      strokeWidth: Math.max(1.5, Math.round(fontSize * 0.06 * 10) / 10),
                      paintFirst: "stroke",
                    },
                "commit"
              )
            }
            className={cn(toggleClass(hasOutline), "flex-none px-3 text-xs")}
          >
            Outline
          </button>
          {hasOutline && (
            <>
              <input
                type="color"
                aria-label="Outline color"
                disabled={readOnly}
                value={asHex(object.stroke, "#000000")}
                onChange={(event) => apply({ stroke: event.target.value }, "schedule")}
                onBlur={commit}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              />
              <Slider
                aria-label="Outline width"
                disabled={readOnly}
                className="flex-1"
                value={[object.strokeWidth ?? 0]}
                min={0.5}
                max={Math.max(4, Math.round(fontSize * 0.3))}
                step={0.5}
                onValueChange={(value) =>
                  value[0] !== undefined && apply({ strokeWidth: value[0] }, "schedule")
                }
                onValueCommit={commit}
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={!!shadow}
            disabled={readOnly}
            onClick={() =>
              apply(
                {
                  shadow: shadow
                    ? null
                    : new Shadow({
                        color: "#000000",
                        blur: Math.round(fontSize * 0.2),
                        offsetX: Math.round(fontSize * 0.05),
                        offsetY: Math.round(fontSize * 0.05),
                      }),
                },
                "commit"
              )
            }
            className={cn(toggleClass(!!shadow), "flex-none px-3 text-xs")}
          >
            Shadow
          </button>
          {shadow && (
            <>
              <input
                type="color"
                aria-label="Shadow color"
                disabled={readOnly}
                value={asHex(shadow.color, "#000000")}
                onChange={(event) => updateShadow({ color: event.target.value }, "schedule")}
                onBlur={commit}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              />
              <Slider
                aria-label="Shadow blur"
                disabled={readOnly}
                className="flex-1"
                value={[shadow.blur]}
                min={0}
                max={Math.max(20, Math.round(fontSize))}
                step={1}
                onValueChange={(value) =>
                  value[0] !== undefined && updateShadow({ blur: value[0] }, "schedule")
                }
                onValueCommit={commit}
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={hasHighlight}
            disabled={readOnly}
            onClick={() =>
              apply(
                { textBackgroundColor: hasHighlight ? "" : activeColor === "#ffffff" ? "#000000" : "#fde047" },
                "commit"
              )
            }
            className={cn(toggleClass(hasHighlight), "flex-none px-3 text-xs")}
          >
            Highlight
          </button>
          {hasHighlight && (
            <input
              type="color"
              aria-label="Highlight color"
              disabled={readOnly}
              value={asHex(object.textBackgroundColor, "#fde047")}
              onChange={(event) => apply({ textBackgroundColor: event.target.value }, "schedule")}
              onBlur={commit}
              className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            />
          )}
        </div>
      </div>
    </div>
  );
};
