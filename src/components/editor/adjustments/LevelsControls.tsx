import { useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GAMMA_RANGE,
  autoLevels,
  type Channel,
  type Histogram,
  type LevelsChannel,
  type LevelsSettings,
} from "@/raster/adjustments";
import { HistogramChart } from "./HistogramChart";
import { CHANNEL_COLORS, CHANNEL_OPTIONS, OptionRow, ValueSlider } from "./controls";

// The midtones slider runs over log10(gamma), so 1 sits in the middle.
const toSlider = (gamma: number) => Math.round(Math.log10(gamma) * 100);
const toGamma = (position: number) =>
  Math.min(GAMMA_RANGE.max, Math.max(GAMMA_RANGE.min, Math.round(Math.pow(10, position / 100) * 100) / 100));

export function LevelsControls({
  settings,
  onChange,
  histogram,
}: {
  settings: LevelsSettings;
  onChange: (settings: LevelsSettings) => void;
  histogram: Histogram;
}) {
  const [channel, setChannel] = useState<Channel>("rgb");
  const levels = settings[channel];
  const update = (change: Partial<LevelsChannel>) =>
    onChange({ ...settings, [channel]: { ...levels, ...change } });

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <OptionRow label="Channel" value={channel} options={CHANNEL_OPTIONS} onChange={setChannel} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => onChange(autoLevels(histogram))}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Auto
        </Button>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-2">
        <HistogramChart bins={histogram[channel]} color={CHANNEL_COLORS[channel]} className="h-24" />
        <div
          aria-hidden="true"
          className="mt-1 h-2 rounded-sm"
          style={{
            background: `linear-gradient(to right, black, ${channel === "rgb" ? "white" : channel})`,
          }}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-xs font-medium">Input levels</span>
        <ValueSlider
          label="Shadows"
          value={levels.inBlack}
          min={0}
          max={levels.inWhite - 2}
          onChange={(inBlack) => update({ inBlack })}
        />
        <ValueSlider
          label="Midtones"
          value={toSlider(levels.gamma)}
          min={toSlider(GAMMA_RANGE.min)}
          max={toSlider(GAMMA_RANGE.max)}
          format={(position) => toGamma(position).toFixed(2)}
          onChange={(position) => update({ gamma: toGamma(position) })}
        />
        <ValueSlider
          label="Highlights"
          value={levels.inWhite}
          min={levels.inBlack + 2}
          max={255}
          onChange={(inWhite) => update({ inWhite })}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-xs font-medium">Output levels</span>
        <ValueSlider
          label="Output shadows"
          value={levels.outBlack}
          min={0}
          max={255}
          onChange={(outBlack) => update({ outBlack })}
        />
        <ValueSlider
          label="Output highlights"
          value={levels.outWhite}
          min={0}
          max={255}
          onChange={(outWhite) => update({ outWhite })}
        />
      </div>
    </div>
  );
}
