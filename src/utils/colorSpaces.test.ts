import { describe, expect, it } from "vitest";
import { hexToRgb, hsbToRgb, labToRgb, parseHex, rgbToHex, rgbToHsb, rgbToLab, type Rgb } from "./colorSpaces";

const round = (lab: { l: number; a: number; b: number }) => [Math.round(lab.l), Math.round(lab.a), Math.round(lab.b)];

describe("colour models", () => {
  it("reads hex as typed in a field, and nothing else", () => {
    expect(parseHex("#ABC")).toBe("#aabbcc");
    expect(parseHex(" 12ab3F ")).toBe("#12ab3f");
    for (const bad of ["", "#12", "#12345", "#1234567", "red", "#ggg", "rgb(1,2,3)"]) expect(parseHex(bad), bad).toBeNull();
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("nonsense")).toEqual([0, 0, 0]);
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
    expect(rgbToHex([300, -4, 12.6])).toBe("#ff000d");
  });

  it("gives Photoshop's HSB numbers", () => {
    expect(rgbToHsb([255, 0, 0])).toEqual({ h: 0, s: 100, b: 100 });
    expect(rgbToHsb([0, 128, 255])).toMatchObject({ s: 100, b: 100 });
    expect(Math.round(rgbToHsb([0, 128, 255]).h)).toBe(210);
    expect(rgbToHsb([128, 128, 128])).toEqual({ h: 0, s: 0, b: (128 / 255) * 100 });
    expect(hsbToRgb({ h: 120, s: 100, b: 50 })).toEqual([0, 128, 0]);
    expect(hsbToRgb({ h: 360, s: 100, b: 100 })).toEqual([255, 0, 0]);
  });

  it("goes round from RGB through HSB and back exactly", () => {
    for (let index = 0; index < 2000; index += 1) {
      const rgb: Rgb = [(index * 37) % 256, (index * 101) % 256, (index * 211) % 256];
      expect(hsbToRgb(rgbToHsb(rgb))).toEqual(rgb);
    }
  });

  it("gives Photoshop's Lab numbers (D50)", () => {
    expect(round(rgbToLab([255, 255, 255]))).toEqual([100, 0, 0]);
    expect(round(rgbToLab([0, 0, 0]))).toEqual([0, 0, 0]);
    expect(round(rgbToLab([255, 0, 0]))).toEqual([54, 81, 70]);
    expect(round(rgbToLab([0, 255, 0]))).toEqual([88, -79, 81]);
    expect(round(rgbToLab([0, 0, 255]))).toEqual([30, 68, -112]);
  });

  it("goes round from RGB through Lab and back, and says when Lab leaves sRGB", () => {
    for (let index = 0; index < 2000; index += 1) {
      const rgb: Rgb = [(index * 53) % 256, (index * 97) % 256, (index * 193) % 256];
      const back = labToRgb(rgbToLab(rgb));
      expect(back.rgb).toEqual(rgb);
      expect(back.inGamut).toBe(true);
    }
    const outside = labToRgb({ l: 50, a: 127, b: -127 });
    expect(outside.inGamut).toBe(false);
    expect(outside.rgb.every((channel) => channel >= 0 && channel <= 255)).toBe(true);
  });
});
