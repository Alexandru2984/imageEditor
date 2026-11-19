import { util, type Canvas as FabricCanvas, type FabricImage, type TMat2D } from "fabric";
import { isEditorChrome } from "@/utils/editorObjects";
import { nativeMultiplier, renderObjectsRegion } from "@/utils/flatten";
import { sceneToLayerMatrix } from "./fill";
import { documentPixelRegion } from "./layerOps";
import { releaseSurface } from "./pixelLayer";

/**
 * Everything visible, as it lines up with a layer's own pixels (`width` ×
 * `height`): what "Sample all layers" tools take their pixels from.
 */
export function visibleInLayerPixels(canvas: FabricCanvas, layer: FabricImage, width: number, height: number): Uint8ClampedArray {
  const multiplier = nativeMultiplier(canvas);
  const region = documentPixelRegion(canvas, [layer], multiplier);
  const { element, plan } = renderObjectsRegion(
    canvas,
    region,
    multiplier,
    (object) => !isEditorChrome(object) && object.visible !== false
  );
  const target = document.createElement("canvas");
  try {
    target.width = width;
    target.height = height;
    const context = target.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The browser could not read the layers");
    const fromRegion: TMat2D = [1 / plan.multiplier, 0, 0, 1 / plan.multiplier, region.left, region.top];
    context.setTransform(...util.multiplyTransformMatrices(sceneToLayerMatrix(layer), fromRegion));
    context.drawImage(element, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  } finally {
    releaseSurface(element);
    releaseSurface(target);
  }
}
