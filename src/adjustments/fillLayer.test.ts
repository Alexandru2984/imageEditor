import { describe, expect, it } from "vitest";
import { fillSwatch, initialFill, readFill } from "./fillLayer";

describe("fill layer content", () => {
  it("reads what the editor makes, dropping keys it does not know", () => {
    expect(readFill({ kind: "solid", color: "#AABBCC", extra: 1 })).toEqual({ kind: "solid", color: "#aabbcc" });
    const gradient = { kind: "gradient", from: "#000000", to: "#ffffff", style: "reflected", angle: 180, scale: 10, reverse: false };
    expect(readFill({ ...gradient, dither: true })).toEqual(gradient);
  });

  it("rejects anything else", () => {
    const gradient = { kind: "gradient", from: "#000000", to: "#ffffff", style: "linear", angle: 0, scale: 100, reverse: false };
    for (const bad of [
      null,
      "solid",
      [],
      { kind: "solid" },
      { kind: "solid", color: "#fff" },
      { kind: "solid", color: "#ffffff;background:url(x)" },
      { ...gradient, style: "angle" },
      { ...gradient, angle: Number.NaN },
      { ...gradient, angle: -181 },
      { ...gradient, scale: 9 },
      { ...gradient, scale: 151 },
      { ...gradient, reverse: "no" },
      { ...gradient, from: undefined },
    ]) {
      expect(readFill(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("starts from the colour wells, as Photoshop does", () => {
    const colors = { foreground: "#112233", background: "#FFEEDD" };
    expect(initialFill("solid", colors)).toEqual({ kind: "solid", color: "#112233" });
    expect(initialFill("gradient", colors)).toEqual({
      kind: "gradient",
      from: "#112233",
      to: "#ffeedd",
      style: "linear",
      angle: 90,
      scale: 100,
      reverse: false,
    });
    expect(initialFill("solid", { foreground: "not a colour", background: "" })).toEqual({ kind: "solid", color: "#000000" });
  });

  it("pictures the content in CSS for the Layers panel", () => {
    expect(fillSwatch({ kind: "solid", color: "#123456" })).toBe("#123456");
    const gradient = { kind: "gradient", from: "#000000", to: "#ffffff", style: "linear", angle: 90, scale: 100, reverse: false } as const;
    // 90°, from the bottom up: CSS's 0deg.
    expect(fillSwatch(gradient)).toBe("linear-gradient(0deg, #000000, #ffffff)");
    expect(fillSwatch({ ...gradient, reverse: true })).toBe("linear-gradient(0deg, #ffffff, #000000)");
    expect(fillSwatch({ ...gradient, style: "radial" })).toBe("radial-gradient(circle, #000000, #ffffff)");
    expect(fillSwatch({ ...gradient, style: "reflected", angle: 0 })).toBe("linear-gradient(90deg, #ffffff, #000000, #ffffff)");
  });
});
