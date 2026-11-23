import { describe, expect, it } from "vitest";
import { letterSpan, lettersPastTheEnd } from "./textOnPath";

describe("letterSpan", () => {
  it("puts the letters on the side of the path their alignment says", () => {
    // Baseline: above the path but for the descent.
    expect(letterSpan("baseline", 100, 0.222)).toEqual([-77.8, 22.2].map((value) => expect.closeTo(value, 6)));
    expect(letterSpan(undefined, 100, 0.222)).toEqual(letterSpan("baseline", 100, 0.222));
    expect(letterSpan("center", 40, 0.222)).toEqual([-20, 20]);
    // Hanging from the path, and standing with their tails on it.
    expect(letterSpan("ascender", 40, 0.222)).toEqual([0, 40]);
    expect(letterSpan("descender", 40, 0.222)).toEqual([-40, 0]);
  });
});

describe("lettersPastTheEnd", () => {
  const widths = [10, 10, 10, 10];
  it("hides the letters that run past the end of the path", () => {
    expect(lettersPastTheEnd(widths, 100, "left", false, 0)).toEqual([false, false, false, false]);
    expect(lettersPastTheEnd(widths, 25, "left", false, 0)).toEqual([false, false, true, true]);
    // Moved along: the last ones fall off.
    expect(lettersPastTheEnd(widths, 40, "left", false, 15)).toEqual([false, false, true, true]);
  });
  it("hides both ends of centred text, and the start of right-aligned text", () => {
    expect(lettersPastTheEnd(widths, 20, "center", false, 0)).toEqual([true, false, false, true]);
    expect(lettersPastTheEnd(widths, 25, "right", false, 0)).toEqual([true, true, false, false]);
  });
  it("runs flipped text back from the end of the path", () => {
    // Flipped, left-aligned text ends at the path's start: the first letters fit.
    expect(lettersPastTheEnd(widths, 25, "left", true, 0)).toEqual([false, false, true, true]);
    expect(lettersPastTheEnd(widths, 100, "left", true, 0)).toEqual([false, false, false, false]);
  });
});
