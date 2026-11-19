import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, canvasCenter, chooseSubmenu, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

/** What the canvas shows at an offset from its centre. */
async function shown(page: Page, dx = 0, dy = 0): Promise<number[]> {
  const center = await canvasCenter(page);
  return page.evaluate(
    ({ x, y }) => {
      const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
      const box = lower.getBoundingClientRect();
      const ratio = lower.width / box.width;
      return [
        ...lower
          .getContext("2d")!
          .getImageData(Math.round((x - box.left) * ratio), Math.round((y - box.top) * ratio), 1, 1).data,
      ];
    },
    { x: center.x + dx, y: center.y + dy }
  );
}

const photoPixels = async (page: Page, points: [number, number][]) =>
  (await autosavedLayerPixels(page, "Background", points))?.pixels.map((pixel) => pixel.slice(0, 3));

async function openGreyPhoto(page: Page) {
  await uploadSolidImage(page, 400, 300, "#808080");
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[128, 128, 128]]);
  await settle(page);
}

test("Levels darkens the photo while it is set, Cancel restores it, and OK applies it in the selection", async ({
  page,
}) => {
  await openGreyPhoto(page);

  await page.keyboard.press("Control+l");
  let dialog = page.getByRole("dialog", { name: "Levels" });
  await dialog.getByRole("slider", { name: "Shadows", exact: true }).focus();
  await page.keyboard.press("End");
  // Everything below the new black point turns black, on screen at once.
  await expect.poll(async () => (await shown(page))[0]).toBeLessThan(10);
  await dialog.getByLabel("Preview").uncheck();
  await expect.poll(async () => (await shown(page))[0]).toBeGreaterThan(120);
  await dialog.getByLabel("Preview").check();
  await expect.poll(async () => (await shown(page))[0]).toBeLessThan(10);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await shown(page))[0]).toBeGreaterThan(120);

  // Only the selected left half changes.
  await page.keyboard.press("m");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Rectangle select");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - 400, center.y - 280);
  await page.mouse.down();
  await page.mouse.move(center.x - 200, center.y, { steps: 4 });
  await page.mouse.move(center.x, center.y + 280, { steps: 4 });
  await page.mouse.up();
  await chooseSubmenu(page, "Image", "Adjustments", "Levels…");
  dialog = page.getByRole("dialog", { name: "Levels" });
  await dialog.getByRole("slider", { name: "Shadows", exact: true }).focus();
  await page.keyboard.press("End");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(() => photoPixels(page, [[100, 150], [300, 150]]))
    .toEqual([
      [0, 0, 0],
      [128, 128, 128],
    ]);

  // One step back undoes it.
  await page.keyboard.press("Control+z");
  await expect.poll(() => photoPixels(page, [[100, 150]])).toEqual([[128, 128, 128]]);
});

test("Curves applies a preset and a point set by number", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#336699");
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[0x33, 0x66, 0x99]]);
  await settle(page);

  await page.keyboard.press("Control+m");
  let dialog = page.getByRole("dialog", { name: "Curves" });
  await dialog.getByLabel("Preset").selectOption("negative");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[0xcc, 0x99, 0x66]]);

  // A point added on the graph, then placed exactly: 0xcc (204) becomes 102.
  await page.keyboard.press("Control+m");
  dialog = page.getByRole("dialog", { name: "Curves" });
  const graph = dialog.getByRole("application", { name: "Curve" });
  const box = (await graph.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
  await dialog.getByLabel("Input").fill("204");
  await dialog.getByLabel("Output").fill("102");
  await expect(dialog.getByLabel("Preset")).toHaveValue("custom");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect.poll(async () => (await photoPixels(page, [[200, 150]]))?.[0]?.[0]).toBe(102);
});
