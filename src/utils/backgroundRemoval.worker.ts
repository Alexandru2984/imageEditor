// Web Worker: runs subject matting off the main thread so the UI stays
// responsive during model download and inference. transformers.js is imported
// here (not on the main thread), so its multi-megabyte runtime lands in the
// worker's own chunk, fetched only when the worker is first spawned.
import {
  AutoModel,
  ImageFeatureExtractor,
  RawImage,
  env,
} from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

// Transformers.js points ONNX Runtime at jsDelivr by default. Besides adding a
// mutable third-party runtime to the inference trust chain, that URL is blocked
// by our production CSP. Clear the override so Vite's bundled ONNX module loads
// the content-hashed WASM asset emitted beside this worker instead.
const wasmBackend = env.backends.onnx.wasm;
if (!wasmBackend) throw new Error("ONNX WASM backend is unavailable");
wasmBackend.wasmPaths = undefined;
wasmBackend.proxy = false;
wasmBackend.initTimeout = 30_000;

const MAX_IMAGE_DIMENSION = 1024;
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_QUEUED_REQUESTS = 4;

// briaai/RMBG-1.4 lacks standard config files, so both configs are supplied
// explicitly, per the model card.
const MODEL_ID = "briaai/RMBG-1.4";
// Pin every fetched model artifact to an immutable Hub commit. Updating the
// model is an explicit, reviewable code change instead of an untrusted change
// arriving from the repository's mutable `main` branch at runtime.
const MODEL_REVISION = "2ceba5a5efaec153162aedea169f76caf9b46cf8";
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
  processor: ImageFeatureExtractor;
};

// Minimal worker-scope surface (avoids DOM/webworker lib type clashes).
const ctx = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
};

const progress = (requestId: string, message: string) =>
  ctx.postMessage({ type: "progress", requestId, message });

let segmenterPromise: Promise<Segmenter> | null = null;

function canUseWebGPU(): boolean {
  const workerNavigator = navigator as Navigator & { gpu?: unknown };
  if (import.meta.env.VITE_AI_DEVICE === "wasm") return false;
  if (import.meta.env.VITE_AI_DEVICE === "webgpu") return true;
  // Headless Chromium exposes a software WebGPU adapter through SwiftShader.
  // Running an 88 MB neural network on it is dramatically slower than WASM and
  // can appear hung, so CI/headless checks deliberately exercise the WASM path.
  return (
    !!workerNavigator.gpu &&
    !/HeadlessChrome/i.test(workerNavigator.userAgent ?? "")
  );
}

async function loadSegmenter(
  device: "webgpu" | "wasm",
  requestId: string
): Promise<Segmenter> {
  progress(requestId, `Loading ${MODEL_ID} (${device})...`);
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: MODEL_CONFIG as any,
    device,
    // Avoid the 176 MB FP32 default. The pinned repository provides both an
    // 88 MB FP16 WebGPU model and a 44 MB q8 WASM model.
    dtype: device === "webgpu" ? "fp16" : "q8",
    revision: MODEL_REVISION,
  });
  // This model's processor config is fixed and reviewed above. Construct it
  // directly instead of performing a second runtime metadata request.
  const processor = new ImageFeatureExtractor(PROCESSOR_CONFIG);
  progress(requestId, "Model loaded.");
  return { model, processor };
}

function getSegmenter(requestId: string): Promise<Segmenter> {
  if (!segmenterPromise) {
    const loadWasm = (webgpuError?: unknown) => {
      progress(
        requestId,
        webgpuError
          ? "WebGPU unavailable, falling back to WASM..."
          : "Using the WASM inference backend..."
      );
      return loadSegmenter("wasm", requestId).catch((wasmError) => {
        segmenterPromise = null; // allow retrying later
        throw new Error(
          webgpuError
            ? `Failed to initialize segmentation model. WebGPU error: ${
                webgpuError instanceof Error
                  ? webgpuError.message
                  : String(webgpuError)
              }. WASM error: ${
                wasmError instanceof Error ? wasmError.message : String(wasmError)
              }`
            : `Failed to initialize segmentation model with WASM: ${
                wasmError instanceof Error ? wasmError.message : String(wasmError)
              }`
        );
      });
    };
    segmenterPromise = canUseWebGPU()
      ? loadSegmenter("webgpu", requestId).catch(loadWasm)
      : loadWasm();
  }
  return segmenterPromise;
}

async function removeBackground(
  imageBlob: Blob,
  requestId: string
): Promise<Blob> {
  progress(requestId, "Starting background removal process...");
  const segmenter = getSegmenter(requestId);

  // Draw the source onto an OffscreenCanvas (downscaled if huge). createImageBitmap
  // and OffscreenCanvas replace the DOM Image/canvas that aren't available here.
  progress(requestId, "Loading image...");
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
  if (!context) {
    bitmap.close();
    throw new Error("Could not get canvas 2D context");
  }
  try {
    context.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }
  progress(requestId, `Image prepared (${width}x${height}).`);

  const inputBlob = await canvas.convertToBlob({ type: "image/png" });
  const rawImage = await RawImage.fromBlob(inputBlob);

  progress(requestId, "Processing with segmentation model...");
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

  progress(requestId, "Applying mask...");
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
  progress(requestId, "Mask applied successfully.");

  const result = await canvas.convertToBlob({ type: "image/png" });
  progress(requestId, "Background removal complete.");
  return result;
}

type ProcessRequest = { type: "process"; requestId: string; blob: Blob };

async function processRequest(data: ProcessRequest): Promise<void> {
  try {
    const result = await removeBackground(data.blob, data.requestId);
    ctx.postMessage({ type: "result", requestId: data.requestId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.postMessage({ type: "error", requestId: data.requestId, message });
  }
}

let queuedRequests = 0;
let requestQueue: Promise<void> = Promise.resolve();

ctx.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as Partial<ProcessRequest> | null;
  if (
    data?.type !== "process" ||
    typeof data.requestId !== "string" ||
    !(data.blob instanceof Blob)
  ) {
    return;
  }
  if (
    data.blob.type !== "image/png" ||
    data.blob.size === 0 ||
    data.blob.size > MAX_BLOB_BYTES
  ) {
    ctx.postMessage({
      type: "error",
      requestId: data.requestId,
      message: "Background removal input is invalid",
    });
    return;
  }
  if (queuedRequests >= MAX_QUEUED_REQUESTS) {
    ctx.postMessage({
      type: "error",
      requestId: data.requestId,
      message: "Background removal queue is full",
    });
    return;
  }

  queuedRequests += 1;
  progress(data.requestId, queuedRequests > 1 ? "Queued..." : "Starting...");
  const request = data as ProcessRequest;
  requestQueue = requestQueue
    .then(() => processRequest(request))
    .finally(() => {
      queuedRequests -= 1;
    });
});
