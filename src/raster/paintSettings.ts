/** Settings shared by the pixel brush and eraser; sizes are in image pixels. */
export interface PaintOptions {
  size: number;
  /** 0–100 */
  hardness: number;
  /** 0–100 */
  opacity: number;
  /** 0–100 */
  flow: number;
}

export const DEFAULT_PAINT_OPTIONS: PaintOptions = { size: 30, hardness: 80, opacity: 100, flow: 100 };

export const PAINT_SIZE_MIN = 1;
export const PAINT_SIZE_MAX = 1000;
/** Positions on the size slider, which is logarithmic so small sizes stay precise. */
export const PAINT_SLIDER_STEPS = 1000;

const clampSize = (size: number) => Math.min(PAINT_SIZE_MAX, Math.max(PAINT_SIZE_MIN, size));

export const paintSizeToSlider = (size: number): number =>
  Math.round(
    (Math.log(clampSize(size) / PAINT_SIZE_MIN) / Math.log(PAINT_SIZE_MAX / PAINT_SIZE_MIN)) *
      PAINT_SLIDER_STEPS
  );

export const sliderToPaintSize = (position: number): number =>
  clampSize(
    Math.round(
      PAINT_SIZE_MIN *
        (PAINT_SIZE_MAX / PAINT_SIZE_MIN) **
          (Math.min(PAINT_SLIDER_STEPS, Math.max(0, position)) / PAINT_SLIDER_STEPS)
    )
  );

// Photoshop's [ and ] steps: finer while the brush is small.
const SIZE_STEPS: [below: number, step: number][] = [
  [10, 1],
  [100, 10],
  [200, 25],
  [500, 50],
  [Infinity, 100],
];

export function stepPaintSize(size: number, direction: 1 | -1): number {
  const probe = direction > 0 ? size : size - 1;
  const step = SIZE_STEPS.find(([below]) => probe < below)![1];
  const next =
    direction > 0 ? Math.floor(size / step) * step + step : Math.ceil(size / step) * step - step;
  return clampSize(next);
}
