import { FabricImage, FabricObject } from "fabric";
import { installLayerMasks } from "@/raster/layerMask";
import { installLayerStyles } from "@/raster/layerStyle";
import { installCompositor } from "@/compositing/compositor";
import { registerGroupClasses } from "@/layers/groupMarkers";
import { registerAdjustmentClasses } from "@/adjustments/adjustmentLayer";

/**
 * Fabric 7 changed the default object origin from left/top to center. Every
 * placement in this editor (image fitting, crop frames, marquee regions, masks,
 * AI cutouts, inserted shapes) is expressed as a top-left corner, and project
 * files written by earlier builds rely on the same convention. Restore it once,
 * before any object is constructed.
 */
export function applyFabricDefaults(): void {
  FabricObject.ownDefaults.originX = "left";
  FabricObject.ownDefaults.originY = "top";
  // Pixel layers often span the whole photo with mostly transparent pixels.
  // A click picks the layer whose pixels are under it, as Photoshop's
  // auto-select does, rather than whichever layer's box is on top.
  FabricImage.ownDefaults.perPixelTargetFind = true;
  // Images draw through their layer masks.
  installLayerMasks();
  // Layers draw their styles (shadow, glow, overlay, stroke).
  installLayerStyles();
  // Layer groups and clipping masks: the markers load from files, and every
  // canvas composes the stack through them.
  registerGroupClasses();
  // Adjustment layers load from files too; the compositor applies them.
  registerAdjustmentClasses();
  installCompositor();
}

applyFabricDefaults();
