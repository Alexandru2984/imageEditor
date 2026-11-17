import { useCallback, useEffect, useRef, useState } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { toast } from "sonner";

interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperLike {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>;
}
type EyeDropperConstructor = new () => EyeDropperLike;

const nativeEyeDropper = (): EyeDropperConstructor | null =>
  typeof window !== "undefined" && "EyeDropper" in window
    ? ((window as unknown as { EyeDropper: EyeDropperConstructor }).EyeDropper)
    : null;

const toHex = (value: number) => value.toString(16).padStart(2, "0");

/** Normalise "#RRGGBB" / "rgb(r, g, b)" from the native picker to "#rrggbb". */
export function normalizeHex(color: string): string | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) return `#${hex[1]!.toLowerCase()}`;
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color.trim());
  if (!rgb) return null;
  const [r, g, b] = rgb.slice(1, 4).map((part) => Math.min(255, Number(part)));
  return `#${toHex(r!)}${toHex(g!)}${toHex(b!)}`;
}

/** Read one document pixel under a viewport point (the on-screen checkerboard is excluded). */
export function sampleCanvasPixel(
  canvas: FabricCanvas,
  x: number,
  y: number
): { hex: string; alpha: number } | null {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const element = canvas.toCanvasElement(1, {
    left: Math.floor(x),
    top: Math.floor(y),
    width: 1,
    height: 1,
  });
  try {
    const context = element.getContext("2d", { willReadFrequently: true });
    const data = context?.getImageData(0, 0, 1, 1).data;
    if (!data) return null;
    return {
      hex: `#${toHex(data[0]!)}${toHex(data[1]!)}${toHex(data[2]!)}`,
      alpha: data[3]! / 255,
    };
  } finally {
    element.width = 0;
    element.height = 0;
  }
}

/**
 * Colour picking. Browsers with the EyeDropper API (Chromium desktop) pick
 * from anywhere on screen; elsewhere the editor shows a transparent overlay
 * over the canvas and the next tap samples the document under it. The
 * overlay leaves Fabric's own tool state untouched.
 */
export function useEyedropper(
  canvas: FabricCanvas | null,
  onPick: (hex: string) => void
): {
  picking: boolean;
  start: () => void;
  cancel: () => void;
  pickAt: (clientX: number, clientY: number) => void;
} {
  const [picking, setPicking] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPicking(false);
  }, []);

  useEffect(() => cancel, [canvas, cancel]);

  useEffect(() => {
    if (!picking) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [picking, cancel]);

  const start = useCallback(() => {
    if (!canvas) return;
    cancel();
    const Native = nativeEyeDropper();
    if (!Native) {
      setPicking(true);
      toast("Tap the image to pick a colour", { id: "eyedropper", duration: 2500 });
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setPicking(true);
    new Native()
      .open({ signal: controller.signal })
      .then((result) => {
        const hex = normalizeHex(result.sRGBHex);
        if (hex) onPickRef.current(hex);
      })
      .catch(() => {
        // Escape or a programmatic abort: nothing to do.
      })
      .finally(() => {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setPicking(false);
        }
      });
  }, [canvas, cancel]);

  const pickAt = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvas) return;
      setPicking(false);
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      const sample = sampleCanvasPixel(canvas, clientX - rect.left, clientY - rect.top);
      if (!sample) return;
      if (sample.alpha === 0) {
        toast("That spot is transparent, so there is no colour to pick");
        return;
      }
      onPickRef.current(sample.hex);
    },
    [canvas]
  );

  return { picking, start, cancel, pickAt };
}
