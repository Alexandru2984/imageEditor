// Web Worker: reads Photoshop files (see psdDocument.ts) away from the page,
// so a large or hostile file can neither freeze it nor take its memory down.

import { decodePsd } from "./psdDocument";

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

ctx.addEventListener("message", (event) => {
  const { buffer } = event.data as { buffer: ArrayBuffer };
  try {
    const result = decodePsd(buffer);
    const transfer = new Set<ArrayBuffer>();
    for (const layer of result.layers) {
      transfer.add(layer.pixels.buffer as ArrayBuffer);
      if (layer.mask) transfer.add(layer.mask.grey.buffer as ArrayBuffer);
    }
    if (result.composite) transfer.add(result.composite.buffer as ArrayBuffer);
    ctx.postMessage({ result }, [...transfer]);
  } catch (error) {
    ctx.postMessage({ error: error instanceof Error ? error.message : "The file could not be read" });
  }
});
