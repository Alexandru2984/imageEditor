import { useState } from "react";
import { Shadow, type FabricObject } from "fabric";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Check,
  ChevronDown,
  Italic,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FONT_OPTIONS, cssFontFamily, ensureFontLoaded, isBundledFont } from "@/utils/fonts";
import { TEXT_STYLES, type TextStyleProps } from "@/utils/textStyles";
import { ColorField } from "./ColorPicker";
import {
  PARAGRAPH_SPACE_MAX,
  changeCase,
  scriptOf,
  withScript,
  type CharacterLocation,
  type CharacterStyles,
} from "@/text/typography";

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
  linethrough?: boolean;
  styles?: CharacterStyles;
  paragraphSpaceBefore?: number;
  paragraphSpaceAfter?: number;
  /** Type on a path: the path the letters follow, and where and how they sit on it. */
  path?: { segmentsInfo?: { length: number }[] } | null;
  pathStartOffset?: number;
  pathSide?: string;
  pathAlign?: string;
  /** Fabric's letter boxes; those past the end of an open path are hidden (src/text/textOnPath.ts). */
  __charBounds?: ({ pastPathEnd?: boolean } | undefined)[][];
  isEditing?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  get2DCursorLocation?: (index: number, skipWrapping?: boolean) => CharacterLocation;
  exitEditing?: () => void;
};

export type ApplyMode = "commit" | "schedule";

/** Where the letters sit on their path, as Photoshop's Type on Path options name it. */
const PATH_ALIGNMENTS = [
  { value: "baseline", label: "Baseline", title: "The letters stand on the path" },
  { value: "center", label: "Center", title: "The path runs through the letters' middle" },
  { value: "ascender", label: "Top", title: "The letters hang from the path (ascender)" },
  { value: "descender", label: "Bottom", title: "The path runs under the letters' tails (descender)" },
] as const;

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

/** A justify icon: full lines, the last one placed as `last` says. */
const justifyIcon = (last: "left" | "center" | "right" | "full") => {
  const x = { left: 2, center: 5, right: 8, full: 2 }[last];
  const width = last === "full" ? 12 : 6;
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <path d="M2 3.5h12M2 7h12M2 10.5h12" />
      <path d={`M${x} 14h${width}`} />
    </svg>
  );
};

/** Photoshop's seven paragraph alignments. */
const ALIGNMENTS = [
  { value: "left", label: "Align text left", icon: <AlignLeft className="h-3.5 w-3.5" /> },
  { value: "center", label: "Align text center", icon: <AlignCenter className="h-3.5 w-3.5" /> },
  { value: "right", label: "Align text right", icon: <AlignRight className="h-3.5 w-3.5" /> },
  { value: "justify-left", label: "Justify last left", icon: justifyIcon("left") },
  { value: "justify-center", label: "Justify last centered", icon: justifyIcon("center") },
  { value: "justify-right", label: "Justify last right", icon: justifyIcon("right") },
  { value: "justify", label: "Justify all", icon: justifyIcon("full") },
] as const;

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

  /** Where superscript and subscript apply: the selected characters while editing, else all. */
  const scriptRange = (): CharacterLocation[] => {
    const length = typeof object.text === "string" ? object.text.length : 0;
    let start = 0;
    let end = length;
    if (object.isEditing && (object.selectionEnd ?? 0) > (object.selectionStart ?? 0)) {
      start = object.selectionStart ?? 0;
      end = object.selectionEnd ?? length;
    }
    const locate = object.get2DCursorLocation?.bind(object);
    if (!locate) return [];
    const locations: CharacterLocation[] = [];
    for (let index = start; index < end; index += 1) {
      const location = locate(index, true);
      // Line breaks take no style.
      if (object.text?.[index] !== "\n") locations.push({ lineIndex: location.lineIndex, charIndex: location.charIndex });
    }
    return locations;
  };
  const script = scriptOf(object.styles, scriptRange());

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

      <div className="space-y-3">
        <Label className="block text-xs font-medium text-muted-foreground">Character</Label>
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
              ["Strikethrough", Strikethrough, !!object.linethrough, () => ({ linethrough: !object.linethrough })],
            ] as const
          ).map(([label, Icon, active, changes]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
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
              ["superscript", "Superscript", Superscript],
              ["subscript", "Subscript", Subscript],
            ] as const
          ).map(([kind, label, Icon]) => (
            <button
              key={kind}
              type="button"
              aria-label={label}
              title={object.isEditing ? `${label} (the selected characters)` : label}
              aria-pressed={script === kind}
              disabled={readOnly || !object.get2DCursorLocation}
              onClick={() => apply({ styles: withScript(object.styles, scriptRange(), fontSize, script === kind ? null : kind) }, "commit")}
              className={toggleClass(script === kind)}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {(
            [
              ["upper", "Uppercase", CaseUpper],
              ["lower", "Lowercase", CaseLower],
              ["title", "Title case", CaseSensitive],
            ] as const
          ).map(([to, label, Icon]) => (
            <button
              key={to}
              type="button"
              aria-label={label}
              title={`Change to ${label.toLowerCase()}`}
              disabled={readOnly}
              onClick={() => {
                if (typeof object.text !== "string") return;
                leaveEditing();
                const text = changeCase(object.text, to);
                if (text !== object.text) apply({ text }, "commit");
              }}
              className={cn(toggleClass(false), "gap-1 text-xs")}
            >
              <Icon className="h-4 w-4" />
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
      </div>

      <div className="space-y-3">
        <Label className="block text-xs font-medium text-muted-foreground">Paragraph</Label>
        <div role="radiogroup" aria-label="Paragraph alignment" className="flex items-center gap-1">
          {ALIGNMENTS.map(({ value, label, icon }) => {
            const active = (object.textAlign ?? "left") === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-label={label}
                title={label}
                aria-checked={active}
                disabled={readOnly}
                onClick={() => apply({ textAlign: value }, "commit")}
                className={toggleClass(active)}
              >
                {icon}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["paragraphSpaceBefore", "Space before paragraph", "Before"],
              ["paragraphSpaceAfter", "Space after paragraph", "After"],
            ] as const
          ).map(([key, label, short]) => (
            <label key={key} className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{short}</span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  aria-label={label}
                  disabled={readOnly}
                  min={0}
                  max={PARAGRAPH_SPACE_MAX}
                  step={1}
                  value={Math.round(object[key] ?? 0)}
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    if (Number.isFinite(value)) apply({ [key]: Math.min(PARAGRAPH_SPACE_MAX, Math.max(0, value)) }, "schedule");
                  }}
                  onBlur={commit}
                  className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-right text-xs tabular-nums disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground">px</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {object.path && (
        <div role="region" aria-label="Type on Path" className="space-y-3">
          <Label className="block text-xs font-medium text-muted-foreground">Type on Path</Label>
          {(() => {
            const hidden = (object.__charBounds ?? []).reduce((count, line) => count + line.filter((box) => box?.pastPathEnd).length, 0);
            return hidden > 0 ? (
              <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
                {hidden === 1 ? "1 letter runs" : `${hidden} letters run`} past the end of the path and {hidden === 1 ? "is" : "are"} hidden.
              </p>
            ) : null;
          })()}
          <SliderRow
            label="Position on the path"
            value={Math.round(object.pathStartOffset ?? 0)}
            display={`${Math.round(object.pathStartOffset ?? 0)}px`}
            min={0}
            max={Math.max(1, Math.round(object.path.segmentsInfo?.at(-1)?.length ?? 1000))}
            step={1}
            disabled={readOnly}
            onChange={(value) => apply({ pathStartOffset: value }, "schedule")}
            onCommit={commit}
          />
          <div role="radiogroup" aria-label="Letters sit on the path at their" className="flex items-center gap-1">
            {PATH_ALIGNMENTS.map(({ value, label, title }) => {
              const active = (object.pathAlign ?? "baseline") === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={title}
                  disabled={readOnly}
                  onClick={() => apply({ pathAlign: value }, "commit")}
                  className={cn(toggleClass(active), "min-w-0 px-1 text-xs")}
                >
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={object.pathSide === "right"}
              title="The letters cross to the other side of the path and run the other way"
              disabled={readOnly}
              onClick={() => apply({ pathSide: object.pathSide === "right" ? "left" : "right" }, "commit")}
              className={cn(toggleClass(object.pathSide === "right"), "px-2 text-xs")}
            >
              Flip side
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                leaveEditing();
                apply({ path: undefined, pathStartOffset: 0, pathSide: "left", pathAlign: "baseline" }, "commit");
              }}
              className={cn(toggleClass(false), "px-2 text-xs")}
            >
              Release from path
            </button>
          </div>
        </div>
      )}

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
              <ColorField
                label="Outline color"
                disabled={readOnly}
                value={asHex(object.stroke, "#000000")}
                onChange={(color) => apply({ stroke: color }, "schedule")}
                onDone={commit}
                className="h-8 w-8"
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
              <ColorField
                label="Shadow color"
                disabled={readOnly}
                value={asHex(shadow.color, "#000000")}
                onChange={(color) => updateShadow({ color }, "schedule")}
                onDone={commit}
                className="h-8 w-8"
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
            <ColorField
              label="Highlight color"
              disabled={readOnly}
              value={asHex(object.textBackgroundColor, "#fde047")}
              onChange={(color) => apply({ textBackgroundColor: color }, "schedule")}
              onDone={commit}
              className="h-8 w-8"
            />
          )}
        </div>
      </div>
    </div>
  );
};
