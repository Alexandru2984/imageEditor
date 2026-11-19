/** Settings of the retouching tools (sizes come from the brush's). */
export interface RetouchOptions {
  /** Clone stamp: cap on a stroke, 1–100. */
  opacity: number;
  /** Clone stamp: build-up per dab, 1–100. */
  flow: number;
  /** Keep the source moving with the brush from stroke to stroke. */
  aligned: boolean;
  /** Copy from everything visible instead of the layer alone. */
  sampleAll: boolean;
}

export const DEFAULT_RETOUCH_OPTIONS: RetouchOptions = {
  opacity: 100,
  flow: 100,
  aligned: true,
  sampleAll: false,
};
