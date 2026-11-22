import { describe, expect, it } from "vitest";
import { Rect, type FabricObject } from "fabric";
import { LayerGroup, LayerGroupEnd } from "@/layers/groupMarkers";
import { layerRows, rowRange } from "./layerRows";
import { AdjustmentLayer } from "@/adjustments/adjustmentLayer";

/** Text without measuring it (no document here): what matters is its type. */
class FakeText extends Rect {
  static type = "IText";
}

type Named = FabricObject & { __layerId?: string; name?: string };

function named<T extends FabricObject>(object: T, id: string, name?: string): T {
  (object as Named).__layerId = id;
  if (name) (object as Named).name = name;
  return object;
}

/** Background, a shape, then a group with text and a shape in it, the shape clipped. */
function stack(collapsed = false) {
  const photo = named(new Rect({ width: 10, height: 10 }), "photo", "Background");
  (photo as Named & { __isBackground?: boolean }).__isBackground = true;
  const clipped = named(new Rect({ width: 4, height: 4 }), "clipped");
  (clipped as Named & { __clipped?: boolean }).__clipped = true;
  return [
    photo,
    named(new Rect({ width: 5, height: 5 }), "rect"),
    named(new LayerGroupEnd(), "end"),
    named(new FakeText({ width: 3, height: 3 }), "text", "Title"),
    clipped,
    named(new LayerGroup({ name: "Stuff", collapsed }), "group"),
  ];
}

describe("layerRows", () => {
  it("lists the top of the stack first, a group's layers indented under it, and names the unnamed", () => {
    const rows = layerRows(stack());
    expect(rows.map((row) => [row.id, row.kind, row.depth, row.name, row.clipped])).toEqual([
      ["group", "group", 0, "Stuff", false],
      ["clipped", "layer", 1, "Rectangle 3", true],
      ["text", "layer", 1, "Title", false],
      ["rect", "layer", 0, "Rectangle 1", false],
      ["photo", "layer", 0, "Background", false],
    ]);
    expect(rows.at(-1)!.locked).toBe(true);
  });

  it("leaves a folded group's layers out, with the same names", () => {
    const rows = layerRows(stack(true));
    expect(rows.map((row) => row.id)).toEqual(["group", "rect", "photo"]);
    expect(rows[1]!.name).toBe("Rectangle 1");
  });

  it("filters by kind and name, keeping the groups around what matches", () => {
    const objects = stack(true);
    expect(layerRows(objects, { kind: "text", query: "" }).map((row) => row.id)).toEqual(["group", "text"]);
    expect(layerRows(objects, { kind: "all", query: "rect" }).map((row) => row.id)).toEqual(["group", "clipped", "rect"]);
    expect(layerRows(objects, { kind: "group", query: "" }).map((row) => row.id)).toEqual(["group"]);
    expect(layerRows(objects, { kind: "pixel", query: "" })).toEqual([]);
  });

  it("shows adjustment layers with what they do, and filters them as a kind", () => {
    // Settings it cannot read (no curves here) fall back to Invert.
    const objects = [...stack(), named(new AdjustmentLayer({ adjustment: { kind: "curves", settings: {} } }), "adj", "Curves 1")];
    const rows = layerRows(objects);
    expect(rows[0]).toMatchObject({ id: "adj", name: "Curves 1", adjustment: "invert", kind: "layer" });
    expect(rows.slice(1).every((row) => row.adjustment === null)).toBe(true);
    expect(layerRows(objects, { kind: "adjustment", query: "" }).map((row) => row.id)).toEqual(["adj"]);
  });

  it("knows which layers a hidden group hides", () => {
    const objects = stack();
    objects[5]!.visible = false;
    const rows = layerRows(objects);
    expect(rows.filter((row) => row.hiddenByGroup).map((row) => row.id)).toEqual(["clipped", "text"]);
    expect(rows[0]!.visible).toBe(false);
  });
});

describe("rowRange", () => {
  it("takes the rows between two, either way round", () => {
    const rows = layerRows(stack());
    expect(rowRange(rows, "rect", "clipped")).toEqual(["clipped", "text", "rect"]);
    expect(rowRange(rows, "clipped", "rect")).toEqual(["clipped", "text", "rect"]);
    expect(rowRange(rows, "gone", "rect")).toEqual(["rect"]);
  });
});
