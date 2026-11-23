import { describe, expect, it } from "vitest";
import { changeCase, scriptOf, withScript, type CharacterLocation } from "./typography";

const at = (lineIndex: number, ...chars: number[]): CharacterLocation[] => chars.map((charIndex) => ({ lineIndex, charIndex }));

describe("superscript and subscript", () => {
  it("shrink and raise or lower the characters, and put them back", () => {
    const styles = withScript({ 0: { 0: { fill: "#ff0000" } } }, at(0, 0, 1), 40, "superscript");
    expect(styles).toEqual({ 0: { 0: { fill: "#ff0000", fontSize: 24, deltaY: -14 }, 1: { fontSize: 24, deltaY: -14 } } });
    expect(scriptOf(styles, at(0, 0, 1))).toBe("superscript");
    expect(scriptOf(styles, at(0, 0, 1, 2))).toBeNull();
    // Switching scripts measures from the text's own size, not the small one.
    const lowered = withScript(styles, at(0, 0, 1), 40, "subscript");
    expect(lowered[0]![1]).toEqual({ fontSize: 24, deltaY: 40 * 0.11 });
    expect(scriptOf(lowered, at(0, 1))).toBe("subscript");
    // Back on the baseline: other styles stay, empty ones go.
    expect(withScript(lowered, at(0, 0, 1), 40, null)).toEqual({ 0: { 0: { fill: "#ff0000" } } });
    // The styles given are left as they were.
    expect(styles[0]![1]).toEqual({ fontSize: 24, deltaY: -14 });
  });

  it("start from a character's own size", () => {
    expect(withScript({ 1: { 2: { fontSize: 20 } } }, at(1, 2), 40, "superscript")).toEqual({ 1: { 2: { fontSize: 12, deltaY: -7 } } });
    expect(scriptOf(undefined, at(0, 0))).toBeNull();
    expect(scriptOf({}, [])).toBeNull();
  });
});

describe("change case", () => {
  it("keeps the length, so character styles still fit", () => {
    expect(changeCase("Hello wörld, it's 2 PM", "upper")).toBe("HELLO WÖRLD, IT'S 2 PM");
    expect(changeCase("Hello WÖRLD", "lower")).toBe("hello wörld");
    expect(changeCase("the QUICK brown-fox's tale", "title")).toBe("The Quick Brown-Fox's Tale");
    expect(changeCase("straße", "upper")).toBe("STRAßE");
  });
});
