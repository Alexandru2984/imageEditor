import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers';

// Configure transformers.js to always download models
env.allowLocalModels = false;
env.useBrowserCache = true;

const MAX_IMAGE_DIMENSION = 1024;

// briaai/RMBG-1.4 is a dedicated background-removal (subject matting)
// model. Its repo lacks standard config files, so both configs are
// supplied explicitly, per the model card.
const MODEL_ID = 'briaai/RMBG-1.4';
const MODEL_CONFIG = { model_type: 'custom' };
const PROCESSOR_CONFIG = {
  do_normalize: true,
  do_pad: false,
  do_rescale: true,
  do_resize: true,
  image_mean: [0.5, 0.5, 0.5],
  feature_extractor_type: 'ImageFeatureExtractor',
  image_std: [1, 1, 1],
  resample: 2,
  rescale_factor: 0.00392156862745098,
  size: { width: 1024, height: 1024 },
};

type Segmenter = {
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
};

let segmenterPromise: Promise<Segmenter> | null = null;

async function loadSegmenter(
  device: 'webgpu' | 'wasm',
  onProgress?: (message: string) => void
): Promise<Segmenter> {
  onProgress?.(`Loading ${MODEL_ID} (${device})...`);
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: MODEL_CONFIG as any,
    device,
  });
  const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: PROCESSOR_CONFIG as any,
  });
  onProgress?.('Model loaded.');
  return { model, processor };
}

function getSegmenter(onProgress?: (message: string) => void): Promise<Segmenter> {
  if (!segmenterPromise) {
    segmenterPromise = loadSegmenter('webgpu', onProgress).catch((webgpuError) => {
      console.warn('WebGPU not available, falling back to WASM:', webgpuError);
      onProgress?.('WebGPU unavailable, falling back to WASM...');
      return loadSegmenter('wasm', onProgress).catch((wasmError) => {
        segmenterPromise = null; // allow retrying later
        throw new Error(
          `Failed to initialize segmentation model. WebGPU error: ${webgpuError instanceof Error ? webgpuError.message : String(webgpuError)}. WASM error: ${wasmError instanceof Error ? wasmError.message : String(wasmError)}`
        );
      });
    });
  }
  return segmenterPromise;
}

function resizeImageIfNeeded(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
  let width = image.naturalWidth;
  let height = image.naturalHeight;

  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    if (width > height) {
      height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
      width = MAX_IMAGE_DIMENSION;
    } else {
      width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
      height = MAX_IMAGE_DIMENSION;
    }

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(image, 0, 0, width, height);
    return true;
  }

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0);
  return false;
}

export async function removeBackground(imageBlob: Blob, onProgress?: (message: string) => void): Promise<Blob> {
  try {
    onProgress?.('Starting background removal process...');

    const segmenter = getSegmenter(onProgress);

    // Draw the source image on a working canvas (downscaled if huge)
    onProgress?.('Loading image...');
    const image = await loadImage(imageBlob);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas 2D context');
    resizeImageIfNeeded(canvas, ctx, image);
    onProgress?.(`Image prepared (${canvas.width}x${canvas.height}).`);

    const inputBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode input image'))),
        'image/png'
      );
    });
    const rawImage = await RawImage.fromBlob(inputBlob);

    // Run the matting model — output is a soft alpha mask of the subject
    onProgress?.('Processing with segmentation model...');
    const { model, processor } = await segmenter;
    const { pixel_values } = await processor(rawImage);
    const { output } = await model({ input: pixel_values });

    if (!output) {
      throw new Error('Model returned no output. The model output was unexpected.');
    }

    const mask = await RawImage.fromTensor(
      output[0].mul(255).to('uint8')
    ).resize(canvas.width, canvas.height);

    // Apply the subject mask to the alpha channel
    onProgress?.('Applying mask...');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < mask.data.length; i++) {
      data[i * 4 + 3] = mask.data[i];
    }
    ctx.putImageData(imageData, 0, 0);
    onProgress?.('Mask applied successfully.');

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            onProgress?.('Background removal complete.');
            resolve(blob);
          } else {
            reject(new Error('Failed to convert output canvas to PNG blob'));
          }
        },
        'image/png',
        1.0
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error removing background:', message, error);
    throw new Error(`Background removal failed: ${message}`);
  }
}

export const loadImage = (file: Blob): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (event) => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${event}`));
    };
    img.src = url;
  });
};
