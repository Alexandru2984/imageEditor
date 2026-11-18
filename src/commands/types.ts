import type { LucideIcon } from "lucide-react";
import type { Shortcut } from "./shortcuts";

/** An editor action, defined once for menus, shortcuts and search. */
export interface Command {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** The first one is displayed; all of them trigger the command. */
  shortcuts?: readonly Shortcut[];
  /** Shortcuts shown but handled elsewhere (paste arrives as an event). */
  shortcutsDisplayOnly?: boolean;
  /** Fires again while the key is held (zoom). */
  repeat?: boolean;
  /** Extra words for search, beyond the label. */
  keywords?: string;
  run: () => void;
  /** Checked lazily, when a menu opens or a key is pressed. */
  isEnabled?: () => boolean;
  /** Whether the command is currently in effect (the active tool, a panel). */
  isChecked?: () => boolean;
  /** An on/off setting: menus render it as a checkbox item. */
  toggle?: boolean;
}

export type CommandMap = Readonly<Record<string, Command>>;

export type MenuEntry =
  | string // a command id
  | "-" // a separator
  | "theme" // the theme choice
  | { label: string; items: readonly MenuEntry[] };

export interface MenuDefinition {
  label: string;
  items: readonly MenuEntry[];
}
