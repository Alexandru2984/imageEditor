import { describe, expect, it } from "vitest";
import type { Canvas as FabricCanvas, TBBox, TMat2D } from "fabric";
import {
  MAX_RASTER_PIXELS,
  MAX_RASTER_SIDE,
  flattenRegion,
  planRasterization,
} from "./flatten";

const region = (width: number, height: number): TBBox =>
  ({ left: 0, top: 0, width, height }) as TBBox;

describe("canvas rasterization limits", () => {
  it("keeps the requested scale when the output is safe", () => {
    expect(planRasterization(region(1_000, 500), 2)).toMatchObject({
      multiplier: 2,
      outputWidth: 2_000,
      outputHeight: 1_000,
      limited: false,
    });
  });

  it("caps both output area and side length", () => {
    const plan = planRasterization(region(20_000, 10_000), 4);

    expect(plan.limited).toBe(true);
    expect(plan.outputWidth).toBeLessThanOrEqual(MAX_RASTER_SIDE);
    expect(plan.outputHeight).toBeLessThanOrEqual(MAX_RASTER_SIDE);
    expect(plan.outputWidth * plan.outputHeight).toBeLessThanOrEqual(
      MAX_RASTER_PIXELS
    );
  });

  it("rejects empty and non-finite regions", () => {
    expect(() => planRasterization(region(0, 10), 1)).toThrow(/empty/);
    expect(() => planRasterization(region(Number.NaN, 10), 1)).toThrow(
      /invalid coordinates/
    );
  });

  it("restores Fabric state if rendering throws", () => {
    const originalVpt: TMat2D = [2, 0, 0, 2, 30, 40];
    const fake = {
      width: 800,
      height: 600,
      viewportTransform: [...originalVpt] as TMat2D,
      enableRetinaScaling: true,
      skipControlsDrawing: false,
      disposed: false,
      destroyed: false,
      getObjects: () => [],
      calcViewportBoundaries: () => undefined,
      requestRenderAll: () => undefined,
      toDataURL() {
        this.width = 1;
        this.height = 1;
        this.viewportTransform = [9, 0, 0, 9, 9, 9];
        this.enableRetinaScaling = false;
        this.skipControlsDrawing = true;
        throw new Error("render exploded");
      },
    };

    expect(() =>
      flattenRegion(fake as unknown as FabricCanvas, region(100, 100))
    ).toThrow(/render exploded/);
    expect(fake.width).toBe(800);
    expect(fake.height).toBe(600);
    expect(fake.viewportTransform).toEqual(originalVpt);
    expect(fake.enableRetinaScaling).toBe(true);
    expect(fake.skipControlsDrawing).toBe(false);
  });
});

describe("planRasterization rounding", () => {
  it("does not lose a pixel to floating-point error", () => {
    const scale = 0.5625;
    const plan = planRasterization(
      { left: 0, top: 0, width: 1280 * scale, height: 720 * scale },
      1280 / (1280 * scale)
    );
    expect(plan.outputWidth).toBe(1280);
    expect(plan.outputHeight).toBe(720);
    const awkward = planRasterization(
      { left: 0, top: 0, width: 719.9999999999, height: 3 },
      1
    );
    expect(awkward.outputWidth).toBe(720);
  });
});
