import { classRegistry, FabricObject, type TClassProperties } from "fabric";
import type { Entry } from "./layerTree";

/**
 * The two invisible objects that make a layer group in the stack (see
 * layerTree.ts): `LayerGroup`, the header above the group's layers, holds
 * what the Layers panel shows for the group (name, visibility, opacity,
 * blend mode, open or closed); `LayerGroupEnd` marks where it ends below.
 * Neither draws anything itself: the compositor applies the group.
 */

const MARKER_DEFAULTS: Partial<TClassProperties<FabricObject>> = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  strokeWidth: 0,
  selectable: false,
  evented: false,
  hasControls: false,
  hasBorders: false,
  objectCaching: false,
};

class GroupMarker extends FabricObject {
  constructor(options?: Record<string, unknown>) {
    super({ ...MARKER_DEFAULTS, ...options });
    // Whatever a file says, a marker stays a weightless placeholder.
    this.set({ ...MARKER_DEFAULTS, erasable: false } as Record<string, unknown>);
  }

  render(): void {}

  drawObject(): void {}
}

export class LayerGroup extends GroupMarker {
  static type = "LayerGroup";

  /** Photoshop's Pass Through: the group's layers blend straight into what is below. */
  declare passThrough: boolean;
  /** Folded shut in the Layers panel. */
  declare collapsed: boolean;
  declare name?: string;

  constructor(options?: Record<string, unknown>) {
    super({ passThrough: true, collapsed: false, ...options });
    if (typeof this.passThrough !== "boolean") this.passThrough = true;
    if (typeof this.collapsed !== "boolean") this.collapsed = false;
  }

  toObject(propertiesToInclude: string[] = []) {
    return super.toObject([...propertiesToInclude, "passThrough", "collapsed"] as never[]);
  }
}

export class LayerGroupEnd extends GroupMarker {
  static type = "LayerGroupEnd";
}

let registered = false;
export function registerGroupClasses(): void {
  if (registered) return;
  registered = true;
  classRegistry.setClass(LayerGroup);
  classRegistry.setClass(LayerGroupEnd);
}

export const isGroupHeader = (object: unknown): object is LayerGroup => object instanceof LayerGroup;
export const isGroupEnd = (object: unknown): object is LayerGroupEnd => object instanceof LayerGroupEnd;
export const isGroupMarker = (object: unknown): object is LayerGroup | LayerGroupEnd => object instanceof GroupMarker;

type Clippable = FabricObject & { __clipped?: boolean; __layerId?: string; __isBackground?: boolean };

/** Clipped to the layer below it (Layer › Create Clipping Mask). */
export const isClipped = (object: FabricObject): boolean => (object as Clippable).__clipped === true;

/** The stack as plain entries for layerTree.ts, in the same order. */
export function entriesOf(objects: readonly FabricObject[]): Entry[] {
  return objects.map((object, index) => {
    const item = object as Clippable;
    const id = item.__layerId ?? `#${index}`;
    if (isGroupHeader(object)) return { id, kind: "header" };
    if (isGroupEnd(object)) return { id, kind: "end" };
    return { id, kind: "layer", clipped: item.__clipped === true, background: item.__isBackground === true };
  });
}
