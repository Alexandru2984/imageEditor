import { describe, expect, it } from "vitest";
import { sameGrid, type DocumentGrid } from "./state";

describe("sameGrid", () => {
  const grid: DocumentGrid = { left: 100.66666666666669, top: 46.5, scale: 0.5692599620493359, width: 400, height: 300 };

  it("matches a grid rounded by a saved document", () => {
    expect(sameGrid(grid, { ...grid, left: 100.6667, scale: 0.5692491603574885 })).toBe(true);
  });

  it("does not match a grid that moved or changed size", () => {
    expect(sameGrid(grid, { ...grid, left: grid.left + 1 })).toBe(false);
    expect(sameGrid(grid, { ...grid, scale: grid.scale * 1.01 })).toBe(false);
    expect(sameGrid(grid, { ...grid, width: 401 })).toBe(false);
  });
});
