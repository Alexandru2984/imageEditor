import { test, expect, type Page } from "@playwright/test";
import {
  autosavedLayerPixels,
  autosavedObjects,
  canvasCenter,
  menuItem,
  uploadSolidImage,
} from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

async function arm(page: Page, key: string, name: string) {
  await page.keyboard.press(key);
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText(name);
}

/** Drag between two offsets from the canvas centre. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const center = await canvasCenter(page);
  await page.mouse.move(center.x + from[0], center.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(center.x + to[0], center.y + to[1], { steps: 6 });
  await page.mouse.up();
}

/** What the canvas shows at an offset from its centre (RGBA). */
async function shown(page: Page, offset: [number, number]): Promise<number[]> {
  const center = await canvasCenter(page);
  return page.evaluate(
    ({ x, y }) => {
      const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
      const box = lower.getBoundingClientRect();
      const ratio = lower.width / box.width;
      const context = lower.getContext("2d")!;
      return [
        ...context.getImageData(Math.round((x - box.left) * ratio), Math.round((y - box.top) * ratio), 1, 1).data,
      ];
    },
    { x: center.x + offset[0], y: center.y + offset[1] }
  );
}

/** Whether a shown pixel is the grey backdrop behind transparent pixels. */
const backdrop = (pixel: number[]) =>
  pixel[3] === 255 && Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) < 16 && pixel[0]! > 150;

/** Run an item of Layer › Layer mask. */
async function maskMenu(page: Page, item: string) {
  await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Layer mask" }).click();
  await menuItem(page, item).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

const maskOf = async (page: Page, name: string) =>
  (await autosavedObjects(page)).find((object) => object.name === name)?.layerMask as
    | { src: string; enabled: boolean }
    | undefined;

test("a mask from the selection hides the rest of the layer, and can be turned off, deleted or applied", async ({
  page,
}) => {
  await uploadSolidImage(page, 400, 300, "#ff0000");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-60, -40], [0, 40]);
  await page.getByRole("button", { name: "Mask", exact: true }).click();

  await expect.poll(async () => (await maskOf(page, "Background"))?.enabled).toBe(true);
  await expect.poll(async () => backdrop(await shown(page, [30, 0]))).toBe(true);
  expect(await shown(page, [-30, 0])).toEqual([255, 0, 0, 255]);
  // The selection became the mask, and the mask is what tools paint on.
  await expect(page.getByText("Drag to select a region")).toBeHidden();

  // Shift+click on the mask thumbnail turns it off, and undo back on.
  await page.getByRole("tab", { name: "Layers" }).click();
  const thumbnail = page.getByRole("button", { name: "Background layer mask" });
  await expect(thumbnail).toHaveAttribute("aria-pressed", "true");
  await thumbnail.click({ modifiers: ["Shift"] });
  await expect.poll(async () => (await maskOf(page, "Background"))?.enabled).toBe(false);
  await expect.poll(() => shown(page, [30, 0])).toEqual([255, 0, 0, 255]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await maskOf(page, "Background"))?.enabled).toBe(true);
  await expect.poll(async () => backdrop(await shown(page, [30, 0]))).toBe(true);

  // Delete brings the whole layer back; undo returns the mask.
  await maskMenu(page, "Delete layer mask");
  await expect.poll(() => maskOf(page, "Background")).toBeUndefined();
  await expect.poll(() => shown(page, [30, 0])).toEqual([255, 0, 0, 255]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await maskOf(page, "Background"))?.enabled).toBe(true);

  // Apply erases what the mask hid and drops the mask.
  await maskMenu(page, "Apply layer mask");
  await expect.poll(() => maskOf(page, "Background")).toBeUndefined();
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const scale = photo.scaleX as number;
  const baked = (await autosavedLayerPixels(page, "Background", [
    [Math.round(200 - 30 / scale), 150],
    [Math.round(200 + 30 / scale), 150],
  ]))!;
  expect(baked.pixels[0]).toEqual([255, 0, 0, 255]);
  expect(baked.pixels[1]![3]).toBe(0);
  expect(backdrop(await shown(page, [30, 0]))).toBe(true);
});

test("Layer › Layer mask offers reveal and hide, and masks survive saving the project", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#00ff00");
  await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Layer mask" }).click();
  await expect(menuItem(page, "Reveal selection")).toBeDisabled();
  await expect(menuItem(page, "Delete layer mask")).toBeDisabled();
  await menuItem(page, "Hide all").click();
  await expect.poll(async () => (await maskOf(page, "Background"))?.enabled).toBe(true);
  await expect.poll(async () => backdrop(await shown(page, [0, 0]))).toBe(true);

  await maskMenu(page, "Invert layer mask");
  await expect.poll(() => shown(page, [0, 0])).toEqual([0, 255, 0, 255]);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const saved = await (await download).path();
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /^New/ }).click();
  await page.getByRole("button", { name: "Start new" }).click();
  await page.getByTestId("project-input").setInputFiles(saved!);
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect.poll(async () => (await maskOf(page, "Background"))?.enabled).toBe(true);
  await expect.poll(() => shown(page, [0, 0])).toEqual([0, 255, 0, 255]);
});

test("the brush, eraser and bucket paint on the mask once it is picked", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ff0000");
  await maskMenu(page, "Hide all");
  await expect.poll(async () => backdrop(await shown(page, [0, 0]))).toBe(true);
  await expect.poll(async () => (await maskOf(page, "Background"))?.enabled).toBe(true);

  // White reveals: default colours, swapped.
  await page.keyboard.press("d");
  await page.keyboard.press("x");
  await arm(page, "b", "Brush");
  await expect(page.getByRole("button", { name: "Stop painting on the layer mask" })).toBeVisible();
  const center = await canvasCenter(page);
  const across = async () => {
    await page.mouse.move(center.x - 100, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 100, center.y, { steps: 12 });
    await page.mouse.up();
  };
  await across();
  await expect.poll(() => shown(page, [0, 0])).toEqual([255, 0, 0, 255]);
  expect(backdrop(await shown(page, [0, 60]))).toBe(true);
  // The photo's own pixels are untouched, and no layer was added.
  expect((await autosavedLayerPixels(page, "Background", [[200, 150]]))!.pixels[0]).toEqual([255, 0, 0, 255]);
  expect(await autosavedObjects(page)).toHaveLength(1);

  // The eraser paints the background colour (black here): hidden again.
  await arm(page, "e", "Eraser");
  await across();
  await expect.poll(async () => backdrop(await shown(page, [0, 0]))).toBe(true);

  // The bucket fills the mask's own area with white.
  await arm(page, "g", "Paint bucket");
  await page.mouse.click(center.x, center.y + 60);
  await expect.poll(() => shown(page, [0, 60])).toEqual([255, 0, 0, 255]);

  // Back on the layer, the brush paints pixels on a new layer.
  await page.getByRole("button", { name: "Stop painting on the layer mask" }).click();
  await arm(page, "b", "Brush");
  await expect(page.getByRole("button", { name: "Stop painting on the layer mask" })).toBeHidden();
  await across();
  await expect.poll(async () => (await autosavedObjects(page)).some((o) => o.name === "Layer 1")).toBe(true);
});
