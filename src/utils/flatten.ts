import type { Canvas as FabricCanvas, TBBox, TMat2D } from "fabric";
import { findBackgroundImage } from "./viewport";

/**
 * Render a scene-space region (crop/selection box) to a PNG data URL at the
 * background photo's native resolution, ignoring the current zoom/pan. Shared
 * by the crop tool and the marquee's "new layer from selection".
 */
export function flattenRegion(canvas: FabricCanvas, region: TBBox): string {
  const prevVpt = [...canvas.viewportTransform] as TMat2D;
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

  const bgImage = findBackgroundImage(canvas);
  const multiplier = bgImage ? bgImage.width / bgImage.getScaledWidth() : 1;

  const dataURL = canvas.toDataURL({
    format: "png",
    quality: 1,
    multiplier,
    left: region.left,
    top: region.top,
    width: region.width,
    height: region.height,
  });

  canvas.setViewportTransform(prevVpt);
  return dataURL;
}
