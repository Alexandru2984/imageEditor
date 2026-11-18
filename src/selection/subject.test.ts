import { describe, expect, it } from "vitest";
import { Mask } from "./mask";
import { keepNearSolid, maskFromAlpha } from "./subject";

describe("maskFromAlpha", () => {
  it("keeps the matte's soft edge as partial selection", () => {
    const pixels = Uint8ClampedArray.from([9, 9, 9, 0, 9, 9, 9, 128, 9, 9, 9, 255]);
    const mask = maskFromAlpha(pixels, 3, 1);
    expect([...mask.data]).toEqual([0, 128, 255]);
    expect(mask.bounds()).toEqual({ x: 1, y: 0, width: 2, height: 1 });
  });

  it("drops the faint haze over the background and firms up the subject", () => {
    const pixels = Uint8ClampedArray.from([0, 0, 0, 4, 0, 0, 0, 12, 0, 0, 0, 13, 0, 0, 0, 250]);
    expect([...maskFromAlpha(pixels, 4, 1).data]).toEqual([0, 0, 13, 255]);
  });
});

describe("keepNearSolid", () => {
  it("keeps the soft edge next to the subject and drops faint specks far away", () => {
    // Solid 3..5, a soft edge at 2 and 6, a faint speck at 12.
    const row = [0, 0, 60, 255, 255, 255, 60, 0, 0, 0, 0, 0, 90, 0, 0];
    const cleaned = keepNearSolid(new Mask(row.length, 1, Uint8Array.from(row)), 2);
    expect([...cleaned.data]).toEqual([0, 0, 60, 255, 255, 255, 60, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("finds nothing in a matte without a solid part", () => {
    expect(keepNearSolid(new Mask(3, 1, Uint8Array.of(40, 90, 40)), 5).isEmpty()).toBe(true);
  });
});
