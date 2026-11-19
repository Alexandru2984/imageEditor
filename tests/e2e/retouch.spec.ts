import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

/** Where the photo shows on screen: the opaque part of the canvas. */
async function photoBox(page: Page) {
  return page.evaluate(() => {
    const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
    const box = lower.getBoundingClientRect();
    const ratio = lower.width / box.width;
    const { data, width, height } = lower.getContext("2d")!.getImageData(0, 0, lower.width, lower.height);
    const opaque = (x: number, y: number) => data[(y * width + x) * 4 + 3]! > 0;
    const row = Math.floor(height / 2);
    const column = Math.floor(width / 2);
    let left = 0;
    while (left < width && !opaque(left, row)) left += 1;
    let right = width - 1;
    while (right > 0 && !opaque(right, row)) right -= 1;
    let top = 0;
    while (top < height && !opaque(column, top)) top += 1;
    let bottom = height - 1;
    while (bottom > 0 && !opaque(column, bottom)) bottom -= 1;
    return {
      left: box.left + left / ratio,
      top: box.top + top / ratio,
      width: (right + 1 - left) / ratio,
      height: (bottom + 1 - top) / ratio,
    };
  });
}

/** Screen position of a photo pixel's centre. */
async function onPhoto(page: Page, x: number, y: number, size: { width: number; height: number }) {
  const box = await photoBox(page);
  return { x: box.left + ((x + 0.5) / size.width) * box.width, y: box.top + ((y + 0.5) / size.height) * box.height };
}

const SIZE = { width: 400, height: 300 };
const photoPixels = async (page: Page, points: [number, number][]) =>
  (await autosavedLayerPixels(page, "Background", points))?.pixels.map((pixel) => pixel.slice(0, 3));

async function arm(page: Page, key: string, name: string) {
  await page.keyboard.press(key);
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText(name);
  await settle(page);
}

test("the clone stamp copies from an Alt-clicked source, aligned or not, in one undo step", async ({ page }) => {
  await uploadSolidImage(page, SIZE.width, SIZE.height, "#808080", [
    { x: 40, y: 40, width: 80, height: 80, color: "#ff0000" },
  ]);
  await expect.poll(() => photoPixels(page, [[280, 200]])).toEqual([[128, 128, 128]]);
  await arm(page, "s", "Clone stamp");

  // Without a source there is nothing to copy.
  let point = await onPhoto(page, 280, 200, SIZE);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText(/Alt-click .* where to copy from/)).toBeVisible();

  point = await onPhoto(page, 80, 80, SIZE);
  await page.keyboard.down("Alt");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  point = await onPhoto(page, 280, 200, SIZE);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => photoPixels(page, [[280, 200], [350, 260]])).toEqual([
    [255, 0, 0],
    [128, 128, 128],
  ]);

  // Aligned: the source moved with the brush, onto the grey beside the square.
  point = await onPhoto(page, 330, 200, SIZE);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(300);
  await expect.poll(() => photoPixels(page, [[330, 200]])).toEqual([[128, 128, 128]]);

  // Not aligned: every stroke starts from the source again.
  await page.getByRole("button", { name: "Aligned" }).click();
  point = await onPhoto(page, 330, 200, SIZE);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => photoPixels(page, [[330, 200]])).toEqual([[255, 0, 0]]);

  // One step back takes that stroke away.
  await page.keyboard.press("Control+z");
  await expect.poll(() => photoPixels(page, [[330, 200], [280, 200]])).toEqual([
    [128, 128, 128],
    [255, 0, 0],
  ]);
});
