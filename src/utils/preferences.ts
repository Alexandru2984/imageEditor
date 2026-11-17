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
