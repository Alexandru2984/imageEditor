import { FabricImage, FabricObject } from "fabric";
import { nativeMultiplier } from "@/utils/flatten";
import { Mask } from "@/selection/mask";
import { strokeBand } from "@/selection/edits";
import { hasEffects, layerStyleMargin, rgba, shadowOffset, type LayerStyle, type StrokeStyle } from "./layerStyleData";

/**
 * Drawing layer styles. A styled layer is drawn onto a work canvas at the
 * resolution it is shown at, the effects are built from those pixels, and
 * the result goes onto the canvas with the layer's opacity and blending:
 *
 * - drop shadow and outer glow are the canvas's own blurred shadow, cast by
 *   the layer drawn out of sight so that only the shadow lands;
 * - colour overlay is the colour cut to the layer's pixels;
 * - the stroke of text, shapes and drawings is a wider round-joined outline
 *   of their own; the stroke of an image follows its opaque pixels and is
 *   worked out once in the image's own pixels, then reused at every zoom.
 */

export type StyledObject = FabricObject & { layerStyle?: LayerStyle };

type RenderInternals = FabricObject & {
  render(ctx: CanvasRenderingContext2D): void;
  transform(ctx: CanvasRenderingContext2D): void;
  drawObject(ctx: CanvasRenderingContext2D, forClipping: boolean, context: object): void;
  _renderFill(ctx: CanvasRenderingContext2D): void;
  _originalElement?: CanvasImageSource;
};

/** Above this many pixels work canvases are freed after each use. */
const KEEP_PIXELS = 4_000_000;
const pool: HTMLCanvasElement[] = [];
/** Styled layers inside styled groups each get their own work canvases. */
let depth = 0;

function workCanvas(slot: number, width: number, height: number) {
  if (width * height > KEEP_PIXELS || depth > 1) {
    const element = document.createElement("canvas");
    element.width = width;
    element.height = height;
    return { element, temporary: true };
  }
  let element = pool[slot];
  if (!element) {
    element = document.createElement("canvas");
    pool[slot] = element;
  }
  if (element.width < width || element.height < height) {
    element.width = Math.max(element.width, width);
    element.height = Math.max(element.height, height);
  }
  return { element, temporary: false };
}

function contextOf(element: HTMLCanvasElement, width: number, height: number) {
  const context = element.getContext("2d");
  if (!context) throw new Error("The browser could not draw the layer style");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, width, height);
  return context;
}

/** Cast `source`'s shadow onto `target` without drawing `source` itself. */
function castShadow(
  target: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  height: number,
  color: string,
  blur: number,
  dx: number,
  dy: number
) {
  // Far enough left that none of the drawing lands on the work canvas.
  const away = width + blur * 3 + 64;
  target.save();
  target.shadowColor = color;
  target.shadowBlur = blur;
  target.shadowOffsetX = away + dx;
  target.shadowOffsetY = dy;
  target.drawImage(source, 0, 0, width, height, -away, 0, width, height);
  target.restore();
}

// ---------- The stroke of an image, in its own pixels ----------

interface ImageStroke {
  key: string;
  /** The layer mask it was cut by; compared whole, as data URLs may share ends. */
  maskSrc: string | null;
  canvas: HTMLCanvasElement;
  /** Image pixels of room around the image. */
  pad: number;
  /** Stroke pixels per image pixel. */
  scale: number;
}

const imageStrokes = new WeakMap<FabricImage, ImageStroke>();
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
const identity = (value: unknown) => {
  if (!value || typeof value !== "object") return 0;
  let id = identities.get(value);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(value, id);
  }
  return id;
};

/** The most pixels an image stroke is worked out at; it is scaled to fit. */
const STROKE_PIXELS = 2_500_000;

function imageStroke(image: FabricImage, stroke: StrokeStyle, imagePerDocPixel: number): ImageStroke {
  const internals = image as RenderInternals & { layerMask?: { src: string; enabled: boolean } };
  const size = stroke.size * imagePerDocPixel;
  const pad = Math.ceil(size) + 2;
  const spanWidth = image.width + pad * 2;
  const spanHeight = image.height + pad * 2;
  const scale = Math.min(1, Math.sqrt(STROKE_PIXELS / Math.max(1, spanWidth * spanHeight)));
  const key = [
    identity(internals._originalElement),
    identity(image.getElement()),
    image.width,
    image.height,
    image.cropX,
    image.cropY,
    image.filters.length,
    stroke.color,
    stroke.position,
    size.toFixed(3),
    scale.toFixed(4),
  ].join("|");
  const maskSrc = internals.layerMask?.enabled ? internals.layerMask.src : null;
  const cached = imageStrokes.get(image);
  if (cached?.key === key && cached.maskSrc === maskSrc) return cached;

  const width = Math.max(1, Math.ceil(spanWidth * scale));
  const height = Math.max(1, Math.ceil(spanHeight * scale));
  const canvas = cached?.canvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not draw the stroke");
  // The image's own pixels, through its mask.
  context.setTransform(scale, 0, 0, scale, (image.width / 2 + pad) * scale, (image.height / 2 + pad) * scale);
  internals._renderFill(context);
  context.setTransform(1, 0, 0, 1, 0, 0);
  const pixels = context.getImageData(0, 0, width, height);
  const shape = new Mask(width, height);
  for (let index = 0; index < shape.data.length; index += 1) shape.data[index] = pixels.data[index * 4 + 3]!;
  const band = strokeBand(shape, Math.max(1, Math.round(size * scale)), stroke.position);
  const value = parseInt(stroke.color.slice(1), 16);
  const [red, green, blue] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  for (let index = 0; index < band.data.length; index += 1) {
    const offset = index * 4;
    pixels.data[offset] = red;
    pixels.data[offset + 1] = green;
    pixels.data[offset + 2] = blue;
    pixels.data[offset + 3] = band.data[index]!;
  }
  context.putImageData(pixels, 0, 0);
  const result = { key, maskSrc, canvas, pad, scale };
  imageStrokes.set(image, result);
  return result;
}

// ---------- The stroke of text, shapes and drawings ----------

/**
 * Draw the object again as a wide round outline of `color` only, placed by
 * `matrix`: its own placement before the outline's width is set, as Fabric
 * places objects by their box including the stroke.
 */
function drawOutline(
  object: RenderInternals,
  target: CanvasRenderingContext2D,
  matrix: DOMMatrix,
  width: number,
  color: string
) {
  const keys = [
    "fill",
    "stroke",
    "strokeWidth",
    "paintFirst",
    "strokeLineJoin",
    "strokeLineCap",
    "strokeDashArray",
    "strokeUniform",
    "backgroundColor",
  ] as const;
  const record = object as unknown as Record<string, unknown>;
  const kept = keys.map((key) => record[key]);
  // Plain assignments: Fabric's cache stays valid for the normal drawing.
  Object.assign(record, {
    fill: null,
    stroke: color,
    strokeWidth: width,
    paintFirst: "fill",
    strokeLineJoin: "round",
    strokeLineCap: "round",
    strokeDashArray: null,
    strokeUniform: false,
    backgroundColor: "",
  });
  // Drawn directly, past Fabric's cache of the object's normal look.
  target.save();
  try {
    target.setTransform(matrix);
    object.drawObject(target, false, {});
  } finally {
    target.restore();
    keys.forEach((key, index) => {
      record[key] = kept[index];
    });
  }
}

// ---------- Drawing a styled layer ----------

let renderPlain: (this: FabricObject, ctx: CanvasRenderingContext2D) => void;

function renderStyled(object: StyledObject, ctx: CanvasRenderingContext2D, style: LayerStyle) {
  const internals = object as unknown as RenderInternals;
  const base = ctx.getTransform();
  ctx.save();
  internals.transform(ctx);
  const placed = ctx.getTransform();
  ctx.restore();

  // Device pixels per document pixel, and per pixel of the object itself.
  const devicePerScene = Math.sqrt(Math.abs(base.a * base.d - base.b * base.c)) || 1;
  const docPerScene = object.canvas ? nativeMultiplier(object.canvas as Parameters<typeof nativeMultiplier>[0]) : 1;
  const devicePerDoc = devicePerScene / docPerScene;
  const devicePerLocal = Math.sqrt(Math.abs(placed.a * placed.d - placed.b * placed.c)) || 1;
  const localPerDoc = devicePerDoc / devicePerLocal;

  // The device pixels the layer and its effects cover, as far as they show.
  const own = object.shadow ? (object.shadow.blur + Math.max(Math.abs(object.shadow.offsetX), Math.abs(object.shadow.offsetY))) * devicePerLocal : 0;
  const margin = layerStyleMargin(style) * devicePerDoc + own + 2;
  const halfWidth = (object.width + (object.strokeWidth || 0)) / 2;
  const halfHeight = (object.height + (object.strokeWidth || 0)) / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ] as const) {
    xs.push(placed.a * x + placed.c * y + placed.e);
    ys.push(placed.b * x + placed.d * y + placed.f);
  }
  const left = Math.max(0, Math.floor(Math.min(...xs) - margin));
  const top = Math.max(0, Math.floor(Math.min(...ys) - margin));
  const right = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs) + margin));
  const bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys) + margin));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return;

  const content = workCanvas(0, width, height);
  const result = workCanvas(1, width, height);
  const extra = workCanvas(2, width, height);
  try {
    // The layer itself, plain: its opacity and blending apply at the end.
    const contentContext = contextOf(content.element, width, height);
    contentContext.setTransform(base.a, base.b, base.c, base.d, base.e - left, base.f - top);
    const opacity = object.opacity;
    const blend = object.globalCompositeOperation;
    object.opacity = 1;
    object.globalCompositeOperation = "source-over";
    try {
      renderPlain.call(object, contentContext);
    } finally {
      object.opacity = opacity;
      object.globalCompositeOperation = blend;
    }

    const out = contextOf(result.element, width, height);
    const { dropShadow, outerGlow, colorOverlay, stroke } = style;
    if (dropShadow?.enabled && dropShadow.opacity > 0) {
      const offset = shadowOffset(dropShadow);
      castShadow(
        out,
        content.element,
        width,
        height,
        rgba(dropShadow.color, dropShadow.opacity),
        dropShadow.size * devicePerDoc,
        offset.x * devicePerDoc,
        offset.y * devicePerDoc
      );
    }
    if (outerGlow?.enabled && outerGlow.opacity > 0 && outerGlow.size > 0) {
      const glow = rgba(outerGlow.color, outerGlow.opacity);
      // Twice, as Photoshop's glow is denser near the edge than one blur.
      castShadow(out, content.element, width, height, glow, outerGlow.size * devicePerDoc, 0, 0);
      castShadow(out, content.element, width, height, glow, (outerGlow.size * devicePerDoc) / 3, 0, 0);
    }
    out.drawImage(content.element, 0, 0, width, height, 0, 0, width, height);

    if (colorOverlay?.enabled && colorOverlay.opacity > 0) {
      const overlay = contextOf(extra.element, width, height);
      overlay.fillStyle = colorOverlay.color;
      overlay.fillRect(0, 0, width, height);
      overlay.globalCompositeOperation = "destination-in";
      overlay.drawImage(content.element, 0, 0, width, height, 0, 0, width, height);
      out.globalAlpha = colorOverlay.opacity / 100;
      out.drawImage(extra.element, 0, 0, width, height, 0, 0, width, height);
      out.globalAlpha = 1;
    }

    if (stroke?.enabled && stroke.size > 0 && stroke.opacity > 0) {
      const outline = contextOf(extra.element, width, height);
      if (object instanceof FabricImage) {
        const drawn = imageStroke(object, stroke, localPerDoc);
        const matrix = new DOMMatrix([placed.a, placed.b, placed.c, placed.d, placed.e, placed.f])
          .translate(-(object.width / 2 + drawn.pad), -(object.height / 2 + drawn.pad))
          .scale(1 / drawn.scale);
        outline.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - left, matrix.f - top);
        outline.drawImage(drawn.canvas, 0, 0);
        outline.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        // An outline as wide as the visible shape plus the stroke on both
        // sides, cut to the side the stroke goes on.
        const own = object.stroke && object.strokeWidth ? object.strokeWidth : 0;
        const size = stroke.size * localPerDoc;
        const matrix = new DOMMatrix([placed.a, placed.b, placed.c, placed.d, placed.e - left, placed.f - top]);
        drawOutline(internals, outline, matrix, own + (stroke.position === "center" ? size : size * 2), stroke.color);
        if (stroke.position !== "center") {
          outline.globalCompositeOperation = stroke.position === "outside" ? "destination-out" : "destination-in";
          outline.drawImage(content.element, 0, 0, width, height, 0, 0, width, height);
          outline.globalCompositeOperation = "source-over";
        }
      }
      out.globalAlpha = stroke.opacity / 100;
      out.drawImage(extra.element, 0, 0, width, height, 0, 0, width, height);
      out.globalAlpha = 1;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= opacity;
    ctx.globalCompositeOperation = blend || "source-over";
    ctx.drawImage(result.element, 0, 0, width, height, left, top, width, height);
    ctx.restore();
  } finally {
    for (const work of [content, result, extra]) {
      if (work.temporary) {
        work.element.width = 0;
        work.element.height = 0;
      }
    }
  }
}

let installed = false;

/** Teach Fabric's objects to draw their layer styles. */
export function installLayerStyles(): void {
  if (installed) return;
  installed = true;
  const prototype = FabricObject.prototype as unknown as RenderInternals;
  const render = prototype.render;
  renderPlain = render;
  prototype.render = function (this: StyledObject, ctx: CanvasRenderingContext2D) {
    const style = this.layerStyle;
    if (!hasEffects(style) || this.isNotVisible()) {
      render.call(this, ctx);
      return;
    }
    depth += 1;
    try {
      renderStyled(this, ctx, style);
    } finally {
      depth -= 1;
    }
  };
}
