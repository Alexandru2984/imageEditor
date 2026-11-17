import { describe, expect, it } from "vitest";
import { formatBytes, sanitizeFileName, supportsAlpha } from "./exportImage";
import { normalizeHex } from "@/hooks/useEyedropper";
import { CANVAS_PRESETS, MAX_BLANK_SIDE } from "./starterImages";

describe("sanitizeFileName", () => {
  it("keeps readable names and strips extensions", () => {
    expect(sanitizeFileName("holiday photo.png")).toBe("holiday-photo");
    expect(sanitizeFileName("Vacanță la mare.JPEG")).toBe("Vacanță-la-mare");
  });

  it("removes path separators, control and reserved characters", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeFileName('a<b>c:"d|e?*\u0000f')).toBe("a-b-c-d-e-f");
  });

  it("falls back when nothing usable is left", () => {
    expect(sanitizeFileName("...")).toBe("edited-image");
    expect(sanitizeFileName("", "fallback")).toBe("fallback");
  });

  it("caps very long names", () => {
    expect(sanitizeFileName("x".repeat(500)).length).toBeLessThanOrEqual(80);
  });
});

describe("export helpers", () => {
  it("formats sizes for people", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });

  it("knows which formats keep transparency", () => {
    expect(supportsAlpha("png")).toBe(true);
    expect(supportsAlpha("webp")).toBe(true);
    expect(supportsAlpha("jpeg")).toBe(false);
  });
});

describe("normalizeHex", () => {
  it("accepts the colour notations EyeDropper returns", () => {
    expect(normalizeHex("#A855F7")).toBe("#a855f7");
    expect(normalizeHex("rgb(255, 0, 16)")).toBe("#ff0010");
    expect(normalizeHex("rgba(1, 2, 3, 0.5)")).toBe("#010203");
  });

  it("rejects anything else", () => {
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });
});

describe("canvas presets", () => {
  it("are unique and within the blank-canvas limits", () => {
    expect(new Set(CANVAS_PRESETS.map((preset) => preset.id)).size).toBe(CANVAS_PRESETS.length);
    for (const preset of CANVAS_PRESETS) {
      expect(preset.width).toBeLessThanOrEqual(MAX_BLANK_SIDE);
      expect(preset.height).toBeLessThanOrEqual(MAX_BLANK_SIDE);
      expect(preset.hint).toBe(`${preset.width} × ${preset.height}`);
    }
  });
});
