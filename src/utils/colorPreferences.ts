import { parseHex } from "./colorSpaces";

/**
 * The Swatches panel's colours and the colour picker's recent colours, kept
 * in this browser. Stored values are checked when read back; when storage is
 * unavailable or full they last for this page session.
 */

const SWATCHES_KEY = "ie-swatches";
const RECENT_KEY = "ie-recent-colors";
export const MAX_SWATCHES = 60;
export const MAX_RECENT_COLORS = 10;

/** The swatches every document starts with. */
export const DEFAULT_SWATCHES: readonly string[] = [
  "#000000", "#ffffff", "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#10b981", "#3b82f6", "#6366f1", "#a855f7", "#ec4899",
];

interface Store {
  swatches: readonly string[];
  recent: readonly string[];
}

let store: Store | null = null;
const listeners = new Set<() => void>();

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Distinct valid colours from what was stored, at most `limit`. */
function readColors(key: string, limit: number): string[] {
  let value: unknown = null;
  try {
    value = JSON.parse(storage()?.getItem(key) ?? "null");
  } catch {
    value = null;
  }
  if (!Array.isArray(value)) return [];
  const colors: string[] = [];
  for (const item of value) {
    const hex = typeof item === "string" && /^#[0-9a-f]{6}$/i.test(item) ? item.toLowerCase() : null;
    if (hex && !colors.includes(hex)) colors.push(hex);
    if (colors.length >= limit) break;
  }
  return colors;
}

function load(): Store {
  store ??= { swatches: readColors(SWATCHES_KEY, MAX_SWATCHES), recent: readColors(RECENT_KEY, MAX_RECENT_COLORS) };
  return store;
}

function save(key: string, colors: readonly string[]): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(key, JSON.stringify(colors));
    return true;
  } catch {
    return false;
  }
}

function change(next: Store) {
  store = next;
  for (const listener of listeners) listener();
}

export const userSwatches = (): readonly string[] => load().swatches;
export const recentColors = (): readonly string[] => load().recent;

export function subscribeColorPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Add a colour to the user's swatches: "added" (kept in this browser),
 * "session" (kept until the page closes), "exists" or "full".
 */
export function addSwatch(color: string): "added" | "session" | "exists" | "full" {
  const hex = parseHex(color);
  const current = load();
  if (!hex) return "exists";
  if (current.swatches.includes(hex) || DEFAULT_SWATCHES.includes(hex)) return "exists";
  if (current.swatches.length >= MAX_SWATCHES) return "full";
  const swatches = [...current.swatches, hex];
  change({ ...current, swatches });
  return save(SWATCHES_KEY, swatches) ? "added" : "session";
}

export function removeSwatch(color: string): void {
  const current = load();
  const swatches = current.swatches.filter((swatch) => swatch !== color);
  if (swatches.length === current.swatches.length) return;
  change({ ...current, swatches });
  save(SWATCHES_KEY, swatches);
}

/** Put a colour first among the recent ones. */
export function pushRecentColor(color: string): void {
  const hex = parseHex(color);
  const current = load();
  if (!hex || current.recent[0] === hex) return;
  const recent = [hex, ...current.recent.filter((item) => item !== hex)].slice(0, MAX_RECENT_COLORS);
  change({ ...current, recent });
  save(RECENT_KEY, recent);
}

/** Read storage again (tests, and another tab's changes). */
export function forgetColorPreferences(): void {
  store = null;
}
