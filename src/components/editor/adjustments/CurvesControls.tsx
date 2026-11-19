import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  CHANNELS,
  CURVE_PRESETS,
  MAX_CURVE_POINTS,
  curveLut,
  defaultCurves,
  isLinearCurve,
  type Channel,
  type CurvePoint,
  type CurvesSettings,
  type Histogram,
} from "@/raster/adjustments";
import { histogramPath } from "./histogramPath";
import { CHANNEL_COLORS, CHANNEL_OPTIONS, OptionRow } from "./controls";

/** The graph's drawing area, in levels, with room for points on the edges. */
const PAD = 6;
const SIZE = 256 + PAD * 2;
/** How close (in levels) a press must be to grab a point. */
const GRAB = 10;
/** Dragging a point this far past the graph removes it. */
const REMOVE_BEYOND = 16;

const CURVE_STROKES: Record<Channel, string> = {
  rgb: "hsl(var(--foreground))",
  red: "rgb(239 68 68)",
  green: "rgb(34 197 94)",
  blue: "rgb(59 130 246)",
};

const clampLevel = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

function pathOf(points: readonly CurvePoint[]) {
  const lut = curveLut(points);
  let d = "";
  for (let x = 0; x < 256; x += 1) d += `${x === 0 ? "M" : "L"}${x} ${255 - lut[x]!}`;
  return d;
}

/** How far a point may move sideways: between its neighbours. */
function xLimits(points: readonly CurvePoint[], index: number) {
  return {
    min: index === 0 ? 0 : points[index - 1]![0] + 1,
    max: index === points.length - 1 ? 255 : points[index + 1]![0] - 1,
  };
}

export function CurvesControls({
  settings,
  onChange,
  histogram,
}: {
  settings: CurvesSettings;
  onChange: (settings: CurvesSettings) => void;
  histogram: Histogram;
}) {
  const ids = useId();
  const [channel, setChannel] = useState<Channel>("rgb");
  const [selected, setSelected] = useState<number | null>(null);
  const graph = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointerId: number; index: number } | null>(null);
  const points = settings[channel];

  const setPoints = (next: CurvePoint[]) => onChange({ ...settings, [channel]: next });

  const levelAt = (event: PointerEvent) => {
    const box = graph.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * SIZE - PAD,
      y: 255 - (((event.clientY - box.top) / box.height) * SIZE - PAD),
    };
  };

  const movePoint = (index: number, x: number, y: number) => {
    const { min, max } = xLimits(points, index);
    const next = [...points];
    next[index] = [Math.min(max, Math.max(min, clampLevel(x))), clampLevel(y)];
    setPoints(next);
  };

  const removePoint = (index: number) => {
    // The end points stay, as in Photoshop.
    if (index === 0 || index === points.length - 1) return;
    setPoints(points.filter((_, at) => at !== index));
    setSelected(null);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const { x, y } = levelAt(event);
    let index = points.findIndex((point) => Math.hypot(point[0] - x, point[1] - y) <= GRAB);
    if (index < 0) {
      const level = clampLevel(x);
      const same = points.findIndex((point) => point[0] === level);
      if (same >= 0) {
        index = same;
      } else {
        if (points.length >= MAX_CURVE_POINTS) return;
        const next = [...points, [level, clampLevel(y)] as const].sort((a, b) => a[0] - b[0]);
        index = next.findIndex((point) => point[0] === level);
        setPoints(next);
      }
    }
    setSelected(index);
    drag.current = { pointerId: event.pointerId, index };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const { x, y } = levelAt(event);
    const interior = current.index > 0 && current.index < points.length - 1;
    const outside = x < -REMOVE_BEYOND || x > 255 + REMOVE_BEYOND || y < -REMOVE_BEYOND || y > 255 + REMOVE_BEYOND;
    if (interior && outside) {
      drag.current = null;
      removePoint(current.index);
      return;
    }
    movePoint(current.index, x, y);
  };

  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (selected === null || !points[selected]) return;
    const step = event.shiftKey ? 10 : 1;
    const [x, y] = points[selected]!;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move) {
      movePoint(selected, x + move[0], y + move[1]);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      removePoint(selected);
    } else {
      return;
    }
    event.preventDefault();
  };

  const presetId =
    CURVE_PRESETS.find(
      (preset) =>
        JSON.stringify(preset.points) === JSON.stringify(settings.rgb) &&
        CHANNELS.every((other) => other === "rgb" || isLinearCurve(settings[other]))
    )?.id ?? "custom";

  const shadows = useMemo(
    () =>
      channel === "rgb"
        ? (["red", "green", "blue"] as const).filter((other) => !isLinearCurve(settings[other]))
        : [],
    [channel, settings]
  );

  const histogramLine = useMemo(() => histogramPath(histogram[channel], 255), [histogram, channel]);
  const point = selected !== null ? points[selected] : undefined;
  const numberField = (label: string, value: number | undefined, onValue: (value: number) => void) => (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        min={0}
        max={255}
        disabled={value === undefined}
        value={value ?? ""}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(next)) onValue(next);
        }}
        className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs tabular-nums text-foreground disabled:opacity-50"
      />
    </label>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OptionRow
          label="Channel"
          value={channel}
          options={CHANNEL_OPTIONS}
          onChange={(next) => {
            setChannel(next);
            setSelected(null);
          }}
        />
        <label htmlFor={`${ids}-preset`} className="sr-only">
          Preset
        </label>
        <select
          id={`${ids}-preset`}
          value={presetId}
          onChange={(event) => {
            const preset = CURVE_PRESETS.find((option) => option.id === event.target.value);
            if (!preset) return;
            onChange({ ...defaultCurves(), rgb: [...preset.points] });
            setChannel("rgb");
            setSelected(null);
          }}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          {presetId === "custom" && <option value="custom">Custom</option>}
          {CURVE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <svg
        ref={graph}
        role="application"
        aria-label="Curve"
        aria-describedby={`${ids}-help`}
        tabIndex={0}
        viewBox={`${-PAD} ${-PAD} ${SIZE} ${SIZE}`}
        className="aspect-square w-full max-w-[18rem] cursor-crosshair touch-none justify-self-center rounded-md border border-border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <path d={histogramLine} fill={CHANNEL_COLORS[channel]} />
        {[64, 128, 192].map((line) => (
          <g key={line} stroke="hsl(var(--border))" strokeWidth={1}>
            <line x1={line} y1={0} x2={line} y2={255} />
            <line x1={0} y1={line} x2={255} y2={line} />
          </g>
        ))}
        <rect x={0} y={0} width={255} height={255} fill="none" stroke="hsl(var(--border))" />
        <line x1={0} y1={255} x2={255} y2={0} stroke="hsl(var(--muted-foreground) / 0.35)" strokeWidth={1} />
        {shadows.map((other) => (
          <path key={other} d={pathOf(settings[other])} fill="none" stroke={CURVE_STROKES[other]} strokeOpacity={0.5} strokeWidth={1.5} />
        ))}
        <path d={pathOf(points)} fill="none" stroke={CURVE_STROKES[channel]} strokeWidth={2} />
        {points.map(([x, y], index) => (
          <rect
            key={`${index}-${x}`}
            x={x - 4}
            y={255 - y - 4}
            width={8}
            height={8}
            fill={index === selected ? CURVE_STROKES[channel] : "hsl(var(--background))"}
            stroke={CURVE_STROKES[channel]}
            strokeWidth={1.5}
          />
        ))}
      </svg>
      <p id={`${ids}-help`} className="text-[11px] leading-snug text-muted-foreground">
        Click the curve to add a point and drag it. Drag a point off the graph, or press Delete, to remove it; arrow
        keys nudge it.
      </p>
      <div className="flex items-center gap-4">
        {numberField("Input", point?.[0], (value) => selected !== null && movePoint(selected, value, point![1]))}
        {numberField("Output", point?.[1], (value) => selected !== null && movePoint(selected, point![0], value))}
      </div>
    </div>
  );
}
