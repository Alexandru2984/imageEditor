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
});
