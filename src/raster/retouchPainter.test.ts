import { describe, expect, it } from "vitest";
import { RetouchPainter, type Pixels } from "./retouchPainter";

/** A layer whose left half is red and right half blue, opaque. */
function halves(width = 40, height = 20): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      data.set(x < width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], at);
    }
  }
  return { data, width, height };
}

const pixel = (pixels: Pixels, x: number, y: number) => [...pixels.data.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4)];

describe("clone stamp", () => {
  it("copies the pixels at the offset under a hard tip", () => {
    const layer = halves();
    const painter = new RetouchPainter(layer, {
      diameter: 6,
      hardness: 1,
      stroke: { kind: "clone", opacity: 1, flow: 1, offset: { x: 20, y: 0 } },
    });
    painter.add({ x: 5, y: 10, pressure: 1 });
    expect(pixel(layer, 5, 10)).toEqual([0, 0, 255, 255]);
    // Outside the tip nothing changes.
    expect(pixel(layer, 12, 10)).toEqual([255, 0, 0, 255]);
    expect(painter.takeChanged()).toEqual({ left: 2, top: 7, right: 8, bottom: 13 });
    expect(painter.takeChanged()).toBeNull();
  });

  it("caps overlapping dabs at the opacity and copies from the layer as it began", () => {
    const layer = halves();
    const painter = new RetouchPainter(layer, {
      diameter: 6,
      hardness: 1,
      stroke: { kind: "clone", opacity: 0.5, flow: 1, offset: { x: 20, y: 0 } },
    });
    for (let x = 2; x <= 8; x += 0.5) painter.add({ x, y: 10, pressure: 1 });
    expect(pixel(layer, 5, 10)).toEqual([128, 0, 128, 255]);
  });

  it("blends partly transparent pixels without darkening them", () => {
    const layer = { data: new Uint8ClampedArray(8 * 4), width: 8, height: 1 };
    layer.data.set([255, 255, 0, 255], 4 * 4);
    const painter = new RetouchPainter(layer, {
      diameter: 2,
      hardness: 1,
      stroke: { kind: "clone", opacity: 0.5, flow: 1, offset: { x: 3, y: 0 } },
    });
    painter.add({ x: 1.5, y: 0.5, pressure: 1 });
    // Half of an opaque yellow over nothing: yellow at half alpha, not olive.
    expect(pixel(layer, 1, 0)).toEqual([255, 255, 0, 128]);
  });

  it("stays inside the selection and leaves pixels whose source is off the layer", () => {
    const layer = halves();
    const clip = new Uint8Array(40 * 20);
    for (let y = 0; y < 20; y += 1) clip.fill(255, y * 40, y * 40 + 5);
    const painter = new RetouchPainter(layer, {
      diameter: 8,
      hardness: 1,
      clip,
      stroke: { kind: "clone", opacity: 1, flow: 1, offset: { x: 20, y: 0 } },
    });
    painter.add({ x: 5, y: 10, pressure: 1 });
    expect(pixel(layer, 4, 10)).toEqual([0, 0, 255, 255]);
    expect(pixel(layer, 6, 10)).toEqual([255, 0, 0, 255]);

    const edge = halves();
    new RetouchPainter(edge, {
      diameter: 4,
      hardness: 1,
      stroke: { kind: "clone", opacity: 1, flow: 1, offset: { x: 0, y: -15 } },
    }).add({ x: 5, y: 5, pressure: 1 });
    expect(pixel(edge, 5, 5)).toEqual([255, 0, 0, 255]);
  });

  it("puts everything back when cancelled", () => {
    const layer = halves();
    const before = layer.data.slice();
    const painter = new RetouchPainter(layer, {
      diameter: 6,
      hardness: 0.5,
      stroke: { kind: "clone", opacity: 1, flow: 1, offset: { x: 20, y: 0 } },
    });
    painter.add({ x: 5, y: 10, pressure: 1 });
    painter.add({ x: 12, y: 10, pressure: 1 });
    painter.cancel();
    expect(layer.data).toEqual(before);
  });
});

describe("healing brush", () => {
  it("keeps the copied texture but takes on the light where it lands", () => {
    // A dark left half with a bright dot to copy, and a light right half.
    const width = 60;
    const height = 30;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = x < 30 ? 50 : 200;
        data.set([value, value, value, 255], (y * width + x) * 4);
      }
    }
    data.set([90, 90, 90, 255], (15 * width + 10) * 4);
    const layer = { data, width, height };
    const painter = new RetouchPainter(layer, {
      diameter: 8,
      hardness: 1,
      stroke: { kind: "heal", offset: { x: -35, y: 0 } },
    });
    painter.add({ x: 45.5, y: 15.5, pressure: 1 });
    // While painting it is a plain copy.
    expect(pixel(layer, 45, 15)[0]).toBe(90);
    painter.heal();
    // Healed: the dot stands 40 above its surroundings, which are now light.
    expect(pixel(layer, 45, 15)[0]).toBeGreaterThan(230);
    expect(Math.abs(pixel(layer, 43, 15)[0]! - 200)).toBeLessThan(4);
  });
});

describe("spot healing", () => {
  it("marks the stroke, asks for its surroundings, and lays the rebuilt pixels in", () => {
    const layer = halves();
    const painter = new RetouchPainter(layer, { diameter: 4, hardness: 1, stroke: { kind: "spot" } });
    painter.add({ x: 5, y: 10, pressure: 1 });
    // Shown darker until it is rebuilt.
    expect(pixel(layer, 5, 10)[0]).toBeLessThan(255);
    const request = painter.spotRequest(3)!;
    expect(request.rect).toEqual({ left: 0, top: 5, right: 10, bottom: 15 });
    expect(request.hole[5 * 10 + 5]).toBe(1);
    expect(request.hole[0]).toBe(0);
    // The original pixels, not the marked ones.
    expect([...request.pixels.slice((5 * 10 + 5) * 4, (5 * 10 + 5) * 4 + 4)]).toEqual([255, 0, 0, 255]);
    const rebuilt = new Uint8ClampedArray(request.pixels.length).fill(255);
    painter.applySpot(request.rect, rebuilt);
    expect(pixel(layer, 5, 10)).toEqual([255, 255, 255, 255]);
    expect(pixel(layer, 1, 6)).toEqual([255, 0, 0, 255]);
  });
});
