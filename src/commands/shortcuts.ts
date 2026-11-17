// Keyboard shortcuts as data: one description is used to match key presses,
// to label menu items and to list the shortcut reference.

export interface Shortcut {
  /**
   * A lower-case letter or digit, a punctuation key ("[", "?", "+", ...) or a
   * KeyboardEvent.key name ("Delete", "ArrowLeft", "Escape", "F7", ...).
   */
  key: string;
  /** Ctrl on Windows and Linux, ⌘ on macOS. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

// Keys whose character already depends on Shift (and on the layout), so the
// Shift state is not part of the shortcut: "?" is Shift+/ on a US keyboard
// but a plain key elsewhere, and "+" is Shift+= or the keypad plus.
const SHIFT_AGNOSTIC = new Set(["?", "+", "=", "-"]);

/**
 * The key a press stands for, independent of modifiers. Letters follow the
 * layout (Z is Z on AZERTY too); when a modifier turns a letter or digit into
 * another character (Option on macOS, Shift on digits), the physical key is
 * used instead. Brackets always use the physical key, as Shift turns them
 * into braces.
 */
export function normalizedKey(event: Pick<KeyboardEvent, "key" | "code">): string {
  const { key, code } = event;
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  if (/^[0-9]$/.test(key)) return key;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter && key.length === 1) return letter[1]!.toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit && key.length === 1 && !SHIFT_AGNOSTIC.has(key)) return digit[1]!;
  if (code === "NumpadAdd") return "+";
  if (code === "NumpadSubtract") return "-";
  return key;
}

export function matchesShortcut(event: ShortcutEvent, shortcut: Shortcut): boolean {
  if (normalizedKey(event) !== shortcut.key) return false;
  if ((event.ctrlKey || event.metaKey) !== !!shortcut.mod) return false;
  if (event.altKey !== !!shortcut.alt) return false;
  if (SHIFT_AGNOSTIC.has(shortcut.key) && shortcut.shift === undefined) return true;
  return event.shiftKey === !!shortcut.shift;
}

export const isApplePlatform = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform ?? "");
};

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Delete: "Del",
  Backspace: "⌫",
  Escape: "Esc",
  Enter: "Enter",
  " ": "Space",
};

/** "Ctrl+Shift+Z" on Windows and Linux, "⇧⌘Z" on Apple platforms. */
export function formatShortcut(shortcut: Shortcut, apple = isApplePlatform()): string {
  const key = KEY_LABELS[shortcut.key] ?? (shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  if (apple) {
    return `${shortcut.alt ? "⌥" : ""}${shortcut.shift ? "⇧" : ""}${shortcut.mod ? "⌘" : ""}${key}`;
  }
  return [shortcut.mod && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift", key]
    .filter(Boolean)
    .join("+");
}
