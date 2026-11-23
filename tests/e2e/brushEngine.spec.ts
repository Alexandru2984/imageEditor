import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, chooseMenu, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

const SIZE = { width: 400, height: 300 };

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
    return { left: box.left + left / ratio, top: box.top + top / ratio, width: (right + 1 - left) / ratio, height: (bottom + 1 - top) / ratio };
  });
}

/** Screen position of a photo pixel's centre. */
async function onPhoto(page: Page, x: number, y: number) {
  const box = await photoBox(page);
  return { x: box.left + ((x + 0.5) / SIZE.width) * box.width, y: box.top + ((y + 0.5) / SIZE.height) * box.height };
}

async function strokeOnPhoto(page: Page, from: [number, number], to: [number, number]) {
  const start = await onPhoto(page, ...from);
  const end = await onPhoto(page, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();
}

const alphaAt = async (page: Page, points: [number, number][]) =>
  (await autosavedLayerPixels(page, "Layer 1", points))?.pixels.map((pixel) => pixel[3]!);

async function armBrush(page: Page) {
  await page.keyboard.press("b");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Brush");
  await settle(page);
}

/** Set a Brush Settings slider to its least (Home) or most (End). */
async function slide(page: Page, name: string, key: "Home" | "End") {
  const slider = page.getByRole("region", { name: "Brush settings" }).getByRole("slider", { name, exact: true });
  await slider.focus();
  await page.keyboard.press(key);
}

test("Brush Settings: spacing leaves gaps between dabs and roundness flattens the tip", async ({ page }) => {
  await uploadSolidImage(page, SIZE.width, SIZE.height, "#ffffff");
  await armBrush(page);
  const options = page.getByRole("group", { name: "Tool options" });
  await options.getByRole("button", { name: "Brush settings" }).click();
  const panel = page.getByRole("region", { name: "Brush settings" });
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("brush-preview")).toBeVisible();
  // Also from the View menu.
  const viewMenu = async () => {
    await page.getByRole("menuitem", { name: "View", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "Brush settings" }).click();
    // A checkbox item leaves the menu open.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  };
  await viewMenu();
  await expect(panel).toHaveCount(0);
  await viewMenu();
  await expect(panel).toBeVisible();

  // The most spacing: dabs ten tips apart, nothing between them.
  await slide(page, "Spacing", "End");
  await expect(panel).toContainText("1000%");
  await strokeOnPhoto(page, [180, 60], [380, 60]);
  await expect.poll(() => alphaAt(page, [[180, 60]])).toEqual([255]);
  const gaps = await alphaAt(page, [
    [230, 60],
    [280, 60],
    [330, 60],
  ]);
  expect(gaps).toEqual([0, 0, 0]);

  // Normal spacing and the flattest tip, lying flat: a thin line.
  await slide(page, "Spacing", "Home");
  await slide(page, "Roundness", "Home");
  await strokeOnPhoto(page, [180, 200], [380, 200]);
  await expect.poll(async () => (await alphaAt(page, [[280, 200]]))?.[0]).toBeGreaterThan(200);
  // The tip is 30 pixels long but one high.
  expect(await alphaAt(page, [[280, 196], [280, 204]])).toEqual([0, 0]);
});

test("symmetry paints mirrored copies about the middle of the document", async ({ page }) => {
  await uploadSolidImage(page, SIZE.width, SIZE.height, "#ffffff");
  await armBrush(page);
  const options = page.getByRole("group", { name: "Tool options" });
  await options.getByRole("combobox", { name: "Symmetry" }).selectOption("vertical");
  await strokeOnPhoto(page, [240, 60], [300, 60]);
  // The stroke, and its mirror on the other side of x = 200.
  await expect.poll(() => alphaAt(page, [[270, 60], [130, 60]])).toEqual([255, 255]);
  expect(await alphaAt(page, [[270, 240], [130, 240]])).toEqual([0, 0]);

  // Dual axis: four copies, one in each quarter.
  await options.getByRole("combobox", { name: "Symmetry" }).selectOption("dual");
  await strokeOnPhoto(page, [330, 100], [340, 100]);
  await expect.poll(() => alphaAt(page, [[335, 100], [65, 100], [335, 200], [65, 200]])).toEqual([255, 255, 255, 255]);

  // Radial: segments turn about the middle.
  await options.getByRole("combobox", { name: "Symmetry" }).selectOption("radial");
  await options.getByRole("spinbutton", { name: "Symmetry segments" }).fill("4");
  await strokeOnPhoto(page, [200, 30], [205, 30]);
  // A quarter turn of (202, 30) about (200, 150) is (320, 152).
  await expect.poll(async () => (await alphaAt(page, [[320, 150]]))?.[0]).toBe(255);
});

test("Define Brush Preset makes a brush from the selection, kept with the presets", async ({ page }) => {
  // A dark square on white.
  await uploadSolidImage(page, SIZE.width, SIZE.height, "#ffffff", [{ x: 20, y: 20, width: 40, height: 40, color: "#000000" }]);
  await page.keyboard.press("m");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Rectangle select");
  await strokeOnPhoto(page, [10, 10], [70, 70]);
  await chooseMenu(page, "Edit", "Define brush preset…");
  const dialog = page.getByRole("dialog", { name: "Define brush preset" });
  await expect(dialog.getByTestId("brush-tip-preview")).toBeVisible();
  await expect(dialog).toContainText("40 px");
  await dialog.getByLabel("Brush name").fill("Square");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("Defined the brush “Square”")).toBeVisible();
  // It is the brush in hand.
  const options = page.getByRole("group", { name: "Tool options" });
  await expect(options).toContainText("Brush");
  await expect(options).toContainText("40px");

  // A click paints a square: its corners too, which a round tip would miss.
  await page.keyboard.press("Control+d");
  const at = await onPhoto(page, 300, 200);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => alphaAt(page, [[300, 200], [317, 217], [283, 183]])).toEqual([255, 255, 255]);
  expect(await alphaAt(page, [[300, 224]])).toEqual([0]);

  // Kept in this browser, and listed with the presets.
  await page.reload();
  await uploadSolidImage(page, SIZE.width, SIZE.height, "#ffffff");
  await armBrush(page);
  await options.getByRole("button", { name: "Brush presets" }).click();
  const list = page.getByRole("listbox", { name: "Brush presets" });
  await expect(list.getByRole("option", { name: /Square/ })).toBeVisible();
  // A built-in one sets the brush.
  await list.getByRole("option", { name: /Calligraphy/ }).click();
  await expect(options).toContainText("24px");
  // The brush as it is set can be saved too, and presets of one's own deleted.
  await options.getByRole("button", { name: "Brush presets" }).click();
  await page.getByLabel("New preset name").fill("My calligraphy");
  await page.getByRole("button", { name: "Save brush" }).click();
  await expect(list.getByRole("option", { name: /My calligraphy/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Delete the brush preset Square" }).click();
  await expect(list.getByRole("option", { name: /Square/ })).toHaveCount(0);
});
