import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { isEditorChrome } from "@/utils/editorObjects";
import { renderObjectsRegion } from "@/utils/flatten";
import { MAX_SEGMENTATION_DIMENSION } from "@/utils/cutout";
import { removeBackground, type RemoveBackgroundOptions } from "@/utils/backgroundRemoval";
import { encodePng } from "@/raster/pngEncoder";
import { releaseSurface } from "@/raster/pixelLayer";
import { Mask, SELECTED } from "./mask";
import { documentGrid, sameGrid, type DocumentGrid } from "./state";

/** Matte values this faint are noise, not subject. */
const MATTE_FLOOR = 13;
/** Matte values this strong are all subject. */
const MATTE_CEILING = 242;

/**
 * A selection from the alpha channel of a matte (RGBA pixels the grid's
 * size). The faint haze a matte leaves over the background is dropped and
 * near-solid areas become solid, keeping the soft edge in between.
 */
export function maskFromAlpha(pixels: Uint8ClampedArray, width: number, height: number): Mask {
  const mask = new Mask(width, height);
  for (let index = 0; index < mask.data.length; index += 1) {
    const alpha = pixels[index * 4 + 3]!;
    mask.data[index] = alpha < MATTE_FLOOR ? 0 : alpha > MATTE_CEILING ? 255 : alpha;
  }
  return mask;
}

/**
 * Keep a matte's partial values only within `reach` pixels of where it is
 * solid: a soft edge around the subject stays, faint specks far from it go.
 */
export function keepNearSolid(matte: Mask, reach: number): Mask {
  const solid = new Mask(
    matte.width,
    matte.height,
    matte.data.map((value) => (value >= SELECTED ? 255 : 0))
  );
  if (solid.isEmpty()) return new Mask(matte.width, matte.height);
  return matte.combine(solid.expanded(reach), "intersect");
}

export interface SubjectSelection {
  mask: Mask;
  grid: DocumentGrid;
}

type Segmenter = (image: Blob, options: RemoveBackgroundOptions) => Promise<Blob>;

/**
 * Select › Subject: the on-device model finds the main subject of what is
 * seen, and its soft matte becomes the selection. Null when the document
 * changed while the model ran.
 */
export async function selectSubject(
  canvas: FabricCanvas,
  options: RemoveBackgroundOptions = {},
  segment: Segmenter = removeBackground
): Promise<SubjectSelection | null> {
  const grid = documentGrid(canvas);
  if (!grid) throw new Error("Open a photo first");

  // The model looks at no more than 1024 pixels a side.
  const reduction = Math.min(1, MAX_SEGMENTATION_DIMENSION / Math.max(grid.width, grid.height));
  const region = { left: grid.left, top: grid.top, width: grid.width / grid.scale, height: grid.height / grid.scale };
  const { element } = renderObjectsRegion(
    canvas,
    region,
    grid.scale * reduction,
    (object: FabricObject) => !isEditorChrome(object) && object.visible !== false
  );
  let image: Blob;
  try {
    image = await encodePng(element);
  } finally {
    releaseSurface(element);
  }

  const matte = await createImageBitmap(await segment(image, options));
  try {
    const current = documentGrid(canvas);
    if (!current || !sameGrid(current, grid)) return null;
    const surface = document.createElement("canvas");
    surface.width = grid.width;
    surface.height = grid.height;
    try {
      const context = surface.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("The browser could not read the subject");
      context.imageSmoothingQuality = "high";
      context.drawImage(matte, 0, 0, grid.width, grid.height);
      const pixels = context.getImageData(0, 0, grid.width, grid.height).data;
      // A few of the model's pixels of soft edge.
      const reach = Math.max(2, Math.ceil(3 / reduction));
      return { mask: keepNearSolid(maskFromAlpha(pixels, grid.width, grid.height), reach), grid };
    } finally {
      releaseSurface(surface);
    }
  } finally {
    matte.close();
  }
}
