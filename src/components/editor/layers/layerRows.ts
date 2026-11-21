import type { FabricObject } from "fabric";
import { hiddenByGroups, treeOf } from "@/compositing/compositor";
import { isGroupHeader, isGroupMarker, type LayerGroup } from "@/layers/groupMarkers";
import type { TreeNode } from "@/layers/layerTree";
import { hasLayerMask, layerMaskThumbnail } from "@/raster/layerMask";
import { EFFECTS, type EffectName, type LayerStyle } from "@/raster/layerStyleData";
import { isBackgroundObject, isObjectLocked, type EditorFabricObject } from "@/utils/editorObjects";

export type EditorObject = EditorFabricObject;

export interface EffectItem {
  name: EffectName;
  label: string;
  enabled: boolean;
}

export interface LayerItem {
  id: string;
  /** A layer, or a group's header. */
  kind: "layer" | "group";
  /** How many groups it is inside. */
  depth: number;
  /** Clipped to the layer below it. */
  clipped: boolean;
  /** A group folded shut. */
  collapsed: boolean;
  name: string;
  type: string;
  visible: boolean;
  /** Its own eye is on, but a group around it is hidden. */
  hiddenByGroup: boolean;
  locked: boolean;
  isBackground: boolean;
  thumbnail: string;
  /** The layer mask, when the layer has one. */
  mask: { thumbnail: string; enabled: boolean } | null;
  /** The layer style's effects, on or off. */
  effects: EffectItem[];
  fabricObject: EditorObject;
}

/** Photoshop's Kind filter. */
export type KindFilter = "all" | "pixel" | "text" | "shape" | "group";

export interface RowFilter {
  kind: KindFilter;
  /** Part of the name, any case. */
  query: string;
}

export const NO_FILTER: RowFilter = { kind: "all", query: "" };

export const isFiltering = (filter: RowFilter) => filter.kind !== "all" || filter.query.trim() !== "";

/** An object's type as one word in lower case ("IText" and "i-text" → "itext"). */
export const typeOf = (object: FabricObject) => (object.type ?? "object").toLowerCase().replace(/-/g, "");

const TEXT_TYPES = new Set(["itext", "text", "textbox", "fabrictext"]);

function kindOf(object: FabricObject): KindFilter {
  if (isGroupHeader(object)) return "group";
  const type = typeOf(object);
  if (type === "image") return "pixel";
  if (TEXT_TYPES.has(type)) return "text";
  return "shape";
}

const DEFAULT_NAMES: Record<string, string> = {
  rect: "Rectangle",
  circle: "Circle",
  ellipse: "Ellipse",
  line: "Line",
  path: "Drawing",
  itext: "Text",
  text: "Text",
  textbox: "Text",
  fabrictext: "Text",
  image: "Image",
  triangle: "Triangle",
  polygon: "Polygon",
};

const defaultName = (object: FabricObject, index: number) => `${DEFAULT_NAMES[typeOf(object)] ?? "Object"} ${index}`;

export function effectsOf(object: FabricObject): EffectItem[] {
  const style = (object as FabricObject & { layerStyle?: LayerStyle }).layerStyle;
  if (!style) return [];
  return EFFECTS.filter(({ name }) => !!style[name]).map(({ name, label }) => ({
    name,
    label,
    enabled: style[name]!.enabled === true,
  }));
}

/**
 * The Layers panel's rows, top of the stack first: groups with their layers
 * just under them (unless folded shut), filtered by kind and name. A group
 * shows while filtering when it or something in it matches. Layers without
 * a name get one ("Rectangle 2"), as they are shown.
 */
export function layerRows(objects: readonly FabricObject[], filter: RowFilter = NO_FILTER): LayerItem[] {
  const filtering = isFiltering(filter);
  const query = filter.query.trim().toLowerCase();
  const matches = (object: FabricObject, name: string) =>
    (filter.kind === "all" || kindOf(object) === filter.kind) && (!query || name.toLowerCase().includes(query));
  const hidden = hiddenByGroups(objects);
  const rows: LayerItem[] = [];

  // Names first, bottom to top, so a layer's name does not depend on what is folded.
  let counter = 1;
  for (const object of objects as EditorObject[]) {
    if (isGroupMarker(object)) continue;
    const isBackground = isBackgroundObject(object);
    if (!object.name?.trim()) object.name = isBackground ? "Background" : defaultName(object, counter);
    if (!isBackground) counter += 1;
  }

  // Bottom to top; reversed at the end.
  const visit = (nodes: readonly TreeNode[], depth: number): boolean => {
    let shown = false;
    for (const node of nodes) {
      const object = objects[node.index] as EditorObject;
      if (node.kind === "group") {
        const header = object as unknown as LayerGroup;
        const start = rows.length;
        const name = object.name?.trim() || "Group";
        const open = filtering || !header.collapsed;
        const inside = open && visit(node.children, depth + 1);
        if (filtering && !inside && !matches(object, name)) {
          rows.length = start;
          continue;
        }
        rows.push({
          id: object.__layerId!,
          kind: "group",
          depth,
          clipped: false,
          collapsed: header.collapsed === true,
          name,
          type: "group",
          visible: object.visible !== false,
          hiddenByGroup: hidden.has(object),
          locked: false,
          isBackground: false,
          thumbnail: "",
          mask: null,
          effects: [],
          fabricObject: object,
        });
        shown = true;
        continue;
      }
      const isBackground = isBackgroundObject(object);
      const name = object.name!.trim();
      if (filtering && !matches(object, name)) continue;
      rows.push({
        id: object.__layerId!,
        kind: "layer",
        depth,
        clipped: node.clipped,
        collapsed: false,
        name,
        type: typeOf(object),
        visible: object.visible !== false,
        hiddenByGroup: hidden.has(object),
        locked: isBackground || isObjectLocked(object),
        isBackground,
        thumbnail: "",
        mask: hasLayerMask(object) ? { thumbnail: layerMaskThumbnail(object), enabled: object.layerMask.enabled } : null,
        effects: effectsOf(object),
        fabricObject: object,
      });
      shown = true;
    }
    return shown;
  };
  visit(treeOf(objects).roots, 0);
  return rows.reverse();
}

/** The rows from one to another, both included, in the order shown (Shift+click). */
export function rowRange(rows: readonly LayerItem[], from: string, to: string): string[] {
  const start = rows.findIndex((row) => row.id === from);
  const end = rows.findIndex((row) => row.id === to);
  if (start < 0 || end < 0) return [to];
  const [low, high] = start <= end ? [start, end] : [end, start];
  return rows.slice(low, high + 1).map((row) => row.id);
}
