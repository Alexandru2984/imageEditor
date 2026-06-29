import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js to always download models
env.allowLocalModels = false;
env.useBrowserCache = true;

const MAX_IMAGE_DIMENSION = 1024;

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

async function createSegmenter(onProgress?: (message: string) => void) {
  // Try WebGPU first, fall back to WASM
  try {
    onProgress?.('Attempting to initialize WebGPU pipeline...');
    const segmenter = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512', {
      device: 'webgpu',
    });
    onProgress?.('WebGPU pipeline initialized successfully.');
    return segmenter;
  } catch (webgpuError) {
    console.warn('WebGPU not available, falling back to WASM:', webgpuError);
    onProgress?.('WebGPU unavailable, falling back to WASM...');
    try {
      const segmenter = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512', {
        device: 'wasm',
      });
      onProgress?.('WASM pipeline initialized successfully.');
      return segmenter;
    } catch (wasmError) {
      throw new Error(
        `Failed to initialize segmentation pipeline. WebGPU error: ${webgpuError instanceof Error ? webgpuError.message : String(webgpuError)}. WASM error: ${wasmError instanceof Error ? wasmError.message : String(wasmError)}`
      );
    }
  }
}

export async function removeBackground(imageBlob: Blob, onProgress?: (message: string) => void): Promise<Blob> {
  try {
    onProgress?.('Starting background removal process...');
    console.log('Starting background removal process...');

    const segmenter = await createSegmenter(onProgress);

    // Load the image from the Blob
    onProgress?.('Loading image...');
    const image = await loadImage(imageBlob);

    // Convert HTMLImageElement to canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('Could not get canvas 2D context');

    // Resize image if needed and draw it to canvas
    const wasResized = resizeImageIfNeeded(canvas, ctx, image);
    console.log(`Image ${wasResized ? 'was' : 'was not'} resized. Final dimensions: ${canvas.width}x${canvas.height}`);
    onProgress?.(`Image prepared (${canvas.width}x${canvas.height}).`);

    // Get image data as base64
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    console.log('Image converted to base64');

    // Process the image with the segmentation model
    onProgress?.('Processing with segmentation model...');
    console.log('Processing with segmentation model...');
    const result = await segmenter(imageData);

    console.log('Segmentation result:', result);

    if (!result || !Array.isArray(result) || result.length === 0) {
      throw new Error('Segmentation returned no results. The model may not support this image format.');
    }

    if (!result[0].mask) {
      throw new Error('Segmentation result is missing mask data. The model output was unexpected.');
    }

    // Create a new canvas for the masked image
    onProgress?.('Applying mask...');
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = canvas.width;
    outputCanvas.height = canvas.height;
    const outputCtx = outputCanvas.getContext('2d');

    if (!outputCtx) throw new Error('Could not get output canvas 2D context');

    // Draw original image
    outputCtx.drawImage(canvas, 0, 0);

    // Apply the mask
    const outputImageData = outputCtx.getImageData(
      0, 0,
      outputCanvas.width,
      outputCanvas.height
    );
    const data = outputImageData.data;

    // Apply inverted mask to alpha channel
    for (let i = 0; i < result[0].mask.data.length; i++) {
      // Invert the mask value (1 - value) to keep the subject instead of the background
      const alpha = Math.round((1 - result[0].mask.data[i]) * 255);
      data[i * 4 + 3] = alpha;
    }

    outputCtx.putImageData(outputImageData, 0, 0);
    onProgress?.('Mask applied successfully.');
    console.log('Mask applied successfully');

    // Convert canvas to blob
    return new Promise((resolve, reject) => {
      outputCanvas.toBlob(
        (blob) => {
          if (blob) {
            onProgress?.('Background removal complete.');
            console.log('Successfully created final blob');
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
