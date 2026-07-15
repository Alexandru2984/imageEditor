import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_DIMENSION,
  inspectRasterBytes,
  inspectRasterDataUrl,
} from "./imageFile";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAvyQP4rvqiVQAAAABJRU5ErkJggg==";
const JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x02,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
]).toString("base64");
const GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const WEBP_BASE64 = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoDAAIAAUAmJaQAA3AA/vz0AAA=";

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));

describe("raster image inspection", () => {
  it.each([
    ["PNG", PNG_BASE64, "image/png", 4, 4],
    ["JPEG", JPEG_BASE64, "image/jpeg", 2, 3],
    ["GIF", GIF_BASE64, "image/gif", 1, 1],
    ["WebP", WEBP_BASE64, "image/webp", 3, 2],
  ] as const)("reads %s signatures and dimensions", (_name, base64, mime, width, height) => {
    expect(inspectRasterBytes(bytes(base64))).toMatchObject({ mime, width, height });
  });

  it("rejects a declared MIME type that does not match the bytes", () => {
    expect(() =>
      inspectRasterDataUrl(`data:image/jpeg;base64,${PNG_BASE64}`)
    ).toThrow(/does not match/);
  });

  it("rejects active image formats such as SVG", () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString(
      "base64"
    );
    expect(() => inspectRasterDataUrl(`data:image/svg+xml;base64,${svg}`)).toThrow(
      /Only inline/
    );
  });

  it("rejects images whose metadata declares unsafe dimensions", () => {
    const oversized = bytes(PNG_BASE64);
    const view = new DataView(
      oversized.buffer,
      oversized.byteOffset,
      oversized.byteLength
    );
    view.setUint32(16, MAX_IMAGE_DIMENSION + 1);
    expect(() => inspectRasterBytes(oversized)).toThrow(/per-side limit/);
  });

  it("rejects malformed base64 before decoding it as an image", () => {
    expect(() => inspectRasterDataUrl("data:image/png;base64,AA=A")).toThrow(
      /valid base64/
    );
  });
});
