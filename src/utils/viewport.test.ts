import { describe, it, expect } from "vitest";
import type { Canvas as FabricCanvas, TMat2D } from "fabric";
import { clampZoom, fitTransform, fitToScreen, isFitted, MIN_ZOOM, MAX_ZOOM } from "./viewport";

const fakeCanvas = (
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number }
) => {
  const canvas = {
    width,
    height,
    viewportTransform: [1, 0, 0, 1, 0, 0] as TMat2D,
    getObjects: () => [{ __isBackground: true, type: "image", getBoundingRect: () => rect }],
    setViewportTransform(vpt: TMat2D) {
      canvas.viewportTransform = vpt;
    },
    requestRenderAll() {},
  };
  return canvas as unknown as FabricCanvas & { width: number; height: number };
};

describe("clampZoom", () => {
  it("keeps values within range untouched (rounded to 2 decimals)", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it("clamps below the minimum", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
  });

  it("clamps above the maximum", () => {
    expect(clampZoom(999)).toBe(MAX_ZOOM);
  });

  it("rounds to two decimal places to keep the percentage label stable", () => {
    expect(clampZoom(1.23456)).toBe(1.23);
    expect(clampZoom(0.999 ** 30)).toBeCloseTo(0.97, 2);
  });
});

describe("fit to screen", () => {
  it("centres the photo at the largest zoom that fits", () => {
    const canvas = fakeCanvas(1000, 500, { left: 0, top: 0, width: 400, height: 400 });
    const vpt = fitTransform(canvas)!;
    expect(vpt[0]).toBe(1.19);
    expect(vpt[4]).toBeCloseTo(500 - 1.19 * 200);
    expect(vpt[5]).toBeCloseTo(250 - 1.19 * 200);
  });

  it("knows when the view is still the fitted one", () => {
    const canvas = fakeCanvas(800, 600, { left: 0, top: 0, width: 400, height: 300 });
    expect(isFitted(canvas)).toBe(false);
    fitToScreen(canvas);
    expect(isFitted(canvas)).toBe(true);
    // The container shrinks (e.g. a bottom sheet opens): no longer fitted.
    (canvas as { height: number }).height = 300;
    expect(isFitted(canvas)).toBe(false);
  });
});
