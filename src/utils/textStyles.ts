import { Shadow } from "fabric";

/** Properties a text style may set on a Fabric text object. */
export type TextStyleProps = Record<string, unknown>;

export interface TextStylePreset {
  id: string;
  label: string;
  /** Font used to render the preset button itself. */
  previewFont: string;
  uppercase?: boolean;
  build: (context: { color: string; fontSize: number }) => TextStyleProps;
}

/** Everything a style may have set before, so styles never stack up. */
const CLEAN: TextStyleProps = {
  fontWeight: "normal",
  fontStyle: "normal",
  underline: false,
  stroke: null,
  strokeWidth: 0,
  paintFirst: "fill",
  shadow: null,
  textBackgroundColor: "",
  charSpacing: 0,
};

const outlineWidth = (fontSize: number, ratio: number) =>
  Math.max(1.5, Math.round(fontSize * ratio * 10) / 10);

export const TEXT_STYLES: TextStylePreset[] = [
  {
    id: "plain",
    label: "Plain",
    previewFont: "Inter Variable",
    build: ({ color }) => ({ ...CLEAN, fontFamily: "Inter Variable", fill: color }),
  },
  {
    id: "meme",
    label: "Meme",
    previewFont: "Anton",
    uppercase: true,
    build: ({ fontSize }) => ({
      ...CLEAN,
      fontFamily: "Anton",
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: outlineWidth(fontSize, 0.08),
      paintFirst: "stroke",
      textAlign: "center",
      charSpacing: 20,
    }),
  },
  {
    id: "outline",
    label: "Outline",
    previewFont: "Montserrat",
    build: ({ color, fontSize }) => ({
      ...CLEAN,
      fontFamily: "Montserrat",
      fontWeight: "bold",
      fill: color,
      stroke: "#ffffff",
      strokeWidth: outlineWidth(fontSize, 0.07),
      paintFirst: "stroke",
    }),
  },
  {
    id: "neon",
    label: "Neon",
    previewFont: "Pacifico",
    build: ({ color, fontSize }) => ({
      ...CLEAN,
      fontFamily: "Pacifico",
      fill: "#ffffff",
      shadow: new Shadow({ color, blur: Math.round(fontSize * 0.5), offsetX: 0, offsetY: 0 }),
    }),
  },
  {
    id: "label",
    label: "Label",
    previewFont: "Montserrat",
    build: ({ color }) => ({
      ...CLEAN,
      fontFamily: "Montserrat",
      fontWeight: "bold",
      fill: "#ffffff",
      textBackgroundColor: color,
    }),
  },
  {
    id: "poster",
    label: "Poster",
    previewFont: "Bebas Neue",
    uppercase: true,
    build: ({ color, fontSize }) => ({
      ...CLEAN,
      fontFamily: "Bebas Neue",
      fill: color,
      charSpacing: 60,
      shadow: new Shadow({
        color: "rgba(0,0,0,0.35)",
        blur: Math.round(fontSize * 0.12),
        offsetX: Math.round(fontSize * 0.04),
        offsetY: Math.round(fontSize * 0.04),
      }),
    }),
  },
  {
    id: "marker",
    label: "Marker",
    previewFont: "Permanent Marker",
    build: ({ color }) => ({ ...CLEAN, fontFamily: "Permanent Marker", fill: color }),
  },
  {
    id: "elegant",
    label: "Elegant",
    previewFont: "Playfair Display",
    build: ({ color }) => ({
      ...CLEAN,
      fontFamily: "Playfair Display",
      fontStyle: "italic",
      fill: color,
    }),
  },
];
