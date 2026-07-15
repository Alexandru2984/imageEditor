export const MAX_IMAGE_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_EMBEDDED_IMAGE_BYTES = 48 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const RASTER_FILE_ACCEPT =
  ".png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp";

const MAX_HEADER_BYTES = 4 * 1024 * 1024;

export type RasterMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export interface RasterMetadata {
  mime: RasterMime;
  width: number;
  height: number;
  byteLength: number;
}

const formatBytes = (bytes: number): string =>
  `${Math.round(bytes / (1024 * 1024))}MB`;

function assertSafeDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Image dimensions are invalid");
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new Error(
      `Image dimensions exceed the ${MAX_IMAGE_DIMENSION}px per-side limit`
    );
  }
  if (width > Math.floor(MAX_IMAGE_PIXELS / height)) {
    throw new Error(
      `Image exceeds the ${Math.round(MAX_IMAGE_PIXELS / 1_000_000)} megapixel limit`
    );
  }
}

const hasBytes = (bytes: Uint8Array, at: number, expected: readonly number[]) =>
  expected.every((value, index) => bytes[at + index] === value);

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 24 ||
    !hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    !hasBytes(bytes, 12, [0x49, 0x48, 0x44, 0x52])
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && view.getUint8(offset) === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = view.getUint8(offset++);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) break;

    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) break;
      return {
        height: view.getUint16(offset + 3),
        width: view.getUint16(offset + 5),
      };
    }
    offset += segmentLength;
  }
  throw new Error("JPEG metadata is missing, corrupt, or unusually large");
}

const readUint24LE = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) {
    return null;
  }

  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunk === "VP8X") {
    return {
      width: readUint24LE(bytes, 24) + 1,
      height: readUint24LE(bytes, 27) + 1,
    };
  }
  if (chunk === "VP8L" && view.getUint8(20) === 0x2f) {
    const b21 = view.getUint8(21);
    const b22 = view.getUint8(22);
    const b23 = view.getUint8(23);
    const b24 = view.getUint8(24);
    return {
      width: 1 + b21 + ((b22 & 0x3f) << 8),
      height:
        1 + ((b22 & 0xc0) >> 6) + (b23 << 2) + ((b24 & 0x0f) << 10),
    };
  }
  if (chunk === "VP8 " && hasBytes(bytes, 23, [0x9d, 0x01, 0x2a])) {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  throw new Error("WebP metadata is missing or corrupt");
}

export function inspectRasterBytes(
  bytes: Uint8Array,
  byteLength = bytes.byteLength
): RasterMetadata {
  const candidates: Array<
    [RasterMime, (value: Uint8Array) => { width: number; height: number } | null]
  > = [
    ["image/png", pngDimensions],
    ["image/jpeg", jpegDimensions],
    ["image/gif", gifDimensions],
    ["image/webp", webpDimensions],
  ];

  for (const [mime, inspect] of candidates) {
    const dimensions = inspect(bytes);
    if (dimensions) {
      assertSafeDimensions(dimensions.width, dimensions.height);
      return { mime, ...dimensions, byteLength };
    }
  }
  throw new Error("Unsupported or invalid image. Use PNG, JPG, GIF, or WebP");
}

function decodedBase64Length(payload: string): number {
  if (payload.length === 0 || payload.length % 4 !== 0) {
    throw new Error("Image data is not valid base64");
  }

  let padding = 0;
  if (payload.endsWith("==")) padding = 2;
  else if (payload.endsWith("=")) padding = 1;

  const dataEnd = payload.length - padding;
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index);
    const valid =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f ||
      (code === 0x3d && index >= dataEnd);
    if (!valid) throw new Error("Image data is not valid base64");
  }

  return (payload.length / 4) * 3 - padding;
}

function decodeHeader(payload: string): Uint8Array {
  const maxChars = Math.ceil(MAX_HEADER_BYTES / 3) * 4;
  const charsToDecode = Math.min(payload.length, maxChars);
  const alignedLength = charsToDecode - (charsToDecode % 4);
  try {
    const binary = atob(payload.slice(0, alignedLength));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error("Image data is not valid base64");
  }
}

export function inspectRasterDataUrl(
  dataUrl: string,
  maxBytes = MAX_EMBEDDED_IMAGE_BYTES
): RasterMetadata {
  const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,/i.exec(dataUrl);
  if (!match) {
    throw new Error("Only inline PNG, JPG, GIF, or WebP images are allowed");
  }

  const payload = dataUrl.slice(match[0].length);
  const byteLength = decodedBase64Length(payload);
  if (byteLength > maxBytes) {
    throw new Error(`Embedded image exceeds the ${formatBytes(maxBytes)} limit`);
  }

  const metadata = inspectRasterBytes(decodeHeader(payload), byteLength);
  const declaredType = match[1];
  if (!declaredType) throw new Error("Image data does not declare a format");
  const declaredMime = declaredType.toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : declaredType.toLowerCase();
  if (metadata.mime !== declaredMime) {
    throw new Error("Image content does not match its declared format");
  }
  return metadata;
}

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Failed to read the image"));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the image"));
    reader.readAsDataURL(blob);
  });

export async function readSafeRasterImage(file: File): Promise<{
  dataUrl: string;
  metadata: RasterMetadata;
}> {
  if (file.size === 0) throw new Error("The image file is empty");
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(`Image exceeds the ${formatBytes(MAX_IMAGE_FILE_BYTES)} limit`);
  }

  const header = new Uint8Array(
    await file.slice(0, Math.min(file.size, MAX_HEADER_BYTES)).arrayBuffer()
  );
  const metadata = inspectRasterBytes(header, file.size);
  const normalized = new Blob([file], { type: metadata.mime });
  return { dataUrl: await readAsDataUrl(normalized), metadata };
}
