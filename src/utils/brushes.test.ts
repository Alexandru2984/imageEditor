import { describe, expect, it } from "vitest";
import { tint, withAlpha } from "./brushes";

describe("brush colours", () => {
  it("adds alpha to hex colours and leaves others alone", () => {
    expect(withAlpha("#ff8000", 0.45)).toBe("rgba(255, 128, 0, 0.45)");
    expect(withAlpha("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
  });

  it("tints toward white", () => {
    expect(tint("#000000", 0.5)).toBe("#808080");
    expect(tint("#ff0000", 0)).toBe("#ff0000");
    expect(tint("#3b82f6", 1)).toBe("#ffffff");
  });
});
