// Web Worker: reads and writes Photoshop files (see psdDocument.ts) away from
// the page, so a large or hostile file can neither freeze it nor take its
// memory down.

import { decodePsd, encodePsd, type PsdToWrite } from "./psdDocument";

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

ctx.addEventListener("message", (event) => {
  const message = event.data as { type: "read"; buffer: ArrayBuffer } | { type: "write"; document: PsdToWrite };
  try {
    if (message.type === "write") {
      const buffer = encodePsd(message.document);
      ctx.postMessage({ result: buffer }, [buffer]);
      return;
    }
    const result = decodePsd(message.buffer);
    const transfer = new Set<ArrayBuffer>();
    for (const layer of result.layers) {
      if (layer.kind !== "layer") continue;
      transfer.add(layer.pixels.buffer as ArrayBuffer);
      if (layer.mask) transfer.add(layer.mask.grey.buffer as ArrayBuffer);
    }
    if (result.composite) transfer.add(result.composite.buffer as ArrayBuffer);
    ctx.postMessage({ result }, [...transfer]);
  } catch (error) {
    ctx.postMessage({ error: error instanceof Error ? error.message : "The Photoshop file could not be handled" });
  }
});
