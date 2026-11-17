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

export type RasterFormat = "png" | "jpeg" | "webp";

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
    outputWidth: snapPixels(region.width * multiplier),
    outputHeight: snapPixels(region.height * multiplier),
    limited: multiplier < requestedMultiplier - Number.EPSILON,
  };
}

// Scene sizes times a multiplier land a hair under whole numbers
// (1280 × 0.5625 / 0.5625 = 719.9999…). Treat those as the whole number.
const PIXEL_EPSILON = 1e-6;
const snapPixels = (value: number): number =>
  Math.max(1, Math.floor(value + PIXEL_EPSILON));

/**
 * Crop rectangle to hand Fabric so its output canvas is exactly the planned
 * size. Fabric sizes the element to width × multiplier and the DOM truncates
 * that to an integer, so aim half a pixel past the planned edge.
 */
function cropFor(region: TBBox, plan: RasterPlan) {
  return {
    left: region.left,
    top: region.top,
    width: (plan.outputWidth + 0.5) / plan.multiplier,
    height: (plan.outputHeight + 0.5) / plan.multiplier,
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
      ...cropFor(region, plan),
      enableRetinaScaling: false,
    })
  );
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("The browser could not encode the rendered region");
  }
  return { ...plan, dataUrl };
}

export interface RenderBlobOptions {
  /**
   * Opaque colour painted *behind* the artwork. JPEG cannot store alpha, so it
   * defaults to white there; PNG/WebP keep transparency unless one is given.
   */
  matte?: string | null;
}

const encodeCanvas = (
  element: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob | null> =>
  new Promise((resolve) => {
    try {
      element.toBlob((blob) => resolve(blob), mime, quality);
    } catch {
      resolve(null);
    }
  });

export async function renderRegionBlob(
  canvas: FabricCanvas,
  region: TBBox,
  requestedMultiplier: number,
  format: RasterFormat,
  quality = 1,
  options: RenderBlobOptions = {}
): Promise<{ blob: Blob; plan: RasterPlan }> {
  const plan = planRasterization(region, requestedMultiplier);
  const element = renderWithIdentityViewport(canvas, () =>
    canvas.toCanvasElement(plan.multiplier, cropFor(region, plan))
  );

  const matte = options.matte ?? (format === "jpeg" ? "#ffffff" : null);
  if (matte) {
    const ctx = element.getContext("2d");
    if (!ctx) throw new Error("The browser could not prepare the export");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, element.width, element.height);
    ctx.restore();
  }

  const mime = `image/${format}`;
  const blob = await encodeCanvas(element, mime, quality);
  // Release the backing store promptly; large exports can be 64 MB of RGBA.
  element.width = 0;
  element.height = 0;
  if (!blob || blob.size === 0 || blob.type !== mime) {
    throw new Error("The browser could not encode the exported image");
  }
  return { blob, plan };
}
