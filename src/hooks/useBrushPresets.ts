import { useSyncExternalStore } from "react";
import { DEFAULT_DYNAMICS, type BrushDynamics, type BrushPreset } from "@/raster/brushEngine";
import type { PaintOptions } from "@/raster/paintSettings";
import { brushPresets, subscribeBrushPresets } from "@/utils/brushPresets";

/** Every brush preset, kept up to date. */
export const useBrushPresets = () => useSyncExternalStore(subscribeBrushPresets, brushPresets, brushPresets);

/** The paint options a preset sets (opacity stays as it was, as in Photoshop). */
export const presetChange = (preset: BrushPreset): Partial<PaintOptions> => ({
  size: preset.size,
  hardness: preset.hardness,
  flow: preset.flow,
  dynamics: { ...preset.dynamics },
  tipId: preset.tipId,
});

const sameDynamics = (a: BrushDynamics, b: BrushDynamics) =>
  (Object.keys(DEFAULT_DYNAMICS) as (keyof BrushDynamics)[]).every((key) => a[key] === b[key]);

/** Whether the brush is set as `preset` sets it. */
export const isPresetApplied = (paint: PaintOptions, preset: BrushPreset) =>
  paint.size === preset.size &&
  paint.hardness === preset.hardness &&
  paint.flow === preset.flow &&
  paint.tipId === preset.tipId &&
  sameDynamics(paint.dynamics, preset.dynamics);
