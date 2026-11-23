import { FabricText, Textbox } from "fabric";

/**
 * Photoshop's Character and Paragraph settings that Fabric's text lacks:
 * superscript and subscript on a range of characters, changing case, and
 * space before and after paragraphs.
 */

/** Fabric's per-character styles: line → character → style. */
export type CharacterStyles = Record<string, Record<string, Record<string, unknown>>>;
export interface CharacterLocation {
  lineIndex: number;
  charIndex: number;
}
export type Script = "superscript" | "subscript";

/** Size and baseline shift of each, as fractions of the font size (Fabric's own). */
export const SCRIPTS: Record<Script, { size: number; baseline: number }> = {
  superscript: { size: 0.6, baseline: -0.35 },
  subscript: { size: 0.6, baseline: 0.11 },
};

const styleAt = (styles: CharacterStyles, { lineIndex, charIndex }: CharacterLocation) => styles[lineIndex]?.[charIndex];

/** The script every character at `locations` is in, or null when they differ or have none. */
export function scriptOf(styles: CharacterStyles | undefined, locations: readonly CharacterLocation[]): Script | null {
  if (!styles || locations.length === 0) return null;
  let found: Script | null = null;
  for (const location of locations) {
    const shift = styleAt(styles, location)?.deltaY;
    const script: Script | null = typeof shift === "number" && shift < 0 ? "superscript" : typeof shift === "number" && shift > 0 ? "subscript" : null;
    if (!script || (found && found !== script)) return null;
    found = script;
  }
  return found;
}

/**
 * The styles with the characters at `locations` set in `script`, or back on
 * the baseline at the text's own size when `script` is null.
 */
export function withScript(
  styles: CharacterStyles | undefined,
  locations: readonly CharacterLocation[],
  fontSize: number,
  script: Script | null
): CharacterStyles {
  const next: CharacterStyles = {};
  for (const [line, characters] of Object.entries(styles ?? {})) {
    next[line] = {};
    for (const [character, style] of Object.entries(characters)) next[line]![character] = { ...style };
  }
  for (const { lineIndex, charIndex } of locations) {
    const line = (next[lineIndex] ??= {});
    const style = { ...(line[charIndex] ?? {}) };
    const scripted = typeof style.deltaY === "number" && style.deltaY !== 0;
    // A character already in a script is measured from the text's size.
    const base = !scripted && typeof style.fontSize === "number" ? style.fontSize : fontSize;
    if (script) {
      style.fontSize = base * SCRIPTS[script].size;
      style.deltaY = base * SCRIPTS[script].baseline;
    } else if (scripted) {
      delete style.fontSize;
      delete style.deltaY;
    }
    if (Object.keys(style).length > 0) line[charIndex] = style;
    else delete line[charIndex];
  }
  for (const [line, characters] of Object.entries(next)) {
    if (Object.keys(characters).length === 0) delete next[line];
  }
  return next;
}

export type TextCase = "upper" | "lower" | "title";

/** The text in another case; the same length, so character styles still fit. */
export function changeCase(text: string, to: TextCase): string {
  const one = (character: string, upper: boolean) => {
    const changed = upper ? character.toLocaleUpperCase() : character.toLocaleLowerCase();
    // "ß" would become "SS": keep such characters as they are.
    return changed.length === character.length ? changed : character;
  };
  let start = true;
  let result = "";
  for (const character of text) {
    const letter = /\p{L}/u.test(character);
    result += to === "upper" ? one(character, true) : to === "lower" ? one(character, false) : letter ? one(character, start) : character;
    if (to === "title") start = !letter && !/['’\p{M}\p{N}]/u.test(character);
  }
  return result;
}

/** Space between paragraphs, the most allowed, in text units. */
export const PARAGRAPH_SPACE_MAX = 1000;

interface ParagraphText {
  paragraphSpaceBefore?: number;
  paragraphSpaceAfter?: number;
  _textLines: unknown[];
}

let installed = false;

/**
 * Space before and after paragraphs. Fabric measures, draws, places the
 * cursor and hit-tests every line through getHeightOfLine, so the space is
 * added to the height of each paragraph's last line (but the text's last).
 */
export function installParagraphSpacing(): void {
  if (installed) return;
  installed = true;
  const layout = FabricText.textLayoutProperties as unknown as string[];
  for (const key of ["paragraphSpaceBefore", "paragraphSpaceAfter"]) {
    if (!layout.includes(key)) layout.push(key);
  }
  const prototype = FabricText.prototype as unknown as {
    getHeightOfLine(this: FabricText & ParagraphText, lineIndex: number): number;
  };
  const original = prototype.getHeightOfLine;
  prototype.getHeightOfLine = function getHeightOfLine(lineIndex) {
    const height = original.call(this, lineIndex);
    const space = (this.paragraphSpaceAfter ?? 0) + (this.paragraphSpaceBefore ?? 0);
    if (!(space > 0) || lineIndex >= this._textLines.length - 1) return height;
    // Point text breaks lines only at paragraphs; a text box also wraps.
    const endsParagraph = this instanceof Textbox ? this.isEndOfWrapping(lineIndex) : true;
    return endsParagraph ? height + space : height;
  };
}
