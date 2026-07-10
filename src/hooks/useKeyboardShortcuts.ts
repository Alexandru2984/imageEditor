import { useEffect } from "react";
import { Canvas as FabricCanvas, ActiveSelection } from "fabric";
import { clampZoom, fitToScreen } from "@/utils/viewport";
import type { Tool } from "@/types/editor";

interface UseKeyboardShortcutsOptions {
  canvas: FabricCanvas | null;
  undo: () => void;
  redo: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onToolChange: (tool: Tool) => void;
}

export function useKeyboardShortcuts({
  canvas,
  undo,
  redo,
  zoom,
  onZoomChange,
  onToolChange,
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

      // Check if a text object is being actively edited on canvas
      if (canvas) {
        const activeObj = canvas.getActiveObject();
        if (activeObj && "isEditing" in activeObj && (activeObj as { isEditing: boolean }).isEditing) {
          // Allow only Escape to exit text editing
          if (e.key !== "Escape") return;
        }
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

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
          if (active instanceof ActiveSelection) {
            active.getObjects().forEach((obj) => canvas.remove(obj));
            canvas.discardActiveObject();
          } else {
            canvas.remove(active);
          }
          canvas.renderAll();
        }
        return;
      }

      // Ctrl+Z — undo
      if (isCtrlOrMeta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z — redo
      if (
        (isCtrlOrMeta && e.key === "y") ||
        (isCtrlOrMeta && e.key === "z" && e.shiftKey)
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+A — select all
      if (isCtrlOrMeta && e.key === "a") {
        if (!canvas) return;
        e.preventDefault();
        const objects = canvas
          .getObjects()
          .filter((obj) => obj.selectable !== false);
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
        switch (e.key.toLowerCase()) {
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
          case "t":
            onToolChange("text");
            break;
          case "k":
            onToolChange("crop");
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canvas, undo, redo, zoom, onZoomChange, onToolChange]);
}
