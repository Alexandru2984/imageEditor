import {
  BUILTIN_PRESETS,
  BUILTIN_TIPS,
  PRESET_ID,
  decodeTip,
  encodeTip,
  isBrushPreset,
  type BrushPreset,
  type BrushTip,
} from "@/raster/brushEngine";

/**
 * The brush presets: Photoshop-like built-in ones and the user's own, kept
 * in this browser with the tips made by Edit › Define Brush Preset. What is
 * stored is checked when read back, and storage may be unavailable or full:
 * the presets then last for this page session.
 */

const PRESETS_KEY = "ie-brush-presets";
const TIPS_KEY = "ie-brush-tips";
export const MAX_USER_PRESETS = 40;
export const MAX_USER_TIPS = 24;

interface Store {
  user: BrushPreset[];
  tips: Map<string, BrushTip>;
  /** Built-in and user presets together, the same array until they change. */
  all: readonly BrushPreset[];
}

let store: Store | null = null;
const builtinTips = new Map<string, BrushTip>();
const listeners = new Set<() => void>();

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

function read(key: string): unknown {
  try {
    return JSON.parse(storage()?.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function load(): Store {
  if (store) return store;
  const tips = new Map<string, BrushTip>();
  const storedTips = read(TIPS_KEY);
  if (storedTips && typeof storedTips === "object" && !Array.isArray(storedTips)) {
    for (const [id, value] of Object.entries(storedTips).slice(0, MAX_USER_TIPS)) {
      const tip = PRESET_ID.test(id) && id.startsWith("user:") ? decodeTip(value) : null;
      if (tip) tips.set(id, tip);
    }
  }
  const storedPresets = read(PRESETS_KEY);
  const user = (Array.isArray(storedPresets) ? storedPresets : [])
    .filter(isBrushPreset)
    .filter((preset) => preset.id.startsWith("user:"))
    .filter((preset) => preset.tipId === null || preset.tipId in BUILTIN_TIPS || tips.has(preset.tipId))
    .slice(0, MAX_USER_PRESETS);
  store = { user, tips, all: [...BUILTIN_PRESETS, ...user] };
  return store;
}

/** Keep the user's presets and their tips; false when the browser would not. */
function persist(current: Store): boolean {
  const target = storage();
  if (!target) return false;
  try {
    const used = new Set(current.user.map((preset) => preset.tipId));
    const tips = Object.fromEntries([...current.tips].filter(([id]) => used.has(id)).map(([id, tip]) => [id, encodeTip(tip)]));
    target.setItem(TIPS_KEY, JSON.stringify(tips));
    target.setItem(PRESETS_KEY, JSON.stringify(current.user));
    return true;
  } catch {
    return false;
  }
}

function changed(next: Omit<Store, "all">) {
  store = { ...next, all: [...BUILTIN_PRESETS, ...next.user] };
  for (const listener of listeners) listener();
}

/** Every preset, built-in first. */
export const brushPresets = (): readonly BrushPreset[] => load().all;

export function subscribeBrushPresets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A tip by its id, or null for the round tip (or one that is gone). */
export function brushTip(id: string | null | undefined): BrushTip | null {
  if (!id) return null;
  const builtin = BUILTIN_TIPS[id];
  if (builtin) {
    let tip = builtinTips.get(id);
    if (!tip) {
      tip = builtin();
      builtinTips.set(id, tip);
    }
    return tip;
  }
  return load().tips.get(id) ?? null;
}

const newId = () => `user:${Math.random().toString(36).slice(2, 10) || "brush"}`;

/**
 * Add a preset (with a new tip of its own, when given). Returns the preset
 * and whether the browser kept it, or a refusal to show.
 */
export function addBrushPreset(
  settings: Omit<BrushPreset, "id" | "tipId"> & { tipId?: string | null },
  tip?: BrushTip
): { preset: BrushPreset; kept: boolean } | string {
  const current = load();
  if (current.user.length >= MAX_USER_PRESETS) return `There can be at most ${MAX_USER_PRESETS} presets of your own; delete one first`;
  const tips = new Map(current.tips);
  let tipId = settings.tipId ?? null;
  if (tip) {
    if (tips.size >= MAX_USER_TIPS) return `There can be at most ${MAX_USER_TIPS} brushes made from pixels; delete one first`;
    tipId = newId();
    tips.set(tipId, tip);
  }
  const preset: BrushPreset = {
    id: newId(),
    name: settings.name.trim().slice(0, 60) || "Brush",
    size: settings.size,
    hardness: settings.hardness,
    flow: settings.flow,
    dynamics: { ...settings.dynamics },
    tipId,
  };
  if (!isBrushPreset(preset)) return "That brush could not be kept";
  const next = { user: [...current.user, preset], tips };
  changed(next);
  return { preset, kept: persist(store!) };
}

/** Delete one of the user's presets (and its tip, unless another uses it). */
export function deleteBrushPreset(id: string): void {
  const current = load();
  const user = current.user.filter((preset) => preset.id !== id);
  if (user.length === current.user.length) return;
  const used = new Set(user.map((preset) => preset.tipId));
  const tips = new Map([...current.tips].filter(([tipId]) => used.has(tipId)));
  changed({ user, tips });
  persist(store!);
}

/** For tests: read the stored presets again. */
export function forgetBrushPresets(): void {
  store = null;
}
