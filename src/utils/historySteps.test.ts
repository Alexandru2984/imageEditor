import { describe, expect, it } from "vitest";
import type { CanvasSnapshot } from "./canvasSnapshot";
import { describeChange } from "./historySteps";

const snapshot = (objects: Record<string, unknown>[], srcs: string[] = []): CanvasSnapshot => ({
  json: JSON.stringify({ objects }),
  srcs,
});

const photo = { type: "Image", __layerId: "p", __isBackground: true, src: "__snapshot_src_0", left: 0, top: 0 };
const layer = { type: "Image", __layerId: "a", name: "Layer 1", src: "__snapshot_src_1", left: 10, top: 10, scaleX: 1, opacity: 1 };

describe("describeChange", () => {
  const base = snapshot([photo, layer], ["data:photo", "data:layer"]);

  it("names the first state, added and removed layers, and reordering", () => {
    expect(describeChange(undefined, base)).toEqual({ name: "Open", kind: "other" });
    expect(describeChange(snapshot([photo], ["data:photo"]), base)).toEqual({ name: "New layer", kind: "added" });
    expect(describeChange(base, snapshot([photo], ["data:photo"]))).toEqual({ name: "Delete layer", kind: "removed" });
    const text = { type: "Textbox", __layerId: "t", text: "Hi" };
    expect(describeChange(base, snapshot([photo, layer, text], base.srcs)).name).toBe("Text");
    const second = { ...layer, __layerId: "b" };
    expect(describeChange(snapshot([photo, layer, second], base.srcs), snapshot([photo, second, layer], base.srcs)).name).toBe("Arrange");
    expect(describeChange(snapshot([photo, layer, second], base.srcs), snapshot([photo, { ...layer, __layerId: "c" }], base.srcs))).toEqual({
      name: "Merge layers",
      kind: "pixels",
    });
  });

  it("names adjustment layers by what they do", () => {
    const levels = { type: "AdjustmentLayer", __layerId: "j", adjustment: { kind: "levels", settings: {} } };
    expect(describeChange(base, snapshot([photo, layer, levels], base.srcs))).toEqual({ name: "New Levels layer", kind: "added" });
    const changed = { ...levels, adjustment: { kind: "levels", settings: { rgb: 1 } } };
    expect(describeChange(snapshot([photo, layer, levels], base.srcs), snapshot([photo, layer, changed], base.srcs)).name).toBe(
      "Modify Levels layer"
    );
  });

  it("names fill layers by what they fill with", () => {
    const fill = { type: "FillLayer", __layerId: "f", fillContent: { kind: "solid", color: "#ff0000" } };
    expect(describeChange(base, snapshot([photo, layer, fill], base.srcs))).toEqual({ name: "New Color Fill layer", kind: "added" });
    const changed = { ...fill, fillContent: { kind: "solid", color: "#00ff00" } };
    expect(describeChange(snapshot([photo, layer, fill], base.srcs), snapshot([photo, layer, changed], base.srcs)).name).toBe(
      "Modify Color Fill layer"
    );
  });

  it("tells pixel edits from moves and other changes, by the source behind each placeholder", () => {
    // Same placeholder, another image behind it.
    expect(describeChange(base, snapshot([photo, layer], ["data:photo", "data:painted"]))).toEqual({ name: "Edit pixels", kind: "pixels" });
    expect(describeChange(base, snapshot([photo, layer], ["data:retouched", "data:layer"])).name).toBe("Edit image");
    // Other placeholders, the same images: nothing changed there.
    expect(describeChange(base, snapshot([{ ...photo, src: "__snapshot_src_1" }, { ...layer, src: "__snapshot_src_0" }], ["data:layer", "data:photo"])).name).toBe(
      "Change"
    );
    expect(describeChange(base, snapshot([photo, { ...layer, left: 30 }], base.srcs))).toEqual({ name: "Move", kind: "other" });
    expect(describeChange(base, snapshot([photo, { ...layer, left: 30, scaleX: 2 }], base.srcs)).name).toBe("Transform");
    expect(describeChange(base, snapshot([photo, { ...layer, opacity: 0.5 }], base.srcs)).name).toBe("Opacity");
    expect(describeChange(base, snapshot([{ ...photo, guides: [{ axis: "x", position: 3 }] }, layer], base.srcs)).name).toBe("Guides");
    expect(describeChange(base, snapshot([photo, { ...layer, layerMask: { src: "__snapshot_src_2", enabled: true } }], [...base.srcs, "data:mask"]))).toEqual({
      name: "Layer mask",
      kind: "pixels",
    });
  });
});
