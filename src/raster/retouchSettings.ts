import type { ToneRange } from "./retouchPainter";

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
  /** Dodge and burn: the tones they work on. */
  range: ToneRange;
  /** Dodge and burn: strength, 1–100. */
  exposure: number;
  /** Dodge and burn: change brightness only, keeping hues. */
  protectTones: boolean;
  spongeMode: "saturate" | "desaturate";
  /** Sponge: strength, 1–100. */
  spongeFlow: number;
}

export const DEFAULT_RETOUCH_OPTIONS: RetouchOptions = {
  opacity: 100,
  flow: 100,
  aligned: true,
  sampleAll: false,
  range: "midtones",
  exposure: 50,
  protectTones: true,
  spongeMode: "desaturate",
  spongeFlow: 50,
};
