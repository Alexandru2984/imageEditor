import { horizontalBlur, type Area } from "./filters";

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** A canvas on the page, or in a worker an offscreen one. */
function canvasOf(width: number, height: number) {
  const element: AnyCanvas =
    typeof document === "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) throw new Error("The browser could not prepare the blur");
  return { element, context };
}

const release = (...elements: AnyCanvas[]) => {
  for (const element of elements) {
    element.width = 0;
    element.height = 0;
  }
};

/**
 * Photoshop's Motion Blur: each pixel averaged along a line of `distance`
 * pixels at `angle` degrees. The image is turned so the line runs along its
 * rows, blurred along them (at a cost that does not grow with the distance)
 * and turned back; its edges are first repeated outwards so they do not fade.
 */
export function motionBlur(area: Area, angle: number, distance: number): Uint8ClampedArray {
  if (distance < 1) return area.data.slice();
  const radius = distance / 2;
  const { width, height } = area;
  if (Math.abs(angle % 180) < 0.01) return horizontalBlur(area, radius);

  const pad = Math.ceil(radius) + 2;
  const source = canvasOf(width, height);
  const padded = canvasOf(width + pad * 2, height + pad * 2);
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const turnedWidth = Math.ceil(padded.element.width * cos + padded.element.height * sin) + 2;
  const turnedHeight = Math.ceil(padded.element.width * sin + padded.element.height * cos) + 2;
  const turned = canvasOf(turnedWidth, turnedHeight);
  try {
    const pixels = source.context.createImageData(width, height);
    pixels.data.set(area.data);
    source.context.putImageData(pixels, 0, 0);
    const pc = padded.context;
    pc.imageSmoothingEnabled = false;
    pc.drawImage(source.element, pad, pad);
    // Edges and corners, stretched outwards.
    pc.drawImage(source.element, 0, 0, 1, height, 0, pad, pad, height);
    pc.drawImage(source.element, width - 1, 0, 1, height, pad + width, pad, pad, height);
    pc.drawImage(source.element, 0, 0, width, 1, pad, 0, width, pad);
    pc.drawImage(source.element, 0, height - 1, width, 1, pad, pad + height, width, pad);
    pc.drawImage(source.element, 0, 0, 1, 1, 0, 0, pad, pad);
    pc.drawImage(source.element, width - 1, 0, 1, 1, pad + width, 0, pad, pad);
    pc.drawImage(source.element, 0, height - 1, 1, 1, 0, pad + height, pad, pad);
    pc.drawImage(source.element, width - 1, height - 1, 1, 1, pad + width, pad + height, pad, pad);

    // Turn so the motion runs along the rows.
    const tc = turned.context;
    tc.translate(turnedWidth / 2, turnedHeight / 2);
    tc.rotate(radians);
    tc.drawImage(padded.element, -padded.element.width / 2, -padded.element.height / 2);
    tc.setTransform(1, 0, 0, 1, 0, 0);
    const rows = tc.getImageData(0, 0, turnedWidth, turnedHeight);
    const blurred = horizontalBlur({ data: rows.data, width: turnedWidth, height: turnedHeight }, radius);
    rows.data.set(blurred);
    tc.putImageData(rows, 0, 0);

    // And back.
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.clearRect(0, 0, padded.element.width, padded.element.height);
    pc.imageSmoothingEnabled = true;
    pc.translate(padded.element.width / 2, padded.element.height / 2);
    pc.rotate(-radians);
    pc.drawImage(turned.element, -turnedWidth / 2, -turnedHeight / 2);
    pc.setTransform(1, 0, 0, 1, 0, 0);
    return pc.getImageData(pad, pad, width, height).data;
  } finally {
    release(source.element, padded.element, turned.element);
  }
}
