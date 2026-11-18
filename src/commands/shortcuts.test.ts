import { describe, expect, it } from "vitest";
import { formatShortcut, matchesShortcut, normalizedKey, type ShortcutEvent } from "./shortcuts";

const press = (key: string, code: string, modifiers: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("normalizedKey", () => {
  it("lower-cases letters, including with Shift or Caps Lock", () => {
    expect(normalizedKey(press("Z", "KeyZ"))).toBe("z");
    expect(normalizedKey(press("j", "KeyJ"))).toBe("j");
  });

  it("follows the layout for letters", () => {
    // The key labelled Z on an AZERTY keyboard sits where W is on QWERTY.
    expect(normalizedKey(press("z", "KeyW"))).toBe("z");
  });

  it("falls back to the physical key when a modifier changes the character", () => {
    // Option+W on macOS types "∑".
    expect(normalizedKey(press("∑", "KeyW"))).toBe("w");
    // Shift+1 types "!".
    expect(normalizedKey(press("!", "Digit1"))).toBe("1");
  });

  it("keeps shifted punctuation and treats braces as brackets", () => {
    expect(normalizedKey(press("?", "Slash"))).toBe("?");
    expect(normalizedKey(press("+", "Equal"))).toBe("+");
    expect(normalizedKey(press("}", "BracketRight"))).toBe("]");
    expect(normalizedKey(press("+", "NumpadAdd"))).toBe("+");
    expect(normalizedKey(press(":", "Semicolon"))).toBe(";");
  });

  it("passes named keys through", () => {
    expect(normalizedKey(press("Delete", "Delete"))).toBe("Delete");
    expect(normalizedKey(press("F7", "F7"))).toBe("F7");
  });
});

describe("matchesShortcut", () => {
  it("treats Ctrl and ⌘ alike", () => {
    expect(matchesShortcut(press("j", "KeyJ", { ctrlKey: true }), { key: "j", mod: true })).toBe(true);
    expect(matchesShortcut(press("j", "KeyJ", { metaKey: true }), { key: "j", mod: true })).toBe(true);
  });

  it("requires exactly the listed modifiers", () => {
    const undo = { key: "z", mod: true };
    expect(matchesShortcut(press("z", "KeyZ", { ctrlKey: true }), undo)).toBe(true);
    expect(matchesShortcut(press("Z", "KeyZ", { ctrlKey: true, shiftKey: true }), undo)).toBe(false);
    expect(matchesShortcut(press("z", "KeyZ", { ctrlKey: true, altKey: true }), undo)).toBe(false);
    expect(matchesShortcut(press("z", "KeyZ"), undo)).toBe(false);
    expect(matchesShortcut(press("v", "KeyV"), { key: "v" })).toBe(true);
    expect(matchesShortcut(press("v", "KeyV", { ctrlKey: true }), { key: "v" })).toBe(false);
  });

  it("matches Shift combinations", () => {
    const redo = { key: "z", mod: true, shift: true };
    expect(matchesShortcut(press("Z", "KeyZ", { ctrlKey: true, shiftKey: true }), redo)).toBe(true);
    const front = { key: "]", mod: true, shift: true };
    expect(matchesShortcut(press("}", "BracketRight", { ctrlKey: true, shiftKey: true }), front)).toBe(true);
    expect(matchesShortcut(press("]", "BracketRight", { ctrlKey: true }), front)).toBe(false);
  });

  it("ignores Shift for keys that need it on some layouts", () => {
    expect(matchesShortcut(press("?", "Slash", { shiftKey: true }), { key: "?" })).toBe(true);
    expect(matchesShortcut(press("+", "Equal", { shiftKey: true }), { key: "+" })).toBe(true);
    expect(matchesShortcut(press("+", "Equal", { ctrlKey: true, shiftKey: true }), { key: "+", mod: true })).toBe(true);
  });

  it("matches Alt shortcuts typed with Option on macOS", () => {
    const exportAs = { key: "w", mod: true, shift: true, alt: true };
    expect(
      matchesShortcut(press("„", "KeyW", { metaKey: true, shiftKey: true, altKey: true }), exportAs)
    ).toBe(true);
  });
});

describe("formatShortcut", () => {
  it("writes Windows and Linux shortcuts in full", () => {
    expect(formatShortcut({ key: "z", mod: true, shift: true }, false)).toBe("Ctrl+Shift+Z");
    expect(formatShortcut({ key: "w", mod: true, alt: true, shift: true }, false)).toBe("Ctrl+Alt+Shift+W");
    expect(formatShortcut({ key: "Delete" }, false)).toBe("Del");
    expect(formatShortcut({ key: "]", mod: true }, false)).toBe("Ctrl+]");
  });

  it("uses the Apple symbols and order on Apple platforms", () => {
    expect(formatShortcut({ key: "z", mod: true, shift: true }, true)).toBe("⇧⌘Z");
    expect(formatShortcut({ key: "w", mod: true, alt: true, shift: true }, true)).toBe("⌥⇧⌘W");
    expect(formatShortcut({ key: "ArrowLeft" }, true)).toBe("←");
  });
});
