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
  fillForeground: [{ key: "Backspace", alt: true }],
  fillBackground: [{ key: "Backspace", mod: true }],
  contentAwareFill: [{ key: "Backspace", shift: true }],
  imageSize: [{ key: "i", mod: true, alt: true }],
  canvasSize: [{ key: "c", mod: true, alt: true }],
  // Browsers keep Ctrl+T for a new tab; Ctrl+Alt+T works everywhere.
  freeTransform: [{ key: "t", mod: true, alt: true }, { key: "t", mod: true }],

  duplicate: [{ key: "j", mod: true }],
  groupLayers: [{ key: "g", mod: true }],
  ungroupLayers: [{ key: "g", mod: true, shift: true }],
  clippingMask: [{ key: "g", mod: true, alt: true }],
  layerViaCut: [{ key: "j", mod: true, shift: true }],
  editLayerMask: [{ key: "\\", mod: true }],
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

  levels: [{ key: "l", mod: true }],
  curves: [{ key: "m", mod: true }],
  hueSaturation: [{ key: "u", mod: true }],
  colorBalance: [{ key: "b", mod: true }],
  blackWhite: [{ key: "b", mod: true, alt: true, shift: true }],
  invert: [{ key: "i", mod: true }],
  desaturate: [{ key: "u", mod: true, shift: true }],

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
  quickMask: [{ key: "q" }],

  zoomIn: [{ key: "=", mod: true }, { key: "+", mod: true }, { key: "+" }, { key: "=" }],
  zoomOut: [{ key: "-", mod: true }, { key: "-" }],
  fitOnScreen: [{ key: "0", mod: true }],
  actualPixels: [{ key: "1", mod: true }],
  toggleSnap: [{ key: ";", mod: true, shift: true }],
  rulers: [{ key: "r", mod: true }],
  showGrid: [{ key: "'", mod: true }],
  showGuides: [{ key: ";", mod: true }],
  lockGuides: [{ key: ";", mod: true, alt: true }],
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
  cloneStampTool: [{ key: "s" }],
  healingTool: [{ key: "j" }],
  nextHealingTool: [{ key: "j", shift: true }],
  toningTool: [{ key: "o" }],
  nextToningTool: [{ key: "o", shift: true }],
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
  penTool: [{ key: "p" }],
  directSelectTool: [{ key: "a" }],
  eyedropper: [{ key: "i" }],
} satisfies Record<string, Shortcut[]>;
