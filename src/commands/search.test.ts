import { describe, expect, it } from "vitest";
import { normalizeText, searchCommands } from "./search";
import type { Command } from "./types";

const command = (id: string, label: string, keywords?: string): Command => ({
  id,
  label,
  keywords,
  run: () => {},
});

const COMMANDS = [
  command("file.export", "Export…", "save download png jpeg"),
  command("image.flipHorizontal", "Flip horizontal", "mirror"),
  command("image.flipVertical", "Flip vertical", "mirror upside down"),
  command("layer.duplicate", "Duplicate layer", "copy clone"),
  command("edit.copy", "Copy"),
  command("view.layers", "Layers panel"),
];

const ids = (query: string) => searchCommands(COMMANDS, query).map((found) => found.id);

describe("searchCommands", () => {
  it("lists everything, in order, for an empty query", () => {
    expect(ids("  ")).toEqual(COMMANDS.map((found) => found.id));
  });

  it("needs every word to match", () => {
    expect(ids("flip vert")).toEqual(["image.flipVertical"]);
    expect(ids("flip diagonal")).toEqual([]);
  });

  it("finds commands by their keywords", () => {
    expect(ids("mirror")).toEqual(["image.flipHorizontal", "image.flipVertical"]);
    expect(ids("download")).toEqual(["file.export"]);
  });

  it("ranks label matches above keyword matches", () => {
    // "Copy" is a label; Duplicate layer only lists it as a keyword.
    expect(ids("copy")).toEqual(["edit.copy", "layer.duplicate"]);
    expect(ids("lay")).toEqual(["view.layers", "layer.duplicate"]);
  });

  it("ignores case, accents and the trailing ellipsis", () => {
    expect(normalizeText("Éxport…")).toBe("export");
    expect(ids("EXPÓRT")).toEqual(["file.export"]);
  });
});
