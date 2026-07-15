import type { Canvas as FabricCanvas, TBBox, TMat2D } from "fabric";
import { findBackgroundImage } from "./viewport";

export const MAX_RASTER_SIDE = 8_192;
export const MAX_RASTER_PIXELS = 16_000_000;
const MAX_SCENE_COORDINATE = 1_000_000_000;

export interface RasterPlan {
  multiplier: number;
  outputWidth: number;
  outputHeight: number;
  limited: boolean;
}

export interface FlattenedRegion extends RasterPlan {
  dataUrl: string;
}

type RasterFormat = "png" | "jpeg";

const assertRegion = (region: TBBox): void => {
  const values = [region.left, region.top, region.width, region.height];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Export region contains invalid coordinates");
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new Error("Export region is empty");
  }
  if (values.some((value) => Math.abs(value) > MAX_SCENE_COORDINATE)) {
    throw new Error("Export region is outside the supported canvas range");
  }
};

export function planRasterization(
  region: TBBox,
  requestedMultiplier: number
): RasterPlan {
  assertRegion(region);
  if (!Number.isFinite(requestedMultiplier) || requestedMultiplier <= 0) {
    throw new Error("Export scale is invalid");
  }

  const pixelLimitMultiplier = Math.sqrt(
    MAX_RASTER_PIXELS / (region.width * region.height)
  );
  const multiplier = Math.min(
    requestedMultiplier,
    MAX_RASTER_SIDE / region.width,
    MAX_RASTER_SIDE / region.height,
    pixelLimitMultiplier
  );
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error("Export dimensions are not supported");
  }

  return {
    multiplier,
    outputWidth: Math.max(1, Math.floor(region.width * multiplier)),
    outputHeight: Math.max(1, Math.floor(region.height * multiplier)),
    limited: multiplier < requestedMultiplier - Number.EPSILON,
  };
}

type MutableCanvasState = {
  width: number;
  height: number;
  viewportTransform: TMat2D;
  enableRetinaScaling: boolean;
  skipControlsDrawing: boolean;
  disposed?: boolean;
  destroyed?: boolean;
  calcViewportBoundaries(): unknown;
  requestRenderAll(): unknown;
};

/**
 * Fabric temporarily mutates its own viewport and dimensions while exporting.
 * Restore all of them even if browser canvas allocation/rendering throws.
 */
function renderWithIdentityViewport<T>(
  canvas: FabricCanvas,
  render: () => T
): T {
  const mutable = canvas as unknown as MutableCanvasState;
  if (mutable.disposed || mutable.destroyed) {
    throw new Error("The canvas is no longer available");
  }
  const previous = {
    width: mutable.width,
    height: mutable.height,
    viewportTransform: [...mutable.viewportTransform] as TMat2D,
    enableRetinaScaling: mutable.enableRetinaScaling,
    skipControlsDrawing: mutable.skipControlsDrawing,
  };

  mutable.viewportTransform = [1, 0, 0, 1, 0, 0];
  mutable.calcViewportBoundaries();
  try {
    return render();
  } finally {
    mutable.width = previous.width;
    mutable.height = previous.height;
    mutable.viewportTransform = previous.viewportTransform;
    mutable.enableRetinaScaling = previous.enableRetinaScaling;
    mutable.skipControlsDrawing = previous.skipControlsDrawing;
    mutable.calcViewportBoundaries();
    if (!mutable.disposed && !mutable.destroyed) mutable.requestRenderAll();
  }
}

const nativeMultiplier = (canvas: FabricCanvas): number => {
  const background = findBackgroundImage(canvas);
  if (!background) return 1;
  const displayedWidth = background.getScaledWidth();
  if (
    !Number.isFinite(background.width) ||
    !Number.isFinite(displayedWidth) ||
    background.width <= 0 ||
    displayedWidth <= 0
  ) {
    throw new Error("Background image scale is invalid");
  }
  return background.width / displayedWidth;
};

/**
 * Render a scene-space region to PNG for crop/selection operations, ignoring
 * the current zoom/pan and capping the detached output canvas safely.
 */
export function flattenRegion(
  canvas: FabricCanvas,
  region: TBBox
): FlattenedRegion {
  const plan = planRasterization(region, nativeMultiplier(canvas));
  const dataUrl = renderWithIdentityViewport(canvas, () =>
    canvas.toDataURL({
      format: "png",
      quality: 1,
      multiplier: plan.multiplier,
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
      enableRetinaScaling: false,
    })
  );
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("The browser could not encode the rendered region");
  }
  return { ...plan, dataUrl };
}

export async function renderRegionBlob(
  canvas: FabricCanvas,
  region: TBBox,
  requestedMultiplier: number,
  format: RasterFormat,
  quality = 1
): Promise<{ blob: Blob; plan: RasterPlan }> {
  const plan = planRasterization(region, requestedMultiplier);
  const blobPromise = renderWithIdentityViewport(canvas, () =>
    canvas.toBlob({
      format,
      quality,
      multiplier: plan.multiplier,
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
      enableRetinaScaling: false,
    })
  );
  const blob = await blobPromise;
  if (!blob || blob.size === 0 || !blob.type.startsWith("image/")) {
    throw new Error("The browser could not encode the exported image");
  }
  return { blob, plan };
}
