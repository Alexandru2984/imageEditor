import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, getAutosaveJson, settle, uploadSolidImage } from "./helpers";

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

test("Free Transform sizes, turns and skews the selected layer by numbers", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", []);
  await settle(page);
  const rectangle = async () => {
    const json = await getAutosaveJson(page);
    const objects = (json ? JSON.parse(json).objects : []) as Array<Record<string, number | string>>;
    const shape = objects.find((object) => String(object.type).toLowerCase() === "rect");
    return shape && { scaleX: shape.scaleX, scaleY: shape.scaleY, angle: shape.angle, skewX: shape.skewX };
  };

  // A rectangle, selected, then another tool.
  await page.keyboard.press("u");
  await settle(page);
  const box = (await page.locator("canvas.upper-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(rectangle).toMatchObject({ angle: 0, skewX: 0 });
  const before = (await rectangle())!;
  await page.keyboard.press("b");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Brush");

  await page.keyboard.press("Control+Alt+t");
  const options = page.getByRole("group", { name: "Tool options" });
  await expect(options).toContainText("Move");
  const width = options.getByLabel("Layer width");
  const shown = Number(await width.inputValue());
  expect(shown).toBeGreaterThan(0);
  // Twice as wide, and as tall: proportions are kept.
  await width.fill(String(shown * 2));
  await width.press("Enter");
  await expect
    .poll(async () => {
      const now = await rectangle();
      return now && [round(Number(now.scaleX) / Number(before.scaleX)), round(Number(now.scaleY) / Number(before.scaleY))];
    })
    .toEqual([2, 2]);
  await options.getByLabel("Layer angle").fill("30");
  await options.getByLabel("Layer angle").press("Enter");
  await options.getByLabel("Horizontal skew").fill("20");
  await options.getByLabel("Horizontal skew").press("Enter");
  await expect.poll(rectangle).toMatchObject({ angle: 30, skewX: 20 });

  await page.keyboard.press("Control+z");
  await expect.poll(rectangle).toMatchObject({ angle: 30, skewX: 0 });
});

const round = (value: number) => Math.round(value * 100) / 100;

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
    return { left: box.left + left / ratio, top: box.top + top / ratio, right: box.left + (right + 1) / ratio, bottom: box.top + (bottom + 1) / ratio };
  });
}

test("Distort and Perspective reshape a layer by its corners", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", []);
  await settle(page);
  // Measured before a layer is selected: its handles are drawn on the canvas.
  const box = await photoBox(page);
  // The photo copied onto a layer of its own.
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+j");
  await expect.poll(() => layerOf(page, "Layer 1")).toMatchObject({ size: [400, 300] });
  await settle(page);
  const alphaAt = async (points: [number, number][]) =>
    (await autosavedLayerPixels(page, "Layer 1", points))?.pixels.map((pixel) => pixel[3]);
  const perPixel = (box.right - box.left) / 400;

  const transform = async (item: "Distort" | "Perspective") => {
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await page.getByRole("menuitem", { name: "Transform", exact: true }).click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Transform");
    // The closing menu still covers the top-left corner for a moment.
    await expect(page.getByRole("menu")).toHaveCount(0);
    await settle(page);
  };
  const dragCorner = async (from: { x: number; y: number }, dx: number, dy: number) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx * perPixel, from.y + dy * perPixel, { steps: 6 });
    await page.mouse.up();
  };

  // Escape leaves the layer as it was.
  await transform("Distort");
  await dragCorner({ x: box.right, y: box.top }, -100, 0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Move");
  await expect.poll(() => alphaAt([[390, 5]])).toEqual([255]);

  // The top-right corner pulled in: the layer's top right is empty now.
  await transform("Distort");
  await dragCorner({ x: box.right, y: box.top }, -100, 0);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => alphaAt([[390, 5], [390, 295], [200, 150]])).toEqual([0, 255, 255]);
  await expect.poll(() => layerOf(page, "Layer 1")).toMatchObject({ size: [400, 300] });

  await page.keyboard.press("Control+z");
  await expect.poll(() => alphaAt([[390, 5]])).toEqual([255]);

  // Undo leaves nothing selected: a click picks the layer again.
  await page.mouse.click((box.left + box.right) / 2, (box.top + box.bottom) / 2);
  await expect(page.getByRole("group", { name: "Transform" })).toBeVisible();
  // Perspective: the top-left corner pulled in pulls the top right in too.
  await transform("Perspective");
  await dragCorner({ x: box.left, y: box.top }, 80, 0);
  await page.keyboard.press("Enter");
  await expect.poll(() => alphaAt([[10, 5], [390, 5], [200, 5], [10, 295]])).toEqual([0, 0, 255, 255]);
});
