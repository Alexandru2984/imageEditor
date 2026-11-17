import { FabricObject } from "fabric";

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
}

applyFabricDefaults();
