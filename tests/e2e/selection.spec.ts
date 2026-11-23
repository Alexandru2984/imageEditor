import { test, expect, type Page } from "@playwright/test";
import {
  autosavedLayerPixels,
  autosavedObjects,
  canvasCenter,
  chooseMenu,
  menuItem,
  settle,
  uploadSolidImage,
} from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

/** Press a tool key and wait until the tool is armed, so the next drag uses it. */
async function arm(page: Page, key: string, name: string) {
  await page.keyboard.press(key);
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText(name);
  await settle(page);
}

/** Drag between two points given relative to the canvas centre. */
async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  modifier?: "Shift" | "Alt" | "Shift+Alt"
) {
  const center = await canvasCenter(page);
  const keys = modifier ? modifier.split("+") : [];
  await page.mouse.move(center.x + from[0], center.y + from[1]);
  for (const key of keys) await page.keyboard.down(key);
  await page.mouse.down();
  await page.mouse.move(center.x + (from[0] + to[0]) / 2, center.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(center.x + to[0], center.y + to[1], { steps: 4 });
  await page.mouse.up();
  for (const key of keys.reverse()) await page.keyboard.up(key);
}

/** How many overlay pixels the marching ants cover. */
const antPixels = (page: Page) =>
  page.evaluate(() => {
    const overlay = document.querySelector<HTMLCanvasElement>('[data-testid="selection-overlay"]')!;
    const data = overlay.getContext("2d")!.getImageData(0, 0, overlay.width, overlay.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) count += 1;
    return count;
  });

const copyLayer = async (page: Page, name = "Layer 1") => {
  await page.getByRole("button", { name: "New layer", exact: true }).click();
  await expect.poll(async () => (await autosavedObjects(page)).some((o) => o.name === name)).toBe(true);
  return (await autosavedObjects(page)).find((o) => o.name === name)!;
};

test("an ellipse selection copies a round region of the photo", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ff0000");
  await arm(page, "m", "Rectangle select");
  await arm(page, "Shift+M", "Ellipse select");
  await drag(page, [-60, -60], [60, 60]);
  await expect(page.getByRole("button", { name: "Redact" })).toBeVisible();
  await expect.poll(() => antPixels(page)).toBeGreaterThan(100);

  await copyLayer(page);
  const copy = await autosavedLayerPixels(page, "Layer 1", [[1, 1]]);
  const { width, height } = copy!;
  expect(width).toBeGreaterThan(20);
  expect(Math.abs(width - height)).toBeLessThanOrEqual(1);
  const pixels = (
    await autosavedLayerPixels(page, "Layer 1", [
      [1, 1],
      [Math.floor(width / 2), Math.floor(height / 2)],
      [Math.floor(width / 2), 1],
    ])
  )!.pixels;
  // Outside the circle in the corner, inside it in the middle and at the top.
  expect(pixels[0]![3]).toBe(0);
  expect(pixels[1]).toEqual([255, 0, 0, 255]);
  expect(pixels[2]![3]).toBeGreaterThan(100);
  // The selection is used up and the new layer is ready to move.
  await expect(page.getByRole("button", { name: "Select (V)" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => antPixels(page)).toBe(0);
});

test("Shift adds to the selection and Alt subtracts from it", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#00ff00");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-80, -40], [-20, 40]);
  await drag(page, [20, -40], [80, 40], "Shift");
  // A band across both, taken away.
  await drag(page, [-100, -8], [100, 8], "Alt");

  await copyLayer(page);
  const { width, height } = (await autosavedLayerPixels(page, "Layer 1", [[0, 0]]))!;
  const pixels = (
    await autosavedLayerPixels(page, "Layer 1", [
      [3, 3],
      [width - 4, height - 4],
      [Math.floor(width / 2), 3],
      [3, Math.floor(height / 2)],
    ])
  )!.pixels;
  expect(pixels[0]![3]).toBe(255);
  expect(pixels[1]![3]).toBe(255);
  // Between the two rectangles, and in the subtracted band.
  expect(pixels[2]![3]).toBe(0);
  expect(pixels[3]![3]).toBe(0);
});

test("the options bar sets how a new shape joins the selection", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#0000ff");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-80, -40], [80, 40]);
  await page.getByRole("radio", { name: "Intersect with selection" }).click();
  await drag(page, [0, -60], [120, 60]);
  await page.getByRole("radio", { name: "New selection" }).click();

  await copyLayer(page);
  const copy = (await autosavedObjects(page)).find((o) => o.name === "Layer 1")!;
  const full = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  // Only the right half of the first rectangle is left.
  const copyWidth = (copy.width as number) * (copy.scaleX as number);
  const copyHeight = (copy.height as number) * (copy.scaleY as number);
  expect(copyWidth).toBeLessThan(copyHeight * 1.2);
  expect(copyWidth).toBeLessThan(((full.width as number) * (full.scaleX as number)) / 2);
});

test("dragging inside the selection moves it; a click or Escape deselects", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-60, -30], [0, 30]);
  await copyLayer(page);
  const first = (await autosavedObjects(page)).find((o) => o.name === "Layer 1")!;

  // Leave the copy unselected so the next copy reads the photo again.
  await page.keyboard.press("Escape");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-60, -30], [0, 30]);
  await drag(page, [-30, 0], [20, 0]);
  const second = await copyLayer(page, "Layer 2");
  expect(second.left as number).toBeGreaterThan((first.left as number) + 10);
  expect(Math.abs((second.top as number) - (first.top as number))).toBeLessThan(1);
  expect(second.width).toBe(first.width);

  await page.keyboard.press("Escape");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-60, -30], [0, 30]);
  await expect.poll(() => antPixels(page)).toBeGreaterThan(0);
  const center = await canvasCenter(page);
  await page.mouse.click(center.x + 100, center.y + 80);
  await expect(page.getByText("Drag to select a region")).toBeVisible();
  await expect.poll(() => antPixels(page)).toBe(0);

  await drag(page, [-60, -30], [0, 30]);
  await expect(page.getByRole("button", { name: "Redact" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Drag to select a region")).toBeVisible();
});

test("Select menu: all, inverse, deselect and reselect", async ({ page }) => {
  await uploadSolidImage(page, 200, 100, "#ff00ff");
  await arm(page, "m", "Rectangle select");

  await page.keyboard.press("Control+a");
  await expect(page.getByRole("button", { name: "Redact" })).toBeVisible();
  await page.keyboard.press("Control+d");
  await expect(page.getByText("Drag to select a region")).toBeVisible();
  await page.keyboard.press("Control+Shift+d");
  await expect(page.getByRole("button", { name: "Redact" })).toBeVisible();
  // All of the photo, at its own resolution.
  await copyLayer(page);
  expect((await autosavedLayerPixels(page, "Layer 1", [[0, 0]]))).toMatchObject({ width: 200, height: 100 });

  // Everything but a rectangle in the middle.
  await page.keyboard.press("Escape");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-30, -20], [30, 20]);
  await chooseMenu(page, "Select", "Inverse");
  await copyLayer(page, "Layer 2");
  const inverse = (await autosavedLayerPixels(page, "Layer 2", [
    [2, 2],
    [100, 50],
  ]))!;
  expect(inverse.width).toBe(200);
  expect(inverse.pixels[0]![3]).toBe(255);
  expect(inverse.pixels[1]![3]).toBe(0);
});

test("Select › Modify feathers and expands the selection", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#000000");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-40, -40], [40, 40]);
  await copyLayer(page);
  const plainSize = (await autosavedLayerPixels(page, "Layer 1", [[0, 0]]))!;

  await page.keyboard.press("Escape");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-40, -40], [40, 40]);
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  await page.getByRole("menuitem", { name: "Modify" }).click();
  await menuItem(page, "Expand…").click();
  const dialog = page.getByRole("dialog", { name: "Expand selection" });
  await dialog.getByLabel("Expand by").fill("10");
  await dialog.getByRole("button", { name: "OK" }).click();
  await copyLayer(page, "Layer 2");
  const grown = (await autosavedLayerPixels(page, "Layer 2", [[0, 0]]))!;
  expect(grown.width).toBe(plainSize.width + 20);
  expect(grown.height).toBe(plainSize.height + 20);

  await page.keyboard.press("Escape");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-40, -40], [40, 40]);
  await page.keyboard.press("Shift+F6");
  const feather = page.getByRole("dialog", { name: "Feather selection" });
  await feather.getByLabel("Feather radius").fill("8");
  await feather.getByLabel("Feather radius").press("Enter");
  await expect(feather).toBeHidden();
  await copyLayer(page, "Layer 3");
  const soft = (await autosavedLayerPixels(page, "Layer 3", [[0, 0]]))!;
  const { width, height } = soft;
  const edge = (await autosavedLayerPixels(page, "Layer 3", [
    [Math.floor(width / 2), Math.floor(height / 2)],
    [Math.floor(width / 2), 2],
  ]))!.pixels;
  // Solid in the middle, fading out towards the edge.
  expect(edge[0]![3]).toBe(255);
  expect(edge[1]![3]).toBeGreaterThan(0);
  expect(edge[1]![3]).toBeLessThan(128);
});

test("Select › Grow, Similar and Modify › Border", async ({ page }) => {
  // Red on the left, blue on the right with a red patch in it.
  await uploadSolidImage(page, 400, 300, "#2020e0", [
    { x: 0, y: 0, width: 200, height: 300, color: "#d02020" },
    { x: 300, y: 100, width: 40, height: 40, color: "#d02020" },
  ]);
  await arm(page, "m", "Rectangle select");
  // A little square in the red half.
  await drag(page, [-150, -20], [-110, 20]);
  await chooseMenu(page, "Select", "Grow");
  await copyLayer(page);
  const grown = (await autosavedLayerPixels(page, "Layer 1", [[0, 0]]))!;
  expect(grown.width).toBe(200);
  expect(grown.height).toBe(300);

  // Similar reaches the red patch too.
  await page.keyboard.press("Escape");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-150, -20], [-110, 20]);
  await chooseMenu(page, "Select", "Similar");
  await copyLayer(page, "Layer 2");
  const similar = (await autosavedLayerPixels(page, "Layer 2", [
    [320, 120],
    [250, 120],
  ]))!;
  expect(similar.width).toBe(340);
  expect(similar.pixels[0]![3]).toBe(255);
  expect(similar.pixels[1]![3]).toBe(0);

  // Border of everything: a frame.
  await page.keyboard.press("Escape");
  await arm(page, "m", "Rectangle select");
  await page.keyboard.press("Control+a");
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  await page.getByRole("menuitem", { name: "Modify" }).click();
  await menuItem(page, "Border…").click();
  const dialog = page.getByRole("dialog", { name: "Border selection" });
  await dialog.getByLabel("Width").fill("40");
  await dialog.getByRole("button", { name: "OK" }).click();
  await copyLayer(page, "Layer 3");
  const frame = (await autosavedLayerPixels(page, "Layer 3", [
    [5, 150],
    [200, 150],
  ]))!;
  expect(frame.width).toBe(400);
  expect(frame.pixels[0]![3]).toBe(255);
  expect(frame.pixels[1]![3]).toBe(0);
});

test("Select › Color Range selects the colours clicked in its preview", async ({ page }) => {
  // Red on the left, blue on the right with a red patch in it.
  await uploadSolidImage(page, 400, 300, "#2020e0", [
    { x: 0, y: 0, width: 200, height: 300, color: "#d02020" },
    { x: 300, y: 100, width: 40, height: 40, color: "#d02020" },
  ]);
  await arm(page, "m", "Rectangle select");
  await chooseMenu(page, "Select", "Color Range…");
  const dialog = page.getByRole("dialog", { name: "Color Range" });
  const ok = dialog.getByRole("button", { name: "OK" });
  // Nothing to select before a colour is picked.
  await expect(ok).toBeDisabled();
  const preview = dialog.getByTestId("color-range-preview");
  /** Where a photo pixel is in the preview, once the dialog has stopped opening. */
  const previewPoint = async (x: number, y: number) => {
    let box = (await preview.boundingBox())!;
    await expect
      .poll(async () => {
        const previous = box;
        box = (await preview.boundingBox())!;
        return JSON.stringify(box) === JSON.stringify(previous);
      })
      .toBe(true);
    return { x: box.x + (x / 400) * box.width, y: box.y + (y / 300) * box.height };
  };
  const red = await previewPoint(100, 150);
  await page.mouse.click(red.x, red.y);
  await expect(ok).toBeEnabled();
  // The preview shows the red as selected (white), the blue not.
  const shades = await preview.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d")!;
    const pick = (x: number, y: number) =>
      context.getImageData(Math.floor((x / 400) * element.width), Math.floor((y / 300) * element.height), 1, 1).data[0];
    return [pick(100, 150), pick(250, 50)];
  });
  expect(shades).toEqual([255, 0]);
  await ok.click();
  await expect(dialog).toBeHidden();
  await copyLayer(page);
  const copied = (await autosavedLayerPixels(page, "Layer 1", [
    [100, 150],
    [320, 120],
    [250, 50],
  ]))!;
  expect(copied.width).toBe(340);
  expect(copied.pixels.map((pixel) => pixel[3])).toEqual([255, 255, 0]);

  // Inside a selection, Color Range only selects there; Shift-click adds the blue.
  await page.keyboard.press("Escape");
  await arm(page, "m", "Rectangle select");
  await page.keyboard.press("Control+a");
  await chooseMenu(page, "Select", "Color Range…");
  await expect(dialog.getByText("inside the current selection")).toBeVisible();
  const again = await previewPoint(100, 150);
  await page.mouse.click(again.x, again.y);
  const blue = await previewPoint(250, 50);
  await page.keyboard.down("Shift");
  await page.mouse.click(blue.x, blue.y);
  await page.keyboard.up("Shift");
  await dialog.getByLabel("Invert").check();
  await ok.click();
  await expect(dialog).toBeHidden();
  // Every colour sampled, inverted: nothing.
  await expect(page.getByText("No pixels matched")).toBeVisible();
});

/** Where a pixel of the photo is on screen. */
async function photoPoint(page: Page, x: number, y: number) {
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const box = (await page.locator("canvas.upper-canvas").boundingBox())!;
  const scale = photo.scaleX as number;
  // The fitted view shows the scene at 100%.
  return {
    x: box.x + (photo.left as number) + (x + 0.5) * scale,
    y: box.y + (photo.top as number) + (y + 0.5) * scale,
  };
}

test("the lasso selects the area dragged around", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#123456");
  await arm(page, "l", "Lasso");
  const center = await canvasCenter(page);
  const corners: [number, number][] = [
    [-60, 50],
    [0, -60],
    [60, 50],
  ];
  await page.mouse.move(center.x + corners[0]![0], center.y + corners[0]![1]);
  await page.mouse.down();
  for (const [dx, dy] of [...corners.slice(1), corners[0]!]) {
    await page.mouse.move(center.x + dx, center.y + dy, { steps: 10 });
  }
  await page.mouse.up();

  await copyLayer(page);
  const { width, height } = (await autosavedLayerPixels(page, "Layer 1", [[0, 0]]))!;
  const pixels = (await autosavedLayerPixels(page, "Layer 1", [
    [2, 2],
    [Math.floor(width / 2), height - 4],
  ]))!.pixels;
  expect(pixels[0]![3]).toBe(0);
  expect(pixels[1]).toEqual([0x12, 0x34, 0x56, 255]);
});

test("the polygonal lasso selects corner by corner", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  await arm(page, "l", "Lasso");
  await arm(page, "Shift+L", "Polygonal lasso");
  const center = await canvasCenter(page);
  const click = (dx: number, dy: number) => page.mouse.click(center.x + dx, center.y + dy);

  // A diamond, with a stray corner taken back on the way.
  await click(0, -50);
  await click(50, 0);
  await click(90, 90);
  await page.keyboard.press("Backspace");
  await click(0, 50);
  await click(-50, 0);
  await expect(page.getByRole("button", { name: "Close shape" })).toBeVisible();
  await click(0, -50);
  await expect(page.getByRole("button", { name: "Redact" })).toBeVisible();
  // Backspace was the polygon's, not a layer delete.
  expect((await autosavedObjects(page)).some((o) => o.name === "Background")).toBe(true);

  await copyLayer(page);
  const { width, height } = (await autosavedLayerPixels(page, "Layer 1", [[0, 0]]))!;
  expect(Math.abs(width - height)).toBeLessThanOrEqual(2);
  const pixels = (await autosavedLayerPixels(page, "Layer 1", [
    [3, 3],
    [Math.floor(width / 2), Math.floor(height / 2)],
  ]))!.pixels;
  expect(pixels[0]![3]).toBe(0);
  expect(pixels[1]![3]).toBe(255);

  // Enter closes too; Escape drops an unfinished shape.
  await page.keyboard.press("Escape");
  await arm(page, "l", "Polygonal lasso");
  await click(-40, -40);
  await click(40, -40);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Close shape" })).toHaveCount(0);
  await click(-40, -40);
  await click(40, -40);
  await click(40, 40);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Redact" })).toBeVisible();
});

test("the magic wand selects similar colours, connected or everywhere", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff", [
    { x: 40, y: 40, width: 120, height: 90, color: "#ff0000" },
    { x: 250, y: 150, width: 100, height: 100, color: "#ff0000" },
  ]);
  await arm(page, "w", "Magic wand");
  const inRed = await photoPoint(page, 100, 80);
  await page.mouse.click(inRed.x, inRed.y);
  await copyLayer(page);
  expect(await autosavedLayerPixels(page, "Layer 1", [[0, 0]])).toMatchObject({ width: 120, height: 90 });

  await page.keyboard.press("Escape");
  await arm(page, "w", "Magic wand");
  await page.getByRole("button", { name: "Contiguous" }).click();
  await page.mouse.click(inRed.x, inRed.y);
  // Shift-click adds the white too: everything.
  const inWhite = await photoPoint(page, 10, 10);
  await page.keyboard.down("Shift");
  await page.mouse.click(inWhite.x, inWhite.y);
  await page.keyboard.up("Shift");
  await copyLayer(page, "Layer 2");
  expect(await autosavedLayerPixels(page, "Layer 2", [[0, 0]])).toMatchObject({ width: 400, height: 300 });

  // Both red areas, and nothing between them.
  await page.keyboard.press("Escape");
  await arm(page, "w", "Magic wand");
  await page.mouse.click(inRed.x, inRed.y);
  await copyLayer(page, "Layer 3");
  const both = (await autosavedLayerPixels(page, "Layer 3", [
    [5, 5],
    [150, 5],
  ]))!;
  expect(both).toMatchObject({ width: 310, height: 210 });
  expect(both.pixels[0]).toEqual([255, 0, 0, 255]);
  expect(both.pixels[1]![3]).toBe(0);
});

test("Select subject is offered while nothing is selected", async ({ page }) => {
  await uploadSolidImage(page, 200, 100);
  await arm(page, "m", "Rectangle select");
  await expect(page.getByRole("button", { name: "Select subject" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  await expect(menuItem(page, "Subject")).toBeEnabled();
  await page.keyboard.press("Escape");
});

test("Select subject selects the subject with the on-device model", async ({ page }) => {
  test.skip(process.env.RUN_AI_E2E !== "1", "Set RUN_AI_E2E=1 for the network- and compute-heavy model check");
  test.setTimeout(5 * 60_000);
  // The sample photo: mountains and a sun under an empty sky.
  await page.getByText("Try a sample photo").click();
  await expect.poll(async () => (await autosavedObjects(page)).length).toBeGreaterThan(0);
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;

  await chooseMenu(page, "Select", "Subject");
  await expect(page.getByRole("button", { name: "Redact" })).toBeVisible({ timeout: 4 * 60_000 });
  // The selection's actions are at hand.
  await expect(page.getByRole("button", { name: "Rectangle select (M)" })).toHaveAttribute("aria-pressed", "true");
  await copyLayer(page);
  const copy = (await autosavedLayerPixels(page, "Layer 1", [[0, 0]]))!;
  // The landscape, without the sky above it.
  expect(copy.width).toBeGreaterThan((photo.width as number) * 0.8);
  expect(copy.height).toBeLessThan((photo.height as number) * 0.9);
  const bottom = (await autosavedLayerPixels(page, "Layer 1", [[Math.floor(copy.width / 2), copy.height - 40]]))!;
  expect(bottom.pixels[0]![3]).toBeGreaterThan(200);
});

test("painting, filling and gradients stay inside the selection", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  await arm(page, "m", "Rectangle select");
  // The left half of a box around the middle of the photo.
  await drag(page, [-60, -40], [0, 40]);
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const scale = photo.scaleX as number;
  const inside = Math.round(200 - 15 / scale);
  const outside = Math.round(200 + 15 / scale);

  // A brush stroke right across the middle.
  await arm(page, "b", "Brush");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - 100, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 100, center.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[inside, 150]]))?.pixels[0]?.[3])
    .toBe(255);
  const stroke = (await autosavedLayerPixels(page, "Layer 1", [
    [outside, 150],
    [Math.round(200 - 80 / scale), 150],
  ]))!.pixels;
  expect(stroke[0]![3]).toBe(0);
  expect(stroke[1]![3]).toBe(0);

  // The bucket fills nothing outside the selection, and only the selection inside it.
  await arm(page, "g", "Paint bucket");
  await page.mouse.click(center.x + 100, center.y + 20);
  await page.waitForTimeout(500);
  expect((await autosavedLayerPixels(page, "Layer 1", [[outside, 170]]))!.pixels[0]![3]).toBe(0);
  await page.mouse.click(center.x - 30, center.y + 30);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[inside, 170]]))?.pixels[0]?.[3])
    .toBe(255);
  expect((await autosavedLayerPixels(page, "Layer 1", [[outside, 170]]))!.pixels[0]![3]).toBe(0);

  // A gradient across the photo lands in the selection only.
  await arm(page, "Shift+G", "Gradient");
  await page.mouse.move(center.x - 150, center.y - 100);
  await page.mouse.down();
  await page.mouse.move(center.x + 150, center.y - 100, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[inside, 130]]))?.pixels[0]?.[3])
    .toBe(255);
  const after = (await autosavedLayerPixels(page, "Layer 1", [
    [outside, 130],
    [inside, 50],
  ]))!.pixels;
  expect(after[0]![3]).toBe(0);
  expect(after[1]![3]).toBe(0);
});

/** The photo's pixels as autosaved. */
const photoPixels = (page: Page, points: [number, number][]) => autosavedLayerPixels(page, "Background", points);

test("Delete clears the selected pixels; Ctrl+J and Ctrl+Shift+J copy or cut them", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ff0000");
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const scale = photo.scaleX as number;
  const inside = Math.round(200 - 30 / scale);
  const outside = Math.round(200 + 30 / scale);
  const selectLeftBox = async () => {
    await arm(page, "m", "Rectangle select");
    await drag(page, [-60, -40], [0, 40]);
    await expect(page.getByRole("button", { name: "Redact" })).toBeVisible();
  };

  await selectLeftBox();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await photoPixels(page, [[inside, 150]]))?.pixels[0]?.[3]).toBe(0);
  expect((await photoPixels(page, [[outside, 150]]))!.pixels[0]![3]).toBe(255);
  // The photo itself stays, and one undo brings the pixels back.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await photoPixels(page, [[inside, 150]]))?.pixels[0]?.[3]).toBe(255);

  // Ctrl+J: a copy on a new layer, the photo untouched.
  await page.keyboard.press("Control+j");
  await expect.poll(async () => (await autosavedObjects(page)).some((o) => o.name === "Layer 1")).toBe(true);
  expect((await photoPixels(page, [[inside, 150]]))!.pixels[0]![3]).toBe(255);
  await expect(page.getByText("Drag to select a region")).toBeVisible();

  // Ctrl+Shift+J from the photo: the pixels move to a new layer.
  await page.getByRole("button", { name: "Select (V)" }).click();
  await page.keyboard.press("Escape");
  await selectLeftBox();
  await page.keyboard.press("Control+Shift+j");
  await expect.poll(async () => (await autosavedObjects(page)).some((o) => o.name === "Layer 2")).toBe(true);
  await expect.poll(async () => (await photoPixels(page, [[inside, 150]]))?.pixels[0]?.[3]).toBe(0);
  const cut = (await autosavedLayerPixels(page, "Layer 2", [[2, 2]]))!;
  expect(cut.pixels[0]).toEqual([255, 0, 0, 255]);
});

test("copying a selection pastes its pixels as a new layer", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#0000ff");
  await arm(page, "m", "Rectangle select");
  await drag(page, [-40, -40], [40, 40]);
  await page.keyboard.press("Control+c");
  await expect(page.getByText("Selection copied")).toBeVisible();
  const images = async () => (await autosavedObjects(page)).filter((o) => o.type === "Image");
  await page.evaluate(() => {
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: new DataTransfer() }));
  });
  await expect.poll(async () => (await images()).length).toBe(2);
  const pasted = (await images())[1]!;
  expect(pasted.name).toBe("Layer 1");
  const full = (await images())[0]!;
  expect((pasted.width as number) * (pasted.scaleX as number)).toBeLessThan(
    ((full.width as number) * (full.scaleX as number)) / 3
  );
});

test("Edit › Fill and Stroke paint the selection on a new layer", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const scale = photo.scaleX as number;
  await arm(page, "m", "Rectangle select");
  await drag(page, [-60, -40], [60, 40]);

  // Alt+Backspace fills with the foreground colour, on a new layer.
  await page.keyboard.press("Alt+Backspace");
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[200, 150]]))?.pixels[0])
    .toEqual([168, 85, 247, 255]);
  expect((await autosavedLayerPixels(page, "Layer 1", [[200, Math.round(150 - 60 / scale)]]))!.pixels[0]![3]).toBe(0);

  // A 6px stroke inside the edge of the same selection, on the same layer,
  // in the background colour after swapping.
  await page.keyboard.press("x");
  await chooseMenu(page, "Edit", "Stroke…");
  const dialog = page.getByRole("dialog", { name: "Stroke" });
  await dialog.getByLabel("Width").fill("6");
  await dialog.getByRole("radio", { name: "Inside" }).click();
  await dialog.getByRole("button", { name: "OK" }).click();
  const top = Math.round(150 - 40 / scale);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[200, top + 2]]))?.pixels[0])
    .toEqual([255, 255, 255, 255]);
  expect((await autosavedLayerPixels(page, "Layer 1", [[200, 150]]))!.pixels[0]).toEqual([168, 85, 247, 255]);
});

/** Overlay pixels tinted red (Quick Mask), or the grey marching ants. */
const overlayPixels = (page: Page, red: boolean) =>
  page.evaluate((red) => {
    const overlay = document.querySelector<HTMLCanvasElement>('[data-testid="selection-overlay"]')!;
    const data = overlay.getContext("2d")!.getImageData(0, 0, overlay.width, overlay.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3]! === 0) continue;
      const tinted = data[index]! > 200 && data[index + 1]! < 40;
      if (tinted === red) count += 1;
    }
    return count;
  }, red);
const redPixels = (page: Page) => overlayPixels(page, true);
const antsOnly = (page: Page) => overlayPixels(page, false);

test("Quick Mask: paint the selection with the brush, then turn it back into a selection", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080");
  await settle(page);
  const chip = page.getByRole("button", { name: "Leave Quick Mask" });

  // A rectangle, then Q: red over the rest, no ants.
  await arm(page, "m", "Rectangle select");
  await drag(page, [-60, -40], [60, 40]);
  await expect.poll(() => antsOnly(page)).toBeGreaterThan(0);
  await page.keyboard.press("q");
  await expect(chip).toBeVisible();
  await expect.poll(() => antsOnly(page)).toBe(0);
  const outside = await redPixels(page);
  expect(outside).toBeGreaterThan(1000);
  // Q again without painting: the same rectangle.
  await page.keyboard.press("q");
  await expect(chip).toHaveCount(0);
  await expect.poll(() => redPixels(page)).toBe(0);
  await expect.poll(() => antsOnly(page)).toBeGreaterThan(0);
  await page.keyboard.press("Control+d");

  // With nothing selected, Quick Mask starts clear; black paints red.
  await page.keyboard.press("q");
  await expect(chip).toBeVisible();
  await expect.poll(() => redPixels(page)).toBe(0);
  await arm(page, "b", "Brush");
  await page.keyboard.press("d");
  await drag(page, [-80, 0], [80, 0]);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(200);
  const painted = await redPixels(page);
  expect(painted).toBeLessThan(outside);
  // The stroke went on the selection, not on a new layer.
  expect((await autosavedObjects(page)).map((object) => object.name)).not.toContain("Layer 1");

  // The white background colour (the eraser) selects again.
  await arm(page, "e", "Eraser");
  await drag(page, [-80, 0], [0, 0]);
  await expect.poll(() => redPixels(page)).toBeLessThan(painted);

  // Leaving it: everything but the rest of the stroke is selected.
  await page.keyboard.press("q");
  await expect(chip).toHaveCount(0);
  await expect.poll(() => antsOnly(page)).toBeGreaterThan(0);
  await page.keyboard.press("Control+j");
  await expect.poll(async () => (await autosavedObjects(page)).some((o) => o.name === "Layer 1")).toBe(true);
  const copied = (await autosavedLayerPixels(page, "Layer 1", [
    [200, 20],
    [250, 150],
    [150, 150],
  ]))!;
  expect(copied.width).toBe(400);
  expect(copied.pixels[0]![3]).toBe(255);
  expect(copied.pixels[1]![3]).toBeLessThan(40);
  expect(copied.pixels[2]![3]).toBe(255);
});

test("Select and Mask fits a rough selection to the picture's edge", async ({ page }) => {
  // A dark red square, 100 pixels wide, in the middle of a white photo.
  await uploadSolidImage(page, 400, 300, "#ffffff", [{ x: 150, y: 100, width: 100, height: 100, color: "#8b1010" }]);
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const scale = photo.scaleX as number;
  await arm(page, "m", "Rectangle select");
  // A selection 20 pixels too large all round.
  await drag(page, [-70 * scale, -70 * scale], [70 * scale, 70 * scale]);

  await page.keyboard.press("Control+Alt+r");
  const dialog = page.getByRole("dialog", { name: "Select and Mask" });
  await expect(dialog).toBeVisible();
  // The overlay view tints what is not selected red; the black-and-white view shows the mask.
  await dialog.getByRole("radio", { name: "Black & White" }).check();
  const preview = dialog.getByTestId("select-and-mask-preview");
  const corner = () =>
    preview.evaluate((element: HTMLCanvasElement) => {
      // The selection's corner, outside the square but inside the marquee.
      const x = Math.round(element.width * (135 / 400));
      const y = Math.round(element.height * (85 / 300));
      return element.getContext("2d")!.getImageData(x, y, 1, 1).data[0];
    });
  await expect.poll(corner).toBe(255);

  await dialog.getByLabel("Radius value").fill("30");
  // The preview follows: the white margin drops out of the selection.
  await expect.poll(corner).toBeLessThan(40);
  await dialog.getByLabel("Output to").selectOption("New Layer");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();

  // The copy holds the square alone, not the marquee's white margin.
  await expect.poll(async () => (await autosavedObjects(page)).some((o) => o.name === "Layer 1")).toBe(true);
  const layer = (await autosavedLayerPixels(page, "Layer 1", []))!;
  expect(layer.width).toBeGreaterThanOrEqual(98);
  expect(layer.width).toBeLessThanOrEqual(108);
  const middle = Math.floor(layer.width / 2);
  expect((await autosavedLayerPixels(page, "Layer 1", [[middle, middle]]))!.pixels[0]).toEqual([139, 16, 16, 255]);
  // The selection became the layer.
  await expect(page.getByRole("button", { name: "New layer", exact: true })).toHaveCount(0);
});

test("Select and Mask's Refine Edge brush, out to a layer mask", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff", [{ x: 150, y: 100, width: 100, height: 100, color: "#8b1010" }]);
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const scale = photo.scaleX as number;
  await arm(page, "m", "Rectangle select");
  await drag(page, [-70 * scale, -70 * scale], [70 * scale, 70 * scale]);
  await chooseMenu(page, "Select", "Select and Mask…");
  const dialog = page.getByRole("dialog", { name: "Select and Mask" });
  await dialog.getByRole("radio", { name: "Black & White" }).check();
  await dialog.getByLabel("Radius value").fill("0");
  const preview = dialog.getByTestId("select-and-mask-preview");
  const at = (fx: number, fy: number) =>
    preview.evaluate(
      (element: HTMLCanvasElement, [fx, fy]) =>
        element.getContext("2d")!.getImageData(Math.round(element.width * fx), Math.round(element.height * fy), 1, 1).data[0],
      [fx, fy] as const
    );
  await expect.poll(() => at(140 / 400, 150 / 300)).toBe(255);

  // Brush down the left side of the margin: only there the selection follows the square.
  const box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + box.width * (140 / 400), box.y + box.height * (110 / 300));
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (140 / 400), box.y + box.height * (190 / 300), { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => at(140 / 400, 150 / 300)).toBeLessThan(40);
  // The right side of the margin was not brushed.
  expect(await at(260 / 400, 150 / 300)).toBe(255);

  await dialog.getByLabel("Output to").selectOption("Layer Mask");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => typeof ((await autosavedObjects(page)).find((o) => o.name === "Background")?.layerMask as { src?: string } | undefined)?.src)
    .toBe("string");
});
