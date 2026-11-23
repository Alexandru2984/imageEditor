import type { Canvas as FabricCanvas, FabricObject, TBBox } from "fabric";
import { isAdjustmentLayer } from "@/adjustments/adjustmentLayer";
import { treeOf } from "@/compositing/compositor";
import { encodeAvif } from "@/export/avifEncoder";
import { plannedFiles, scaleOf, type ExportSize } from "@/export/exportPlan";
import { clippingRuns, rangeOf } from "@/layers/layerTree";
import { findBackgroundImage, isEditorChrome, isLayerObject } from "./editorObjects";
import {
  nativeMultiplier,
  paintMatte,
  planRasterization,
  renderObjectsRegion,
  renderRegionCanvas,
  type RasterFormat,
  type RasterPlan,
} from "./flatten";

export type ExportFormat = RasterFormat | "avif";

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
  avif: "AVIF",
};

export const FORMAT_EXTENSION: Record<ExportFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  avif: "avif",
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

/** The document's width in pixels at its own resolution (1×). */
export function nativeWidth(canvas: FabricCanvas): number {
  const region = exportRegion(canvas);
  return region ? Math.round(region.width * nativeMultiplier(canvas)) : 0;
}

export function planExport(canvas: FabricCanvas, size: number | ExportSize): RasterPlan | null {
  const region = exportRegion(canvas);
  if (!region || region.width <= 0 || region.height <= 0) return null;
  const scale = typeof size === "number" ? size : scaleOf(size, nativeWidth(canvas));
  return planRasterization(region, nativeMultiplier(canvas) * scale);
}

/** Encode a rendered export; the canvas is emptied afterwards (large ones hold a lot of memory). */
async function encode(element: HTMLCanvasElement, format: ExportFormat, quality: number): Promise<Blob> {
  try {
    if (format === "avif") return await encodeAvif(element, quality);
    const mime = `image/${format}`;
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        element.toBlob(resolve, mime, format === "png" ? 1 : quality);
      } catch {
        resolve(null);
      }
    });
    if (!blob || blob.size === 0 || blob.type !== mime) throw new Error("The browser could not encode the exported image");
    return blob;
  } finally {
    element.width = 0;
    element.height = 0;
  }
}

export async function exportImage(
  canvas: FabricCanvas,
  settings: ExportSettings
): Promise<{ blob: Blob; plan: RasterPlan }> {
  const region = exportRegion(canvas);
  if (!region) throw new Error("There is nothing to export yet");
  // Controls are never drawn into exports, so the selection can stay as is.
  const { element, plan } = renderRegionCanvas(canvas, region, nativeMultiplier(canvas) * settings.scale);
  const matte = settings.matte ?? (settings.format === "jpeg" ? "#ffffff" : null);
  if (matte) paintMatte(element, matte);
  return { blob: await encode(element, settings.format, settings.quality), plan };
}

/**
 * Export Layers to Files: each visible layer or group at the top of the
 * stack, with the layers clipped to it, on its own over the document's area.
 * Adjustment layers change what is under them and show nothing alone, so
 * they are left out.
 */
export function layerExports(canvas: FabricCanvas): { label: string; include: (object: FabricObject) => boolean }[] {
  const objects = canvas.getObjects();
  const exports: { label: string; include: (object: FabricObject) => boolean }[] = [];
  for (const run of clippingRuns(treeOf(objects).roots)) {
    const base = objects[run.base.index];
    if (!base || !base.visible || isEditorChrome(base) || isAdjustmentLayer(base)) continue;
    const members = new Set<FabricObject>();
    for (const node of [run.base, ...run.clipped]) {
      const [low, high] = rangeOf(node);
      for (let index = low; index <= high; index += 1) members.add(objects[index]!);
    }
    exports.push({ label: (base as { name?: string }).name?.trim() || "Layer", include: (object) => members.has(object) });
  }
  return exports.reverse();
}

export interface ExportJob {
  format: ExportFormat;
  /** 0..1, for JPEG, WebP and AVIF. */
  quality: number;
  matte: string | null;
  sizes: readonly ExportSize[];
  /** Each layer to a file of its own, rather than the document. */
  layers: boolean;
  baseName: string;
}

export interface ExportedFile {
  name: string;
  blob: Blob;
  width: number;
  height: number;
  limited: boolean;
}

/** Every file an export makes, one after another; `onFile` follows along. */
export async function exportFiles(
  canvas: FabricCanvas,
  job: ExportJob,
  onFile?: (done: number, total: number) => void
): Promise<ExportedFile[]> {
  const region = exportRegion(canvas);
  if (!region) throw new Error("There is nothing to export yet");
  const targets = job.layers
    ? layerExports(canvas).map(({ label, include }) => ({ label, target: include }))
    : [{ label: null, target: null }];
  if (targets.length === 0) throw new Error("There are no visible layers to export");
  const planned = plannedFiles(job.baseName, FORMAT_EXTENSION[job.format], targets, job.sizes);
  const width = nativeWidth(canvas);
  const matte = job.matte ?? (job.format === "jpeg" ? "#ffffff" : null);
  const files: ExportedFile[] = [];
  for (const file of planned) {
    const multiplier = nativeMultiplier(canvas) * scaleOf(file.size, width);
    const { element, plan } = file.target
      ? renderObjectsRegion(canvas, region, multiplier, file.target)
      : renderRegionCanvas(canvas, region, multiplier);
    if (matte) paintMatte(element, matte);
    const blob = await encode(element, job.format, job.quality);
    files.push({ name: file.name, blob, width: plan.outputWidth, height: plan.outputHeight, limited: plan.limited });
    onFile?.(files.length, planned.length);
  }
  return files;
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
