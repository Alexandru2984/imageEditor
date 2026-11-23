import { describe, expect, it } from "vitest";
import { plannedFiles, scaleOf, sizeSuffix } from "./exportPlan";

describe("Export As file plans", () => {
  it("names sizes as Photoshop does", () => {
    expect(sizeSuffix({ scale: 1 })).toBe("");
    expect(sizeSuffix({ scale: 2 })).toBe("@2x");
    expect(sizeSuffix({ scale: 0.5 })).toBe("@0.5x");
    expect(sizeSuffix({ width: 1200 })).toBe("-1200w");
    expect(scaleOf({ width: 1200 }, 800)).toBe(1.5);
    expect(scaleOf({ scale: 0.25 }, 800)).toBe(0.25);
  });

  it("makes one file per layer and size, with safe, distinct names", () => {
    const files = plannedFiles(
      "holiday photo",
      "png",
      [
        { label: "Sky", target: 1 },
        { label: "../Sky", target: 2 },
        { label: "Text: Hello!", target: 3 },
      ],
      [{ scale: 1 }, { scale: 2 }]
    );
    expect(files.map((file) => file.name)).toEqual([
      "holiday-photo-Sky.png",
      "holiday-photo-Sky@2x.png",
      "holiday-photo-Sky-2.png",
      "holiday-photo-Sky@2x-2.png",
      "holiday-photo-Text-Hello.png",
      "holiday-photo-Text-Hello@2x.png",
    ]);
    expect(files.map((file) => file.target)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("names a file of one size as the dialog shows it, whatever the size", () => {
    expect(plannedFiles("holiday photo", "webp", [{ label: null, target: 0 }], [{ scale: 0.5 }]).map((file) => file.name)).toEqual([
      "holiday-photo.webp",
    ]);
    expect(plannedFiles("p", "png", [{ label: "Sky", target: 0 }], [{ width: 300 }]).map((file) => file.name)).toEqual(["p-Sky.png"]);
  });

  it("names the document alone after the file name", () => {
    expect(plannedFiles("", "avif", [{ label: null, target: 0 }], [{ scale: 0.5 }, { width: 640 }]).map((file) => file.name)).toEqual([
      "edited-image@0.5x.avif",
      "edited-image-640w.avif",
    ]);
  });
});
