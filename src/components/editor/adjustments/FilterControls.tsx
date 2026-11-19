import type { EmbossSettings, NoiseSettings, UnsharpSettings } from "@/raster/filters";
import type { Histogram } from "@/raster/adjustments";
import { Check, LogSlider, OptionRow, ValueSlider } from "./controls";

interface ControlsProps<Settings> {
  settings: Settings;
  onChange: (settings: Settings) => void;
  histogram: Histogram;
}

const degrees = (value: number) => `${Math.round(value)}°`;
const percent = (value: number) => `${Math.round(value)}%`;

export function GaussianBlurControls({ settings, onChange }: ControlsProps<{ radius: number }>) {
  return <LogSlider label="Radius" value={settings.radius} min={0.1} max={250} onChange={(radius) => onChange({ radius })} />;
}

export function HighPassControls({ settings, onChange }: ControlsProps<{ radius: number }>) {
  return <LogSlider label="Radius" value={settings.radius} min={0.1} max={250} onChange={(radius) => onChange({ radius })} />;
}

export function MotionBlurControls({ settings, onChange }: ControlsProps<{ angle: number; distance: number }>) {
  return (
    <div className="grid gap-2">
      <ValueSlider
        label="Angle"
        value={settings.angle}
        min={-90}
        max={90}
        format={degrees}
        onChange={(angle) => onChange({ ...settings, angle })}
      />
      <LogSlider
        label="Distance"
        value={settings.distance}
        min={1}
        max={500}
        onChange={(distance) => onChange({ ...settings, distance })}
      />
    </div>
  );
}

export function UnsharpMaskControls({ settings, onChange }: ControlsProps<UnsharpSettings>) {
  return (
    <div className="grid gap-2">
      <ValueSlider
        label="Amount"
        value={settings.amount}
        min={1}
        max={500}
        format={percent}
        onChange={(amount) => onChange({ ...settings, amount })}
      />
      <LogSlider label="Radius" value={settings.radius} min={0.1} max={250} onChange={(radius) => onChange({ ...settings, radius })} />
      <ValueSlider
        label="Threshold"
        value={settings.threshold}
        min={0}
        max={255}
        format={(value) => `${Math.round(value)} levels`}
        onChange={(threshold) => onChange({ ...settings, threshold })}
      />
    </div>
  );
}

const DISTRIBUTIONS = [
  { value: "uniform", label: "Uniform" },
  { value: "gaussian", label: "Gaussian" },
] as const;

export function AddNoiseControls({ settings, onChange }: ControlsProps<NoiseSettings>) {
  return (
    <div className="grid gap-3">
      <ValueSlider
        label="Amount"
        value={settings.amount}
        min={1}
        max={400}
        format={percent}
        onChange={(amount) => onChange({ ...settings, amount })}
      />
      <OptionRow
        label="Distribution"
        value={settings.distribution}
        options={DISTRIBUTIONS}
        onChange={(distribution) => onChange({ ...settings, distribution })}
      />
      <Check
        label="Monochromatic"
        checked={settings.monochromatic}
        onChange={(monochromatic) => onChange({ ...settings, monochromatic })}
      />
    </div>
  );
}

export function MosaicControls({ settings, onChange }: ControlsProps<{ size: number }>) {
  return (
    <ValueSlider
      label="Cell size"
      value={settings.size}
      min={2}
      max={200}
      format={(value) => `${Math.round(value)} px`}
      onChange={(size) => onChange({ size })}
    />
  );
}

export function EmbossControls({ settings, onChange }: ControlsProps<EmbossSettings>) {
  return (
    <div className="grid gap-2">
      <ValueSlider
        label="Angle"
        value={settings.angle}
        min={-180}
        max={180}
        format={degrees}
        onChange={(angle) => onChange({ ...settings, angle })}
      />
      <ValueSlider
        label="Height"
        value={settings.height}
        min={1}
        max={10}
        format={(value) => `${Math.round(value)} px`}
        onChange={(height) => onChange({ ...settings, height })}
      />
      <ValueSlider
        label="Amount"
        value={settings.amount}
        min={1}
        max={500}
        format={percent}
        onChange={(amount) => onChange({ ...settings, amount })}
      />
    </div>
  );
}
