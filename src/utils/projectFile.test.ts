import { describe, it, expect } from "vitest";
import { readProjectFile } from "./projectFile";

function fileOf(content: string): File {
  return new File([content], "p.imgedit.json", { type: "application/json" });
}

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
      srcs: ["data:image/png;base64,AAAA"],
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
    await expect(readProjectFile(file)).rejects.toThrow(/unexpected image source/);
  });

  it("rejects an external src smuggled directly into the JSON", async () => {
    // A tampered file can bypass the srcs array by putting a real URL in json
    const snapshot = {
      json: '{"objects":[{"type":"image","src":"https://evil.example/x.png"}]}',
      srcs: [],
    };
    const file = fileOf(JSON.stringify({ snapshot }));
    await expect(readProjectFile(file)).rejects.toThrow(/unexpected image source/);
  });
});
