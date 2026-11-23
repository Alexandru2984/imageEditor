import { FabricImage, FabricObject } from "fabric";
import { nativeMultiplier } from "@/utils/flatten";
import { Mask } from "@/selection/mask";
import { strokeBand } from "@/selection/edits";
import {
  hasEffects,
  layerStyleMargin,
  rgba,
  shadowOffset,
  type BevelStyle,
  type GradientOverlayStyle,
  type LayerStyle,
  type SatinStyle,
  type StrokeStyle,
} from "./layerStyleData";

/**
 * Drawing layer styles. A styled layer is drawn onto a work canvas at the
 * resolution it is shown at, the effects are built from those pixels, and
 * the result goes onto the canvas with the layer's opacity and blending:
 *
 * - drop shadow and outer glow are the canvas's own blurred shadow, cast by
 *   the layer drawn out of sight so that only the shadow lands;
 * - colour and gradient overlays are the colour cut to the layer's pixels;
 * - inner shadow, inner glow and the bevel's shading are the blurred shadow
 *   of everything outside the layer, cut to the layer; satin is the layer's
 *   blurred shape against itself shifted both ways;
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

/** Sides of the work area the screen cut off: the layer may go on past them. */
interface CutSides {
  left: boolean;
  top: boolean;
  right: boolean;
  bottom: boolean;
}

type Take = (slot: number, width: number, height: number) => HTMLCanvasElement;

/**
 * Into `target` (cleared): the shadow that everything outside the layer
 * casts onto it, `dx`, `dy` away and blurred by `blur`, cut to the layer.
 * Past the work area counts as outside, but not past the sides the screen
 * cut off. `passes` draws it again, denser near the edge.
 */
function castInner(
  take: Take,
  target: CanvasRenderingContext2D,
  content: HTMLCanvasElement,
  width: number,
  height: number,
  cut: CutSides,
  color: string,
  blur: number,
  dx: number,
  dy: number,
  passes = 1
) {
  // What is outside, with room around the work area for the blur to fill.
  const frame = Math.ceil(blur * 2 + Math.max(Math.abs(dx), Math.abs(dy)) + 8);
  const outerWidth = width + frame * 2;
  const outerHeight = height + frame * 2;
  const outside = take(3, outerWidth, outerHeight);
  const context = contextOf(outside, outerWidth, outerHeight);
  const x0 = cut.left ? frame : 0;
  const y0 = cut.top ? frame : 0;
  const x1 = cut.right ? frame + width : outerWidth;
  const y1 = cut.bottom ? frame + height : outerHeight;
  context.fillStyle = "#000000";
  context.fillRect(x0, y0, x1 - x0, y1 - y0);
  context.globalCompositeOperation = "destination-out";
  context.drawImage(content, 0, 0, width, height, frame, frame, width, height);
  context.globalCompositeOperation = "source-over";

  // Drawn out of sight, so that only its shadow lands.
  const away = outerWidth + blur * 3 + 64;
  target.save();
  target.shadowColor = color;
  target.shadowBlur = blur;
  target.shadowOffsetX = away + dx;
  target.shadowOffsetY = dy;
  for (let pass = 0; pass < passes; pass += 1) {
    target.drawImage(outside, 0, 0, outerWidth, outerHeight, -away - frame, -frame, outerWidth, outerHeight);
  }
  target.restore();
  clipTo(target, content, width, height, "destination-in");
}

/** Keep `target` only where the layer is (`destination-in`) or is not (`destination-out`). */
function clipTo(
  target: CanvasRenderingContext2D,
  content: HTMLCanvasElement,
  width: number,
  height: number,
  operation: "destination-in" | "destination-out"
) {
  target.globalCompositeOperation = operation;
  target.drawImage(content, 0, 0, width, height, 0, 0, width, height);
  target.globalCompositeOperation = "source-over";
}

/** Put `source` onto `out` at `alpha` with `operation`. */
function lay(
  out: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  height: number,
  alpha: number,
  operation: GlobalCompositeOperation
) {
  out.globalAlpha = alpha;
  out.globalCompositeOperation = operation;
  out.drawImage(source, 0, 0, width, height, 0, 0, width, height);
  out.globalAlpha = 1;
  out.globalCompositeOperation = "source-over";
}

/** The gradient of a gradient overlay over the layer's box (work pixels), running `direction`. */
function overlayGradient(
  context: CanvasRenderingContext2D,
  overlay: GradientOverlayStyle,
  box: { x0: number; y0: number; x1: number; y1: number },
  direction: { x: number; y: number }
): CanvasGradient {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const boxWidth = box.x1 - box.x0;
  const boxHeight = box.y1 - box.y0;
  if (overlay.gradient === "radial") {
    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.max(boxWidth, boxHeight) / 2));
    gradient.addColorStop(0, overlay.color);
    gradient.addColorStop(1, overlay.endColor);
    return gradient;
  }
  // Long enough to cross the box the way it runs.
  const half = Math.max(0.5, (Math.abs(direction.x) * boxWidth + Math.abs(direction.y) * boxHeight) / 2);
  const gradient = context.createLinearGradient(
    cx - direction.x * half,
    cy - direction.y * half,
    cx + direction.x * half,
    cy + direction.y * half
  );
  if (overlay.gradient === "reflected") {
    gradient.addColorStop(0, overlay.endColor);
    gradient.addColorStop(0.5, overlay.color);
    gradient.addColorStop(1, overlay.endColor);
  } else {
    gradient.addColorStop(0, overlay.color);
    gradient.addColorStop(1, overlay.endColor);
  }
  return gradient;
}

/** Satin: the layer's blurred shape against itself shifted both ways, cut to the layer, into a work canvas. */
function satinOf(
  take: Take,
  content: HTMLCanvasElement,
  width: number,
  height: number,
  satin: SatinStyle,
  devicePerDoc: number
): HTMLCanvasElement {
  const offset = shadowOffset(satin);
  const blur = satin.size * devicePerDoc;
  const dx = offset.x * devicePerDoc;
  const dy = offset.y * devicePerDoc;
  const one = take(4, width, height);
  const first = contextOf(one, width, height);
  castShadow(first, content, width, height, satin.color, blur, dx, dy);
  const other = take(3, width, height);
  const second = contextOf(other, width, height);
  castShadow(second, content, width, height, satin.color, blur, -dx, -dy);
  // Where just one of them is: their difference.
  first.globalCompositeOperation = "xor";
  first.drawImage(other, 0, 0, width, height, 0, 0, width, height);
  first.globalCompositeOperation = "source-over";
  let result = one;
  if (satin.invert) {
    const inverted = contextOf(other, width, height);
    inverted.fillStyle = satin.color;
    inverted.fillRect(0, 0, width, height);
    clipTo(inverted, one, width, height, "destination-out");
    result = other;
  }
  clipTo(result.getContext("2d")!, content, width, height, "destination-in");
  return result;
}

/**
 * Bevel and emboss, onto `out`: highlight (Screen) on the slopes facing the
 * light and shadow (Multiply) on those facing away, inside the edge, outside
 * it, or both.
 */
function drawBevel(
  take: Take,
  out: CanvasRenderingContext2D,
  content: HTMLCanvasElement,
  width: number,
  height: number,
  cut: CutSides,
  bevel: BevelStyle,
  devicePerDoc: number
) {
  const raised = bevel.direction === "up" ? 1 : -1;
  const reach = bevel.size * devicePerDoc;
  // A lower light throws the shading further; Photoshop's 30° is the measure.
  const lift = Math.cos((Math.min(90, Math.max(0, bevel.altitude)) * Math.PI) / 180) / Math.cos(Math.PI / 6);
  const depth = bevel.depth / 100;
  const strength = Math.min(1, depth);
  const spread = Math.min(3, Math.max(1, Math.sqrt(depth)));
  const blur = reach + bevel.soften * devicePerDoc;
  const highlight = rgba(bevel.color, bevel.opacity * strength);
  const shadow = rgba(bevel.shadowColor, bevel.shadowOpacity * strength);
  const fx = take(4, width, height);
  const part = (inside: boolean, scale: number, sign: number) => {
    const distance = Math.max(0.5, reach * 0.5 * lift * spread * scale);
    // Away from the light.
    const away = shadowOffset({ angle: bevel.angle, distance });
    for (const [color, toward, operation] of [
      [highlight, 1, "screen"],
      [shadow, -1, "multiply"],
    ] as const) {
      const context = contextOf(fx, width, height);
      const s = toward * raised * sign;
      if (inside) {
        // What is outside, shifted away from the light, lands on the slope facing it.
        castInner(take, context, content, width, height, cut, color, blur * scale, away.x * s, away.y * s);
      } else {
        // The layer shifted towards the light lands on the outer slope facing it.
        castShadow(context, content, width, height, color, blur * scale, -away.x * s, -away.y * s);
        clipTo(context, content, width, height, "destination-out");
      }
      lay(out, fx, width, height, 1, operation);
    }
  };
  if (bevel.kind === "innerBevel") part(true, 1, 1);
  else if (bevel.kind === "outerBevel") part(false, 1, 1);
  else if (bevel.kind === "emboss") {
    part(true, 0.5, 1);
    part(false, 0.5, 1);
  } else {
    // Pillow emboss: raised inside, sunk outside.
    part(true, 0.5, 1);
    part(false, 0.5, -1);
  }
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

/** A layer's Fill opacity (Layers panel), 0–1. */
export function fillOf(object: FabricObject): number {
  const fill = (object as FabricObject & { __fill?: unknown }).__fill;
  return typeof fill === "number" && Number.isFinite(fill) ? Math.min(1, Math.max(0, fill)) : 1;
}

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
  const wanted = {
    left: Math.floor(Math.min(...xs) - margin),
    top: Math.floor(Math.min(...ys) - margin),
    right: Math.ceil(Math.max(...xs) + margin),
    bottom: Math.ceil(Math.max(...ys) + margin),
  };
  const left = Math.max(0, wanted.left);
  const top = Math.max(0, wanted.top);
  const right = Math.min(ctx.canvas.width, wanted.right);
  const bottom = Math.min(ctx.canvas.height, wanted.bottom);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return;
  const cut: CutSides = {
    left: wanted.left < 0,
    top: wanted.top < 0,
    right: wanted.right > ctx.canvas.width,
    bottom: wanted.bottom > ctx.canvas.height,
  };

  const works: { element: HTMLCanvasElement; temporary: boolean }[] = [];
  const take: Take = (slot, takeWidth, takeHeight) => {
    const work = workCanvas(slot, takeWidth, takeHeight);
    works.push(work);
    return work.element;
  };
  const content = workCanvas(0, width, height);
  const result = workCanvas(1, width, height);
  const extra = workCanvas(2, width, height);
  works.push(content, result, extra);
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
    const { dropShadow, outerGlow, colorOverlay, stroke, gradientOverlay, satin, innerGlow, innerShadow, bevel } = style;
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
    // Fill opacity fades the layer's own pixels, not its effects.
    out.globalAlpha = fillOf(object);
    out.drawImage(content.element, 0, 0, width, height, 0, 0, width, height);
    out.globalAlpha = 1;

    if (gradientOverlay?.enabled && gradientOverlay.opacity > 0) {
      const overlay = contextOf(extra.element, width, height);
      // The angle is the document's; the view may be turned or flipped.
      const radians = (gradientOverlay.angle * Math.PI) / 180;
      const along = { x: Math.cos(radians), y: -Math.sin(radians) };
      const mapped = { x: base.a * along.x + base.c * along.y, y: base.b * along.x + base.d * along.y };
      const length = Math.hypot(mapped.x, mapped.y) || 1;
      overlay.fillStyle = overlayGradient(
        overlay,
        gradientOverlay,
        { x0: Math.min(...xs) - left, y0: Math.min(...ys) - top, x1: Math.max(...xs) - left, y1: Math.max(...ys) - top },
        { x: mapped.x / length, y: mapped.y / length }
      );
      overlay.fillRect(0, 0, width, height);
      clipTo(overlay, content.element, width, height, "destination-in");
      lay(out, extra.element, width, height, gradientOverlay.opacity / 100, "source-over");
    }

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

    if (satin?.enabled && satin.opacity > 0) {
      lay(out, satinOf(take, content.element, width, height, satin, devicePerDoc), width, height, satin.opacity / 100, "multiply");
    }

    if (innerGlow?.enabled && innerGlow.opacity > 0 && innerGlow.size > 0) {
      const glow = contextOf(extra.element, width, height);
      const blur = innerGlow.size * devicePerDoc;
      if (innerGlow.source === "edge") {
        // Twice, as with the outer glow.
        castInner(take, glow, content.element, width, height, cut, rgba(innerGlow.color, innerGlow.opacity), blur, 0, 0, 2);
        lay(out, extra.element, width, height, 1, "screen");
      } else {
        // From the middle: the colour, less the glow of the edge.
        const edge = take(4, width, height);
        castInner(take, contextOf(edge, width, height), content.element, width, height, cut, "#000000", blur, 0, 0, 2);
        glow.fillStyle = innerGlow.color;
        glow.fillRect(0, 0, width, height);
        clipTo(glow, content.element, width, height, "destination-in");
        clipTo(glow, edge, width, height, "destination-out");
        lay(out, extra.element, width, height, innerGlow.opacity / 100, "screen");
      }
    }

    if (innerShadow?.enabled && innerShadow.opacity > 0) {
      const offset = shadowOffset(innerShadow);
      castInner(
        take,
        contextOf(extra.element, width, height),
        content.element,
        width,
        height,
        cut,
        rgba(innerShadow.color, innerShadow.opacity),
        innerShadow.size * devicePerDoc,
        offset.x * devicePerDoc,
        offset.y * devicePerDoc
      );
      lay(out, extra.element, width, height, 1, "multiply");
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

    if (bevel?.enabled && bevel.size > 0 && (bevel.opacity > 0 || bevel.shadowOpacity > 0)) {
      drawBevel(take, out, content.element, width, height, cut, bevel, devicePerDoc);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= opacity;
    ctx.globalCompositeOperation = blend || "source-over";
    ctx.drawImage(result.element, 0, 0, width, height, left, top, width, height);
    ctx.restore();
  } finally {
    for (const work of works) {
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
      const fill = fillOf(this);
      if (fill >= 1) {
        render.call(this, ctx);
        return;
      }
      // Without effects, Fill is one more opacity.
      const opacity = this.opacity;
      this.opacity = opacity * fill;
      try {
        render.call(this, ctx);
      } finally {
        this.opacity = opacity;
      }
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
