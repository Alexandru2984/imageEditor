import type { Canvas as FabricCanvas } from "fabric";

/** Pen pressure, 0–1; mice and fingers paint at full size. */
export function pressureOf(event: Event): number {
  const pointer = event as PointerEvent;
  return pointer.pointerType === "pen" && pointer.pressure > 0 ? pointer.pressure : 1;
}

/**
 * The brush's outline on the canvas's top layer, black and white so it shows
 * on any colour. `x`, `y` and `radius` are in screen pixels of the canvas; a
 * tip less round than 1 is an ellipse turned `angle` degrees.
 */
export function strokeBrushOutline(
  canvas: FabricCanvas,
  x: number,
  y: number,
  radius: number,
  roundness = 1,
  angle = 0
): void {
  if (radius < 2) return;
  const top = canvas.contextTop;
  const ratio = canvas.getRetinaScaling();
  const turn = (-angle * Math.PI) / 180;
  top.save();
  top.setTransform(ratio, 0, 0, ratio, 0, 0);
  top.lineWidth = 1;
  top.beginPath();
  top.ellipse(x, y, radius, Math.max(1, radius * roundness), turn, 0, Math.PI * 2);
  top.strokeStyle = "rgba(0, 0, 0, 0.7)";
  top.stroke();
  top.beginPath();
  top.ellipse(x, y, radius + 1, Math.max(2, radius * roundness + 1), turn, 0, Math.PI * 2);
  top.strokeStyle = "rgba(255, 255, 255, 0.8)";
  top.stroke();
  top.restore();
}
