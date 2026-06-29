import { useEffect } from "react";
import { Canvas as FabricCanvas, ActiveSelection } from "fabric";
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

      // + / = — zoom in
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        const newZoom = Math.min(zoom + 0.1, 5);
        onZoomChange(parseFloat(newZoom.toFixed(2)));
        return;
      }

      // - — zoom out
      if (e.key === "-") {
        e.preventDefault();
        const newZoom = Math.max(zoom - 0.1, 0.1);
        onZoomChange(parseFloat(newZoom.toFixed(2)));
        return;
      }

      // Tool shortcuts (only without modifiers)
      if (!isCtrlOrMeta && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case "b":
            onToolChange("draw");
            break;
          case "v":
            onToolChange("select");
            break;
          case "t":
            onToolChange("text");
            break;
          case "e":
            onToolChange("eraser");
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canvas, undo, redo, zoom, onZoomChange, onToolChange]);
}
