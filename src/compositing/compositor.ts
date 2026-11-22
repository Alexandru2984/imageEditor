import { Canvas, StaticCanvas, type FabricObject, type Point } from "fabric";
import { buildTree, clippingRuns, type GroupNode, type LayerTree, type TreeNode } from "@/layers/layerTree";
import { entriesOf, isClipped, isGroupHeader, isGroupMarker, type LayerGroup } from "@/layers/groupMarkers";
import { isAdjustmentLayer, type AdjustmentLayer } from "@/adjustments/adjustmentLayer";
import { adjustmentJob, type AdjustmentData } from "@/adjustments/adjustmentData";
import type { PixelJob } from "@/raster/pixelJobs";
import { adjustOnGpu, blendLayerOnGpu, type PixelRect } from "./adjustGpu";
import { adjustPixels, composePixels, isCustomBlend } from "./blendMath";

/**
 * Draws the layer stack as Photoshop composes it. Ordinary layers draw
 * straight onto the canvas as Fabric always drew them (with their masks and
 * styles); only groups that are not Pass Through at full opacity, and
 * clipping masks, go through buffers the size of the canvas being drawn:
 *
 * - a group is drawn into its own buffer, then onto what is below with the
 *   group's opacity and blend mode;
 * - a clipping mask draws its base into a buffer, the clipped layers only
 *   where the base has pixels, then the whole onto what is below with the
 *   base's opacity and blend mode;
 * - an adjustment layer changes the pixels drawn so far where it is drawn
 *   (the whole stack below it, the group's when the group is isolated, the
 *   base's when clipped), within the document. With any in the stack, the
 *   stack is drawn into a buffer first, so the transparency checkerboard
 *   under the document is never adjusted.
 *
 * Exports go through the same path (toCanvasElement → renderCanvas →
 * _renderObjects), so files look as the screen does.
 *
 * A group's opacity, blend mode and isolation apply when its header is among
 * the objects being drawn; its visibility always does. So merging layers
 * inside a group renders them as they are within it, and the merged layer,
 * still in the group, gets the group's settings once, from the group.
 */

type RenderInternals = { _renderObjects(ctx: CanvasRenderingContext2D, objects: FabricObject[]): void; _objects: FabricObject[] };

/** Buffers kept between frames, up to about a 4K screen each. */
const KEEP_BUFFER_PIXELS = 8_300_000;

const buffers: HTMLCanvasElement[] = [];
let depth = 0;

function acquire(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  let element = buffers[depth];
  if (!element) {
    element = document.createElement("canvas");
    buffers[depth] = element;
  }
  depth += 1;
  const { width, height } = ctx.canvas;
  if (element.width !== width || element.height !== height) {
    element.width = width;
    element.height = height;
  }
  const buffer = element.getContext("2d")!;
  buffer.setTransform(1, 0, 0, 1, 0, 0);
  buffer.globalAlpha = 1;
  buffer.globalCompositeOperation = "source-over";
  buffer.clearRect(0, 0, width, height);
  buffer.setTransform(ctx.getTransform());
  buffer.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
  return buffer;
}

function release(): void {
  depth -= 1;
}

/** Free buffers grown for a large export once the render is over. */
function trimBuffers(): void {
  if (depth !== 0) return;
  for (const element of buffers) {
    if (element.width * element.height > KEEP_BUFFER_PIXELS) {
      element.width = 0;
      element.height = 0;
    }
  }
}

/**
 * A buffer onto a context in one of Photoshop's blend modes a canvas has not
 * (Linear Burn, Vivid Light, Dissolve…): on the GPU, else on the CPU.
 */
function blendCustom(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, alpha: number, blend: string) {
  const opacity = alpha * ctx.globalAlpha;
  if (!(opacity > 0)) return;
  const target = ctx.canvas as HTMLCanvasElement;
  const result = blendLayerOnGpu(target, source, blend, opacity);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (result) {
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(result, 0, 0);
  } else {
    const { width, height } = target;
    const below = ctx.getImageData(0, 0, width, height);
    const layer = source.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height);
    composePixels(below.data, layer.data, width, blend, opacity);
    ctx.putImageData(below, 0, 0);
  }
  ctx.restore();
}

/** Draw a buffer onto a context, pixel for pixel. */
function drawBuffer(ctx: CanvasRenderingContext2D, buffer: CanvasRenderingContext2D, alpha: number, blend: GlobalCompositeOperation) {
  if (isCustomBlend(blend)) {
    blendCustom(ctx, buffer.canvas as HTMLCanvasElement, alpha, blend);
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= alpha;
  ctx.globalCompositeOperation = blend;
  ctx.drawImage(buffer.canvas, 0, 0);
  ctx.restore();
}

/** Draw an object with some of its settings changed for the moment. */
function renderWith(object: FabricObject, ctx: CanvasRenderingContext2D, changes: { opacity?: number; globalCompositeOperation?: GlobalCompositeOperation }) {
  const saved = { opacity: object.opacity, globalCompositeOperation: object.globalCompositeOperation };
  Object.assign(object, changes);
  try {
    object.render(ctx);
  } finally {
    Object.assign(object, saved);
  }
}

const blendOf = (object: FabricObject): GlobalCompositeOperation => (object.globalCompositeOperation || "source-over") as GlobalCompositeOperation;

/** The blend a group composes with: Pass Through acts as Normal once isolated. */
const groupBlend = (header: LayerGroup): GlobalCompositeOperation => (header.passThrough === false ? blendOf(header) : "source-over");

/** Each adjustment's pixel job, worked out once per change of its settings. */
const jobs = new WeakMap<AdjustmentData, PixelJob>();
const jobOf = (adjustment: AdjustmentData): PixelJob => {
  let job = jobs.get(adjustment);
  if (!job) {
    job = adjustmentJob(adjustment);
    jobs.set(adjustment, job);
  }
  return job;
};

/** How strongly an adjustment applies: its opacity, and Fill (the same thing for it, as in Photoshop). */
const strengthOf = (layer: AdjustmentLayer): number => {
  const fill = (layer as AdjustmentLayer & { __fill?: number }).__fill;
  return (layer.opacity ?? 1) * (typeof fill === "number" && Number.isFinite(fill) ? Math.min(1, Math.max(0, fill)) : 1);
};

type Photo = FabricObject & { __isBackground?: boolean };

/**
 * Apply an adjustment layer to what `ctx` holds within `area` (scene
 * coordinates; the whole canvas without one): on the GPU when it can, on the
 * CPU otherwise.
 */
/**
 * Where an adjustment layer applies over `rect` of a canvas drawn through
 * `transform`: a canvas the size of `rect` whose red says how much, "none"
 * for everywhere, "loading" for nowhere yet. layerMask.ts provides it.
 */
export type AdjustmentMasks = (
  layer: AdjustmentLayer,
  transform: DOMMatrix,
  rect: PixelRect
) => HTMLCanvasElement | "none" | "loading";

let adjustmentMask: AdjustmentMasks = () => "none";

/** The red channel of a mask canvas, one byte a pixel. */
function redOf(mask: HTMLCanvasElement): Uint8Array | null {
  const context = mask.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const { data } = context.getImageData(0, 0, mask.width, mask.height);
  const red = new Uint8Array(mask.width * mask.height);
  for (let pixel = 0; pixel < red.length; pixel += 1) red[pixel] = data[pixel * 4]!;
  return red;
}

function applyAdjustment(ctx: CanvasRenderingContext2D, layer: AdjustmentLayer, area: { left: number; top: number; width: number; height: number } | null): void {
  const strength = strengthOf(layer);
  if (!layer.visible || strength <= 0) return;
  const { width, height } = ctx.canvas;
  let rect: PixelRect = { x: 0, y: 0, width, height };
  if (area) {
    const matrix = ctx.getTransform();
    const xs = [area.left, area.left + area.width].flatMap((x) => [area.top, area.top + area.height].map((y) => matrix.a * x + matrix.c * y + matrix.e));
    const ys = [area.left, area.left + area.width].flatMap((x) => [area.top, area.top + area.height].map((y) => matrix.b * x + matrix.d * y + matrix.f));
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const right = Math.min(width, Math.ceil(Math.max(...xs)));
    const bottom = Math.min(height, Math.ceil(Math.max(...ys)));
    rect = { x: left, y: top, width: right - left, height: bottom - top };
  }
  if (!(rect.width > 0 && rect.height > 0)) return;
  const mask = adjustmentMask(layer, ctx.getTransform(), rect);
  if (mask === "loading") return;
  const job = jobOf(layer.adjustment);
  const blend = blendOf(layer);
  const masked = mask === "none" ? null : mask;
  const adjusted = adjustOnGpu(ctx.canvas as HTMLCanvasElement, rect, job, strength, blend, masked);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (adjusted) {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    ctx.drawImage(adjusted, 0, 0, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
  } else {
    const image = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
    adjustPixels(image.data, rect.width, rect.height, job, strength, blend, masked ? redOf(masked) : null);
    ctx.putImageData(image, rect.x, rect.y);
  }
  ctx.restore();
}

class Composition {
  private readonly drawn = new Map<TreeNode, boolean>();
  /** Where adjustments apply: the document, in scene coordinates. */
  private readonly area: { left: number; top: number; width: number; height: number } | null;

  constructor(
    private readonly all: readonly FabricObject[],
    private readonly included: ReadonlySet<FabricObject>
  ) {
    const photo = all.find((object) => (object as Photo).__isBackground === true);
    this.area = photo && all.some(isAdjustmentLayer) ? photo.getBoundingRect() : null;
  }

  /** Draw a layer, or apply it when it is an adjustment. */
  private draw(ctx: CanvasRenderingContext2D, object: FabricObject): void {
    if (isAdjustmentLayer(object)) {
      applyAdjustment(ctx, object, this.area);
      return;
    }
    const blend = blendOf(object);
    if (!isCustomBlend(blend) || !object.visible) {
      object.render(ctx);
      return;
    }
    // On its own first, then blended onto what is below.
    const buffer = acquire(ctx);
    try {
      renderWith(object, buffer, { opacity: 1, globalCompositeOperation: "source-over" });
      drawBuffer(ctx, buffer, object.opacity, blend);
    } finally {
      release();
    }
  }

  /** Whether any layer the render asked for is in this node. */
  private draws(node: TreeNode): boolean {
    let known = this.drawn.get(node);
    if (known === undefined) {
      known = node.kind === "layer" ? this.included.has(this.all[node.index]!) : node.children.some((child) => this.draws(child));
      this.drawn.set(node, known);
    }
    return known;
  }

  list(ctx: CanvasRenderingContext2D, nodes: readonly TreeNode[]): void {
    for (const { base, clipped } of clippingRuns(nodes)) {
      if (clipped.length === 0) this.node(ctx, base);
      else if (isAdjustmentLayer(this.all[base.index])) {
        // Nothing to clip to: an adjustment has no pixels of its own.
        this.node(ctx, base);
        for (const node of clipped) this.node(ctx, node);
      } else this.clipping(ctx, base, clipped);
    }
  }

  private node(ctx: CanvasRenderingContext2D, node: TreeNode): void {
    if (node.kind === "layer") {
      const object = this.all[node.index]!;
      if (this.included.has(object)) this.draw(ctx, object);
      return;
    }
    const header = this.all[node.index] as LayerGroup;
    if (!header.visible || !this.draws(node)) return;
    if (!this.included.has(header) || (header.passThrough !== false && header.opacity >= 1)) {
      this.list(ctx, node.children);
      return;
    }
    const buffer = acquire(ctx);
    try {
      this.list(buffer, node.children);
      drawBuffer(ctx, buffer, header.opacity, groupBlend(header));
    } finally {
      release();
    }
  }

  /** Base and clipped layers in a buffer of their own. */
  private clipping(ctx: CanvasRenderingContext2D, base: TreeNode, clipped: readonly TreeNode[]): void {
    const baseObject = this.all[base.index]!;
    if (!baseObject.visible || !this.draws(base)) return;
    const buffer = acquire(ctx);
    try {
      if (base.kind === "layer") renderWith(baseObject, buffer, { opacity: 1, globalCompositeOperation: "source-over" });
      else this.list(buffer, (base as GroupNode).children);
      for (const node of clipped) {
        const object = this.all[node.index]!;
        if (!object.visible || !this.included.has(object)) continue;
        if (isAdjustmentLayer(object)) {
          // Only the base (and what is clipped below), keeping its shape.
          this.draw(buffer, object);
          continue;
        }
        const blend = blendOf(object);
        if (blend === "source-over") {
          // Normal: only where the base already has pixels, keeping its shape.
          renderWith(object, buffer, { globalCompositeOperation: "source-atop" });
          continue;
        }
        const layer = acquire(ctx);
        try {
          renderWith(object, layer, { globalCompositeOperation: "source-over" });
          layer.save();
          layer.setTransform(1, 0, 0, 1, 0, 0);
          layer.globalCompositeOperation = "destination-in";
          layer.drawImage(buffer.canvas, 0, 0);
          layer.restore();
          drawBuffer(buffer, layer, 1, blend);
        } finally {
          release();
        }
      }
      if (base.kind === "layer") drawBuffer(ctx, buffer, baseObject.opacity, blendOf(baseObject));
      else if (this.included.has(baseObject)) drawBuffer(ctx, buffer, baseObject.opacity, groupBlend(baseObject as LayerGroup));
      else drawBuffer(ctx, buffer, 1, "source-over");
    } finally {
      release();
    }
  }
}

/** Skip the compositor while `render` runs: each layer drawn on its own, as it is. */
let rawDepth = 0;
export function withoutCompositing<T>(render: () => T): T {
  rawDepth += 1;
  try {
    return render();
  } finally {
    rawDepth -= 1;
  }
}

const needsCompositing = (all: readonly FabricObject[], objects: readonly FabricObject[]) =>
  rawDepth === 0 &&
  (all.some(isGroupMarker) || objects.some(isClipped) || all.some(isAdjustmentLayer) || objects.some((object) => isCustomBlend(blendOf(object))));

/** The stack's structure, for the objects of a canvas. */
export const treeOf = (objects: readonly FabricObject[]): LayerTree => buildTree(entriesOf(objects));

/** Layers that do not show because a group they are in is hidden. */
export function hiddenByGroups(objects: readonly FabricObject[]): Set<FabricObject> {
  const hidden = new Set<FabricObject>();
  if (!objects.some(isGroupHeader)) return hidden;
  const hide = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      hidden.add(objects[node.index]!);
      if (node.kind === "group") hide(node.children);
    }
  };
  const visit = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      if (node.kind !== "group") continue;
      if (objects[node.index]!.visible) visit(node.children);
      else hide(node.children);
    }
  };
  visit(treeOf(objects).roots);
  return hidden;
}

let installed = false;

/** Teach every Fabric canvas to draw groups and clipping masks. */
export function installCompositor(masks?: AdjustmentMasks): void {
  if (masks) adjustmentMask = masks;
  if (installed) return;
  installed = true;
  const prototype = StaticCanvas.prototype as unknown as RenderInternals;
  const renderObjects = prototype._renderObjects;
  prototype._renderObjects = function (this: RenderInternals, ctx: CanvasRenderingContext2D, objects: FabricObject[]) {
    const all = this._objects;
    if (!needsCompositing(all, objects)) {
      renderObjects.call(this, ctx, objects);
      return;
    }
    // The structure comes from the whole stack, so a render of some layers
    // (an export without the helpers, say) still sees the groups around them.
    const included = new Set(objects);
    const composition = new Composition(all, included);
    if (objects.some((object) => isAdjustmentLayer(object) || isCustomBlend(blendOf(object)))) {
      // Adjustments and the blends done here change only the document's own
      // pixels, not what is already on the context (the checkerboard under
      // the document).
      const stack = acquire(ctx);
      try {
        composition.list(stack, treeOf(all).roots);
        drawBuffer(ctx, stack, 1, "source-over");
      } finally {
        release();
      }
    } else composition.list(ctx, treeOf(all).roots);
    // Anything drawn that is not in the stack (none today) still shows.
    for (const object of objects) if (!all.includes(object)) object.render(ctx);
    trimBuffers();
  };

  // A layer in a hidden group cannot be clicked on the canvas.
  const interactive = Canvas.prototype as unknown as {
    searchPossibleTargets(objects: FabricObject[], pointer: Point): unknown;
    _objects: FabricObject[];
  };
  const search = interactive.searchPossibleTargets;
  interactive.searchPossibleTargets = function (this: typeof interactive, objects: FabricObject[], pointer: Point) {
    if (objects === this._objects) {
      const hidden = hiddenByGroups(objects);
      if (hidden.size) objects = objects.filter((object) => !hidden.has(object));
    }
    return search.call(this, objects, pointer);
  };
}
