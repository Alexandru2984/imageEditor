/**
 * What a fill layer shows, as plain data: saved with the project, kept in
 * the history, read from and written to Photoshop files (in a worker, so
 * nothing here needs the page). fillLayer.ts is the layer itself.
 */

export type GradientStyle = "linear" | "radial" | "reflected";
export const GRADIENT_STYLES: readonly GradientStyle[] = ["linear", "radial", "reflected"];

export type FillContent =
  | { kind: "solid"; color: string }
  | {
      kind: "gradient";
      /** The colour at the gradient's start, then its end. */
      from: string;
      to: string;
      style: GradientStyle;
      /** Degrees, counter-clockwise from pointing right (90: from the bottom up). */
      angle: number;
      /** Percent of the document's reach. */
      scale: number;
      reverse: boolean;
    };

export type FillKind = FillContent["kind"];

export const FILL_TITLES: Record<FillKind, string> = { solid: "Color Fill", gradient: "Gradient Fill" };

export const MIN_GRADIENT_SCALE = 10;
export const MAX_GRADIENT_SCALE = 150;

const HEX = /^#[0-9a-f]{6}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const colorOf = (value: unknown): string | null =>
  typeof value === "string" && HEX.test(value.toLowerCase()) ? value.toLowerCase() : null;

/**
 * A fill layer's content from a file or an undo step, value by value; null
 * when anything is not what the editor makes. Unknown keys are dropped.
 */
export function readFill(value: unknown): FillContent | null {
  if (!isRecord(value)) return null;
  if (value.kind === "solid") {
    const color = colorOf(value.color);
    return color ? { kind: "solid", color } : null;
  }
  if (value.kind !== "gradient") return null;
  const from = colorOf(value.from);
  const to = colorOf(value.to);
  const style = GRADIENT_STYLES.find((candidate) => candidate === value.style);
  if (!from || !to || !style || typeof value.reverse !== "boolean") return null;
  if (!isNumberIn(value.angle, -180, 180) || !isNumberIn(value.scale, MIN_GRADIENT_SCALE, MAX_GRADIENT_SCALE)) return null;
  return { kind: "gradient", from, to, style, angle: value.angle, scale: value.scale, reverse: value.reverse };
}

/** A new fill layer's content, from the colour wells as Photoshop starts it. */
export function initialFill(kind: FillKind, colors: { foreground: string; background: string }): FillContent {
  const foreground = colorOf(colors.foreground) ?? "#000000";
  const background = colorOf(colors.background) ?? "#ffffff";
  if (kind === "solid") return { kind, color: foreground };
  return { kind, from: foreground, to: background, style: "linear", angle: 90, scale: 100, reverse: false };
}

/** A CSS picture of the content, for the Layers panel. */
export function fillSwatch(content: FillContent): string {
  if (content.kind === "solid") return content.color;
  const [from, to] = content.reverse ? [content.to, content.from] : [content.from, content.to];
  if (content.style === "radial") return `radial-gradient(circle, ${from}, ${to})`;
  // CSS angles go clockwise from pointing up.
  const css = 90 - content.angle;
  if (content.style === "reflected") return `linear-gradient(${css}deg, ${to}, ${from}, ${to})`;
  return `linear-gradient(${css}deg, ${from}, ${to})`;
}
