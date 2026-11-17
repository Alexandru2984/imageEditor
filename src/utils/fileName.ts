/** A filesystem-safe base name; falls back when the user clears the field. */
export function sanitizeFileName(name: string, fallback = "edited-image"): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

/** The base name of an uploaded file, made safe for downloads. */
export const documentNameFromFile = (file: File): string =>
  sanitizeFileName(file.name.replace(/\.[^.]+$/, ""), "edited-image");
