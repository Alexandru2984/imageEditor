import { Point, util, type Canvas as FabricCanvas, type FabricImage, type FabricObject, type TMat2D } from "fabric";
import { isEditorChrome } from "@/utils/editorObjects";
import { nativeMultiplier, renderObjectsRegion } from "@/utils/flatten";
import { floodFillMask } from "./floodFill";
import { documentPixelRegion } from "./layerOps";
import { hexToRgb } from "./painter";
import { beginPixelEdit, releaseSurface } from "./pixelLayer";

export interface BucketOptions {
  /** 0–255 */
  tolerance: number;
  contiguous: boolean;
  /** Decide what to fill from what is seen (all layers), not this layer alone. */
  sampleAll: boolean;
  /** 0–100 */
  opacity: number;
}

export const DEFAULT_BUCKET_OPTIONS: BucketOptions = {
  tolerance: 32,
  contiguous: true,
  sampleAll: true,
  opacity: 100,
};

/** Maps a layer's pixel coordinates from scene coordinates. */
export function sceneToLayerMatrix(layer: FabricImage): TMat2D {
  const toPixels: TMat2D = [
    1,
    0,
    0,
    1,
    layer.width / 2 + (layer.cropX ?? 0),
    layer.height / 2 + (layer.cropY ?? 0),
  ];
  return util.multiplyTransformMatrices(toPixels, util.invertTransform(layer.calcTransformMatrix()));
}

/**
 * Paint bucket: fill the area around a scene point on `layer` with `color`.
 * The area is found on the document's pixel grid, from what is visible there
 * or from the layer alone, then painted into the layer's own pixels.
 * Returns whether the click landed on the layer at all.
 */
export function bucketFill(
  canvas: FabricCanvas,
  layer: FabricImage,
  point: { x: number; y: number },
  color: string,
  options: BucketOptions
): boolean {
  const multiplier = nativeMultiplier(canvas);
  const region = documentPixelRegion(canvas, [layer], multiplier);
  const include = options.sampleAll
    ? (object: FabricObject) =>
        object === layer || (!isEditorChrome(object) && object.visible !== false)
    : (object: FabricObject) => object === layer;

  // Alone, the layer is judged by its own pixels, not how it is blended.
  const kept = { opacity: layer.opacity, globalCompositeOperation: layer.globalCompositeOperation };
  if (!options.sampleAll) layer.set({ opacity: 1, globalCompositeOperation: "source-over" });
  let rendered: ReturnType<typeof renderObjectsRegion>;
  try {
    rendered = renderObjectsRegion(canvas, region, multiplier, include);
  } finally {
    layer.set(kept);
  }
  const { element, plan } = rendered;
  try {
    const context = element.getContext("2d");
    if (!context) throw new Error("The browser could not read the pixels to fill");
    const { width, height } = element;
    const image = context.getImageData(0, 0, width, height);
    const mask = floodFillMask(
      image.data,
      width,
      height,
      (point.x - region.left) * plan.multiplier,
      (point.y - region.top) * plan.multiplier,
      options
    );
    if (!mask) return false;

    // Reuse the sampled pixels as the paint: the colour where the mask is set.
    const [red, green, blue] = hexToRgb(color);
    const alpha = Math.round((255 * options.opacity) / 100);
    const data = image.data;
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4;
      if (mask[index]) {
        data[offset] = red;
        data[offset + 1] = green;
        data[offset + 2] = blue;
        data[offset + 3] = alpha;
      } else {
        data[offset + 3] = 0;
      }
    }
    context.putImageData(image, 0, 0);

    const { context: target } = beginPixelEdit(layer);
    const fromRegion: TMat2D = [1 / plan.multiplier, 0, 0, 1 / plan.multiplier, region.left, region.top];
    const matrix = util.multiplyTransformMatrices(sceneToLayerMatrix(layer), fromRegion);
    target.save();
    target.setTransform(...matrix);
    target.drawImage(element, 0, 0);
    target.restore();
    return true;
  } finally {
    releaseSurface(element);
  }
}

/**
 * Paint bucket on pixels of their own, such as a layer mask: the area around
 * a scene point is found in those pixels alone and filled with `color`.
 */
export function bucketFillPixels(
  layer: FabricImage,
  point: { x: number; y: number },
  color: string,
  options: BucketOptions
): boolean {
  const { surface, context } = beginPixelEdit(layer);
  const seed = util.transformPoint(new Point(point.x, point.y), sceneToLayerMatrix(layer));
  const { width, height } = surface;
  const image = context.getImageData(0, 0, width, height);
  const area = floodFillMask(image.data, width, height, seed.x, seed.y, options);
  if (!area) return false;
  const [red, green, blue] = hexToRgb(color);
  const alpha = Math.round((255 * options.opacity) / 100);
  const data = image.data;
  for (let index = 0; index < area.length; index += 1) {
    const offset = index * 4;
    if (area[index]) {
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = alpha;
    } else {
      data[offset + 3] = 0;
    }
  }
  const paint = document.createElement("canvas");
  paint.width = width;
  paint.height = height;
  try {
    paint.getContext("2d")?.putImageData(image, 0, 0);
    context.drawImage(paint, 0, 0);
  } finally {
    releaseSurface(paint);
  }
  return true;
}
