import { classRegistry, FabricObject, type TClassProperties } from "fabric";
import { readAdjustment, type AdjustmentData } from "./adjustmentData";

/**
 * Photoshop's adjustment layer: no pixels of its own, it changes how
 * everything below it in the stack looks (within its group when the group is
 * isolated, or only its base when clipped). The compositor applies it; on
 * its own it draws nothing and takes no room, so it is picked in the Layers
 * panel rather than on the canvas.
 *
 * Its position (left, top, scale, angle) places its layer mask, when it has
 * one: mask pixel (x, y) lies at calcTransformMatrix() × (x, y) in the scene.
 */

/** What every adjustment layer is, whatever a file says. */
const FIXED: Partial<TClassProperties<FabricObject>> = {
  width: 0,
  height: 0,
  strokeWidth: 0,
  selectable: false,
  evented: false,
  hasControls: false,
  hasBorders: false,
  objectCaching: false,
};

const DEFAULTS: Partial<TClassProperties<FabricObject>> = { left: 0, top: 0, ...FIXED };

const FALLBACK: AdjustmentData = { kind: "invert", settings: {} };

export class AdjustmentLayer extends FabricObject {
  static type = "AdjustmentLayer";

  declare adjustment: AdjustmentData;
  declare name?: string;
  /** Applies only to the layer below it (Layer › Create Clipping Mask). */
  declare __clipped?: boolean;
  /** Where it applies: white fully, black not at all (see layerMask.ts). */
  declare layerMask?: { src: string; enabled: boolean };

  constructor(options?: Record<string, unknown>) {
    super({ ...DEFAULTS, ...options });
    // Whatever a file says, it stays weightless, with settings the editor makes.
    this.set({ ...FIXED, erasable: false } as Record<string, unknown>);
    this.adjustment = readAdjustment(this.adjustment) ?? FALLBACK;
  }

  render(): void {}

  drawObject(): void {}

  toObject(propertiesToInclude: string[] = []) {
    return super.toObject([...propertiesToInclude, "adjustment"] as never[]);
  }
}

let registered = false;
export function registerAdjustmentClasses(): void {
  if (registered) return;
  registered = true;
  classRegistry.setClass(AdjustmentLayer);
}

export const isAdjustmentLayer = (object: unknown): object is AdjustmentLayer => object instanceof AdjustmentLayer;
