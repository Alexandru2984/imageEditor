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
