import { test, expect } from "@playwright/test";
import {
  TOP_IMAGE,
  autosavedLayerPixels,
  autosavedObjects,
  canvasCenter,
  uploadSolidImage,
} from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

/** Colours survive the brush's gradient and PNG round trip within a step or two. */
function expectColor(actual: number[] | undefined, expected: number[], tolerance = 2) {
  expect(actual).toHaveLength(4);
  actual!.forEach((channel, index) =>
    expect(Math.abs(channel - expected[index]!), `channel ${index}: ${actual}`).toBeLessThanOrEqual(tolerance)
  );
}

const layerNames = async (page: import("@playwright/test").Page) =>
  (await autosavedObjects(page)).map((object) => object.name);

async function stroke(page: import("@playwright/test").Page, dy = 0, span = 80) {
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - span, center.y + dy);
  await page.mouse.down();
  await page.mouse.move(center.x + span, center.y + dy, { steps: 12 });
  await page.mouse.up();
}

test("the brush paints pixels on a new layer, undoably, and the eraser removes them", async ({
  page,
}) => {
  await uploadSolidImage(page, 400, 300);
  await page.keyboard.press("b");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Brush");

  await stroke(page);
  await expect.poll(() => layerNames(page)).toContain("Layer 1");
  const painted = await autosavedLayerPixels(page, "Layer 1", [
    [200, 150],
    [5, 5],
  ]);
  // The layer matches the photo's resolution.
  expect(painted?.width).toBe(400);
  expect(painted?.height).toBe(300);
  expectColor(painted?.pixels[0], [168, 85, 247, 255]);
  expect(painted?.pixels[1]?.[3]).toBe(0);

  // A second stroke continues on the same layer.
  await stroke(page, 40);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[200, 150]]))?.pixels[0]?.[3])
    .toBe(255);
  await page.waitForTimeout(400);
  expect((await layerNames(page)).filter((name) => name?.startsWith("Layer"))).toEqual(["Layer 1"]);

  // Undo takes the strokes back one at a time.
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect.poll(() => layerNames(page)).not.toContain("Layer 1");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => layerNames(page)).toContain("Layer 1");

  // The eraser works on the same pixel layer.
  await page.keyboard.press("e");
  await stroke(page);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[200, 150]]))?.pixels[0]?.[3])
    .toBe(0);
});

async function solidPngBuffer(page: import("@playwright/test").Page, size: number, color: string) {
  const base64 = await page.evaluate(
    ({ size, color }) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, size, size);
      return canvas.toDataURL("image/png").split(",")[1]!;
    },
    { size, color }
  );
  return Buffer.from(base64, "base64");
}

test("the brush paints on the selected image layer at that layer's resolution", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  const buffer = await solidPngBuffer(page, 100, "#00ff00");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add image layer" }).click();
  await (await chooser).setFiles({ name: "green.png", mimeType: "image/png", buffer });
  await expect.poll(async () => (await autosavedObjects(page)).length).toBe(2);

  // The added layer is selected, so the brush paints on it.
  await page.keyboard.press("b");
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, TOP_IMAGE, [[50, 50]]))?.pixels[0])
    .not.toEqual([0, 255, 0, 255]);
  const layer = await autosavedLayerPixels(page, TOP_IMAGE, [
    [50, 50],
    [2, 2],
  ]);
  expect(layer?.width).toBe(100);
  expectColor(layer?.pixels[0], [168, 85, 247, 255]);
  // Pixels outside the dab are untouched.
  expect(layer?.pixels[1]).toEqual([0, 255, 0, 255]);
  expect(await autosavedObjects(page)).toHaveLength(2);
});

test("painted layers survive saving and reopening the project", async ({ page }) => {
  await uploadSolidImage(page, 300, 200);
  await page.keyboard.press("b");
  await stroke(page);
  await expect.poll(() => layerNames(page)).toContain("Layer 1");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const saved = await (await download).path();

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /^New/ }).click();
  await page.getByRole("button", { name: "Start new" }).click();
  await page.getByTestId("project-input").setInputFiles(saved!);
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[150, 100]]))?.pixels[0]?.[3])
    .toBe(255);
});

test("clicks pass through the transparent pixels of a pixel layer", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  const center = await canvasCenter(page);
  await page.keyboard.press("u");
  await page.mouse.click(center.x, center.y);
  // A stroke well away from the shape, on a layer spanning the whole photo.
  await page.keyboard.press("b");
  await stroke(page, -150);
  await expect.poll(() => layerNames(page)).toContain("Layer 1");

  await page.keyboard.press("v");
  await page.getByRole("button", { name: "Toggle layers" }).click();
  const current = page.locator('[data-layer-id][aria-current="true"]');
  await expect(current).toContainText("Layer 1");
  await page.mouse.click(center.x, center.y);
  await expect(current).toContainText(/rect/i);
  await page.mouse.click(center.x, center.y - 150);
  await expect(current).toContainText("Layer 1");
});
