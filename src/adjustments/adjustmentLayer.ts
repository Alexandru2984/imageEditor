import { classRegistry } from "fabric";
import { readAdjustment, type AdjustmentData } from "./adjustmentData";
import { DocumentLayer } from "./documentLayer";
import { FillLayer } from "./fillLayer";

/**
 * Photoshop's adjustment layer: it changes how everything below it in the
 * stack looks (within its group when the group is isolated, or only its base
 * when clipped), and leaves their pixels as they are. The compositor applies it.
 */

const FALLBACK: AdjustmentData = { kind: "invert", settings: {} };

export class AdjustmentLayer extends DocumentLayer {
  static type = "AdjustmentLayer";

  declare adjustment: AdjustmentData;

  constructor(options?: Record<string, unknown>) {
    super(options);
    // Settings the editor makes, whatever a file says.
    this.adjustment = readAdjustment(this.adjustment) ?? FALLBACK;
  }

  /** It changes what is below; the compositor applies it. */
  render(): void {}

  toObject(propertiesToInclude: string[] = []) {
    return super.toObject([...propertiesToInclude, "adjustment"] as never[]);
  }
}

let registered = false;
/** Adjustment and fill layers load from files and undo steps. */
export function registerAdjustmentClasses(): void {
  if (registered) return;
  registered = true;
  classRegistry.setClass(AdjustmentLayer);
  classRegistry.setClass(FillLayer);
}

export const isAdjustmentLayer = (object: unknown): object is AdjustmentLayer => object instanceof AdjustmentLayer;
