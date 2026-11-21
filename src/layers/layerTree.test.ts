import { describe, expect, it } from "vitest";
import {
  arrangeNodes,
  buildTree,
  clippingRuns,
  groupNodes,
  insertEmptyGroup,
  MAX_GROUP_DEPTH,
  moveNodes,
  repaired,
  ungroupNode,
  walk,
  type Entry,
} from "./layerTree";

const layer = (id: string, extra: Partial<Entry> = {}): Entry => ({ id, kind: "layer", ...extra });
const header = (id: string): Entry => ({ id, kind: "header" });
const end = (id: string): Entry => ({ id: `${id}-end`, kind: "end" });
const photo = layer("photo", { background: true });
const ids = (entries: Entry[] | null) => entries?.map((entry) => entry.id);

describe("buildTree", () => {
  it("reads groups between their end marker and header, nested, bottom to top", () => {
    const tree = buildTree([photo, layer("a"), end("G"), layer("b"), end("H"), layer("c"), header("H"), header("G"), layer("d")]);
    expect(tree.stray).toEqual([]);
    expect(walk(tree).map(({ node, depth }) => `${depth}:${node.id}`)).toEqual(["0:photo", "0:a", "0:G", "1:b", "1:H", "2:c", "0:d"]);
    const group = tree.roots[2]!;
    expect(group).toMatchObject({ kind: "group", index: 7, end: 2 });
  });

  it("ignores markers without a partner, and groups around the photo or nested too deep", () => {
    expect(buildTree([photo, header("X"), layer("a"), end("Y")]).stray).toEqual([1, 3]);
    expect(buildTree([end("G"), photo, header("G")]).stray).toEqual([0, 2]);
    const deep: Entry[] = [photo];
    for (let depth = 0; depth <= MAX_GROUP_DEPTH; depth += 1) deep.push(end(`g${depth}`));
    deep.push(layer("inside"));
    for (let depth = MAX_GROUP_DEPTH; depth >= 0; depth -= 1) deep.push(header(`g${depth}`));
    const tree = buildTree(deep);
    expect(tree.stray).toHaveLength(2);
    expect(Math.max(...walk(tree).map(({ depth }) => depth))).toBe(MAX_GROUP_DEPTH);
    expect(ids(repaired(deep))).toHaveLength(deep.length - 2);
  });

  it("stacks clipped layers on the base below them, and draws a clipped bottom layer plainly", () => {
    const tree = buildTree([layer("orphan", { clipped: true }), layer("base"), layer("c1", { clipped: true }), layer("c2", { clipped: true }), layer("free")]);
    expect(clippingRuns(tree.roots).map(({ base, clipped }) => [base.id, clipped.map((node) => node.id)])).toEqual([
      ["orphan", []],
      ["base", ["c1", "c2"]],
      ["free", []],
    ]);
  });
});

describe("moving and grouping", () => {
  const stack = [photo, layer("a"), end("G"), layer("b"), layer("c"), header("G"), layer("d")];

  it("moves layers above, below and into groups, never under the photo", () => {
    expect(ids(moveNodes(stack, ["d"], { id: "G", where: "insideBottom" }))).toEqual(["photo", "a", "G-end", "d", "b", "c", "G", ]);
    expect(ids(moveNodes(stack, ["b"], { id: "d", where: "above" }))).toEqual(["photo", "a", "G-end", "c", "G", "d", "b"]);
    expect(ids(moveNodes(stack, ["d"], { id: "a", where: "below" }))).toEqual(["photo", "d", "a", "G-end", "b", "c", "G"]);
    expect(ids(moveNodes(stack, ["a"], { id: "photo", where: "below" }))).toEqual(["photo", "a", "G-end", "b", "c", "G", "d"]);
    expect(ids(moveNodes(stack, ["G"], { id: null, where: "top" }))).toEqual(["photo", "a", "d", "G-end", "b", "c", "G"]);
    // A group does not go inside itself; the photo does not move.
    expect(moveNodes(stack, ["G"], { id: "b", where: "above" })).toBeNull();
    expect(moveNodes(stack, ["photo"], { id: null, where: "top" })).toBeNull();
  });

  it("groups layers where the topmost was, and takes groups apart in place", () => {
    const grouped = groupNodes(stack, ["a", "c"], header("N"), end("N"));
    expect(ids(grouped)).toEqual(["photo", "G-end", "b", "N-end", "a", "c", "N", "G", "d"]);
    expect(ids(ungroupNode(grouped!, "N"))).toEqual(["photo", "G-end", "b", "a", "c", "G", "d"]);
    expect(ids(groupNodes(stack, ["photo"], header("N"), end("N")))).toBeUndefined();
    expect(ids(insertEmptyGroup(stack, "b", header("E"), end("E")))).toEqual(["photo", "a", "G-end", "b", "E-end", "E", "c", "G", "d"]);
    expect(ids(insertEmptyGroup(stack, null, header("E"), end("E")))).toEqual([...ids(stack)!, "E-end", "E"]);
  });

  it("arranges within the group, past whole groups, and out at its edges", () => {
    expect(ids(arrangeNodes(stack, ["a"], "forward"))).toEqual(["photo", "G-end", "b", "c", "G", "a", "d"]);
    expect(ids(arrangeNodes(stack, ["c"], "forward"))).toEqual(["photo", "a", "G-end", "b", "G", "c", "d"]);
    expect(ids(arrangeNodes(stack, ["b"], "backward"))).toEqual(["photo", "a", "b", "G-end", "c", "G", "d"]);
    expect(ids(arrangeNodes(stack, ["b"], "front"))).toEqual(["photo", "a", "G-end", "c", "b", "G", "d"]);
    expect(ids(arrangeNodes(stack, ["d"], "back"))).toEqual(["photo", "d", "a", "G-end", "b", "c", "G"]);
    expect(arrangeNodes(stack, ["a"], "backward")).toBeNull();
    expect(arrangeNodes(stack, ["d"], "front")).toBeNull();
  });
});
