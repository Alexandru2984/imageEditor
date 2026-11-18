import { test, expect } from "@playwright/test";
import {
  TOP_IMAGE,
  autosavedLayerPixels,
  autosavedObjects,
  canvasCenter,
  chooseMenu,
  menuItem,
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

/** Press a tool key and wait until the tool is armed, so the next drag uses it. */
async function arm(page: import("@playwright/test").Page, key: string, name: string) {
  await page.keyboard.press(key);
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText(name);
}
const armBrush = (page: import("@playwright/test").Page) => arm(page, "b", "Brush");

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
  await armBrush(page);

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
  await arm(page, "e", "Eraser");
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
  await armBrush(page);
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
  await armBrush(page);
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
  await arm(page, "u", "Shape");
  await page.mouse.click(center.x, center.y);
  // A stroke well away from the shape, on a layer spanning the whole photo.
  await armBrush(page);
  await stroke(page, -150);
  await expect.poll(() => layerNames(page)).toContain("Layer 1");

  await arm(page, "v", "Move");
  await page.getByRole("button", { name: "Toggle layers" }).click();
  const current = page.locator('[data-layer-id][aria-current="true"]');
  await expect(current).toContainText("Layer 1");
  await page.mouse.click(center.x, center.y);
  await expect(current).toContainText(/rect/i);
  await page.mouse.click(center.x, center.y - 150);
  await expect(current).toContainText("Layer 1");
});

test("layer commands create, merge, rasterize and flatten layers in one undo step each", async ({
  page,
}) => {
  await uploadSolidImage(page, 400, 300);
  const center = await canvasCenter(page);
  await page.getByRole("button", { name: "Toggle layers" }).click();
  const rows = page.locator("[data-layer-id]");
  const current = page.locator('[data-layer-id][aria-current="true"]');

  // New layer, then paint on it: the brush uses the selected layer.
  await page.keyboard.press("Control+Shift+Alt+n");
  await expect(current).toContainText("Layer 1");
  await armBrush(page);
  await stroke(page);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[200, 150]]))?.pixels[0]?.[3])
    .toBe(255);

  // A shape above it, rasterized into pixels.
  await arm(page, "u", "Shape");
  await page.mouse.click(center.x, center.y + 60);
  await expect(current).toContainText(/rect/i);
  await chooseMenu(page, "Layer", "Rasterize layer");
  await expect
    .poll(async () => (await autosavedObjects(page)).map((object) => object.type?.toString().toLowerCase()))
    .toEqual(["image", "image", "image"]);
  await expect(rows).toHaveCount(3);

  // Merge down: the shape's pixels join Layer 1, which keeps its name.
  await page.keyboard.press("Control+e");
  await expect(rows).toHaveCount(2);
  await expect(current).toContainText("Layer 1");
  await expect.poll(async () => (await autosavedObjects(page)).length).toBe(2);
  const merged = await autosavedLayerPixels(page, "Layer 1", [[200, 150]]);
  expect(merged?.width).toBe(400);
  expectColor(merged?.pixels[0], [168, 85, 247, 255]);

  // One undo brings both layers back.
  await page.keyboard.press("Control+z");
  await expect(rows).toHaveCount(3);
  await page.keyboard.press("Control+Shift+z");
  await expect(rows).toHaveCount(2);

  // Flatten bakes everything into the photo at its own resolution.
  await chooseMenu(page, "Layer", "Flatten image");
  await expect(rows).toHaveCount(1);
  await expect.poll(async () => (await autosavedObjects(page)).length).toBe(1);
  const flat = await autosavedLayerPixels(page, "Background", [
    [200, 150],
    [5, 5],
  ]);
  expect([flat?.width, flat?.height]).toEqual([400, 300]);
  expectColor(flat?.pixels[0], [168, 85, 247, 255]);
  expect(flat?.pixels[1]).toEqual([255, 255, 255, 255]);
  // Nothing is left to merge.
  await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
  await expect(menuItem(page, "Merge visible")).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("flattening a rotated photo keeps all of it, upright", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  await armBrush(page);
  await stroke(page);
  await expect.poll(() => layerNames(page)).toContain("Layer 1");

  // The document turns on its side; nothing is selected, so all of it turns.
  await page.keyboard.press("Escape");
  await chooseMenu(page, "Image", "Rotate 90° clockwise");
  await expect
    .poll(async () => (await autosavedObjects(page)).map((object) => object.angle))
    .toEqual([90, 90]);

  await chooseMenu(page, "Layer", "Flatten image");
  await expect.poll(async () => (await autosavedObjects(page)).length).toBe(1);
  const [photo] = await autosavedObjects(page);
  expect(photo?.angle ?? 0).toBe(0);
  // Painted across the middle, the stroke now runs down the centre.
  const flat = await autosavedLayerPixels(page, "Background", [
    [150, 200],
    [150, 5],
  ]);
  expect([flat?.width, flat?.height]).toEqual([300, 400]);
  expectColor(flat?.pixels[0], [168, 85, 247, 255]);
  expect(flat?.pixels[1]).toEqual([255, 255, 255, 255]);
});

test("the paint bucket fills the clicked area on a new layer, one undo step per click", async ({
  page,
}) => {
  // White with a black band down the middle: two white areas apart.
  await uploadSolidImage(page, 400, 300, "#ffffff", [
    { x: 180, y: 0, width: 40, height: 300, color: "#000000" },
  ]);
  await arm(page, "g", "Paint bucket");
  const options = page.getByRole("group", { name: "Tool options" });
  await expect(options.getByRole("button", { name: "Contiguous" })).toHaveAttribute("aria-pressed", "true");

  // Left of the band, which spans 40 of the photo's 400 pixels.
  const center = await canvasCenter(page);
  const leftArea = { x: center.x - 120, y: center.y };
  await page.mouse.click(leftArea.x, leftArea.y);
  await expect.poll(() => layerNames(page)).toContain("Layer 1");
  const filled = await autosavedLayerPixels(page, "Layer 1", [
    [20, 20],
    [170, 290],
    [200, 150],
    [300, 150],
  ]);
  expectColor(filled?.pixels[0], [168, 85, 247, 255], 0);
  expectColor(filled?.pixels[1], [168, 85, 247, 255], 0);
  // Neither the band nor the white area beyond it.
  expect(filled?.pixels[2]?.[3]).toBe(0);
  expect(filled?.pixels[3]?.[3]).toBe(0);

  // One undo takes the fill, and the layer it made, away.
  await page.keyboard.press("Control+z");
  await expect.poll(() => layerNames(page)).not.toContain("Layer 1");

  // Not contiguous: every white pixel, on both sides of the band.
  await options.getByRole("button", { name: "Contiguous" }).click();
  await page.mouse.click(leftArea.x, leftArea.y);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[300, 150]]))?.pixels[0]?.[3])
    .toBe(255);
  expect((await autosavedLayerPixels(page, "Layer 1", [[200, 150]]))?.pixels[0]?.[3]).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(() => layerNames(page)).not.toContain("Layer 1");

  // Judged by the empty layer alone, the whole layer is one area.
  await options.getByRole("button", { name: "All layers" }).click();
  await page.mouse.click(leftArea.x, leftArea.y);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[200, 150]]))?.pixels[0]?.[3])
    .toBe(255);
});
