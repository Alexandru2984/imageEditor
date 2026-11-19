import { describe, expect, it } from "vitest";
import { initializeCanvas, writePsd, type Psd } from "ag-psd";
import { blendFromPsd, blendToPsd, decodePsd } from "./psdDocument";

const solid = (width: number, height: number, rgba: [number, number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set(rgba, index * 4);
  return { width, height, data, colorSpace: "srgb" } as ImageData;
};

// Writing needs only pixel arrays too.
initializeCanvas(
  () => {
    throw new Error("no canvas");
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" }) as ImageData
);

describe("decodePsd", () => {
  it("reads layers bottom to top with their place, opacity, blend, visibility, mask and the guides", () => {
    const mask = solid(2, 2, [0, 0, 0, 255]);
    const psd: Psd = {
      width: 8,
      height: 6,
      imageResources: { gridAndGuidesInformation: { guides: [{ location: 3, direction: "vertical" }, { location: 2.5, direction: "horizontal" }] } },
      children: [
        { name: "Bottom", left: 0, top: 0, right: 8, bottom: 6, imageData: solid(8, 6, [255, 0, 0, 255]) },
        {
          name: "Group",
          opacity: 0.5,
          children: [
            {
              name: "Top",
              left: 2,
              top: 1,
              right: 5,
              bottom: 3,
              opacity: 0.5,
              blendMode: "multiply",
              hidden: true,
              imageData: solid(3, 2, [0, 0, 255, 255]),
              mask: { left: 3, top: 1, right: 5, bottom: 3, defaultColor: 255, imageData: mask },
            },
          ],
        },
      ],
    };
    const decoded = decodePsd(writePsd(psd, { generateThumbnail: false }));
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(6);
    expect(decoded.layers.map((layer) => layer.name)).toEqual(["Bottom", "Top"]);
    const [bottom, top] = decoded.layers;
    expect([...bottom!.pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(top).toMatchObject({ left: 2, top: 1, width: 3, height: 2, visible: false, blend: "multiply" });
    expect(top!.opacity).toBeCloseTo(0.25, 2);
    expect([...top!.pixels.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    expect(top!.mask).toMatchObject({ left: 3, top: 1, width: 2, height: 2, outside: 255, enabled: true });
    expect([...top!.mask!.grey]).toEqual([0, 0, 0, 0]);
    expect(decoded.guides).toEqual([
      { axis: "x", position: 3 },
      { axis: "y", position: 2.5 },
    ]);
    expect(decoded.composite).toBeUndefined();
  });

  it("opens a flattened file from its composite, and turns away oversized ones", () => {
    const flat = decodePsd(writePsd({ width: 4, height: 3, imageData: solid(4, 3, [10, 20, 30, 255]) }, { generateThumbnail: false }));
    expect(flat.layers).toEqual([]);
    expect([...flat.composite!.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    const huge = writePsd({ width: 9000, height: 2, imageData: solid(9000, 2, [0, 0, 0, 255]) }, { generateThumbnail: false });
    expect(() => decodePsd(huge)).toThrow(/too large/);
    expect(() => decodePsd(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow();
  });

  it("maps blend modes both ways", () => {
    expect(blendFromPsd("color dodge")).toBe("color-dodge");
    expect(blendFromPsd("linear burn")).toBeNull();
    expect(blendFromPsd(undefined)).toBe("source-over");
    expect(blendToPsd("soft-light")).toBe("soft light");
    expect(blendToPsd("source-over")).toBe("normal");
    expect(blendToPsd("lighter")).toBe("normal");
  });
});
