import { describe, it, expect } from "vitest";
import type { Canvas as FabricCanvas } from "fabric";
import { takeSnapshot, parseSnapshot } from "./canvasSnapshot";

// Minimal stand-in for a Fabric canvas: takeSnapshot only calls toObject().
function fakeCanvas(data: unknown): FabricCanvas {
  return { toObject: () => data } as unknown as FabricCanvas;
}

const BIG_SRC = "data:image/png;base64," + "A".repeat(10_000);
const OTHER_SRC = "data:image/png;base64," + "B".repeat(10_000);

describe("takeSnapshot / parseSnapshot", () => {
  it("extracts image srcs out of the JSON and re-inlines them on parse", () => {
    const data = {
      version: "6",
      objects: [
        { type: "image", src: BIG_SRC, left: 0 },
        { type: "rect", fill: "#fff" },
      ],
    };

    const snapshot = takeSnapshot(fakeCanvas(data));

    // The heavy src must not live in the JSON string anymore
    expect(snapshot.json).not.toContain(BIG_SRC);
    expect(snapshot.srcs).toEqual([BIG_SRC]);

    // Round-trips back to the original structure
    const restored = parseSnapshot(snapshot);
    expect(restored).toEqual(data);
  });

  it("keeps the src out of the serialized snapshot regardless of size", () => {
    const data = { objects: [{ type: "image", src: BIG_SRC }] };
    const snapshot = takeSnapshot(fakeCanvas(data));
    // JSON weighs a placeholder, not the megabytes of base64
    expect(snapshot.json.length).toBeLessThan(200);
  });

  it("deduplicates nothing but lets callers share srcs by reference", () => {
    // Two snapshots of the same image should reference an equal src string,
    // so the history array holds pointers, not copies
    const data = { objects: [{ type: "image", src: BIG_SRC }] };
    const a = takeSnapshot(fakeCanvas(data));
    const b = takeSnapshot(fakeCanvas(data));
    expect(a.srcs[0]).toBe(b.srcs[0]);
  });

  it("handles multiple images and preserves their order", () => {
    const data = {
      objects: [
        { type: "image", src: BIG_SRC },
        { type: "image", src: OTHER_SRC },
      ],
    };
    const snapshot = takeSnapshot(fakeCanvas(data));
    expect(snapshot.srcs).toEqual([BIG_SRC, OTHER_SRC]);
    expect(parseSnapshot(snapshot)).toEqual(data);
  });

  it("recurses into grouped objects (e.g. arrow groups)", () => {
    const data = {
      objects: [
        {
          type: "group",
          objects: [
            { type: "image", src: BIG_SRC },
            { type: "line" },
          ],
        },
      ],
    };
    const snapshot = takeSnapshot(fakeCanvas(data));
    expect(snapshot.json).not.toContain(BIG_SRC);
    expect(snapshot.srcs).toEqual([BIG_SRC]);
    expect(parseSnapshot(snapshot)).toEqual(data);
  });

  it("is a no-op for documents without images", () => {
    const data = { objects: [{ type: "rect" }, { type: "i-text" }] };
    const snapshot = takeSnapshot(fakeCanvas(data));
    expect(snapshot.srcs).toEqual([]);
    expect(parseSnapshot(snapshot)).toEqual(data);
  });
});
