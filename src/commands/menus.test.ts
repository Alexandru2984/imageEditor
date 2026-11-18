import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useEditorCommands, type EditorCommandContext } from "@/hooks/useEditorCommands";
import { EDITOR_MENUS } from "./menus";
import type { CommandMap, MenuEntry } from "./types";

const noop = () => {};

/** The editor's commands, built once with inert actions. */
function editorCommands(): CommandMap {
  const context: EditorCommandContext = {
    canvas: null,
    activeTool: "select",
    onToolChange: noop,
    lastShape: "rectangle",
    lastBrushTool: "brush",
    lastFillTool: "bucket",
    undo: noop,
    redo: noop,
    hasUndo: () => false,
    hasRedo: () => false,
    zoomIn: noop,
    zoomOut: noop,
    fitOnScreen: noop,
    actualPixels: noop,
    rotate: noop,
    flip: noop,
    arrange: noop,
    duplicate: noop,
    copy: noop,
    paste: noop,
    canPaste: () => false,
    requestNew: noop,
    requestOpenImage: noop,
    requestOpenProject: noop,
    placeImage: noop,
    saveProject: noop,
    exportImage: noop,
    ai: {
      isProcessing: false,
      processingMessage: null,
      removeBackground: async () => {},
      extractSubject: async () => {},
      cancel: noop,
    },
    pickColor: noop,
    snapping: true,
    setSnapping: noop,
    panel: null,
    togglePanel: noop,
    openPanel: noop,
    showShortcuts: noop,
    adjustBrush: noop,
    swapColors: noop,
    resetColors: noop,
    openCommandPalette: noop,
  };
  let commands: CommandMap = {};
  const Probe = () => {
    commands = useEditorCommands(context);
    return null;
  };
  renderToString(createElement(Probe));
  return commands;
}

const menuIds = (entries: readonly MenuEntry[]): string[] =>
  entries.flatMap((entry) => {
    if (entry === "-" || entry === "theme") return [];
    if (typeof entry === "string") return [entry];
    return menuIds(entry.items);
  });

describe("editor menus", () => {
  const commands = editorCommands();

  it("only name commands that exist", () => {
    // A typo would otherwise drop the item from the menu without a sound.
    const missing = EDITOR_MENUS.flatMap((menu) => menuIds(menu.items)).filter(
      (id) => !commands[id]
    );
    expect(missing).toEqual([]);
  });

  it("give every command its own keys", () => {
    const owners = new Map<string, string>();
    const clashes: string[] = [];
    for (const command of Object.values(commands)) {
      for (const shortcut of command.shortcuts ?? []) {
        // Keys like "+" match with or without Shift, so Shift isn't part of them.
        const shift = shortcut.key.length === 1 && /[?+=-]/.test(shortcut.key) ? "" : !!shortcut.shift;
        const signature = `${!!shortcut.mod}|${!!shortcut.alt}|${shift}|${shortcut.key.toLowerCase()}`;
        const owner = owners.get(signature);
        if (owner && owner !== command.id) clashes.push(`${owner} / ${command.id}: ${signature}`);
        owners.set(signature, command.id);
      }
    }
    expect(clashes).toEqual([]);
  });
});
