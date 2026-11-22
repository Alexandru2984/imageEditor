import { describe, expect, it } from "vitest";
import { decodeRuns, encodeRuns, restoreSelection, sameStoredSelection, storeSelection, storedSize } from "./history";
import { Mask } from "./mask";
import type { DocumentGrid } from "./state";

const grid: DocumentGrid = { left: 10, top: 20, width: 400, height: 300, scale: 1 };

describe("selections in the undo history", () => {
  it("encode runs so they decode to the same bytes, long runs included", () => {
    const data = new Uint8Array(1000);
    data.fill(255, 100, 900);
    data[950] = 128;
    const runs = encodeRuns(data)!;
    expect(runs.length).toBeLessThan(20);
    expect([...decodeRuns(runs, data.length)]).toEqual([...data]);
    const huge = new Uint8Array(5_000_000).fill(255);
    expect([...encodeRuns(huge)!]).toHaveLength(5);
    expect(decodeRuns(encodeRuns(huge)!, huge.length).every((value) => value === 255)).toBe(true);
  });

  it("keep noise as it is, where runs would not pay", () => {
    const noise = Uint8Array.from({ length: 4096 }, (_, index) => (index * 97) & 255);
    expect(encodeRuns(noise)).toBeNull();
    const mask = new Mask(64, 64, noise);
    const record = storeSelection({ grid: { ...grid, width: 64, height: 64 }, mask })!;
    expect(record.encoded).toBe(false);
    expect(restoreSelection(record).mask.data).toBe(noise);
  });

  it("store a rectangle on a large photo in a few kilobytes, and bring it back", () => {
    const big: DocumentGrid = { left: 0, top: 0, width: 4000, height: 3000, scale: 1 };
    const mask = Mask.rect(4000, 3000, 500, 400, 3500, 2600);
    const record = storeSelection({ grid: big, mask })!;
    expect(storedSize(record)).toBeLessThan(20_000);
    // The same mask is encoded once.
    expect(storeSelection({ grid: big, mask })).toBe(record);
    const back = restoreSelection(record);
    expect(back.grid).toBe(big);
    expect(back.mask.bounds()).toEqual(mask.bounds());
    expect(sameStoredSelection(storeSelection(back), record)).toBe(true);
  });

  it("tell selections apart by their pixels and grid", () => {
    const a = storeSelection({ grid, mask: Mask.rect(400, 300, 0, 0, 10, 10) });
    const same = storeSelection({ grid, mask: Mask.rect(400, 300, 0, 0, 10, 10) });
    const other = storeSelection({ grid, mask: Mask.rect(400, 300, 0, 0, 11, 10) });
    const moved = storeSelection({ grid: { ...grid, left: 40 }, mask: Mask.rect(400, 300, 0, 0, 10, 10) });
    expect(sameStoredSelection(a, same)).toBe(true);
    expect(sameStoredSelection(a, other)).toBe(false);
    expect(sameStoredSelection(a, moved)).toBe(false);
    expect(sameStoredSelection(a, null)).toBe(false);
    expect(sameStoredSelection(null, null)).toBe(true);
    expect(storeSelection(null)).toBeNull();
  });
});
