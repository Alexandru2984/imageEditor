import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_RECENT_COLORS,
  MAX_SWATCHES,
  addSwatch,
  forgetColorPreferences,
  pushRecentColor,
  recentColors,
  removeSwatch,
  subscribeColorPreferences,
  userSwatches,
} from "./colorPreferences";

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

describe("swatches and recent colours in this browser", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    forgetColorPreferences();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    forgetColorPreferences();
  });

  it("adds, keeps and deletes swatches, telling who listens", () => {
    let changes = 0;
    const stop = subscribeColorPreferences(() => (changes += 1));
    expect(addSwatch("#ABCDEF")).toBe("added");
    expect(addSwatch("#abcdef")).toBe("exists");
    // The built-in ones are there already.
    expect(addSwatch("#000000")).toBe("exists");
    expect(userSwatches()).toEqual(["#abcdef"]);
    forgetColorPreferences();
    expect(userSwatches()).toEqual(["#abcdef"]);
    removeSwatch("#abcdef");
    expect(userSwatches()).toEqual([]);
    expect(JSON.parse(storage.values.get("ie-swatches")!)).toEqual([]);
    stop();
    expect(changes).toBe(2);
  });

  it("keeps the newest recent colours first, without repeats", () => {
    for (let index = 0; index < 14; index += 1) pushRecentColor(`#0000${index.toString(16).padStart(2, "0")}`);
    pushRecentColor("#000005");
    const recent = recentColors();
    expect(recent).toHaveLength(MAX_RECENT_COLORS);
    expect(recent[0]).toBe("#000005");
    expect(recent[1]).toBe("#00000d");
    expect(new Set(recent).size).toBe(recent.length);
  });

  it("skips what was tampered with", () => {
    storage.values.set("ie-swatches", JSON.stringify(["#112233", "#112233", "red", "#12", "<b>", 7, "#AABBCC", "url(x)"]));
    storage.values.set("ie-recent-colors", "{oops");
    expect(userSwatches()).toEqual(["#112233", "#aabbcc"]);
    expect(recentColors()).toEqual([]);
  });

  it("has a limit, and lasts for the session when the browser will not keep it", () => {
    for (let index = 0; index < MAX_SWATCHES; index += 1) addSwatch(`#10${index.toString(16).padStart(4, "0")}`);
    expect(addSwatch("#fedcba")).toBe("full");
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage(true);
    forgetColorPreferences();
    expect(addSwatch("#fedcba")).toBe("session");
    expect(userSwatches()).toEqual(["#fedcba"]);
  });
});
