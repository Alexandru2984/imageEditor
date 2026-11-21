/**
 * Layer groups, as Photoshop files keep them: in the flat stack of layers
 * (bottom to top), a group is the run of layers between an end marker below
 * them and the group's header above them. Whatever lies between the two is in
 * the group, so a layer added, copied or merged at a place inside a group
 * stays in it without anyone having to say so.
 *
 * These functions work on plain entries and return new orders; the canvas
 * side (layerGroups.ts) applies them to Fabric objects.
 */

export type EntryKind = "layer" | "header" | "end";

export interface Entry {
  id: string;
  kind: EntryKind;
  /** Clipped to the layer (or group) below it, within the same group. */
  clipped?: boolean;
  /** The document's photo: always at the bottom, never in a group. */
  background?: boolean;
}

/** Groups may sit inside groups this deep, as many as Photoshop allows. */
export const MAX_GROUP_DEPTH = 10;

export interface LayerNode {
  kind: "layer";
  id: string;
  /** Its place in the entries. */
  index: number;
  clipped: boolean;
}

export interface GroupNode {
  kind: "group";
  id: string;
  /** The header's place in the entries. */
  index: number;
  /** The end marker's place. */
  end: number;
  /** Bottom to top. */
  children: TreeNode[];
}

export type TreeNode = LayerNode | GroupNode;

export interface LayerTree {
  /** Bottom to top. */
  roots: TreeNode[];
  /** Markers without a partner, or nested too deep: they are ignored. */
  stray: number[];
}

/** The stack of entries as a tree of layers and groups. */
export function buildTree(entries: readonly Entry[]): LayerTree {
  // Pair the markers first, so a stray one cannot capture its neighbours.
  const partner = new Map<number, number>();
  const open: number[] = [];
  const stray: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "end") open.push(index);
    else if (entry.kind === "header") {
      const end = open.pop();
      if (end === undefined) stray.push(index);
      else {
        partner.set(end, index);
        partner.set(index, end);
      }
    }
  });
  stray.push(...open);

  const roots: TreeNode[] = [];
  const frames: { node: GroupNode | null; children: TreeNode[] }[] = [{ node: null, children: roots }];
  entries.forEach((entry, index) => {
    const frame = frames[frames.length - 1]!;
    if (entry.kind === "layer") {
      frame.children.push({ kind: "layer", id: entry.id, index, clipped: !!entry.clipped && !entry.background });
      return;
    }
    const pair = partner.get(index);
    if (pair === undefined) return;
    if (entry.kind === "end") {
      if (frames.length > MAX_GROUP_DEPTH || entriesBetweenHaveBackground(entries, index, pair)) {
        stray.push(index, pair);
        partner.delete(index);
        partner.delete(pair);
        return;
      }
      const header = entries[pair]!;
      const node: GroupNode = { kind: "group", id: header.id, index: pair, end: index, children: [] };
      frame.children.push(node);
      frames.push({ node, children: node.children });
    } else if (frames.length > 1 && frame.node?.index === index) {
      frames.pop();
    }
  });
  stray.sort((a, b) => a - b);
  return { roots, stray };
}

const entriesBetweenHaveBackground = (entries: readonly Entry[], from: number, to: number) =>
  entries.slice(from, to + 1).some((entry) => entry.background);

/** The entries a node spans, as [first, last] (inclusive). */
export const rangeOf = (node: TreeNode): [number, number] => (node.kind === "group" ? [node.end, node.index] : [node.index, node.index]);

/** Every node of the tree, depth first, with its parent group (null at the top). */
export function walk(tree: LayerTree): { node: TreeNode; parent: GroupNode | null; depth: number }[] {
  const out: { node: TreeNode; parent: GroupNode | null; depth: number }[] = [];
  const visit = (nodes: TreeNode[], parent: GroupNode | null, depth: number) => {
    for (const node of nodes) {
      out.push({ node, parent, depth });
      if (node.kind === "group") visit(node.children, node, depth + 1);
    }
  };
  visit(tree.roots, null, 0);
  return out;
}

/** A node by the id of its layer or group header. */
export function findNode(tree: LayerTree, id: string): { node: TreeNode; parent: GroupNode | null; depth: number } | null {
  return walk(tree).find((entry) => entry.node.id === id) ?? null;
}

/**
 * Siblings as clipping groups: each base with the clipped nodes stacked on
 * it. A clipped node with nothing under it (the bottom of its group) is
 * drawn as an ordinary one, as Photoshop does.
 */
export function clippingRuns(siblings: readonly TreeNode[]): { base: TreeNode; clipped: LayerNode[] }[] {
  const runs: { base: TreeNode; clipped: LayerNode[] }[] = [];
  for (const node of siblings) {
    const last = runs[runs.length - 1];
    if (node.kind === "layer" && node.clipped && last) last.clipped.push(node);
    else runs.push({ base: node, clipped: [] });
  }
  return runs;
}

/** Entries without stray markers. */
export function repaired(entries: readonly Entry[]): Entry[] {
  const { stray } = buildTree(entries);
  if (stray.length === 0) return [...entries];
  const drop = new Set(stray);
  return entries.filter((_, index) => !drop.has(index));
}

/** The topmost nodes among `ids`: a node inside a chosen group goes with it. */
function chosenNodes(tree: LayerTree, ids: ReadonlySet<string>): TreeNode[] {
  const chosen: TreeNode[] = [];
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (ids.has(node.id)) chosen.push(node);
      else if (node.kind === "group") visit(node.children);
    }
  };
  visit(tree.roots);
  return chosen.sort((a, b) => rangeOf(a)[0] - rangeOf(b)[0]);
}

/** Where moved layers go, relative to a layer or group. */
export type Anchor =
  | { id: string; where: "above" | "below" }
  /** At the top or the bottom of a group's own layers. */
  | { id: string; where: "insideTop" | "insideBottom" }
  /** At the very top of the stack, outside any group. */
  | { id: null; where: "top" };

/** Take nodes out of the stack, keeping their order: [the rest, the taken entries]. */
function extract(entries: readonly Entry[], nodes: readonly TreeNode[]): [Entry[], Entry[]] {
  const taken = new Set<number>();
  for (const node of nodes) {
    const [first, last] = rangeOf(node);
    for (let index = first; index <= last; index += 1) taken.add(index);
  }
  const rest: Entry[] = [];
  const moved: Entry[] = [];
  entries.forEach((entry, index) => (taken.has(index) ? moved : rest).push(entry));
  return [rest, moved];
}

/** Where in `rest` an anchor puts things, never under the photo. */
function insertionPoint(rest: readonly Entry[], anchor: Anchor): number | null {
  let at: number;
  if (anchor.id === null) at = rest.length;
  else {
    const found = findNode(buildTree(rest), anchor.id);
    if (!found) return null;
    const [first, last] = rangeOf(found.node);
    if (anchor.where === "above") at = last + 1;
    else if (anchor.where === "below") at = first;
    else {
      if (found.node.kind !== "group") return null;
      at = anchor.where === "insideTop" ? found.node.index : found.node.end + 1;
    }
  }
  const photo = rest.findIndex((entry) => entry.background);
  return Math.max(at, photo + 1);
}

/** Move layers and groups to an anchor. Null when nothing can move there. */
export function moveNodes(entries: readonly Entry[], ids: readonly string[], anchor: Anchor): Entry[] | null {
  const tree = buildTree(entries);
  const nodes = chosenNodes(tree, new Set(ids)).filter((node) => !(node.kind === "layer" && entries[node.index]!.background));
  if (nodes.length === 0) return null;
  // A group cannot go inside itself.
  if (anchor.id !== null && nodes.some((node) => node.kind === "group" && findNode({ roots: [node], stray: [] }, anchor.id!))) return null;
  const [rest, moved] = extract(entries, nodes);
  const at = insertionPoint(rest, anchor);
  if (at === null) return null;
  const result = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  return depthOf(result) > MAX_GROUP_DEPTH ? null : result;
}

/** How deep the deepest group sits. */
function depthOf(entries: readonly Entry[]): number {
  return walk(buildTree(entries)).reduce((deepest, { node, depth }) => (node.kind === "group" ? Math.max(deepest, depth + 1) : deepest), 0);
}

/**
 * Put layers and groups into a new group, made where the topmost of them
 * was. `header` and `end` are the new markers' entries.
 */
export function groupNodes(entries: readonly Entry[], ids: readonly string[], header: Entry, end: Entry): Entry[] | null {
  const tree = buildTree(entries);
  const nodes = chosenNodes(tree, new Set(ids)).filter((node) => !(node.kind === "layer" && entries[node.index]!.background));
  if (nodes.length === 0) return null;
  const top = nodes[nodes.length - 1]!;
  const [rest, moved] = extract(entries, nodes);
  // Just under where the topmost chosen one sat, among what is left.
  const above = entries.slice(rangeOf(top)[1] + 1).find((entry) => rest.includes(entry));
  const at = above ? rest.indexOf(above) : rest.length;
  const result = [...rest.slice(0, at), end, ...moved, header, ...rest.slice(at)];
  return depthOf(result) > MAX_GROUP_DEPTH ? null : result;
}

/** A new, empty group above a node (or at the top). */
export function insertEmptyGroup(entries: readonly Entry[], anchorId: string | null, header: Entry, end: Entry): Entry[] {
  const found = anchorId ? findNode(buildTree(entries), anchorId) : null;
  const photo = entries.findIndex((entry) => entry.background);
  const at = Math.max(found ? rangeOf(found.node)[1] + 1 : entries.length, photo + 1);
  const result = [...entries.slice(0, at), end, header, ...entries.slice(at)];
  return depthOf(result) > MAX_GROUP_DEPTH ? [...entries, end, header] : result;
}

/** Take a group apart, its layers staying where they are. */
export function ungroupNode(entries: readonly Entry[], groupId: string): Entry[] | null {
  const found = findNode(buildTree(entries), groupId);
  if (!found || found.node.kind !== "group") return null;
  const { index, end } = found.node;
  return entries.filter((_, at) => at !== index && at !== end);
}

export type ArrangeAction = "front" | "forward" | "backward" | "back";

/**
 * Photoshop's Arrange: within the layers' group, past whole groups; Bring
 * Forward at the top of a group steps out of it, Send Backward at its
 * bottom likewise.
 */
export function arrangeNodes(entries: readonly Entry[], ids: readonly string[], action: ArrangeAction): Entry[] | null {
  const tree = buildTree(entries);
  const nodes = chosenNodes(tree, new Set(ids)).filter((node) => !(node.kind === "layer" && entries[node.index]!.background));
  if (nodes.length === 0) return null;
  const upward = action === "front" || action === "forward";
  const lead = upward ? nodes[nodes.length - 1]! : nodes[0]!;
  const found = findNode(tree, lead.id)!;
  const siblings = found.parent ? found.parent.children : tree.roots;
  const position = siblings.indexOf(found.node);
  const chosen = new Set(nodes.map((node) => node.id));
  let anchor: Anchor | null = null;
  if (action === "front" || action === "back") {
    const edge = upward
      ? [...siblings].reverse().find((node) => !chosen.has(node.id))
      : siblings.find((node) => !chosen.has(node.id) && !(node.kind === "layer" && entries[node.index]!.background));
    if (edge) anchor = { id: edge.id, where: upward ? "above" : "below" };
  } else {
    const next = upward ? siblings.slice(position + 1).find((node) => !chosen.has(node.id)) : [...siblings.slice(0, position)].reverse().find((node) => !chosen.has(node.id));
    if (next && !(next.kind === "layer" && entries[next.index]!.background)) anchor = { id: next.id, where: upward ? "above" : "below" };
    else if (!next && found.parent) anchor = { id: found.parent.id, where: upward ? "above" : "below" };
  }
  if (!anchor) return null;
  const result = moveNodes(entries, ids, anchor);
  return result && result.some((entry, index) => entry !== entries[index]) ? result : null;
}
