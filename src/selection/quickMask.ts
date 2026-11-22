import { FabricImage, type Canvas as FabricCanvas } from "fabric";
import { editSession, linkPixelOwner, releaseSurface, type PixelRect } from "@/raster/pixelLayer";
import { Mask } from "./mask";
import { documentGrid, sameGrid, selectionOf, type DocumentGrid } from "./state";

/**
 * Quick Mask (Q), as in Photoshop: the selection shown as red over what is
 * not selected, and painted with the brush, eraser, paint bucket and
 * gradient (white selects, black masks, greys select partly). The selection
 * stays the one record of it: each stroke sets the selection, so it is a
 * step in the history like any other change, and leaving the mode leaves
 * the selection painted.
 */

/** The red's strength over what is not selected, Photoshop's default. */
export const QUICK_MASK_OPACITY = 0.5;

interface QuickMaskPixels {
  /** Grey pixels over the document grid, for the paint tools. */
  image: FabricImage;
  /** The selection the pixels show (made from, or saved to); null: nothing selected. */
  source: Mask | null;
  grid: DocumentGrid;
  /** Red, as opaque as the pixels are dark, for the overlay. */
  tint: HTMLCanvasElement;
  /** The part of the tint that no longer matches the pixels. */
  stale: PixelRect | null;
  /** The part of the pixels painted since they were last saved to the selection. */
  dirty: PixelRect | null;
}

const states = new WeakMap<FabricCanvas, QuickMaskPixels>();
/** The selection made on entering with none: leaving it untouched selects nothing again. */
const entered = new WeakMap<FabricCanvas, Mask>();

const union = (a: PixelRect | null, b: PixelRect): PixelRect =>
  a
    ? {
        left: Math.min(a.left, b.left),
        top: Math.min(a.top, b.top),
        right: Math.max(a.right, b.right),
        bottom: Math.max(a.bottom, b.bottom),
      }
    : b;

/** A rect inside a width × height surface, or null once nothing of it is left. */
function clampRect(rect: PixelRect, width: number, height: number): PixelRect | null {
  const left = Math.max(0, Math.floor(rect.left));
  const top = Math.max(0, Math.floor(rect.top));
  const right = Math.min(width, Math.ceil(rect.right));
  const bottom = Math.min(height, Math.ceil(rect.bottom));
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function newCanvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the quick mask");
  return { element, context };
}

/** Red (little-endian RGBA words) as opaque as the selection value is low. */
const tintWord = (value: number) => ((255 - value) << 24) | 0xff;

function build(grid: DocumentGrid, source: Mask | null): QuickMaskPixels {
  const { width, height } = grid;
  const grey = newCanvas(width, height);
  const tint = newCanvas(width, height);
  const greyPixels = grey.context.createImageData(width, height);
  const tintPixels = tint.context.createImageData(width, height);
  const greyWords = new Uint32Array(greyPixels.data.buffer);
  const tintWords = new Uint32Array(tintPixels.data.buffer);
  if (source) {
    const data = source.data;
    for (let index = 0; index < data.length; index += 1) {
      const value = data[index]!;
      greyWords[index] = 0xff000000 | (value << 16) | (value << 8) | value;
      tintWords[index] = tintWord(value);
    }
  } else {
    greyWords.fill(0xff000000);
    tintWords.fill(tintWord(0));
  }
  grey.context.putImageData(greyPixels, 0, 0);
  tint.context.putImageData(tintPixels, 0, 0);

  const image = new FabricImage(grey.element, {
    originX: "left",
    originY: "top",
    left: grid.left,
    top: grid.top,
    scaleX: 1 / grid.scale,
    scaleY: 1 / grid.scale,
    objectCaching: false,
  });
  const state: QuickMaskPixels = { image, source, grid, tint: tint.element, stale: null, dirty: null };
  const whole = { left: 0, top: 0, right: width, bottom: height };
  linkPixelOwner(image, {
    owner: image,
    // Painting goes on a copy; the first pixels are no longer needed.
    began: (surface) => {
      if (surface !== grey.element) releaseSurface(grey.element);
    },
    changed: (rect) => {
      state.stale = union(state.stale, rect ?? whole);
      state.dirty = union(state.dirty, rect ?? whole);
    },
    committed: () => {},
  });
  return state;
}

function release(state: QuickMaskPixels) {
  releaseSurface(state.tint);
  const surface = editSession(state.image)?.surface ?? (state.image.getElement() as HTMLCanvasElement);
  releaseSurface(surface);
}

const pixelsOf = (state: QuickMaskPixels): HTMLCanvasElement =>
  editSession(state.image)?.surface ?? (state.image.getElement() as HTMLCanvasElement);

/** The state for the current selection, made again once the selection or the document changed. */
function stateOf(canvas: FabricCanvas): QuickMaskPixels | null {
  const grid = documentGrid(canvas);
  if (!grid) return null;
  const selection = selectionOf(canvas).current();
  const source = selection?.mask ?? null;
  const known = states.get(canvas);
  if (known && known.source === source && sameGrid(known.grid, grid)) return known;
  if (known) release(known);
  const state = build(selection?.grid ?? grid, source);
  states.set(canvas, state);
  return state;
}

/** The pixels the paint tools paint in Quick Mask mode; null without a document. */
export function quickMaskPixels(canvas: FabricCanvas): FabricImage | null {
  return stateOf(canvas)?.image ?? null;
}

export function isQuickMaskPixels(canvas: FabricCanvas, image: FabricImage): boolean {
  return states.get(canvas)?.image === image;
}

/**
 * Save what was painted on the quick mask as the selection, as one history
 * step named `label`. Whether anything changed.
 */
export function commitQuickMask(canvas: FabricCanvas, image: FabricImage, label: string): boolean {
  const state = states.get(canvas);
  if (!state || state.image !== image || !state.dirty) return false;
  const { width, height } = state.grid;
  const rect = clampRect(state.dirty, width, height);
  state.dirty = null;
  if (!rect) return false;
  const context = pixelsOf(state).getContext("2d");
  if (!context) return false;
  const rectWidth = rect.right - rect.left;
  const pixels = context.getImageData(rect.left, rect.top, rectWidth, rect.bottom - rect.top).data;
  const data = state.source ? state.source.data.slice() : new Uint8Array(width * height);
  let changed = false;
  for (let y = rect.top; y < rect.bottom; y += 1) {
    let from = (y - rect.top) * rectWidth * 4;
    const row = y * width;
    for (let x = rect.left; x < rect.right; x += 1, from += 4) {
      const value = pixels[from]!;
      if (data[row + x] !== value) {
        data[row + x] = value;
        changed = true;
      }
    }
  }
  if (!changed) return false;
  const store = selectionOf(canvas);
  store.set(new Mask(width, height, data), state.grid, label);
  // The pixels already show it: no need to make them again.
  state.source = store.peek()?.mask ?? null;
  return true;
}

/** The red to lay over the document, brought up to date with the pixels; null without a document. */
export function quickMaskTint(canvas: FabricCanvas): { tint: HTMLCanvasElement; grid: DocumentGrid } | null {
  const state = stateOf(canvas);
  if (!state) return null;
  const rect = state.stale && clampRect(state.stale, state.grid.width, state.grid.height);
  state.stale = null;
  const context = rect ? pixelsOf(state).getContext("2d") : null;
  if (rect && context) {
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    const pixels = context.getImageData(rect.left, rect.top, width, height);
    const words = new Uint32Array(pixels.data.buffer);
    for (let index = 0; index < words.length; index += 1) words[index] = tintWord(words[index]! & 0xff);
    state.tint.getContext("2d")?.putImageData(pixels, rect.left, rect.top);
  }
  return { tint: state.tint, grid: state.grid };
}

/**
 * Select › Edit in Quick Mask Mode (Q). Entering with nothing selected
 * starts with everything selected (no red), as in Photoshop; leaving
 * without painting then selects nothing again. Whether the mode is on.
 */
export function toggleQuickMask(canvas: FabricCanvas): boolean {
  const store = selectionOf(canvas);
  if (store.quickMask) {
    store.setQuickMask(false);
    const untouched = entered.get(canvas);
    entered.delete(canvas);
    if (untouched && store.current()?.mask === untouched) store.set(null, undefined, "Exit Quick Mask");
    const state = states.get(canvas);
    states.delete(canvas);
    if (state) release(state);
    return false;
  }
  const grid = documentGrid(canvas);
  if (!grid) return false;
  // A polygon being drawn becomes part of the selection first.
  store.draft?.finish();
  if (!store.current()) {
    const everything = Mask.full(grid.width, grid.height);
    store.set(everything, grid, "Quick Mask");
    entered.set(canvas, everything);
  } else {
    entered.delete(canvas);
  }
  store.setQuickMask(true);
  return true;
}
