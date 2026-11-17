import { useEffect } from "react";
import { Canvas as FabricCanvas, ActiveSelection } from "fabric";
import { clampZoom, fitToScreen } from "@/utils/viewport";
import {
  isEditorChrome,
  isProtectedObject,
  isReadOnlySelection,
  removeSelectedObjects,
} from "@/utils/editorObjects";
import type { Tool } from "@/types/editor";

interface UseKeyboardShortcutsOptions {
  canvas: FabricCanvas | null;
  undo: () => void;
  redo: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onToolChange: (tool: Tool) => void;
  /** Editor-level commands; each is optional so the hook stays reusable. */
  actions?: ShortcutActions;
}

export interface ShortcutActions {
  save?: () => void;
  exportImage?: () => void;
  duplicate?: () => void;
  copy?: () => void;
  arrange?: (action: "front" | "forward" | "backward" | "back") => void;
  flip?: (axis: "x" | "y") => void;
  pickColor?: () => void;
  showShortcuts?: () => void;
}

export function useKeyboardShortcuts({
  canvas,
  undo,
  redo,
  zoom,
  onZoomChange,
  onToolChange,
  actions,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts when typing in an input/textarea or Fabric IText
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      // Dialogs and menus own the keyboard while they are open.
      if (target.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"]')) {
        return;
      }

      // Check if a text object is being actively edited on canvas
      if (canvas) {
        const activeObj = canvas.getActiveObject();
        if (activeObj && "isEditing" in activeObj && (activeObj as { isEditing: boolean }).isEditing) {
          // Allow only Escape to exit text editing
          if (e.key !== "Escape") return;
        }
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      // With Shift or Caps Lock held, letters arrive upper-case ("Z").
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      // Delete / Backspace — delete selected object
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (active) {
          e.preventDefault();
          // The crop overlay is UI chrome — cancel the crop instead of
          // deleting the rect out from under the crop tool
          if ((active as unknown as Record<string, unknown>).__isCropOverlay) {
            onToolChange("select");
            return;
          }
          removeSelectedObjects(canvas);
        }
        return;
      }

      // Ctrl+S — save a project file; Ctrl+E — export dialog
      if (isCtrlOrMeta && key === "s" && !e.shiftKey && actions?.save) {
        e.preventDefault();
        actions.save();
        return;
      }
      if (isCtrlOrMeta && key === "e" && !e.shiftKey && actions?.exportImage) {
        e.preventDefault();
        actions.exportImage();
        return;
      }

      // Ctrl+D — duplicate; Ctrl+C — copy layers (paste is a paste event)
      if (isCtrlOrMeta && key === "d" && actions?.duplicate) {
        e.preventDefault();
        actions.duplicate();
        return;
      }
      if (isCtrlOrMeta && key === "c" && !e.shiftKey && actions?.copy) {
        if (canvas?.getActiveObject()) actions.copy();
        return;
      }

      // Ctrl+] / Ctrl+[ — forward / backward; with Shift — front / back
      if (isCtrlOrMeta && (e.code === "BracketRight" || e.code === "BracketLeft") && actions?.arrange) {
        e.preventDefault();
        const up = e.code === "BracketRight";
        actions.arrange(e.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward");
        return;
      }

      // Shift+H / Shift+V — flip the selection (or the whole image)
      if (!isCtrlOrMeta && !e.altKey && e.shiftKey && (key === "h" || key === "v") && actions?.flip) {
        e.preventDefault();
        actions.flip(key === "h" ? "x" : "y");
        return;
      }

      // ? — keyboard shortcut reference
      if (e.key === "?" && actions?.showShortcuts) {
        e.preventDefault();
        actions.showShortcuts();
        return;
      }

      // Ctrl+Z — undo
      if (isCtrlOrMeta && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z — redo
      if (
        (isCtrlOrMeta && key === "y") ||
        (isCtrlOrMeta && key === "z" && e.shiftKey)
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+A — select all
      if (isCtrlOrMeta && key === "a") {
        if (!canvas) return;
        e.preventDefault();
        const objects = canvas
          .getObjects()
          .filter(
            (object) =>
              !isEditorChrome(object) && !isProtectedObject(object)
          );
        if (objects.length > 0) {
          const selection = new ActiveSelection(objects, { canvas });
          canvas.setActiveObject(selection);
          canvas.renderAll();
        }
        return;
      }

      // Escape — deselect
      if (e.key === "Escape") {
        if (!canvas) return;
        canvas.discardActiveObject();
        canvas.renderAll();
        return;
      }

      // Arrow keys — nudge the selected object (Shift = 10px steps)
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (!active) return;
        e.preventDefault();
        if (isReadOnlySelection(active)) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") active.left -= step;
        else if (e.key === "ArrowRight") active.left += step;
        else if (e.key === "ArrowUp") active.top -= step;
        else active.top += step;
        active.setCoords();
        canvas.fire("object:modified", { target: active });
        canvas.renderAll();
        return;
      }

      // Ctrl+0 — fit to screen
      if (isCtrlOrMeta && e.key === "0") {
        if (!canvas) return;
        e.preventDefault();
        onZoomChange(fitToScreen(canvas));
        return;
      }

      // + / = — zoom in
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        onZoomChange(clampZoom(zoom + 0.1));
        return;
      }

      // - — zoom out
      if (e.key === "-") {
        e.preventDefault();
        onZoomChange(clampZoom(zoom - 0.1));
        return;
      }

      // Tool shortcuts (only without modifiers)
      if (!isCtrlOrMeta && !e.altKey) {
        switch (key) {
          case "v":
            onToolChange("select");
            break;
          case "b":
            onToolChange("draw");
            break;
          case "e":
            onToolChange("eraser");
            break;
          case "r":
            onToolChange("rectangle");
            break;
          case "c":
            onToolChange("circle");
            break;
          case "l":
            onToolChange("line");
            break;
          case "a":
            onToolChange("arrow");
            break;
          case "y":
            onToolChange("triangle");
            break;
          case "s":
            onToolChange("star");
            break;
          case "t":
            onToolChange("text");
            break;
          case "m":
            onToolChange("marquee");
            break;
          case "k":
            onToolChange("crop");
            break;
          case "i":
            actions?.pickColor?.();
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canvas, undo, redo, zoom, onZoomChange, onToolChange, actions]);
}
