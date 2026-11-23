import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, autosavedObjects, canvasCenter, chooseMenu, uploadSolidImage } from "./helpers";
import { BLACK, dragRow, GREY, paintedLayer, shown, stack, WHITE } from "./layerHelpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

const row = (page: Page, name: string) => page.getByRole("group", { name: `${name} layer` });
const groupRow = (page: Page, name: string) => page.getByRole("group", { name: `${name} group` });
const selectedRows = (page: Page) => page.locator('[data-layer-id][aria-current="true"]');
const visibility = async (page: Page) =>
  Object.fromEntries((await autosavedObjects(page)).map((object) => [String(object.name), object.visible !== false]));

/** A grey photo with a black square at the left (Layer 1) and a white one at the right (Layer 2). */
async function twoLayers(page: Page) {
  await uploadSolidImage(page, 400, 300, "#808080");
  await paintedLayer(page, [-100, -50], [-20, 50], "foreground");
  await paintedLayer(page, [20, -50], [100, 50], "background");
  await page.getByRole("tab", { name: "Layers" }).click();
}

test("rows select as in Photoshop: Shift+click a range, Ctrl+click one in or out, and Ctrl+G groups what is picked", async ({
  page,
}) => {
  await twoLayers(page);
  await paintedLayer(page, [-40, 60], [40, 90], "foreground");

  await row(page, "Layer 1").click();
  await row(page, "Layer 3").click({ modifiers: ["Shift"] });
  await expect(selectedRows(page)).toHaveCount(3);
  await row(page, "Layer 2").click({ modifiers: ["Control"] });
  await expect(selectedRows(page)).toHaveCount(2);
  await expect(row(page, "Layer 2")).not.toHaveAttribute("aria-current", "true");

  await page.keyboard.press("Control+g");
  await expect.poll(() => stack(page)).toEqual(["Background", "Layer 2", "]", "Layer 1", "Layer 3", "[Group 1"]);
  await expect(selectedRows(page)).toHaveCount(1);
  await expect(groupRow(page, "Group 1")).toHaveAttribute("aria-current", "true");

  // A group and a layer together go into a new group.
  await row(page, "Layer 2").click({ modifiers: ["Control"] });
  await expect(selectedRows(page)).toHaveCount(2);
  await page.keyboard.press("Control+g");
  await expect
    .poll(() => stack(page))
    .toEqual(["Background", "]", "Layer 2", "]", "Layer 1", "Layer 3", "[Group 1", "[Group 2"]);
});

test("dragging a row restacks it, into a group and out of it, one undo step each", async ({ page }) => {
  await twoLayers(page);
  await row(page, "Layer 2").click();
  await page.keyboard.press("Control+g");
  await expect.poll(() => stack(page)).toEqual(["Background", "Layer 1", "]", "Layer 2", "[Group 1"]);

  // Onto the group: inside it, at its top.
  await dragRow(page, row(page, "Layer 1"), groupRow(page, "Group 1"), "middle");
  await expect.poll(() => stack(page)).toEqual(["Background", "]", "Layer 2", "Layer 1", "[Group 1"]);
  await expect(row(page, "Layer 1")).toHaveAttribute("aria-current", "true");

  // Above the group: out of it, on top of everything.
  await dragRow(page, row(page, "Layer 1"), groupRow(page, "Group 1"), "top");
  await expect.poll(() => stack(page)).toEqual(["Background", "]", "Layer 2", "[Group 1", "Layer 1"]);

  // Nothing goes below the photo: dropped there, it lands just above it.
  await dragRow(page, row(page, "Layer 1"), row(page, "Background"), "bottom");
  await expect.poll(() => stack(page)).toEqual(["Background", "Layer 1", "]", "Layer 2", "[Group 1"]);

  await page.keyboard.press("Control+z");
  await expect.poll(() => stack(page)).toEqual(["Background", "]", "Layer 2", "[Group 1", "Layer 1"]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => stack(page)).toEqual(["Background", "]", "Layer 2", "Layer 1", "[Group 1"]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => stack(page)).toEqual(["Background", "Layer 1", "]", "Layer 2", "[Group 1"]);
});

test("Alt+click on an eye shows that layer alone and again brings the rest back; a drag across eyes hides several", async ({
  page,
}) => {
  await twoLayers(page);
  await row(page, "Layer 1").getByRole("button", { name: "Hide Layer 1" }).click({ modifiers: ["Alt"] });
  await expect.poll(() => visibility(page)).toEqual({ Background: false, "Layer 1": true, "Layer 2": false });
  await expect.poll(() => shown(page, [-60, 0])).toEqual(BLACK);

  await row(page, "Layer 1").getByRole("button", { name: "Hide Layer 1" }).click({ modifiers: ["Alt"] });
  await expect.poll(() => visibility(page)).toEqual({ Background: true, "Layer 1": true, "Layer 2": true });
  await expect.poll(() => shown(page, [60, 0])).toEqual(WHITE);

  // Press on the top eye and sweep down: both layers hide, in one step.
  const top = (await page.getByRole("button", { name: "Hide Layer 2" }).boundingBox())!;
  const next = (await page.getByRole("button", { name: "Hide Layer 1" }).boundingBox())!;
  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => visibility(page)).toEqual({ Background: true, "Layer 1": false, "Layer 2": false });
  await expect.poll(() => shown(page, [-60, 0])).toEqual(GREY);
  await page.keyboard.press("Control+z");
  await expect.poll(() => visibility(page)).toEqual({ Background: true, "Layer 1": true, "Layer 2": true });
});

test("Ctrl+click on a thumbnail selects the layer's pixels", async ({ page }) => {
  await twoLayers(page);
  await row(page, "Layer 1").locator("[data-thumbnail]").click({ modifiers: ["Control"] });
  // Copy the photo through that selection onto a layer of its own.
  await row(page, "Background").click();
  const before = await stack(page);
  await page.keyboard.press("Control+j");
  await expect.poll(async () => (await stack(page)).length).toBe(before.length + 1);
  const name = (await stack(page)).find((layer) => !before.includes(layer))!;
  // Cut to the square's size (46×56 document pixels), all of it photo.
  const { width, height } = (await autosavedLayerPixels(page, name, [[0, 0]]))!;
  expect(width).toBeGreaterThan(40);
  expect(width).toBeLessThan(52);
  expect(height).toBeGreaterThan(50);
  expect(height).toBeLessThan(62);
  const copy = await autosavedLayerPixels(page, name, [
    [Math.floor(width / 2), Math.floor(height / 2)],
    [2, 2],
  ]);
  expect(copy!.pixels).toEqual([
    [128, 128, 128, 255],
    [128, 128, 128, 255],
  ]);
});

test("the right-click menu and the buttons below the list act on the row", async ({ page }) => {
  await twoLayers(page);

  await row(page, "Layer 1").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Layer options" });
  await expect(menu).toBeVisible();
  await expect(row(page, "Layer 1")).toHaveAttribute("aria-current", "true");
  await menu.getByRole("menuitem", { name: /Rename/ }).click();
  await page.getByRole("textbox", { name: "Rename Layer 1" }).fill("Sky");
  await page.keyboard.press("Enter");
  await expect.poll(() => stack(page)).toEqual(["Background", "Sky", "Layer 2"]);

  await row(page, "Sky").click({ button: "right" });
  await menu.getByRole("menuitem", { name: /Duplicate layer/ }).click();
  await expect.poll(async () => (await stack(page)).length).toBe(4);

  // New group, from the button below the list, then dragged to the trash.
  await page.getByRole("button", { name: "Create a new group" }).click();
  await expect.poll(async () => (await stack(page)).filter((name) => name.startsWith("[")).length).toBe(1);
  await dragRow(page, groupRow(page, "Group 1"), page.getByRole("button", { name: "Delete layer" }), "middle");
  await expect.poll(async () => (await stack(page)).filter((name) => name.startsWith("[")).length).toBe(0);

  // The trash deletes the selected layer; a locked one stays.
  await row(page, "Layer 2").click();
  await page.getByRole("button", { name: "Delete layer" }).click();
  await expect.poll(() => stack(page)).not.toContain("Layer 2");
  await row(page, "Sky").click();
  await page.getByRole("button", { name: "Lock Sky", exact: true }).click();
  await page.getByRole("button", { name: "Delete layer" }).click();
  await expect(page.getByText("Unlock the layers first")).toBeVisible();
  await expect.poll(() => stack(page)).toContain("Sky");
});

test("the list filters by kind and name, and a layer's effects turn on and off from it", async ({ page }) => {
  await twoLayers(page);
  await row(page, "Layer 2").click();
  await page.keyboard.press("Control+g");

  await page.getByRole("searchbox", { name: "Filter layers by name" }).fill("1");
  await expect(page.locator("[data-layer-id]")).toHaveText([/Group 1/, /Layer 1/]);
  await page.getByRole("searchbox", { name: "Filter layers by name" }).fill("");
  await page.getByRole("combobox", { name: "Filter layers by kind" }).selectOption("group");
  await expect(page.locator("[data-layer-id]")).toHaveText([/Group 1/]);
  await page.getByRole("combobox", { name: "Filter layers by kind" }).selectOption("all");
  await expect(page.locator("[data-layer-id]")).toHaveCount(4);

  // A colour overlay on Layer 1, then off from the panel.
  await row(page, "Layer 1").click();
  await chooseMenu(page, "Layer", "Layer style…");
  const dialog = page.getByRole("dialog", { name: "Layer style" });
  await dialog.getByLabel("Colour overlay").check();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect.poll(async () => (await shown(page, [-60, 0]))[0]).toBeGreaterThan(200);
  await page.getByRole("button", { name: "Show the effects of Layer 1" }).click();
  await page.getByRole("button", { name: "Hide the colour overlay of Layer 1" }).click();
  await expect
    .poll(async () => ((await autosavedObjects(page)).find((object) => object.name === "Layer 1")?.layerStyle as Record<string, { enabled: boolean }>)?.colorOverlay?.enabled)
    .toBe(false);
  await expect.poll(() => shown(page, [-60, 0])).toEqual(BLACK);
  await expect(page.getByRole("button", { name: "Show the colour overlay of Layer 1" })).toBeVisible();
});

/** A tool by its key, once its options show. */
async function arm(page: Page, key: string, name: string) {
  await page.keyboard.press(key);
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText(name);
}

/** A stroke across the canvas, at `dy` from its centre, between two offsets. */
async function brushStroke(page: Page, from: number, to: number, dy = 0) {
  const center = await canvasCenter(page);
  await page.mouse.move(center.x + from, center.y + dy);
  await page.mouse.down();
  await page.mouse.move(center.x + to, center.y + dy, { steps: 12 });
  await page.mouse.up();
}

const layerOf = async (page: Page, name: string) => (await autosavedObjects(page)).find((object) => object.name === name)!;

test("Fill fades a layer's own pixels but not its effects", async ({ page }) => {
  await twoLayers(page);
  await row(page, "Layer 2").click();
  await chooseMenu(page, "Layer", "Layer style…");
  const dialog = page.getByRole("dialog", { name: "Layer style" });
  await dialog.getByLabel("Stroke", { exact: true }).check();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  // The white square, and its black stroke just outside its left edge.
  await expect.poll(() => shown(page, [60, 0])).toEqual(WHITE);
  await expect.poll(async () => (await shown(page, [17, 0]))[0]).toBeLessThan(40);

  const fill = page.getByRole("slider", { name: "Layer fill" });
  await fill.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await layerOf(page, "Layer 2")).__fill).toBe(0);
  await expect.poll(() => shown(page, [60, 0])).toEqual(GREY);
  expect((await shown(page, [17, 0]))[0]).toBeLessThan(40);
  // Opacity still fades everything.
  expect((await layerOf(page, "Layer 2")).opacity).toBe(1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => shown(page, [60, 0])).toEqual(WHITE);
});

test("Lock transparent pixels keeps the brush and the eraser inside the layer's pixels", async ({ page }) => {
  await twoLayers(page);
  await row(page, "Layer 1").click();
  await page.getByRole("button", { name: "Lock transparent pixels" }).click();
  await expect.poll(async () => (await layerOf(page, "Layer 1")).__lockTransparency).toBe(true);
  await expect(page.getByRole("button", { name: "Lock transparent pixels" })).toHaveAttribute("aria-pressed", "true");

  // White over the black square and past both its sides.
  await page.keyboard.press("d");
  await page.keyboard.press("x");
  await arm(page, "b", "Brush");
  await brushStroke(page, -130, 10);
  await expect.poll(() => shown(page, [-60, 0])).toEqual(WHITE);
  expect(await shown(page, [-120, 0])).toEqual(GREY);
  expect(await shown(page, [0, 0])).toEqual(GREY);

  // The eraser paints the background colour (black now) instead of making holes.
  await arm(page, "e", "Eraser");
  await brushStroke(page, -130, 10, 30);
  await expect.poll(() => shown(page, [-60, 30])).toEqual(BLACK);
  expect(await shown(page, [-120, 30])).toEqual(GREY);
  expect(await shown(page, [-60, 0])).toEqual(WHITE);
});

test("Lock image pixels sends the brush to a new layer, and Lock position keeps the layer in place", async ({ page }) => {
  await twoLayers(page);
  await row(page, "Layer 1").click();
  await page.getByRole("button", { name: "Lock image pixels" }).click();
  await expect.poll(async () => (await layerOf(page, "Layer 1")).__lockPixels).toBe(true);
  // A hollow padlock on the row; the row's own padlock still locks all.
  await expect(row(page, "Layer 1").getByRole("button", { name: "Lock Layer 1" })).toBeVisible();

  await page.keyboard.press("d");
  await arm(page, "b", "Brush");
  await brushStroke(page, -80, -40);
  await expect.poll(() => stack(page)).toEqual(["Background", "Layer 1", "Layer 2", "Layer 3"]);

  // Lock position: arrows and drags with the Move tool leave it where it is.
  await row(page, "Layer 2").click();
  await page.getByRole("button", { name: "Lock position" }).click();
  await expect.poll(async () => (await layerOf(page, "Layer 2")).__lockPosition).toBe(true);
  const before = await layerOf(page, "Layer 2");
  await arm(page, "v", "Move");
  await page.keyboard.press("ArrowRight");
  await brushStroke(page, 60, 140);
  await page.waitForTimeout(300);
  const after = await layerOf(page, "Layer 2");
  expect([after.left, after.top]).toEqual([before.left, before.top]);

  // Locks survive a reload.
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await page.getByRole("tab", { name: "Layers" }).click();
  await row(page, "Layer 2").click();
  await expect(page.getByRole("button", { name: "Lock position" })).toHaveAttribute("aria-pressed", "true");
  await arm(page, "v", "Move");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  expect((await layerOf(page, "Layer 2")).left).toEqual(before.left);
});
