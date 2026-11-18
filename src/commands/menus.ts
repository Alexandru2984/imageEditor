import type { MenuDefinition } from "./types";

/** The editor's menu bar. Entries are command ids (see useEditorCommands). */
export const EDITOR_MENUS: readonly MenuDefinition[] = [
  {
    label: "File",
    items: [
      "file.new",
      "file.openImage",
      "file.openProject",
      "-",
      "file.placeImage",
      "-",
      "file.saveProject",
      "file.export",
    ],
  },
  {
    label: "Edit",
    items: ["edit.undo", "edit.redo", "-", "edit.cut", "edit.copy", "edit.paste", "edit.delete"],
  },
  {
    label: "Image",
    items: [
      "image.rotateCounterClockwise",
      "image.rotateClockwise",
      "image.flipHorizontal",
      "image.flipVertical",
      "-",
      "tool.crop",
      "-",
      "ai.removeBackground",
      "ai.extractSubject",
    ],
  },
  {
    label: "Layer",
    items: [
      "file.placeImage",
      "layer.duplicate",
      "-",
      {
        label: "Arrange",
        items: [
          "layer.bringToFront",
          "layer.bringForward",
          "layer.sendBackward",
          "layer.sendToBack",
        ],
      },
      "layer.toggleLock",
      "-",
      "layer.clearUnlocked",
    ],
  },
  {
    label: "Select",
    items: ["select.allLayers", "select.deselect", "-", "tool.marquee"],
  },
  {
    label: "Filter",
    items: ["filter.adjustments"],
  },
  {
    label: "View",
    items: [
      "view.zoomIn",
      "view.zoomOut",
      "view.fitOnScreen",
      "view.actualPixels",
      "-",
      "view.snap",
      "-",
      "view.propertiesPanel",
      "view.adjustPanel",
      "view.layersPanel",
      "-",
      "theme",
    ],
  },
  {
    label: "Help",
    items: ["help.shortcuts"],
  },
];
