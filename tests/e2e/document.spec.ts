import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop menu tests");
  await page.goto("/");
});

const layerOf = async (page: Page, name: string, points: [number, number][] = []) => {
  const layer = await autosavedLayerPixels(page, name, points);
  return layer && { size: [layer.width, layer.height], pixels: layer.pixels.map((pixel) => pixel.slice(0, 3)) };
};

async function openImageMenu(page: Page, item: RegExp) {
  await page.getByRole("menuitem", { name: "Image", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("Image Size resamples the photo and its pixel layers, in proportion or not, in one undo step", async ({ page }) => {
  // Red in the top-left quarter of a grey photo.
  await uploadSolidImage(page, 400, 300, "#808080", [{ x: 0, y: 0, width: 200, height: 150, color: "#ff0000" }]);
  await expect.poll(() => layerOf(page, "Background")).toMatchObject({ size: [400, 300] });
  await page.keyboard.press("Control+Shift+Alt+n");
  await expect.poll(() => layerOf(page, "Layer 1")).toMatchObject({ size: [400, 300] });
  await settle(page);

  await openImageMenu(page, /^Image Size/);
  const dialog = page.getByRole("dialog", { name: "Image size" });
  await expect(dialog).toContainText("Now 400 × 300 pixels");
  // Proportions are kept: the height follows the width.
  await dialog.getByLabel("Width", { exact: true }).fill("200");
  await expect(dialog.getByLabel("Height", { exact: true })).toHaveValue("150");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(() => layerOf(page, "Background", [[50, 40], [150, 110]]))
    .toEqual({ size: [200, 150], pixels: [[255, 0, 0], [128, 128, 128]] });
  await expect.poll(() => layerOf(page, "Layer 1")).toMatchObject({ size: [200, 150] });

  // Unlinked, the document stretches.
  await page.keyboard.press("Control+Alt+i");
  await expect(dialog).toContainText("Now 200 × 150 pixels");
  await dialog.getByRole("button", { name: "Keep proportions" }).click();
  await dialog.getByLabel("Height", { exact: true }).fill("300");
  await expect(dialog.getByLabel("Width", { exact: true })).toHaveValue("200");
  await dialog.getByRole("radio", { name: "Hard edges" }).click();
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(() => layerOf(page, "Background", [[99, 149], [100, 150]]))
    .toEqual({ size: [200, 300], pixels: [[255, 0, 0], [128, 128, 128]] });
  await expect.poll(() => layerOf(page, "Layer 1")).toMatchObject({ size: [200, 300] });

  await page.keyboard.press("Control+z");
  await expect.poll(() => layerOf(page, "Background")).toMatchObject({ size: [200, 150] });
  await expect.poll(() => layerOf(page, "Layer 1")).toMatchObject({ size: [200, 150] });
});
