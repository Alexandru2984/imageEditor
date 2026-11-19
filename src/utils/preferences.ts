import { DEFAULT_GRID, isGridSettings, type GridSettings } from "./guideData";

/**
 * Per-browser editor preferences. Storage can be unavailable (private mode,
 * blocked site data), so every access falls back to the default.
 */
export function readBooleanPreference(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

export function writeBooleanPreference(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Not persisted; the in-memory value still applies for this session.
  }
}

export const SNAP_PREFERENCE_KEY = "ie-snap";
export const RULERS_PREFERENCE_KEY = "ie-rulers";
export const GRID_PREFERENCE_KEY = "ie-grid";
export const GUIDES_PREFERENCE_KEY = "ie-guides";
export const LOCK_GUIDES_PREFERENCE_KEY = "ie-lock-guides";
const GRID_SETTINGS_KEY = "ie-grid-settings";

export function readGridSettings(): GridSettings {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(GRID_SETTINGS_KEY) ?? "null");
    return isGridSettings(stored) ? { spacing: stored.spacing, subdivisions: stored.subdivisions } : DEFAULT_GRID;
  } catch {
    return DEFAULT_GRID;
  }
}

export function writeGridSettings(settings: GridSettings): void {
  try {
    window.localStorage.setItem(GRID_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Kept for this session only.
  }
}
