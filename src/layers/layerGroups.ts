import { ActiveSelection, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import { hiddenByGroups, treeOf } from "@/compositing/compositor";
import { ensureLayerId, isEditorChrome, isLayerObject, isObjectLocked, type EditorFabricObject } from "@/utils/editorObjects";
import { isAdjustmentLayer, type AdjustmentLayer } from "@/adjustments/adjustmentLayer";
import { entriesOf, isGroupHeader, isGroupMarker, LayerGroup, LayerGroupEnd } from "./groupMarkers";
import {
  arrangeNodes,
  findNode,
  groupNodes,
  insertEmptyGroup,
  moveNodes,
  rangeOf,
  ungroupNode,
  type Anchor,
  type ArrangeAction,
  type Entry,
  type GroupNode,
} from "./layerTree";

/**
 * Layer groups and clipping masks on a Fabric canvas: the commands of
 * Photoshop's Layer menu and the Layers panel. Each change is one history
 * step (an added, removed or modified object).
 */

type StackObject = FabricObject & EditorFabricObject & { __clipped?: boolean };

export { isLayerObject };

/** The document's objects (no editor helpers), each with an id, and the stack as entries. */
function stackOf(canvas: FabricCanvas): { objects: FabricObject[]; entries: Entry[] } {
  const objects = canvas.getObjects().filter((object) => !isEditorChrome(object));
  const used = new Set<string>();
  for (const object of objects) ensureLayerId(object, used);
  return { objects, entries: entriesOf(objects) };
}

const idOf = (object: FabricObject) => (object as StackObject).__layerId ?? "";

/**
 * Make the canvas hold `entries`' objects in that order: new markers added,
 * dropped ones removed, the rest rearranged.
 */
function applyStack(canvas: FabricCanvas, entries: readonly Entry[], created: readonly FabricObject[] = []): void {
  const objects = canvas.getObjects();
  const byId = new Map<string, FabricObject>();
  for (const object of [...objects, ...created]) byId.set(idOf(object), object);
  const ordered = entries.map((entry) => byId.get(entry.id)).filter((object): object is FabricObject => !!object);
  const keep = new Set(ordered);
  const removed = objects.filter((object) => !keep.has(object) && !isEditorChrome(object));
  // Editor helpers are not in the plan; they stay on top.
  const helpers = objects.filter((object) => isEditorChrome(object) && !keep.has(object));
  if (removed.length) canvas.remove(...removed);
  const added = created.filter((object) => keep.has(object));
  if (added.length) canvas.add(...added);
  const stack = (canvas as unknown as { _objects: FabricObject[] })._objects;
  stack.splice(0, stack.length, ...ordered, ...helpers);
  // Order alone does not fire anything: one change, one history step.
  if (!added.length && !removed.length) {
    const target = ordered.find((object, index) => object !== objects[index] && !isGroupMarker(object)) ?? ordered[ordered.length - 1];
    if (target) canvas.fire("object:modified", { target });
  }
  canvas.requestRenderAll();
}

// ---------- The selected group ----------

type Listener = () => void;
const selectedGroups = new WeakMap<FabricCanvas, { ids: readonly string[]; listeners: Set<Listener> }>();

function groupSelectionState(canvas: FabricCanvas) {
  let state = selectedGroups.get(canvas);
  if (!state) {
    state = { ids: [], listeners: new Set() };
    selectedGroups.set(canvas, state);
  }
  return state;
}

/**
 * The groups picked in the Layers panel. Picking a group selects its layers
 * on the canvas too, so they move together; this says it was the group, for
 * commands such as Ungroup.
 */
export function pickedGroups(canvas: FabricCanvas): LayerGroup[] {
  return picked(canvas, isGroupHeader);
}

/**
 * The adjustment layers picked in the Layers panel: they take no room on the
 * canvas, so they are selected here rather than there.
 */
export function pickedAdjustments(canvas: FabricCanvas): AdjustmentLayer[] {
  return picked(canvas, isAdjustmentLayer);
}

function picked<T extends FabricObject>(canvas: FabricCanvas, test: (object: unknown) => object is T): T[] {
  const { ids } = groupSelectionState(canvas);
  if (ids.length === 0) return [];
  const found = new Map(canvas.getObjects().filter(test).map((object) => [idOf(object), object]));
  return ids.map((id) => found.get(id)).filter((object): object is T => !!object);
}

/** Whether groups or adjustment layers are picked in the panel. */
export const hasPicks = (canvas: FabricCanvas): boolean => pickedGroups(canvas).length + pickedAdjustments(canvas).length > 0;

/** The one adjustment layer picked, when it is all that is selected. */
export function selectedAdjustment(canvas: FabricCanvas): AdjustmentLayer | null {
  const adjustments = pickedAdjustments(canvas);
  if (adjustments.length !== 1 || pickedGroups(canvas).length > 0 || canvas.getActiveObjects().length > 0) return null;
  return adjustments[0]!;
}

/** Layers inside any of the given groups. */
function membersOf(canvas: FabricCanvas, groups: readonly LayerGroup[]): Set<FabricObject> {
  const inside = new Set<FabricObject>();
  for (const group of groups) for (const object of groupObjects(canvas, group)) inside.add(object);
  return inside;
}

/**
 * The one group picked, when it is all that is selected (layers picked
 * besides it make it a mixed selection).
 */
export function selectedGroup(canvas: FabricCanvas): LayerGroup | null {
  const groups = pickedGroups(canvas);
  if (groups.length !== 1 || pickedAdjustments(canvas).length > 0) return null;
  const inside = membersOf(canvas, groups);
  return canvas.getActiveObjects().every((object) => inside.has(object)) ? groups[0]! : null;
}

export function setSelectedGroup(canvas: FabricCanvas, group: LayerGroup | null): void {
  setPicks(canvas, group ? [group] : []);
}

/** Groups and adjustment layers, picked in the panel. */
function setPicks(canvas: FabricCanvas, objects: readonly FabricObject[]): void {
  const state = groupSelectionState(canvas);
  const ids = objects.map(idOf);
  if (state.ids.length === ids.length && state.ids.every((id, index) => id === ids[index])) return;
  state.ids = ids;
  for (const listener of state.listeners) listener();
}

export function onSelectedGroupChange(canvas: FabricCanvas, listener: Listener): () => void {
  const { listeners } = groupSelectionState(canvas);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The layers (not markers) inside a group, bottom to top. */
export function groupMembers(canvas: FabricCanvas, group: LayerGroup): FabricObject[] {
  const { objects } = stackOf(canvas);
  const found = findNode(treeOf(objects), idOf(group));
  if (!found || found.node.kind !== "group") return [];
  const [first, last] = rangeOf(found.node);
  return objects.slice(first, last + 1).filter(isLayerObject);
}

/** Everything a group spans in the stack: its markers and all inside. */
export function groupObjects(canvas: FabricCanvas, group: LayerGroup): FabricObject[] {
  const { objects } = stackOf(canvas);
  const found = findNode(treeOf(objects), idOf(group));
  if (!found || found.node.kind !== "group") return [];
  const [first, last] = rangeOf(found.node);
  return objects.slice(first, last + 1);
}

/** Select a group: its layers on the canvas, the group itself for the panel. */
export function selectGroup(canvas: FabricCanvas, group: LayerGroup): void {
  selectLayers(canvas, [idOf(group)]);
}

/**
 * Pick layers and groups in the Layers panel (by id): the layers, and the
 * groups' shown layers, are selected on the canvas so they move together.
 * Adjustment layers, which have no place on the canvas, are only picked.
 */
export function selectLayers(canvas: FabricCanvas, ids: readonly string[]): void {
  const { objects } = stackOf(canvas);
  const chosen = new Set(ids);
  const groups = objects.filter((object): object is LayerGroup => isGroupHeader(object) && chosen.has(idOf(object)));
  const hidden = hiddenByGroups(canvas.getObjects());
  const inside = membersOf(canvas, groups);
  const adjustments = objects.filter((object) => isAdjustmentLayer(object) && chosen.has(idOf(object)) && !inside.has(object));
  const targets = new Set<FabricObject>();
  for (const object of objects) {
    if (!isLayerObject(object) || isAdjustmentLayer(object)) continue;
    if (chosen.has(idOf(object)) && !inside.has(object)) targets.add(object);
    else if (inside.has(object) && object.visible && !hidden.has(object)) targets.add(object);
  }
  const list = objects.filter((object) => targets.has(object));
  // Setting the canvas selection clears the groups; set them again after.
  canvas.discardActiveObject();
  if (list.length === 1) canvas.setActiveObject(list[0]!);
  else if (list.length > 1) canvas.setActiveObject(new ActiveSelection(list, { canvas }));
  setPicks(canvas, [...groups, ...adjustments]);
  canvas.requestRenderAll();
}

/** The ids of what is selected: picked groups, and the layers selected outside them. */
function selectedIds(canvas: FabricCanvas): string[] {
  const groups = pickedGroups(canvas);
  return [...groups.map(idOf), ...selectedLayerObjects(canvas).map(idOf)];
}

/** The selected layers themselves (not those of picked groups), adjustment layers included. */
export function selectedLayerObjects(canvas: FabricCanvas): FabricObject[] {
  const inside = membersOf(canvas, pickedGroups(canvas));
  return [
    ...pickedAdjustments(canvas).filter((object) => !inside.has(object)),
    ...canvas.getActiveObjects().filter((object) => isLayerObject(object) && !inside.has(object)),
  ];
}

/** The group a layer (or group) is directly in, if any. */
export function parentGroup(canvas: FabricCanvas, object: FabricObject): LayerGroup | null {
  const { objects } = stackOf(canvas);
  const found = findNode(treeOf(objects), idOf(object));
  return found?.parent ? (objects[found.parent.index] as LayerGroup) : null;
}

/** Whether a layer shows: its own eye and those of the groups around it. */
export function isShownInDocument(canvas: FabricCanvas, object: FabricObject): boolean {
  return object.visible !== false && !hiddenByGroups(canvas.getObjects()).has(object);
}

/** Layers that show, with the groups around them taken into account. */
export function shownLayers(canvas: FabricCanvas): FabricObject[] {
  const objects = canvas.getObjects();
  const hidden = hiddenByGroups(objects);
  return objects.filter((object) => isLayerObject(object) && object.visible !== false && !hidden.has(object));
}

/** "Group 1", "Group 2", … after the highest number in use. */
function nextGroupName(canvas: FabricCanvas): string {
  let highest = 0;
  for (const object of canvas.getObjects()) {
    const match = /^Group (\d+)$/.exec((object as StackObject).name ?? "");
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Group ${highest + 1}`;
}

function newMarkers(canvas: FabricCanvas): [LayerGroup, LayerGroupEnd, Entry, Entry] {
  const header = new LayerGroup({ name: nextGroupName(canvas) });
  const end = new LayerGroupEnd();
  const used = new Set(canvas.getObjects().map(idOf));
  ensureLayerId(header, used);
  ensureLayerId(end, used);
  return [header, end, { id: idOf(header), kind: "header" }, { id: idOf(end), kind: "end" }];
}

// ---------- Commands ----------

export type Refusal = string;

/** Layer › Group Layers (Ctrl+G): the selected layers into a new group. */
export function groupSelected(canvas: FabricCanvas): LayerGroup | Refusal {
  const ids = selectedIds(canvas);
  if (ids.length === 0) return "Select the layers to group";
  const { entries } = stackOf(canvas);
  const [header, end, headerEntry, endEntry] = newMarkers(canvas);
  const next = groupNodes(entries, ids, headerEntry, endEntry);
  if (!next) return "Those layers cannot be grouped";
  canvas.discardActiveObject();
  applyStack(canvas, next, [header, end]);
  selectGroup(canvas, header);
  return header;
}

/** Layer › New › Group: an empty group above the selected layer. */
export function addGroup(canvas: FabricCanvas): LayerGroup {
  const { entries } = stackOf(canvas);
  const ids = selectedIds(canvas);
  const anchor = ids.length ? ids[ids.length - 1]! : null;
  const [header, end, headerEntry, endEntry] = newMarkers(canvas);
  applyStack(canvas, insertEmptyGroup(entries, anchor, headerEntry, endEntry), [header, end]);
  canvas.discardActiveObject();
  setSelectedGroup(canvas, header);
  return header;
}

/** Layer › Ungroup Layers (Ctrl+Shift+G). */
export function ungroupSelected(canvas: FabricCanvas): FabricObject[] | Refusal {
  const group = selectedGroup(canvas) ?? enclosingGroupOfSelection(canvas);
  if (!group) return "Select a group to ungroup";
  const members = groupMembers(canvas, group);
  const next = ungroupNode(stackOf(canvas).entries, idOf(group));
  if (!next) return "Select a group to ungroup";
  setSelectedGroup(canvas, null);
  applyStack(canvas, next);
  const selectable = members.filter((object) => object.visible);
  canvas.discardActiveObject();
  if (selectable.length === 1) canvas.setActiveObject(selectable[0]!);
  else if (selectable.length > 1) canvas.setActiveObject(new ActiveSelection(selectable, { canvas }));
  canvas.requestRenderAll();
  return members;
}

/** Whether Ungroup has a group to take apart. */
export const canUngroup = (canvas: FabricCanvas): boolean => !!(selectedGroup(canvas) ?? enclosingGroupOfSelection(canvas));

/** Whether any selected layer is clipped. */
export const hasClippedSelection = (canvas: FabricCanvas): boolean =>
  selectedLayerObjects(canvas).some((object) => (object as StackObject).__clipped === true);

/** Forget the picked groups and adjustments when the canvas selection changes some other way. */
export function watchGroupSelection(canvas: FabricCanvas): () => void {
  const forget = () => setPicks(canvas, []);
  canvas.on("selection:created", forget);
  canvas.on("selection:updated", forget);
  canvas.on("selection:cleared", forget);
  return () => {
    canvas.off("selection:created", forget);
    canvas.off("selection:updated", forget);
    canvas.off("selection:cleared", forget);
  };
}

/** The group every selected layer is in, when they share one. */
function enclosingGroupOfSelection(canvas: FabricCanvas): LayerGroup | null {
  const ids = new Set(selectedIds(canvas));
  const selected = canvas.getObjects().filter((object) => ids.has(idOf(object)));
  if (selected.length === 0) return null;
  const parents = new Set(selected.map((object) => parentGroup(canvas, object)));
  return parents.size === 1 ? [...parents][0]! : null;
}

/**
 * Delete what is selected in the panel: picked groups with everything in
 * them, and the selected layers. Refused while any of it is locked.
 */
export function deleteSelectedLayers(canvas: FabricCanvas): number | Refusal {
  const { objects } = stackOf(canvas);
  const tree = treeOf(objects);
  const doomed = new Set<FabricObject>();
  for (const id of selectedIds(canvas)) {
    const found = findNode(tree, id);
    if (!found) continue;
    const [first, last] = found.node.kind === "group" ? rangeOf(found.node) : [found.node.index, found.node.index];
    for (const object of objects.slice(first, last + 1)) doomed.add(object);
  }
  const layers = [...doomed].filter(isLayerObject);
  if (layers.some((object) => isObjectLocked(object) || (object as StackObject).__isBackground)) {
    return "Unlock the layers first";
  }
  if (doomed.size === 0) return "Select the layers to delete";
  setPicks(canvas, []);
  canvas.discardActiveObject();
  canvas.remove(...objects.filter((object) => doomed.has(object)));
  canvas.requestRenderAll();
  return layers.length;
}

/** Layer › Delete › Group: the group and everything in it. */
export function deleteGroup(canvas: FabricCanvas, group: LayerGroup): number | Refusal {
  const { objects } = stackOf(canvas);
  const found = findNode(treeOf(objects), idOf(group));
  if (!found || found.node.kind !== "group") return "That group is gone";
  const [first, last] = rangeOf(found.node);
  const inside = objects.slice(first, last + 1);
  if (inside.some((object) => isLayerObject(object) && isObjectLocked(object))) return "Unlock the layers in the group first";
  setSelectedGroup(canvas, null);
  canvas.discardActiveObject();
  canvas.remove(...inside);
  canvas.requestRenderAll();
  return inside.filter(isLayerObject).length;
}

/** Move layers or groups (by id) to an anchor; the Layers panel's drag and drop. */
export function moveLayers(canvas: FabricCanvas, ids: readonly string[], anchor: Anchor): boolean {
  const next = moveNodes(stackOf(canvas).entries, ids, anchor);
  if (!next) return false;
  applyStack(canvas, next);
  return true;
}

/** Layer › Arrange, around whole groups and out at a group's edges. */
export function arrangeSelected(canvas: FabricCanvas, action: ArrangeAction): boolean {
  return arrangeLayers(canvas, selectedIds(canvas), action);
}

/** Arrange the given layers or groups (by id). False when nothing moved. */
export function arrangeLayers(canvas: FabricCanvas, ids: readonly string[], action: ArrangeAction): boolean {
  if (ids.length === 0) return false;
  const next = arrangeNodes(stackOf(canvas).entries, ids, action);
  if (!next) return false;
  const active = canvas.getActiveObject();
  applyStack(canvas, next);
  // The selection's own stacking follows the canvas.
  if (active instanceof ActiveSelection) active.setCoords();
  return true;
}

/** Layer › Create Clipping Mask / Release Clipping Mask (Ctrl+Alt+G toggles). */
export function setClipping(canvas: FabricCanvas, clipped: boolean): number {
  const layers = selectedLayerObjects(canvas).filter(
    (object) => !(object as StackObject).__isBackground && !isObjectLocked(object)
  ) as StackObject[];
  const changing = layers.filter((layer) => (layer.__clipped === true) !== clipped);
  for (const layer of changing) layer.__clipped = clipped;
  if (changing.length) {
    canvas.fire("object:modified", { target: changing[0]! });
    canvas.requestRenderAll();
  }
  return changing.length;
}

/** Whether Ctrl+Alt+G would clip (true) or release (false) the selection. */
export function clippingAction(canvas: FabricCanvas): boolean | null {
  const layers = selectedLayerObjects(canvas).filter((object) => !(object as StackObject).__isBackground) as StackObject[];
  if (layers.length === 0) return null;
  return !layers.every((layer) => layer.__clipped === true);
}

/** The selected group, or the ids of the selected layers (for the panel and commands). */
export function selectionIds(canvas: FabricCanvas): string[] {
  return selectedIds(canvas);
}

/** Layer › Duplicate on a group: a copy of it and everything in it, just above. */
export async function duplicateGroup(canvas: FabricCanvas, group: LayerGroup): Promise<LayerGroup | null> {
  const { objects } = stackOf(canvas);
  const found = findNode(treeOf(objects), idOf(group));
  if (!found || found.node.kind !== "group") return null;
  const [first, last] = rangeOf(found.node);
  const originals = objects.slice(first, last + 1);
  const copies = await cloneStack(originals);
  if (!canvas.getObjects().includes(group)) return null;
  const header = copies[copies.length - 1] as LayerGroup;
  header.name = `${group.name ?? "Group"} copy`.slice(0, 256);
  const position = canvas.getObjects().indexOf(group) + 1;
  canvas.discardActiveObject();
  canvas.insertAt(position, ...copies);
  selectGroup(canvas, header);
  return header;
}

/** Deep copies with new ids (markers included). */
async function cloneStack(objects: readonly FabricObject[]): Promise<FabricObject[]> {
  const { cloneObjects } = await import("@/utils/canvasActions");
  const copies = await cloneObjects([...objects]);
  const used = new Set<string>();
  for (const copy of copies) {
    (copy as StackObject).__layerId = undefined;
    ensureLayerId(copy, used);
  }
  return copies;
}

/** The groups around a layer, outermost first (for the panel's indentation). */
export function groupPath(canvas: FabricCanvas, object: FabricObject): GroupNode[] {
  const tree = treeOf(canvas.getObjects());
  const path: GroupNode[] = [];
  const visit = (nodes: GroupNode["children"], trail: GroupNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === idOf(object)) {
        path.push(...trail);
        return true;
      }
      if (node.kind === "group" && visit(node.children, [...trail, node])) return true;
    }
    return false;
  };
  visit(tree.roots, []);
  return path;
}
