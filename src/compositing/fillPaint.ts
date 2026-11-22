import type { Canvas as FabricCanvas, TMat2D } from "fabric";
import { findBackgroundImage } from "@/utils/editorObjects";
import { documentMaskAlpha } from "@/raster/layerMask";
import type { FillContent, FillLayer } from "@/adjustments/fillLayer";

/**
 * Fill layers on a 2D context: the colour or gradient over the document
 * (where Photoshop's would show, the document being all there is), through
 * the layer's mask. The context's alpha and blend mode are the layer's.
 */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The gradient over `area` in scene coordinates, as Photoshop lays one out. */
function gradientOf(ctx: CanvasRenderingContext2D, content: Extract<FillContent, { kind: "gradient" }>, area: Box): CanvasGradient {
  const [from, to] = content.reverse ? [content.to, content.from] : [content.from, content.to];
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  const scale = content.scale / 100;
  if (content.style === "radial") {
    const radius = (Math.max(area.width, area.height) / 2) * scale;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(radius, 1e-6));
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    return gradient;
  }
  // Counter-clockwise from pointing right, with the scene's y pointing down.
  const radians = (content.angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = -Math.sin(radians);
  // Half the document's reach along that direction.
  const reach = Math.max(((Math.abs(area.width * dx) + Math.abs(area.height * dy)) / 2) * scale, 1e-6);
  const gradient = ctx.createLinearGradient(cx - dx * reach, cy - dy * reach, cx + dx * reach, cy + dy * reach);
  if (content.style === "reflected") {
    gradient.addColorStop(0, to);
    gradient.addColorStop(0.5, from);
    gradient.addColorStop(1, to);
  } else {
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
  }
  return gradient;
}

function paintArea(ctx: CanvasRenderingContext2D, content: FillContent, area: Box) {
  ctx.fillStyle = content.kind === "solid" ? content.color : gradientOf(ctx, content, area);
  ctx.fillRect(area.left, area.top, area.width, area.height);
}

const scratch: (HTMLCanvasElement | null)[] = [null, null];
function work(index: 0 | 1, width: number, height: number): CanvasRenderingContext2D | null {
  let element = scratch[index];
  if (!element) {
    element = document.createElement("canvas");
    scratch[index] = element;
  }
  if (element.width !== width || element.height !== height) {
    element.width = width;
    element.height = height;
  }
  const context = element.getContext("2d");
  context?.setTransform(1, 0, 0, 1, 0, 0);
  context?.clearRect(0, 0, width, height);
  return context;
}

const multiply = (m: DOMMatrix, t: TMat2D) => m.multiply(new DOMMatrix(t));

export function paintFillLayer(ctx: CanvasRenderingContext2D, layer: FillLayer): void {
  const photo = layer.canvas ? findBackgroundImage(layer.canvas as FabricCanvas) : undefined;
  if (!photo) return;
  const area = photo.getBoundingRect();
  if (!(area.width > 0 && area.height > 0)) return;
  const mask = documentMaskAlpha(layer);
  if (mask === "loading") return;
  if (mask === "none") {
    paintArea(ctx, layer.fillContent, area);
    return;
  }
  // Masked: the content and the mask meet on canvases the size of the area on screen.
  const m = ctx.getTransform();
  const xs = [area.left, area.left + area.width].flatMap((x) => [area.top, area.top + area.height].map((y) => m.a * x + m.c * y + m.e));
  const ys = [area.left, area.left + area.width].flatMap((x) => [area.top, area.top + area.height].map((y) => m.b * x + m.d * y + m.f));
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return;
  const content = work(0, width, height);
  const shape = work(1, width, height);
  if (!content || !shape) return;
  content.setTransform(m.a, m.b, m.c, m.d, m.e - left, m.f - top);
  paintArea(content, layer.fillContent, area);
  // Shown everywhere the mask does not reach, as its alpha where it does.
  shape.fillStyle = "#000000";
  shape.fillRect(0, 0, width, height);
  const placed = multiply(m, mask.placement);
  shape.setTransform(placed.a, placed.b, placed.c, placed.d, placed.e - left, placed.f - top);
  shape.clearRect(0, 0, mask.alpha.width, mask.alpha.height);
  shape.imageSmoothingEnabled = true;
  shape.drawImage(mask.alpha, 0, 0);
  content.setTransform(1, 0, 0, 1, 0, 0);
  content.globalCompositeOperation = "destination-in";
  content.drawImage(shape.canvas, 0, 0);
  content.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(content.canvas, 0, 0, width, height, left, top, width, height);
  ctx.restore();
}
