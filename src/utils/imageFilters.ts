import * as fabric from "fabric";
import type { FabricImage } from "fabric";

// Non-destructive image adjustments. Fabric stores these as a filter stack on
// the image object and re-applies them on demand, so nothing is baked into the
// pixels — the values can always be read back and re-edited.
export interface FilterValues {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  blur: number; // 0..100
  hue: number; // -100..100
}

export const DEFAULT_FILTERS: FilterValues = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
  hue: 0,
};

export const hasAdjustments = (v: FilterValues): boolean =>
  v.brightness !== 0 ||
  v.contrast !== 0 ||
  v.saturation !== 0 ||
  v.blur !== 0 ||
  v.hue !== 0;

/** Rebuild the image's filter stack from slider values (a fixed-order stack). */
export function applyFilterValues(image: FabricImage, v: FilterValues): void {
  image.filters = [
    new fabric.filters.Brightness({ brightness: v.brightness / 100 }),
    new fabric.filters.Contrast({ contrast: v.contrast / 100 }),
    new fabric.filters.Saturation({ saturation: v.saturation / 100 }),
    new fabric.filters.Blur({ blur: v.blur / 100 }),
    new fabric.filters.HueRotation({ rotation: v.hue / 100 }),
  ];
  image.applyFilters();
}

type FilterLike = {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  rotation?: number;
};

/** Read slider values back out of an image's current filter stack. */
export function readFilterValues(
  filters: readonly FilterLike[] | undefined
): FilterValues {
  const out = { ...DEFAULT_FILTERS };
  for (const f of filters ?? []) {
    if (typeof f.brightness === "number")
      out.brightness = Math.round(f.brightness * 100);
    if (typeof f.contrast === "number")
      out.contrast = Math.round(f.contrast * 100);
    if (typeof f.saturation === "number")
      out.saturation = Math.round(f.saturation * 100);
    if (typeof f.blur === "number") out.blur = Math.round(f.blur * 100);
    if (typeof f.rotation === "number") out.hue = Math.round(f.rotation * 100);
  }
  return out;
}
