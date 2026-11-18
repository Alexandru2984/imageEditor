// Web Worker: encodes painted layers to PNG. On the main thread Chrome
// encodes canvas.toBlob() in idle time, which a busy page can delay by
// seconds, and the stroke is only an undo step once it is encoded.

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

ctx.addEventListener("message", (event) => {
  const { id, bitmap } = event.data as { id: number; bitmap: ImageBitmap };
  void (async () => {
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D canvas in this worker");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await canvas.convertToBlob({ type: "image/png" });
      ctx.postMessage({ id, blob });
    } catch (error) {
      bitmap.close();
      ctx.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
