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
