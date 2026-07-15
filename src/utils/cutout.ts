import type { FabricImage } from "fabric";
import { removeBackground, blobToDataURL } from "./backgroundRemoval";

const MAX_SEGMENTATION_DIMENSION = 1024;

interface ExtractSubjectOptions {
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  const error = new Error("Background removal was cancelled");
  error.name = "AbortError";
  throw error;
};

/**
 * Run subject matting (RMBG) on a Fabric image and return a PNG data URL of the
 * subject on a transparent background. A data URL (not a revocable blob URL) so
 * undo/autosave snapshots that reference it keep working indefinitely.
 */
export async function extractSubjectDataURL(
  image: FabricImage,
  options: ExtractSubjectOptions = {}
): Promise<string> {
  throwIfAborted(options.signal);
  const el = image.getElement() as HTMLImageElement | HTMLCanvasElement;
  const width = "naturalWidth" in el ? el.naturalWidth : el.width;
  const height = "naturalHeight" in el ? el.naturalHeight : el.height;

  if (!width || !height) throw new Error("Image dimensions are invalid");
  const scale = Math.min(
    1,
    MAX_SEGMENTATION_DIMENSION / width,
    MAX_SEGMENTATION_DIMENSION / height
  );
  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));

  // The model consumes at most 1024px per side. Downscale directly into that
  // working size instead of allocating a second full-resolution RGBA canvas.
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");
  ctx.drawImage(el, 0, 0, outputWidth, outputHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))),
      "image/png"
    );
  });

  throwIfAborted(options.signal);
  const result = await removeBackground(blob, options);
  return blobToDataURL(result, options.signal);
}
