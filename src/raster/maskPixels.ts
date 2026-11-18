/**
 * A layer mask is kept as a grey image (white shows the layer, black hides
 * it) so every paint tool works on it unchanged. Drawing needs it as alpha:
 * white pixels whose opacity is the grey. Transparent mask pixels, as the
 * eraser leaves them, read as white.
 */
export function greyToAlpha(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3]!;
    // Rec. 601 luma, in integers.
    const grey = (pixels[offset]! * 77 + pixels[offset + 1]! * 150 + pixels[offset + 2]! * 29 + 128) >> 8;
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = Math.round((grey * alpha + 255 * (255 - alpha)) / 255);
  }
}

/** The grey of a colour as a hex colour, for painting on a mask. */
export function greyOf(color: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return "#000000";
  const value = parseInt(match[1]!, 16);
  const grey = (((value >> 16) & 255) * 77 + ((value >> 8) & 255) * 150 + (value & 255) * 29 + 128) >> 8;
  const hex = grey.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}
