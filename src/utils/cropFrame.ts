import type { Box } from "./snapping";

export type CropRatioId = "free" | "original" | "1:1" | "4:5" | "3:2" | "16:9" | "9:16";

export interface CropRatioOption {
  id: CropRatioId;
  label: string;
  /** What the shape is typically used for, shown as a tooltip. */
  hint: string;
  /** Width ÷ height; null for free, "original" for the photo's own shape. */
  ratio: number | null | "original";
}

export const CROP_RATIOS: CropRatioOption[] = [
  { id: "free", label: "Free", hint: "Any shape", ratio: null },
  { id: "original", label: "Original", hint: "Keep the photo's shape", ratio: "original" },
  { id: "1:1", label: "1:1", hint: "Square post, profile picture", ratio: 1 },
  { id: "4:5", label: "4:5", hint: "Portrait post", ratio: 4 / 5 },
  { id: "3:2", label: "3:2", hint: "Classic photo print", ratio: 3 / 2 },
  { id: "16:9", label: "16:9", hint: "Widescreen, video thumbnail", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", hint: "Story, reel, short", ratio: 9 / 16 },
];

/** The largest box of the given width÷height ratio centred inside `area`. */
export function fitRatio(area: Box, ratio: number): Box {
  if (!(ratio > 0) || !(area.width > 0) || !(area.height > 0)) return { ...area };
  let width = area.width;
  let height = width / ratio;
  if (height > area.height) {
    height = area.height;
    width = height * ratio;
  }
  return {
    left: area.left + (area.width - width) / 2,
    top: area.top + (area.height - height) / 2,
    width,
    height,
  };
}

/** Resolve an option to a numeric ratio for a photo of the given box. */
export function resolveRatio(option: CropRatioOption, photo: Box): number | null {
  if (option.ratio === "original") return photo.height > 0 ? photo.width / photo.height : null;
  return option.ratio;
}
