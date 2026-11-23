import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_PRESETS, DEFAULT_DYNAMICS, encodeTip } from "@/raster/brushEngine";
import { MAX_USER_PRESETS, addBrushPreset, brushPresets, brushTip, deleteBrushPreset, forgetBrushPresets } from "./brushPresets";

/** A stand-in for the browser's storage. */
function fakeStorage(full = false) {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (full) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  };
}

const settings = { name: "Mine", size: 12, hardness: 50, flow: 70, dynamics: DEFAULT_DYNAMICS };

describe("brush presets in this browser", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    forgetBrushPresets();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    forgetBrushPresets();
  });

  it("lists the built-in ones, then keeps the user's with their tips", () => {
    expect(brushPresets()).toEqual(BUILTIN_PRESETS);
    const tip = { width: 2, height: 1, alpha: new Uint8Array([255, 128]) };
    const added = addBrushPreset(settings, tip);
    if (typeof added === "string") throw new Error(added);
    expect(added.kept).toBe(true);
    expect(added.preset.id).toMatch(/^user:/);
    expect(brushTip(added.preset.tipId)).toEqual(tip);
    // Read back as a new page would.
    forgetBrushPresets();
    const again = brushPresets().at(-1)!;
    expect(again).toEqual(added.preset);
    expect(brushTip(again.tipId)).toEqual(tip);
    // Deleting it lets go of its tip as well.
    deleteBrushPreset(again.id);
    forgetBrushPresets();
    expect(brushPresets()).toEqual(BUILTIN_PRESETS);
    expect(JSON.parse(storage.values.get("ie-brush-tips")!)).toEqual({});
  });

  it("skips what was tampered with", () => {
    const good = { ...settings, id: "user:good", tipId: null };
    storage.values.set(
      "ie-brush-presets",
      JSON.stringify([
        good,
        { ...good, id: "builtin:soft-round" },
        { ...good, id: "user:missing-tip", tipId: "user:gone" },
        { ...good, id: "user:bad", size: 1e9 },
        "nonsense",
      ])
    );
    storage.values.set("ie-brush-tips", JSON.stringify({ "user:x": { width: 1, height: 1, alpha: "!!" }, "other:y": encodeTip({ width: 1, height: 1, alpha: new Uint8Array([1]) }) }));
    expect(brushPresets().slice(BUILTIN_PRESETS.length)).toEqual([good]);
    expect(brushTip("user:x")).toBeNull();
    expect(brushTip("other:y")).toBeNull();
    storage.values.set("ie-brush-presets", "{not json");
    forgetBrushPresets();
    expect(brushPresets()).toEqual(BUILTIN_PRESETS);
  });

  it("keeps presets for the session when the browser will not, and has a limit", () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage(true);
    forgetBrushPresets();
    const added = addBrushPreset(settings);
    if (typeof added === "string") throw new Error(added);
    expect(added.kept).toBe(false);
    expect(brushPresets()).toContain(added.preset);
    for (let index = 1; index < MAX_USER_PRESETS; index += 1) addBrushPreset(settings);
    expect(addBrushPreset(settings)).toMatch(/at most/);
  });

  it("makes the built-in tips once", () => {
    const chalk = brushTip("builtin:chalk")!;
    expect(chalk.width).toBe(96);
    expect(brushTip("builtin:chalk")).toBe(chalk);
    expect(brushTip(null)).toBeNull();
  });
});
