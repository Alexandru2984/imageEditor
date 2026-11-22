import { FabricObject, type TClassProperties } from "fabric";

/**
 * A layer that spans the whole document with no pixels of its own:
 * Photoshop's adjustment and fill layers. The compositor draws it; on its own
 * it draws nothing and takes no room, so it is picked in the Layers panel
 * rather than on the canvas, and kept out of selections, snapping and sizes.
 *
 * Its position (left, top, scale, angle) places its layer mask, when it has
 * one: mask pixel (x, y) lies at calcTransformMatrix() × (x, y) in the scene.
 */

/** What every such layer is, whatever a file says. */
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

export class DocumentLayer extends FabricObject {
  static type = "DocumentLayer";

  declare name?: string;
  /** Applies only to the layer below it (Layer › Create Clipping Mask). */
  declare __clipped?: boolean;
  /** Where it shows: white fully, black not at all (see layerMask.ts). */
  declare layerMask?: { src: string; enabled: boolean };

  constructor(options?: Record<string, unknown>) {
    super({ ...DEFAULTS, ...options });
    // Whatever a file says, it stays weightless.
    this.set({ ...FIXED, erasable: false } as Record<string, unknown>);
  }

  /** Each kind draws itself (an adjustment layer draws nothing, the compositor applies it). */
  drawObject(): void {}
}

export const isDocumentLayer = (object: unknown): object is DocumentLayer => object instanceof DocumentLayer;
