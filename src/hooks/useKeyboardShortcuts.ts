import { useEffect, useLayoutEffect, useRef } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { isReadOnlySelection } from "@/utils/editorObjects";
import { matchesShortcut } from "@/commands/shortcuts";
import type { Command } from "@/commands/types";

interface UseKeyboardShortcutsOptions {
  canvas: FabricCanvas | null;
  /** Every command; their shortcuts are matched in order. */
  commands: readonly Command[];
}

// Inputs that take no typing: once a colour is picked, B still means brush.
// (Range inputs stay out: their arrow keys would also nudge the layer.)
const KEYLESS_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "reset", "submit"]);

const isTypingTarget = (target: HTMLElement): boolean =>
  (target instanceof HTMLInputElement && !KEYLESS_INPUTS.has(target.type)) ||
  target.tagName === "TEXTAREA" ||
  target.tagName === "SELECT" ||
  target.isContentEditable;

const NUDGE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/**
 * Runs command shortcuts, plus the few keys that act on the canvas directly:
 * Escape deselects and the arrow keys nudge the selection.
 */
export function useKeyboardShortcuts({ canvas, commands }: UseKeyboardShortcutsOptions): void {
  // Read through a ref so a new command list doesn't re-subscribe the
  // listener. Updated before the browser handles any further input.
  const commandsRef = useRef(commands);
  useLayoutEffect(() => {
    commandsRef.current = commands;
  }, [commands]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A control already used the key (a slider's arrows, a tab list's).
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      // Typing in a field, and dialogs and menus, own the keyboard.
      if (isTypingTarget(target)) return;
      if (target.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;

      // While a text layer is being edited on the canvas, only Escape leaves.
      const activeObject = canvas?.getActiveObject() as { isEditing?: boolean } | undefined;
      if (activeObject?.isEditing && e.key !== "Escape") return;

      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!canvas) return;
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }

      // Arrow keys nudge the selected layer (Shift = 10 px steps).
      if (NUDGE_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = canvas?.getActiveObject();
        if (!canvas || !active) return;
        e.preventDefault();
        if (isReadOnlySelection(active)) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") active.left -= step;
        else if (e.key === "ArrowRight") active.left += step;
        else if (e.key === "ArrowUp") active.top -= step;
        else active.top += step;
        active.setCoords();
        canvas.fire("object:modified", { target: active });
        canvas.requestRenderAll();
        return;
      }

      for (const command of commandsRef.current) {
        if (command.shortcutsDisplayOnly || !command.shortcuts) continue;
        if (!command.shortcuts.some((shortcut) => matchesShortcut(e, shortcut))) continue;
        // A disabled command leaves the key to the browser (Ctrl+C with
        // nothing selected still copies selected page text).
        if (command.isEnabled && !command.isEnabled()) return;
        e.preventDefault();
        if (e.repeat && !command.repeat) return;
        command.run();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canvas]);
}
