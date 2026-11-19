import { useState } from "react";
import {
  type BlackWhiteSettings,
  type BrightnessContrastSettings,
  type ColorBalanceSettings,
  type ColorShift,
  type ExposureSettings,
  type GradientMapSettings,
  type Histogram,
  type HueSaturationSettings,
  type ToneRange,
} from "@/raster/adjustments";
import { HistogramChart } from "./HistogramChart";
import { CHANNEL_COLORS, Check, OptionRow, ValueSlider } from "./controls";

interface ControlsProps<Settings> {
  settings: Settings;
  onChange: (settings: Settings) => void;
  histogram: Histogram;
}

const signed = (value: number) => (value > 0 ? `+${Math.round(value)}` : String(Math.round(value)));

export function BrightnessContrastControls({ settings, onChange }: ControlsProps<BrightnessContrastSettings>) {
  return (
    <div className="grid gap-2">
      <ValueSlider
        label="Brightness"
        value={settings.brightness}
        min={-150}
        max={150}
        format={signed}
        onChange={(brightness) => onChange({ ...settings, brightness })}
      />
      <ValueSlider
        label="Contrast"
        value={settings.contrast}
        min={-50}
        max={100}
        format={signed}
        onChange={(contrast) => onChange({ ...settings, contrast })}
      />
    </div>
  );
}

// Gamma moves on a log scale, so 1 sits in the middle.
const gammaToSlider = (gamma: number) => Math.round(Math.log10(gamma) * 100);
const sliderToGamma = (position: number) => Math.round(Math.pow(10, position / 100) * 100) / 100;

export function ExposureControls({ settings, onChange }: ControlsProps<ExposureSettings>) {
  return (
    <div className="grid gap-2">
      <ValueSlider
        label="Exposure"
        value={settings.exposure}
        min={-5}
        max={5}
        step={0.05}
        format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`}
        onChange={(exposure) => onChange({ ...settings, exposure })}
      />
      <ValueSlider
        label="Offset"
        value={settings.offset}
        min={-0.5}
        max={0.5}
        step={0.005}
        format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(3)}`}
        onChange={(offset) => onChange({ ...settings, offset })}
      />
      <ValueSlider
        label="Gamma"
        value={gammaToSlider(settings.gamma)}
        min={gammaToSlider(0.1)}
        max={gammaToSlider(9.99)}
        format={(position) => sliderToGamma(position).toFixed(2)}
        onChange={(position) => onChange({ ...settings, gamma: sliderToGamma(position) })}
      />
    </div>
  );
}

export function HueSaturationControls({ settings, onChange }: ControlsProps<HueSaturationSettings>) {
  const { colorize } = settings;
  return (
    <div className="grid gap-2">
      <ValueSlider
        label="Hue"
        value={settings.hue}
        min={colorize ? 0 : -180}
        max={colorize ? 360 : 180}
        format={(value) => (colorize ? `${Math.round(value)}°` : `${signed(value)}°`)}
        onChange={(hue) => onChange({ ...settings, hue })}
      />
      <ValueSlider
        label="Saturation"
        value={settings.saturation}
        min={colorize ? 0 : -100}
        max={100}
        format={colorize ? undefined : signed}
        onChange={(saturation) => onChange({ ...settings, saturation })}
      />
      <ValueSlider
        label="Lightness"
        value={settings.lightness}
        min={-100}
        max={100}
        format={signed}
        onChange={(lightness) => onChange({ ...settings, lightness })}
      />
      <Check
        label="Colorize"
        checked={colorize}
        onChange={(checked) =>
          // As in Photoshop, colorizing starts from a moderate tint.
          onChange(
            checked
              ? { ...settings, colorize: true, hue: settings.hue < 0 ? settings.hue + 360 : settings.hue, saturation: 25 }
              : { ...settings, colorize: false, hue: 0, saturation: 0 }
          )
        }
      />
    </div>
  );
}

const TONES = [
  { value: "shadows", label: "Shadows" },
  { value: "midtones", label: "Midtones" },
  { value: "highlights", label: "Highlights" },
] as const;

const BALANCE_AXES = ["Cyan – Red", "Magenta – Green", "Yellow – Blue"] as const;

export function ColorBalanceControls({ settings, onChange }: ControlsProps<ColorBalanceSettings>) {
  const [tone, setTone] = useState<ToneRange>("midtones");
  const shift = settings[tone];
  return (
    <div className="grid gap-3">
      <OptionRow label="Tone" value={tone} options={TONES} onChange={setTone} />
      <div className="grid gap-2">
        {BALANCE_AXES.map((label, axis) => (
          <ValueSlider
            key={label}
            label={label}
            value={shift[axis]!}
            min={-100}
            max={100}
            format={signed}
            onChange={(value) => {
              const next = [...shift] as ColorShift;
              next[axis] = value;
              onChange({ ...settings, [tone]: next });
            }}
          />
        ))}
      </div>
      <Check
        label="Preserve luminosity"
        checked={settings.preserveLuminosity}
        onChange={(preserveLuminosity) => onChange({ ...settings, preserveLuminosity })}
      />
    </div>
  );
}

const BLACK_WHITE_COLOURS: { key: keyof BlackWhiteSettings; label: string; swatch: string }[] = [
  { key: "reds", label: "Reds", swatch: "#ef4444" },
  { key: "yellows", label: "Yellows", swatch: "#eab308" },
  { key: "greens", label: "Greens", swatch: "#22c55e" },
  { key: "cyans", label: "Cyans", swatch: "#06b6d4" },
  { key: "blues", label: "Blues", swatch: "#3b82f6" },
  { key: "magentas", label: "Magentas", swatch: "#d946ef" },
];

export function BlackWhiteControls({ settings, onChange }: ControlsProps<BlackWhiteSettings>) {
  return (
    <div className="grid gap-2">
      {BLACK_WHITE_COLOURS.map(({ key, label, swatch }) => (
        <div key={key} className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: swatch }} />
          <div className="flex-1">
            <ValueSlider
              label={label}
              value={settings[key]}
              min={-200}
              max={300}
              format={(value) => `${Math.round(value)}%`}
              onChange={(value) => onChange({ ...settings, [key]: value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GradientMapControls({ settings, onChange }: ControlsProps<GradientMapSettings>) {
  const [start, end] = settings.reverse ? [settings.to, settings.from] : [settings.from, settings.to];
  const colour = (label: string, key: "from" | "to") => (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <input
        type="color"
        value={settings[key]}
        onChange={(event) => onChange({ ...settings, [key]: event.target.value })}
        className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
    </label>
  );
  return (
    <div className="grid gap-3">
      <div aria-hidden="true" className="h-6 rounded-md border border-border" style={{ background: `linear-gradient(to right, ${start}, ${end})` }} />
      <div className="flex flex-wrap items-center gap-4">
        {colour("Shadows colour", "from")}
        {colour("Highlights colour", "to")}
      </div>
      <Check label="Reverse" checked={settings.reverse} onChange={(reverse) => onChange({ ...settings, reverse })} />
    </div>
  );
}

export function PosterizeControls({ settings, onChange }: ControlsProps<{ levels: number }>) {
  return (
    <ValueSlider label="Levels" value={settings.levels} min={2} max={64} onChange={(levels) => onChange({ levels })} />
  );
}

export function ThresholdControls({ settings, onChange, histogram }: ControlsProps<{ level: number }>) {
  return (
    <div className="grid gap-2">
      <div className="relative rounded-md border border-border bg-muted/30 p-2">
        <HistogramChart bins={histogram.rgb} color={CHANNEL_COLORS.rgb} className="h-20" />
        <div
          aria-hidden="true"
          className="absolute bottom-2 top-2 w-px bg-primary"
          style={{ left: `calc(0.5rem + (100% - 1rem) * ${settings.level / 255})` }}
        />
      </div>
      <ValueSlider
        label="Threshold level"
        value={settings.level}
        min={1}
        max={255}
        onChange={(level) => onChange({ level })}
      />
    </div>
  );
}
