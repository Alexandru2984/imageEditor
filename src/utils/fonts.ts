// Self-hosted typefaces for text layers. Importing the stylesheets only
// declares @font-face rules; browsers download a file the first time a
// glyph range is actually used, so unused fonts cost nothing.
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/anton/400.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/permanent-marker/400.css";
import "@fontsource/pacifico/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/700.css";
import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/700.css";

import type { Canvas as FabricCanvas, FabricObject } from "fabric";

export interface FontOption {
  family: string;
  label: string;
  category: "Sans" | "Serif" | "Display" | "Handwriting" | "Mono";
}

export const DEFAULT_TEXT_FONT = "Inter Variable";

export const FONT_OPTIONS: FontOption[] = [
  { family: "Inter Variable", label: "Inter", category: "Sans" },
  { family: "Montserrat", label: "Montserrat", category: "Sans" },
  { family: "Playfair Display", label: "Playfair Display", category: "Serif" },
  { family: "Anton", label: "Anton", category: "Display" },
  { family: "Bebas Neue", label: "Bebas Neue", category: "Display" },
  { family: "Permanent Marker", label: "Permanent Marker", category: "Handwriting" },
  { family: "Pacifico", label: "Pacifico", category: "Handwriting" },
  { family: "Caveat", label: "Caveat", category: "Handwriting" },
  { family: "Roboto Mono", label: "Roboto Mono", category: "Mono" },
];

const KNOWN_FAMILIES = new Set(FONT_OPTIONS.map((font) => font.family));

export const isBundledFont = (family: string | undefined): boolean =>
  !!family && KNOWN_FAMILIES.has(family);

/** CSS font-family value for previews (quoted, with a fallback). */
export const cssFontFamily = (family: string): string =>
  `"${family.replace(/["\\]/g, "")}", ui-sans-serif, system-ui, sans-serif`;

/**
 * Make sure a bundled font face is ready before text is measured with it.
 * Unknown families resolve immediately: the canvas falls back to a system
 * font and nothing is fetched.
 */
export async function ensureFontLoaded(
  family: string,
  weight: string | number = 400,
  style = "normal"
): Promise<boolean> {
  if (!isBundledFont(family) || typeof document === "undefined" || !document.fonts) return false;
  const descriptor = `${style} ${weight} 32px "${family}"`;
  try {
    if (document.fonts.check(descriptor)) return false;
    await document.fonts.load(descriptor);
    return true;
  } catch {
    return false;
  }
}

type TextLike = FabricObject & {
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  initDimensions?: () => void;
};

const collectText = (objects: FabricObject[], out: TextLike[]) => {
  for (const object of objects) {
    const text = object as TextLike;
    if (typeof text.fontFamily === "string") out.push(text);
    const children = (object as unknown as { _objects?: FabricObject[] })._objects;
    if (Array.isArray(children)) collectText(children, out);
  }
  return out;
};

/**
 * Load every bundled font used by the document's text layers, then
 * re-measure those layers. Text measured with a fallback font would have the
 * wrong width and selection box until the next edit.
 */
export async function loadDocumentFonts(canvas: FabricCanvas, objects?: FabricObject[]) {
  const texts = collectText(objects ?? canvas.getObjects(), []);
  if (texts.length === 0) return;
  const loads = await Promise.all(
    texts.map((text) =>
      ensureFontLoaded(text.fontFamily ?? "", text.fontWeight ?? 400, text.fontStyle ?? "normal")
    )
  );
  if (!loads.some(Boolean) || canvas.disposed || canvas.destroyed) return;
  for (const text of texts) {
    text.initDimensions?.();
    text.setCoords();
    text.dirty = true;
  }
  canvas.requestRenderAll();
}
