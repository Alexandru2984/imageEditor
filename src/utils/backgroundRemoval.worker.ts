// Web Worker: runs subject matting off the main thread so the UI stays
// responsive during model download and inference. transformers.js is imported
// here (not on the main thread), so its multi-megabyte runtime lands in the
// worker's own chunk, fetched only when the worker is first spawned.
import { AutoModel, AutoProcessor, RawImage, env } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MAX_IMAGE_DIMENSION = 1024;

// briaai/RMBG-1.4 lacks standard config files, so both configs are supplied
// explicitly, per the model card.
const MODEL_ID = "briaai/RMBG-1.4";
const MODEL_CONFIG = { model_type: "custom" };
const PROCESSOR_CONFIG = {
  do_normalize: true,
  do_pad: false,
  do_rescale: true,
  do_resize: true,
  image_mean: [0.5, 0.5, 0.5],
  feature_extractor_type: "ImageFeatureExtractor",
  image_std: [1, 1, 1],
  resample: 2,
  rescale_factor: 0.00392156862745098,
  size: { width: 1024, height: 1024 },
};

type Segmenter = {
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
};

// Minimal worker-scope surface (avoids DOM/webworker lib type clashes).
const ctx = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
};

const progress = (message: string) => ctx.postMessage({ type: "progress", message });

let segmenterPromise: Promise<Segmenter> | null = null;

async function loadSegmenter(device: "webgpu" | "wasm"): Promise<Segmenter> {
  progress(`Loading ${MODEL_ID} (${device})...`);
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: MODEL_CONFIG as any,
    device,
  });
  const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: PROCESSOR_CONFIG as any,
  });
  progress("Model loaded.");
  return { model, processor };
}

function getSegmenter(): Promise<Segmenter> {
  if (!segmenterPromise) {
    segmenterPromise = loadSegmenter("webgpu").catch((webgpuError) => {
      progress("WebGPU unavailable, falling back to WASM...");
      return loadSegmenter("wasm").catch((wasmError) => {
        segmenterPromise = null; // allow retrying later
        throw new Error(
          `Failed to initialize segmentation model. WebGPU error: ${
            webgpuError instanceof Error ? webgpuError.message : String(webgpuError)
          }. WASM error: ${
            wasmError instanceof Error ? wasmError.message : String(wasmError)
          }`
        );
      });
    });
  }
  return segmenterPromise;
}

async function removeBackground(imageBlob: Blob): Promise<Blob> {
  progress("Starting background removal process...");
  const segmenter = getSegmenter();

  // Draw the source onto an OffscreenCanvas (downscaled if huge). createImageBitmap
  // and OffscreenCanvas replace the DOM Image/canvas that aren't available here.
  progress("Loading image...");
  const bitmap = await createImageBitmap(imageBlob);
  let width = bitmap.width;
  let height = bitmap.height;
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    if (width > height) {
      height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
      width = MAX_IMAGE_DIMENSION;
    } else {
      width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
      height = MAX_IMAGE_DIMENSION;
    }
  }

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get canvas 2D context");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  progress(`Image prepared (${width}x${height}).`);

  const inputBlob = await canvas.convertToBlob({ type: "image/png" });
  const rawImage = await RawImage.fromBlob(inputBlob);

  progress("Processing with segmentation model...");
  const { model, processor } = await segmenter;
  const { pixel_values } = await processor(rawImage);
  const { output } = await model({ input: pixel_values });
  if (!output) {
    throw new Error("Model returned no output. The model output was unexpected.");
  }

  const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(
    width,
    height
  );

  progress("Applying mask...");
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  if (mask.data.length !== width * height) {
    throw new Error("Segmentation mask dimensions do not match the image");
  }
  for (let i = 0; i < mask.data.length; i++) {
    const alpha = mask.data[i];
    if (alpha === undefined) throw new Error("Segmentation mask is incomplete");
    data[i * 4 + 3] = alpha;
  }
  context.putImageData(imageData, 0, 0);
  progress("Mask applied successfully.");

  const result = await canvas.convertToBlob({ type: "image/png" });
  progress("Background removal complete.");
  return result;
}

ctx.addEventListener("message", async (e: MessageEvent) => {
  const data = e.data as { type?: string; blob?: Blob };
  if (data?.type !== "process" || !data.blob) return;
  try {
    const result = await removeBackground(data.blob);
    ctx.postMessage({ type: "result", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.postMessage({ type: "error", message });
  }
});
