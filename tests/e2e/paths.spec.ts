import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, autosavedObjects, canvasCenter, chooseMenu, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

interface Anchor {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
  smooth: boolean;
}
type SavedPath = { name: string; subpaths: { closed: boolean; anchors: Anchor[] }[] };

const savedPaths = async (page: Page): Promise<SavedPath[]> => {
  const photo = (await autosavedObjects(page)).find((object) => object.name === "Background");
  return ((photo as { paths?: SavedPath[] } | undefined)?.paths ?? []) as SavedPath[];
};

async function arm(page: Page, key: string, name: string) {
  await page.keyboard.press(key);
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText(name);
  await settle(page);
}

/** The scene point under a screen point (the fitted view shows the scene at 100%). */
async function sceneOf(page: Page, x: number, y: number) {
  const box = (await page.locator("canvas.upper-canvas").boundingBox())!;
  return { x: x - box.x, y: y - box.y };
}

test("the Pen draws corners and curves, and Direct selection reshapes them", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080");
  await arm(page, "p", "Pen");
  const c = await canvasCenter(page);
  const points = [
    { x: c.x - 80, y: c.y - 60 },
    { x: c.x + 80, y: c.y - 60 },
    { x: c.x, y: c.y + 70 },
  ];
  for (const point of points.slice(0, 2)) await page.mouse.click(point.x, point.y);
  // A drag pulls out a curve's handles.
  await page.mouse.move(points[2]!.x, points[2]!.y);
  await page.mouse.down();
  await page.mouse.move(points[2]!.x - 40, points[2]!.y, { steps: 5 });
  await page.mouse.up();
  // Back on the first point: the shape closes.
  await page.mouse.click(points[0]!.x, points[0]!.y);

  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.closed).toBe(true);
  const [path] = await savedPaths(page);
  expect(path!.name).toBe("Work Path");
  const anchors = path!.subpaths[0]!.anchors;
  expect(anchors).toHaveLength(3);
  const first = await sceneOf(page, points[0]!.x, points[0]!.y);
  expect(anchors[0]!.x).toBeCloseTo(first.x, 0);
  expect(anchors[0]!.y).toBeCloseTo(first.y, 0);
  expect(anchors[0]!.smooth).toBe(false);
  expect(anchors[2]!.smooth).toBe(true);
  expect(anchors[2]!.outX).toBeLessThan(anchors[2]!.x - 30);
  expect(anchors[2]!.inX).toBeGreaterThan(anchors[2]!.x + 30);

  // The path is drawn over the canvas.
  const blue = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLCanvasElement>('[data-testid="selection-overlay"]')!;
    const data = overlay.getContext("2d")!.getImageData(0, 0, overlay.width, overlay.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index + 2]! > 200 && data[index]! < 80) count += 1;
    return count;
  });
  expect(blue).toBeGreaterThan(100);

  // Direct selection drags the first anchor; undo puts it back.
  await arm(page, "a", "Direct selection");
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  await page.mouse.move(points[0]!.x - 30, points[0]!.y - 20, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await savedPaths(page))[0]!.subpaths[0]!.anchors[0]!.x).toBeCloseTo(first.x - 30, 0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await savedPaths(page))[0]!.subpaths[0]!.anchors[0]!.x).toBeCloseTo(first.x, 0);

  // Arrow keys nudge the picked anchor; Delete takes it out.
  await page.mouse.click(points[1]!.x, points[1]!.y);
  const before = (await savedPaths(page))[0]!.subpaths[0]!.anchors[1]!;
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await savedPaths(page))[0]!.subpaths[0]!.anchors[1]!.x).toBeGreaterThan(before.x);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await savedPaths(page))[0]!.subpaths[0]!.anchors.length).toBe(2);
  // The layers stayed as they were.
  expect((await autosavedObjects(page)).map((object) => object.name)).toEqual(["Background"]);
});

test("the Pen ends a path with Enter and carries on from its end; paths survive a reload", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080");
  await arm(page, "p", "Pen");
  const c = await canvasCenter(page);
  await page.mouse.click(c.x - 50, c.y);
  await page.mouse.click(c.x, c.y - 40);
  await page.keyboard.press("Enter");
  // A click elsewhere starts another subpath; one on the end carries on.
  await page.mouse.click(c.x + 60, c.y + 60);
  await page.keyboard.press("Enter");
  await page.mouse.click(c.x, c.y - 40);
  await page.mouse.click(c.x + 50, c.y);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths.map((subpath) => subpath.anchors.length)).toEqual([3, 1]);
  // Backspace while drawing takes the last point back.
  await page.mouse.click(c.x + 50, c.y);
  await page.mouse.click(c.x + 80, c.y + 30);
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.anchors.length).toBe(4);
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.anchors.length).toBe(3);
  await page.keyboard.press("Enter");

  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await settle(page);
  // Shown again by Direct selection, from the restored document.
  await arm(page, "a", "Direct selection");
  await page.mouse.click(c.x - 50, c.y);
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths.length).toBe(2);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.anchors.length).toBe(2);
});

test("the Paths panel makes selections, fills, strokes and shapes from a path", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const scale = photo.scaleX as number;
  await arm(page, "p", "Pen");
  const c = await canvasCenter(page);
  for (const [dx, dy] of [
    [-80, -60],
    [80, -60],
    [0, 70],
    [-80, -60],
  ] as const) {
    await page.mouse.click(c.x + dx, c.y + dy);
  }
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.closed).toBe(true);

  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Paths panel" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Paths" });
  await expect(panel.getByRole("button", { name: "Work Path", exact: true })).toBeVisible();
  const action = (name: string) => panel.getByRole("button", { name, exact: true });
  const inside = [200, Math.round(150 - 17 / scale)] as [number, number];
  const onEdge = [200, Math.round(150 - 60 / scale)] as [number, number];
  const outside = [20, 20] as [number, number];

  // Fill: the foreground colour inside the path, on a new layer.
  await action("Fill path with the foreground colour").click();
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [inside]))?.pixels[0])
    .toEqual([168, 85, 247, 255]);
  expect((await autosavedLayerPixels(page, "Layer 1", [outside]))!.pixels[0]![3]).toBe(0);

  // Stroke: the brush along the path, on the same layer, in the background colour after swapping.
  await page.keyboard.press("x");
  await action("Stroke path with the brush").click();
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [onEdge]))?.pixels[0])
    .toEqual([255, 255, 255, 255]);

  // A shape layer in the path's outline.
  await action("New shape layer from path").click();
  await expect.poll(async () => (await autosavedObjects(page)).find((o) => o.name === "Shape 1")?.type).toBe("Path");
  // It sits where the path is: its box is the triangle's.
  const box = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.lower-canvas")!;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  const shapeObject = (await autosavedObjects(page)).find((o) => o.name === "Shape 1")!;
  const shapeLeft = (shapeObject.left as number) - (shapeObject.originX === "center" ? (shapeObject.width as number) / 2 : 0);
  const shapeTop = (shapeObject.top as number) - (shapeObject.originY === "center" ? (shapeObject.height as number) / 2 : 0);
  expect(shapeLeft).toBeCloseTo(c.x - 80 - box.x, 0);
  expect(shapeTop).toBeCloseTo(c.y - 60 - box.y, 0);
  expect(shapeObject.width as number).toBeCloseTo(160, 0);

  // Ctrl+Enter: the path's area becomes the selection.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "New layer", exact: true }).click();
  await expect.poll(async () => (await autosavedObjects(page)).some((o) => o.name === "Layer 2")).toBe(true);
  const copied = (await autosavedLayerPixels(page, "Layer 2", [[0, 0]]))!;
  expect(copied.width).toBeGreaterThan(150 / scale);
  expect(copied.width).toBeLessThan(170 / scale);

  // A path from the selection: Select All gives the document's four corners.
  await page.keyboard.press("Control+a");
  await action("Make work path from selection").click();
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.anchors.length).toBe(4);

  // Renaming the Work Path saves it; Delete takes it away.
  await panel.getByRole("button", { name: "Work Path", exact: true }).dblclick();
  await panel.getByLabel("Path name").fill("Outline");
  await panel.getByLabel("Path name").press("Enter");
  await expect.poll(async () => (await savedPaths(page)).map((path) => path.name)).toEqual(["Outline"]);
  await panel.getByRole("button", { name: "Outline", exact: true }).click();
  await action("Delete path").click();
  await expect.poll(async () => (await savedPaths(page)).length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await savedPaths(page)).map((path) => path.name)).toEqual(["Outline"]);
});

test("Type on Path sets text along an open path, typed at once, undone and kept", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  await arm(page, "p", "Pen");
  const c = await canvasCenter(page);
  // An arch: up from the left, down to the right.
  for (const [dx, dy] of [
    [-150, 40],
    [0, -60],
    [150, 40],
  ] as const) {
    await page.mouse.click(c.x + dx, c.y + dy);
  }
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.anchors.length).toBe(3);

  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Paths panel" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Paths" });
  await panel.getByRole("button", { name: "More path actions" }).click();
  await page.getByRole("menuitem", { name: "Type on Path" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  // The Move tool takes over from the Pen, and the words are selected: typing replaces them.
  await expect(page.getByRole("group", { name: "Tool options" })).not.toContainText("Pen");
  /** Pixels of the text selection's highlight in a box around a screen point. */
  const highlightNear = (x: number, y: number, half = 6) =>
    page.evaluate(
      ({ x, y, half }) => {
        const upper = document.querySelector("canvas.upper-canvas") as HTMLCanvasElement;
        const box = upper.getBoundingClientRect();
        const ratio = upper.width / box.width;
        const { data } = upper.getContext("2d")!.getImageData((x - box.left - half) * ratio, (y - box.top - half) * ratio, half * 2 * ratio, half * 2 * ratio);
        let count = 0;
        for (let index = 0; index < data.length; index += 4) if (data[index + 3]! > 30 && data[index + 2]! > data[index]! + 60) count += 1;
        return count;
      },
      { x, y, half }
    );
  // The highlight follows the letters up the arch, not a straight box above it.
  await expect.poll(() => highlightNear(c.x - 75, c.y - 25)).toBeGreaterThan(20);
  expect(await highlightNear(c.x - 110, c.y - 45)).toBe(0);
  await page.keyboard.type("Along the arch");
  await page.keyboard.press("Escape");
  const text = async () => (await autosavedObjects(page)).find((object) => object.type === "IText") as
    | { text?: string; path?: { type?: string; visible?: boolean } }
    | undefined;
  await expect.poll(async () => (await text())?.text).toBe("Along the arch");
  expect((await text())?.path).toMatchObject({ type: "Path", visible: false });

  /** Purple pixels on screen in a box around a point (screen coordinates). */
  const purpleNear = (x: number, y: number, half = 30) =>
    page.evaluate(
      ({ x, y, half }) => {
        const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
        const box = lower.getBoundingClientRect();
        const ratio = lower.width / box.width;
        const { data } = lower.getContext("2d")!.getImageData((x - box.left - half) * ratio, (y - box.top - half) * ratio, half * 2 * ratio, half * 2 * ratio);
        let count = 0;
        for (let index = 0; index < data.length; index += 4) if (data[index]! > 120 && data[index + 1]! < 140 && data[index + 2]! > 200) count += 1;
        return count;
      },
      { x, y, half }
    );
  // The letters follow the arch up to its top, and nothing is under it.
  await expect.poll(() => purpleNear(c.x - 75, c.y - 25)).toBeGreaterThan(20);
  expect(await purpleNear(c.x, c.y + 80)).toBe(0);

  // Back a step: the typing; another: the text. Forward brings both back on the path.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await text())?.text).toBe("Type on a path");
  await page.keyboard.press("Control+z");
  await expect.poll(text).toBeUndefined();
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await text())?.text).toBe("Along the arch");
  await expect.poll(() => purpleNear(c.x - 75, c.y - 25)).toBeGreaterThan(20);

  // Kept after a reload.
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  expect((await text())?.path).toMatchObject({ type: "Path" });
  await expect.poll(() => purpleNear(c.x - 75, c.y - 25)).toBeGreaterThan(20);

  // Its options: where along the path, which side, which line of the letters sits on it.
  await page.keyboard.press("v");
  await page.mouse.click(c.x - 75, c.y - 25);
  const options = page.getByRole("region", { name: "Type on Path" });
  await expect(options).toBeVisible();
  const saved = async () => (await text()) as { pathStartOffset?: number; pathSide?: string; pathAlign?: string; path?: unknown };
  const position = options.getByRole("slider", { name: "Position on the path" });
  await position.focus();
  for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await saved()).pathStartOffset).toBe(4);
  await options.getByRole("button", { name: "Flip side" }).click();
  await expect.poll(async () => (await saved()).pathSide).toBe("right");
  // Flipped, the text runs back along the path under it: its first word is at the
  // path's end, and a double-click there picks that word, where the letters are.
  await page.mouse.dblclick(c.x + 104, c.y + 27);
  await page.keyboard.type("Over");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await text())?.text).toBe("Over the arch");
  await options.getByRole("radio", { name: "Center" }).click();
  await expect.poll(async () => (await saved()).pathAlign).toBe("center");
  // Off the path: one straight line again, the text kept.
  await options.getByRole("button", { name: "Release from path" }).click();
  await expect.poll(async () => (await saved()).path ?? null).toBeNull();
  expect((await text())?.text).toBe("Over the arch");
  await expect(options).toHaveCount(0);
});

test("Escape closes a menu opened while the Pen draws, and the path goes on", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  await arm(page, "p", "Pen");
  const c = await canvasCenter(page);
  await page.mouse.click(c.x - 100, c.y);
  await page.mouse.click(c.x, c.y - 50);
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.anchors.length).toBe(2);
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  // The menu had the key: the same subpath takes the next anchor.
  await page.mouse.click(c.x + 100, c.y);
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths.map((subpath) => subpath.anchors.length)).toEqual([3]);
});

test("Letters past the end of an open path are hidden; a closed path takes them around", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  await arm(page, "p", "Pen");
  const c = await canvasCenter(page);
  // A short open line, 120 px.
  await page.mouse.click(c.x - 60, c.y);
  await page.mouse.click(c.x + 60, c.y);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.anchors.length).toBe(2);
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Paths panel" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  const paths = page.getByRole("region", { name: "Paths" });
  const typeOnPath = async () => {
    await page.getByRole("tab", { name: "Layers" }).click();
    await paths.getByRole("button", { name: "More path actions" }).click();
    await page.getByRole("menuitem", { name: "Type on Path" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  };
  const ink = () =>
    page.evaluate(
      ({ x, y }) => {
        const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
        const box = lower.getBoundingClientRect();
        const ratio = lower.width / box.width;
        const { data } = lower.getContext("2d")!.getImageData((x - box.left) * ratio, (y - 30 - box.top) * ratio, 40 * ratio, 30 * ratio);
        let count = 0;
        for (let index = 0; index < data.length; index += 4) if (data[index]! < 230) count += 1;
        return count;
      },
      { x: c.x - 60, y: c.y }
    );
  await typeOnPath();
  await page.keyboard.type("Far");
  await expect.poll(ink).toBeGreaterThan(30);
  const alone = await ink();
  await page.keyboard.type(" too long for this line");
  await page.getByRole("tab", { name: "Properties" }).click();
  const options = page.getByRole("region", { name: "Type on Path" });
  await expect(options.getByRole("status")).toContainText(/\d+ letters run past the end of the path/);
  // Nothing is drawn back over the start: the first letters look as they do alone.
  expect(Math.abs((await ink()) - alone)).toBeLessThan(alone * 0.1);

  // A closed path: the letters go on around it, none hidden.
  await page.getByRole("tab", { name: "Layers" }).click();
  await paths.getByRole("button", { name: "Delete path", exact: true }).click();
  await expect.poll(async () => (await savedPaths(page)).length).toBe(0);
  // Done typing: a click off the photo.
  await page.mouse.click(c.x + 260, c.y + 180);
  await arm(page, "p", "Pen");
  for (const [dx, dy] of [
    [-40, 60],
    [40, 60],
    [0, 110],
    [-40, 60],
  ] as const) {
    await page.mouse.click(c.x + dx, c.y + dy);
  }
  await expect.poll(async () => (await savedPaths(page))[0]?.subpaths[0]?.closed).toBe(true);
  await typeOnPath();
  await page.keyboard.type("All the way around the triangle");
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(options).toBeVisible();
  await expect(options.getByRole("status")).toHaveCount(0);
});
