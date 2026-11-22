import { describe, expect, it } from "vitest";
import { initializeCanvas, writePsd, type Psd } from "ag-psd";
import { blendFromPsd, blendToPsd, decodePsd, encodePsd, nestLayers, type DecodedGroup, type DecodedLayer } from "./psdDocument";

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
    // The group as the editor keeps it: its end, its layers, its header.
    expect(decoded.layers.map((layer) => (layer.kind === "end" ? "]" : layer.name))).toEqual(["Bottom", "]", "Top", "Group"]);
    const [bottom, , top, group] = decoded.layers as [DecodedLayer, unknown, DecodedLayer, DecodedGroup];
    expect([...bottom.pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(top).toMatchObject({ left: 2, top: 1, width: 3, height: 2, visible: false, blend: "multiply", clipped: false, fill: 1 });
    expect(top.opacity).toBeCloseTo(0.5, 2);
    expect(group).toMatchObject({ kind: "group", visible: true, passThrough: true });
    expect(group.opacity).toBeCloseTo(0.5, 2);
    expect([...top.pixels.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    expect(top.mask).toMatchObject({ left: 3, top: 1, width: 2, height: 2, outside: 255, enabled: true });
    expect([...top.mask!.grey]).toEqual([0, 0, 0, 0]);
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
    // Photoshop's own, which the compositor blends itself.
    expect(blendFromPsd("linear burn")).toBe("linear-burn");
    expect(blendFromPsd("dissolve")).toBe("dissolve");
    expect(blendToPsd("vivid-light")).toBe("vivid light");
    expect(blendToPsd("hard-mix")).toBe("hard mix");
    // Ones the editor has nothing like.
    expect(blendFromPsd("linear height")).toBeNull();
    expect(blendFromPsd(undefined)).toBe("source-over");
    expect(blendToPsd("soft-light")).toBe("soft light");
    expect(blendToPsd("source-over")).toBe("normal");
    expect(blendToPsd("lighter")).toBe("normal");
  });

  it("writes what it reads back: layers with their settings, the composite and the guides", () => {
    const pixels = (width: number, height: number, rgba: [number, number, number, number]) => solid(width, height, rgba).data;
    const written = encodePsd({
      width: 6,
      height: 4,
      layers: [
        { kind: "layer", name: "Background", left: 0, top: 0, width: 6, height: 4, opacity: 1, visible: true, blend: "source-over", pixels: pixels(6, 4, [255, 255, 255, 255]), clipped: false, fill: 1 },
        { kind: "layer", name: "Spot", left: 1, top: 2, width: 2, height: 1, opacity: 0.4, visible: false, blend: "screen", pixels: pixels(2, 1, [0, 128, 0, 255]), clipped: false, fill: 1 },
      ],
      composite: pixels(6, 4, [255, 255, 255, 255]),
      guides: [{ axis: "y", position: 2 }],
    });
    const back = decodePsd(written);
    const layers = back.layers as DecodedLayer[];
    expect(layers.map(({ name, left, top, width, height, visible, blend }) => ({ name, left, top, width, height, visible, blend }))).toEqual([
      { name: "Background", left: 0, top: 0, width: 6, height: 4, visible: true, blend: "source-over" },
      { name: "Spot", left: 1, top: 2, width: 2, height: 1, visible: false, blend: "screen" },
    ]);
    expect(layers[1]!.opacity).toBeCloseTo(0.4, 2);
    expect([...layers[1]!.pixels.slice(0, 4)]).toEqual([0, 128, 0, 255]);
    expect(back.guides).toEqual([{ axis: "y", position: 2 }]);
  });

  it("writes and reads back groups, clipping, Fill and a layer without pixels", () => {
    const pixels = (width: number, height: number, rgba: [number, number, number, number]) => solid(width, height, rgba).data;
    const layer = (name: string, extra: Partial<DecodedLayer> = {}): DecodedLayer => ({
      kind: "layer",
      name,
      left: 0,
      top: 0,
      width: 2,
      height: 2,
      opacity: 1,
      visible: true,
      blend: "source-over",
      pixels: pixels(2, 2, [9, 9, 9, 255]),
      clipped: false,
      fill: 1,
      ...extra,
    });
    const group = (name: string, extra: Partial<DecodedGroup> = {}): DecodedGroup => ({
      kind: "group",
      name,
      opacity: 1,
      visible: true,
      passThrough: true,
      blend: "source-over",
      collapsed: false,
      ...extra,
    });
    const written = encodePsd({
      width: 4,
      height: 4,
      layers: [
        layer("Photo", { width: 4, height: 4, pixels: pixels(4, 4, [255, 255, 255, 255]) }),
        { kind: "end" },
        layer("Base", { width: 0, height: 0, pixels: new Uint8ClampedArray(0) }),
        layer("Clipped", { clipped: true, fill: 0.25 }),
        { kind: "end" },
        layer("Inner"),
        group("Inside", { passThrough: false, blend: "multiply", collapsed: true }),
        group("Outside", { opacity: 0.5, visible: false }),
      ],
      composite: pixels(4, 4, [255, 255, 255, 255]),
      guides: [],
    });
    const back = decodePsd(written).layers;
    expect(back.map((entry) => (entry.kind === "end" ? "]" : entry.name))).toEqual([
      "Photo",
      "]",
      "Clipped",
      "]",
      "Inner",
      "Inside",
      "Outside",
    ]);
    // A layer without pixels has no size to open; the clipped one still is.
    expect(back[2]).toMatchObject({ kind: "layer", clipped: true });
    expect((back[2] as DecodedLayer).fill).toBeCloseTo(0.25, 2);
    expect(back[5]).toMatchObject({ kind: "group", passThrough: false, blend: "multiply", collapsed: true });
    expect(back[6]).toMatchObject({ kind: "group", passThrough: true, visible: false, collapsed: false });
    expect((back[6] as DecodedGroup).opacity).toBeCloseTo(0.5, 2);
  });

  it("nests the flat list as Photoshop does, and flattens groups nested too deep", () => {
    expect(nestLayers([{ kind: "end" }, { kind: "group", name: "G", opacity: 1, visible: true, passThrough: true, blend: "source-over", collapsed: false }])).toEqual([
      { name: "G", opacity: 1, hidden: false, blendMode: "pass through", opened: true, children: [] },
    ]);
    let nested: Psd["children"] = [{ name: "Deepest", left: 0, top: 0, right: 1, bottom: 1, imageData: solid(1, 1, [1, 2, 3, 255]) }];
    for (let level = 0; level < 12; level += 1) nested = [{ name: `G${level}`, opacity: level === 11 ? 1 : 0.5, children: nested }];
    const decoded = decodePsd(writePsd({ width: 1, height: 1, children: nested }, { generateThumbnail: false }));
    expect(decoded.layers.filter((entry) => entry.kind === "group")).toHaveLength(10);
    const deepest = decoded.layers.find((entry) => entry.kind === "layer") as DecodedLayer;
    // The two flattened groups' opacity went into it.
    expect(deepest.opacity).toBeCloseTo(0.25, 2);
    expect(decoded.notes.join()).toMatch(/nested more than 10 deep/);
  });
});
