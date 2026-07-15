import { describe, it, expect } from "vitest";
import { readProjectFile } from "./projectFile";

function fileOf(content: string): File {
  return new File([content], "p.imgedit.json", { type: "application/json" });
}

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAvyQP4rvqiVQAAAABJRU5ErkJggg==";

describe("readProjectFile", () => {
  it("parses a valid project file into a snapshot", async () => {
    const snapshot = { json: '{"objects":[]}', srcs: [] };
    const file = fileOf(JSON.stringify({ version: 1, snapshot }));
    await expect(readProjectFile(file)).resolves.toEqual(snapshot);
  });

  it("rejects non-JSON content", async () => {
    await expect(readProjectFile(fileOf("not json"))).rejects.toThrow();
  });

  it("rejects JSON that isn't a project file", async () => {
    await expect(readProjectFile(fileOf('{"hello":"world"}'))).rejects.toThrow(
      /valid project file/
    );
  });

  it("rejects a snapshot missing its srcs array", async () => {
    const file = fileOf(JSON.stringify({ snapshot: { json: "{}" } }));
    await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
  });

  it("rejects a snapshot whose json isn't a string", async () => {
    const file = fileOf(JSON.stringify({ snapshot: { json: 5, srcs: [] } }));
    await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
  });

  it("accepts placeholder srcs backed by inline data images", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"image","src":"__snapshot_src_0"}]}',
      srcs: [PNG_DATA_URL],
    };
    const file = fileOf(JSON.stringify({ version: 1, snapshot }));
    await expect(readProjectFile(file)).resolves.toEqual(snapshot);
  });

  it("rejects an extracted src pointing at an external URL", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"image","src":"__snapshot_src_0"}]}',
      srcs: ["https://evil.example/track.png"],
    };
    const file = fileOf(JSON.stringify({ snapshot }));
    await expect(readProjectFile(file)).rejects.toThrow(/Only inline/);
  });

  it("rejects an external src smuggled directly into the JSON", async () => {
    // A tampered file can bypass the srcs array by putting a real URL in json
    const snapshot = {
      json: '{"objects":[{"type":"image","src":"https://evil.example/x.png"}]}',
      srcs: [],
    };
    const file = fileOf(JSON.stringify({ snapshot }));
    await expect(readProjectFile(file)).rejects.toThrow(/Only inline/);
  });

  it("rejects a Fabric pattern source that could trigger an external request", async () => {
    const snapshot = {
      json: JSON.stringify({
        objects: [
          {
            type: "Rect",
            fill: { type: "pattern", source: "https://evil.example/pixel.png" },
          },
        ],
      }),
      srcs: [],
    };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/unsupported object type|Only inline/);
  });

  it("rejects placeholders that do not point into the validated source list", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"Image","src":"__snapshot_src_2"}]}',
      srcs: [PNG_DATA_URL],
    };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/invalid image placeholder/);
  });

  it("rejects deeply nested snapshots without recursive traversal", async () => {
    let nested: unknown = { type: "Rect" };
    for (let index = 0; index < 70; index += 1) {
      nested = { type: "Rect", clipPath: nested };
    }
    const snapshot = { json: JSON.stringify({ objects: [nested] }), srcs: [] };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/nesting is too deep/);
  });

  it("rejects prototype-mutating property names", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"Rect","__proto__":{"visible":false}}]}',
      srcs: [],
    };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/unsafe property name/);
  });

  it("rejects project versions the editor does not understand", async () => {
    const snapshot = { json: '{"objects":[]}', srcs: [] };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 99, snapshot })))
    ).rejects.toThrow(/valid project file/);
  });
});
