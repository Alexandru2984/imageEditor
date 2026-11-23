// Web Worker: encodes AVIF with libavif (Squoosh's build, via jSquash) for
// browsers whose canvas cannot. The single-threaded build: the page is not
// cross-origin isolated, so there are no shared-memory threads.
import moduleFactory from "@jsquash/avif/codec/enc/avif_enc.js";
import { defaultOptions } from "@jsquash/avif/meta.js";
import { initEmscriptenModule } from "@jsquash/avif/utils.js";

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

let encoder: ReturnType<typeof initEmscriptenModule<Awaited<ReturnType<typeof moduleFactory>>>> | null = null;

ctx.addEventListener("message", (event) => {
  const { id, pixels, width, height, quality } = event.data as {
    id: number;
    pixels: ArrayBuffer;
    width: number;
    height: number;
    quality: number;
  };
  void (async () => {
    try {
      encoder ??= initEmscriptenModule(moduleFactory);
      const module = await encoder;
      const output = module.encode(new Uint8Array(pixels), width, height, {
        ...defaultOptions,
        quality,
        // Alpha at the same quality as the colour.
        qualityAlpha: -1,
        // A little faster than the default 6, nearly as small.
        speed: 7,
      });
      if (!output) throw new Error("The AVIF encoder failed");
      const buffer = output.slice().buffer;
      ctx.postMessage({ id, buffer }, [buffer]);
    } catch (error) {
      ctx.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
