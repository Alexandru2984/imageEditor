import type { Canvas as FabricCanvas, TBBox } from "fabric";
import { findBackgroundImage, isLayerObject } from "./editorObjects";
import {
  nativeMultiplier,
  planRasterization,
  renderRegionBlob,
  type RasterFormat,
  type RasterPlan,
} from "./flatten";

export type ExportFormat = RasterFormat;

export interface ExportSettings {
  format: ExportFormat;
  /** 0..1, used by JPEG and WebP. */
  quality: number;
  /** Output scale relative to the photo's native resolution. */
  scale: number;
  /** Opaque colour behind the artwork, or null to keep transparency. */
  matte: string | null;
}

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: "PNG",
  jpeg: "JPG",
  webp: "WebP",
};

export const FORMAT_EXTENSION: Record<ExportFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

export const supportsAlpha = (format: ExportFormat): boolean => format !== "jpeg";

/**
 * The document area: the photo when there is one, otherwise the union of all
 * objects. Exports never include the empty workspace around the artboard.
 */
export function exportRegion(canvas: FabricCanvas): TBBox | null {
  const background = findBackgroundImage(canvas);
  if (background) return background.getBoundingRect();

  const objects = canvas.getObjects().filter(isLayerObject);
  if (objects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const object of objects) {
    const rect = object.getBoundingRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export function planExport(canvas: FabricCanvas, scale: number): RasterPlan | null {
  const region = exportRegion(canvas);
  if (!region || region.width <= 0 || region.height <= 0) return null;
  return planRasterization(region, nativeMultiplier(canvas) * scale);
}

export async function exportImage(
  canvas: FabricCanvas,
  settings: ExportSettings
): Promise<{ blob: Blob; plan: RasterPlan }> {
  const region = exportRegion(canvas);
  if (!region) throw new Error("There is nothing to export yet");
  // Controls are never drawn into exports, so the selection can stay as is.
  return renderRegionBlob(
    canvas,
    region,
    nativeMultiplier(canvas) * settings.scale,
    settings.format,
    settings.format === "png" ? 1 : settings.quality,
    { matte: settings.matte }
  );
}

// Kept here for existing callers; it lives in a Fabric-free module so the
// start screen can use it without loading the editor.
export { sanitizeFileName } from "./fileName";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function copyImageToClipboard(blob: Blob): Promise<void> {
  if (!("clipboard" in navigator) || typeof ClipboardItem === "undefined") {
    throw new Error("This browser cannot copy images to the clipboard");
  }
  // Clipboard image support is PNG-only across browsers.
  if (blob.type !== "image/png") throw new Error("Only PNG images can be copied");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], "probe.png", { type: "image/png" });
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareImage(blob: Blob, fileName: string): Promise<boolean> {
  const file = new File([blob], fileName, { type: blob.type });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    throw error;
  }
}
