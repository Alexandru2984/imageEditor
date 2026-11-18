import type { Command } from "./types";

/** Lower case, without accents or a trailing ellipsis, for matching. */
export const normalizeText = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/…$/, "")
    .toLowerCase()
    .trim();

const wordsOf = (text: string): string[] => normalizeText(text).split(/[^a-z0-9%°]+/).filter(Boolean);

/**
 * How well one query word fits a command: the start of a label word beats
 * the middle of the label, which beats a keyword. 0 means no match.
 */
function termScore(term: string, label: string, labelWords: string[], keywordWords: string[]): number {
  if (labelWords.some((word) => word === term)) return 6;
  if (labelWords.some((word) => word.startsWith(term))) return 4;
  if (label.includes(term)) return 2;
  if (keywordWords.some((word) => word.startsWith(term))) return 1;
  return 0;
}

/**
 * Commands matching every word of the query, best first; ties keep the
 * given order. An empty query lists them all.
 */
export function searchCommands(commands: readonly Command[], query: string): Command[] {
  const terms = wordsOf(query);
  if (terms.length === 0) return [...commands];
  const scored: { command: Command; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const label = normalizeText(command.label);
    const labelWords = wordsOf(command.label);
    const keywordWords = wordsOf(command.keywords ?? "");
    let score = 0;
    for (const term of terms) {
      const value = termScore(term, label, labelWords, keywordWords);
      if (value === 0) return;
      score += value;
    }
    // The whole query at the start of the label reads as the intended command.
    if (label.startsWith(normalizeText(query))) score += 3;
    scored.push({ command, score, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}
