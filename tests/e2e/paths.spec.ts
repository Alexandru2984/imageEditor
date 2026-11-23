import { test, expect, type Page } from "@playwright/test";
import { autosavedObjects, canvasCenter, settle, uploadSolidImage } from "./helpers";

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
