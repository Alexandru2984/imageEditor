import { describe, expect, it } from "vitest";
import { Mask } from "./mask";
import { strokeBand } from "./edits";

const row = (mask: Mask, y: number) =>
  [...mask.data.subarray(y * mask.width, (y + 1) * mask.width)].map((value) => (value ? "#" : ".")).join("");

describe("strokeBand", () => {
  // Columns and rows 3 to 8.
  const square = Mask.rect(12, 12, 3, 3, 9, 9);

  it("paints inside the edge", () => {
    expect(row(strokeBand(square, 1, "inside"), 6)).toBe("...#....#...");
    expect(row(strokeBand(square, 2, "inside"), 6)).toBe("...##..##...");
  });

  it("paints outside the edge", () => {
    expect(row(strokeBand(square, 2, "outside"), 6)).toBe(".##......##.");
  });

  it("straddles the edge when centred", () => {
    expect(row(strokeBand(square, 2, "center"), 6)).toBe("..##....##..");
    expect(row(strokeBand(square, 1, "center"), 6)).toBe("...#....#...");
  });
});
