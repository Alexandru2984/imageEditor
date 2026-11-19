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

test("Canvas Size, Trim and Reveal All move the document's edges and keep the layers", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", [{ x: 0, y: 0, width: 200, height: 150, color: "#ff0000" }]);
  await expect.poll(() => layerOf(page, "Background")).toMatchObject({ size: [400, 300] });
  // An empty layer as big as the photo was.
  await page.keyboard.press("Control+Shift+Alt+n");
  await expect.poll(() => layerOf(page, "Layer 1")).toMatchObject({ size: [400, 300] });
  await settle(page);

  // Grown from the top-left corner, the new area black.
  await page.keyboard.press("Control+Alt+c");
  const canvasSize = page.getByRole("dialog", { name: "Canvas size" });
  await expect(canvasSize).toContainText("Now 400 × 300 pixels");
  await canvasSize.getByLabel("Width", { exact: true }).fill("500");
  await canvasSize.getByLabel("Height", { exact: true }).fill("400");
  await canvasSize.getByRole("radio", { name: "Top left" }).click();
  await canvasSize.getByRole("radio", { name: "Black" }).click();
  await canvasSize.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(() => layerOf(page, "Background", [[50, 50], [300, 200], [450, 350], [450, 50]]))
    .toEqual({ size: [500, 400], pixels: [[255, 0, 0], [128, 128, 128], [0, 0, 0], [0, 0, 0]] });
  // Other layers are left as they were.
  await expect.poll(() => layerOf(page, "Layer 1")).toMatchObject({ size: [400, 300] });

  // Trimming the black away gives the photo back.
  await openImageMenu(page, /^Trim/);
  const trimDialog = page.getByRole("dialog", { name: "Trim" });
  await trimDialog.getByRole("radio", { name: "Bottom-right colour" }).click();
  await trimDialog.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(() => layerOf(page, "Background", [[50, 50], [300, 200]]))
    .toEqual({ size: [400, 300], pixels: [[255, 0, 0], [128, 128, 128]] });

  // Smaller: only the red quarter is left.
  await page.keyboard.press("Control+Alt+c");
  await canvasSize.getByLabel("Width", { exact: true }).fill("200");
  await canvasSize.getByLabel("Height", { exact: true }).fill("150");
  await canvasSize.getByRole("radio", { name: "Top left" }).click();
  await expect(canvasSize).toContainText("the photo is cut");
  await canvasSize.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(() => layerOf(page, "Background", [[199, 149]]))
    .toEqual({ size: [200, 150], pixels: [[255, 0, 0]] });

  // Reveal All grows it around Layer 1 again, in the background colour (white).
  await openImageMenu(page, /^Reveal All/);
  await expect
    .poll(() => layerOf(page, "Background", [[50, 50], [300, 200]]))
    .toEqual({ size: [400, 300], pixels: [[255, 0, 0], [255, 255, 255]] });

  await page.keyboard.press("Control+z");
  await expect.poll(() => layerOf(page, "Background")).toMatchObject({ size: [200, 150] });
});

test("Rotate Canvas turns the document by any angle, filling the new corners", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", [{ x: 0, y: 0, width: 200, height: 150, color: "#ff0000" }]);
  await expect.poll(() => layerOf(page, "Background")).toMatchObject({ size: [400, 300] });
  await settle(page);

  const rotateBy = async (angle: string, direction: "Clockwise" | "Counter-clockwise") => {
    await openImageMenu(page, /^Rotate Canvas/);
    const dialog = page.getByRole("dialog", { name: "Rotate canvas" });
    await dialog.getByLabel("Angle", { exact: true }).fill(angle);
    await dialog.getByRole("radio", { name: direction, exact: true }).click();
    await dialog.getByRole("button", { name: "OK" }).click();
  };

  // A quarter turn clockwise: the red top-left corner goes to the top right, exactly.
  await rotateBy("90", "Clockwise");
  await expect
    .poll(() => layerOf(page, "Background", [[150, 0], [299, 199], [149, 0], [150, 200]]))
    .toEqual({ size: [300, 400], pixels: [[255, 0, 0], [255, 0, 0], [128, 128, 128], [128, 128, 128]] });

  // Back by 45°: the canvas grows to hold the photo and the corners are white.
  await rotateBy("45", "Counter-clockwise");
  await expect
    .poll(() => layerOf(page, "Background", [[3, 3], [491, 491], [265, 371], [230, 124]]))
    .toEqual({ size: [495, 495], pixels: [[255, 255, 255], [255, 255, 255], [128, 128, 128], [255, 0, 0]] });

  await page.keyboard.press("Control+z");
  await expect.poll(() => layerOf(page, "Background")).toMatchObject({ size: [300, 400] });
});
