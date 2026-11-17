import { useCallback, useEffect, useRef, useState } from "react";
import { FabricImage } from "fabric";
import type { Canvas as FabricCanvas } from "fabric";
import { toast } from "sonner";
import { extractSubjectDataURL } from "@/utils/cutout";
import { findBackgroundImage } from "@/utils/viewport";
import { markBackgroundObject, type EditorFabricObject } from "@/utils/editorObjects";
import { isAbortError } from "@/utils/abort";

const abortIfNeeded = (signal: AbortSignal): void => {
  if (!signal.aborted) return;
  const error = new Error("Background removal was cancelled");
  error.name = "AbortError";
  throw error;
};

export interface AiActions {
  isProcessing: boolean;
  processingMessage: string | null;
  removeBackground: () => Promise<void>;
  extractSubject: () => Promise<void>;
  cancel: () => void;
}

/**
 * On-device subject matting (RMBG in a worker). Remove BG replaces the photo
 * in place; Extract keeps the photo and adds the cut-out as a new layer.
 */
export function useAiActions(canvas: FabricCanvas | null): AiActions {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  // A new document invalidates any running job.
  useEffect(() => () => controllerRef.current?.abort(), [canvas]);

  const run = useCallback(
    async (
      label: string,
      job: (signal: AbortSignal, onProgress: (message: string) => void) => Promise<string>
    ) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsProcessing(true);
      setProcessingMessage(`${label}...`);
      const loadingToast = toast.loading(`${label}... The first run downloads the AI model.`, {
        action: { label: "Cancel", onClick: () => controller.abort() },
      });
      try {
        const success = await job(controller.signal, (message) => {
          setProcessingMessage(message);
          toast.loading(message, { id: loadingToast });
        });
        toast.success(success);
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          console.error(`${label} failed:`, error);
          toast.error(
            error instanceof Error ? error.message.slice(0, 240) : `${label} failed. Please try again.`
          );
        }
      } finally {
        toast.dismiss(loadingToast);
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setIsProcessing(false);
          setProcessingMessage(null);
        }
      }
    },
    []
  );

  const removeBackground = useCallback(async () => {
    if (!canvas) return;
    await run("Removing background", async (signal, onProgress) => {
      const background = findBackgroundImage(canvas);
      if (!background) throw new Error("There is no photo to process");
      const resultUrl = await extractSubjectDataURL(background, { signal, onProgress });
      // Keep the photo's on-canvas footprint so annotations stay aligned even
      // though the model returns a downscaled image.
      const bounds = background.getBoundingRect();
      const image = await FabricImage.fromURL(resultUrl, { signal });
      abortIfNeeded(signal);
      const scale = Math.min(bounds.width / image.width, bounds.height / image.height);
      image.scale(scale);
      image.set({
        left: bounds.left + bounds.width / 2 - (image.width * scale) / 2,
        top: bounds.top + bounds.height / 2 - (image.height * scale) / 2,
      });
      markBackgroundObject(image);
      (image as EditorFabricObject).name = "Background";
      canvas.remove(background);
      canvas.add(image);
      canvas.sendObjectToBack(image);
      canvas.requestRenderAll();
      return "Background removed";
    });
  }, [canvas, run]);

  const extractSubject = useCallback(async () => {
    if (!canvas) return;
    await run("Extracting subject", async (signal, onProgress) => {
      const active = canvas.getActiveObject();
      const source =
        active && active instanceof FabricImage ? active : findBackgroundImage(canvas);
      if (!source) throw new Error("Select an image to extract from");
      const resultUrl = await extractSubjectDataURL(source, { signal, onProgress });
      const bounds = source.getBoundingRect();
      const cutout = await FabricImage.fromURL(resultUrl, { signal });
      abortIfNeeded(signal);
      const scale = Math.min(bounds.width / cutout.width, bounds.height / cutout.height);
      cutout.scale(scale);
      cutout.set({
        left: bounds.left + bounds.width / 2 - (cutout.width * scale) / 2,
        top: bounds.top + bounds.height / 2 - (cutout.height * scale) / 2,
      });
      (cutout as EditorFabricObject).name = "Cutout";
      canvas.add(cutout);
      canvas.setActiveObject(cutout);
      canvas.requestRenderAll();
      return "Subject extracted to a new layer";
    });
  }, [canvas, run]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  return { isProcessing, processingMessage, removeBackground, extractSubject, cancel };
}
