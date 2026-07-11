import type { FabricImage } from "fabric";
import { removeBackground, blobToDataURL } from "./backgroundRemoval";

/**
 * Run subject matting (RMBG) on a Fabric image and return a PNG data URL of the
 * subject on a transparent background. A data URL (not a revocable blob URL) so
 * undo/autosave snapshots that reference it keep working indefinitely.
 */
export async function extractSubjectDataURL(image: FabricImage): Promise<string> {
  const el = image.getElement() as HTMLImageElement | HTMLCanvasElement;
  const width = "naturalWidth" in el ? el.naturalWidth : el.width;
  const height = "naturalHeight" in el ? el.naturalHeight : el.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");
  ctx.drawImage(el, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))),
      "image/png"
    );
  });

  const result = await removeBackground(blob);
  return blobToDataURL(result);
}
