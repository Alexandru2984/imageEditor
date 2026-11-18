import type { Shortcut } from "./shortcuts";

// Default shortcuts, following Photoshop where the browser allows it. The
// first entry of each list is the one shown in menus and tooltips.
export const KEYMAP = {
  openImage: [{ key: "o", mod: true }],
  saveProject: [{ key: "s", mod: true }],
  exportImage: [{ key: "w", mod: true, alt: true, shift: true }],

  undo: [{ key: "z", mod: true }],
  redo: [
    { key: "z", mod: true, shift: true },
    { key: "y", mod: true },
  ],
  cut: [{ key: "x", mod: true }],
  copy: [{ key: "c", mod: true }],
  // Pasting is driven by the browser's paste event (it carries images).
  paste: [{ key: "v", mod: true }],
  delete: [{ key: "Delete" }, { key: "Backspace" }],

  duplicate: [{ key: "j", mod: true }],
  // Ctrl+Shift+N is the browser's private window; Photoshop's no-dialog
  // variant adds Alt.
  newLayer: [{ key: "n", mod: true, shift: true, alt: true }],
  mergeDown: [{ key: "e", mod: true }],
  mergeVisible: [{ key: "e", mod: true, shift: true }],
  bringToFront: [{ key: "]", mod: true, shift: true }],
  bringForward: [{ key: "]", mod: true }],
  sendBackward: [{ key: "[", mod: true }],
  sendToBack: [{ key: "[", mod: true, shift: true }],
  lockLayer: [{ key: "/", mod: true }],

  flipHorizontal: [{ key: "h", shift: true }],
  flipVertical: [{ key: "v", shift: true }],

  selectAll: [{ key: "a", mod: true }],
  selectAllLayers: [{ key: "a", mod: true, alt: true }],
  deselect: [{ key: "d", mod: true }],
  reselect: [{ key: "d", mod: true, shift: true }],
  selectInverse: [
    { key: "i", mod: true, shift: true },
    { key: "F7", shift: true },
  ],
  featherSelection: [{ key: "F6", shift: true }],

  zoomIn: [{ key: "=", mod: true }, { key: "+", mod: true }, { key: "+" }, { key: "=" }],
  zoomOut: [{ key: "-", mod: true }, { key: "-" }],
  fitOnScreen: [{ key: "0", mod: true }],
  actualPixels: [{ key: "1", mod: true }],
  toggleSnap: [{ key: ";", mod: true, shift: true }],
  layersPanel: [{ key: "F7" }],

  shortcuts: [{ key: "?" }],
  commandPalette: [{ key: "k", mod: true }],

  brushSmaller: [{ key: "[" }],
  brushLarger: [{ key: "]" }],
  brushSofter: [{ key: "[", shift: true }],
  brushHarder: [{ key: "]", shift: true }],

  swapColors: [{ key: "x" }],
  defaultColors: [{ key: "d" }],

  selectTool: [{ key: "v" }],
  brushTool: [{ key: "b" }],
  nextBrushTool: [{ key: "b", shift: true }],
  eraserTool: [{ key: "e" }],
  fillTool: [{ key: "g" }],
  nextFillTool: [{ key: "g", shift: true }],
  shapeTool: [{ key: "u" }],
  nextShape: [{ key: "u", shift: true }],
  textTool: [{ key: "t" }],
  marqueeTool: [{ key: "m" }],
  nextMarqueeTool: [{ key: "m", shift: true }],
  lassoTool: [{ key: "l" }],
  nextLassoTool: [{ key: "l", shift: true }],
  magicWandTool: [{ key: "w" }],
  cropTool: [{ key: "c" }],
  eyedropper: [{ key: "i" }],
} satisfies Record<string, Shortcut[]>;
