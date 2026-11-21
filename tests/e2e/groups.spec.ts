import { test, expect, type Page } from "@playwright/test";
import { autosavedObjects, canvasCenter, chooseMenu, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop layer tests");
  await page.goto("/");
});

/** Drag between two offsets from the canvas centre. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const center = await canvasCenter(page);
  await page.mouse.move(center.x + from[0], center.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(center.x + to[0], center.y + to[1], { steps: 6 });
  await page.mouse.up();
}

/** What the canvas shows at an offset from its centre (RGBA). */
async function shown(page: Page, offset: [number, number]): Promise<number[]> {
  const center = await canvasCenter(page);
  return page.evaluate(
    ({ x, y }) => {
      const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
      const box = lower.getBoundingClientRect();
      const ratio = lower.width / box.width;
      return [
        ...lower.getContext("2d")!.getImageData(Math.round((x - box.left) * ratio), Math.round((y - box.top) * ratio), 1, 1).data,
      ];
    },
    { x: center.x + offset[0], y: center.y + offset[1] }
  );
}

const GREY = [128, 128, 128, 255];
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

/**
 * A new layer with a rectangle in the foreground (black) or background
 * (white) colour: Fill with nothing but the photo selected paints on a new
 * layer, as the brush does.
 */
async function paintedLayer(page: Page, from: [number, number], to: [number, number], colour: "foreground" | "background") {
  const before = (await autosavedObjects(page)).length;
  await page.keyboard.press("m");
  // Photoshop's default colours: black and white.
  await page.keyboard.press("d");
  await drag(page, from, to);
  await page.keyboard.press(colour === "foreground" ? "Alt+Backspace" : "Control+Backspace");
  await expect.poll(async () => (await autosavedObjects(page)).length).toBe(before + 1);
  await page.keyboard.press("Control+d");
  await settle(page);
}

const types = async (page: Page) => (await autosavedObjects(page)).map((object) => `${object.type}:${object.name ?? ""}`);

test("Group layers gathers layers in a group that hides with them, folds in the panel, and comes apart again", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080");
  await paintedLayer(page, [-100, -50], [-20, 50], "foreground");
  await paintedLayer(page, [20, -50], [100, 50], "background");
  await expect.poll(() => shown(page, [-60, 0])).toEqual(BLACK);
  await expect.poll(() => shown(page, [60, 0])).toEqual(WHITE);

  await page.keyboard.press("Control+Alt+a");
  await page.keyboard.press("Control+g");
  await expect
    .poll(() => types(page))
    .toEqual(["Image:Background", "LayerGroupEnd:", "Image:Layer 1", "Image:Layer 2", "LayerGroup:Group 1"]);

  await page.getByRole("tab", { name: "Layers" }).click();
  const group = page.getByRole("group", { name: "Group 1 group" });
  await expect(group).toHaveAttribute("aria-current", "true");
  // The group's eye hides everything in it.
  await page.getByRole("button", { name: "Hide Group 1" }).click();
  await expect.poll(() => shown(page, [-60, 0])).toEqual(GREY);
  await expect.poll(() => shown(page, [60, 0])).toEqual(GREY);
  await page.getByRole("button", { name: "Show Group 1" }).click();
  await expect.poll(() => shown(page, [60, 0])).toEqual(WHITE);

  // Folding hides its layers from the list only.
  await page.getByRole("button", { name: "Close Group 1" }).click();
  await expect(page.getByRole("group", { name: "Layer 1 layer" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open Group 1" }).click();
  await expect(page.getByRole("group", { name: "Layer 1 layer" })).toBeVisible();

  // Ungroup keeps the layers where they are; undo brings the group back.
  await group.click();
  await page.keyboard.press("Control+Shift+g");
  await expect.poll(() => types(page)).toEqual(["Image:Background", "Image:Layer 1", "Image:Layer 2"]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => types(page)).toContain("LayerGroup:Group 1");

  // The group comes back with the project, hidden as it was left.
  await page.getByRole("button", { name: "Hide Group 1" }).click();
  await expect.poll(() => shown(page, [60, 0])).toEqual(GREY);
  await expect.poll(async () => (await autosavedObjects(page)).find((object) => object.type === "LayerGroup")?.visible).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect.poll(() => types(page)).toContain("LayerGroup:Group 1");
  await expect.poll(() => shown(page, [60, 0])).toEqual(GREY);
});

test("a clipping mask shows a layer only where the layer below has pixels, also once flattened", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080");
  await paintedLayer(page, [-100, -50], [0, 50], "foreground");
  await paintedLayer(page, [-50, -30], [50, 30], "background");
  await expect.poll(() => shown(page, [30, 0])).toEqual(WHITE);

  await page.keyboard.press("Control+Alt+g");
  await expect.poll(async () => (await autosavedObjects(page)).find((object) => object.name === "Layer 2")?.__clipped).toBe(true);
  await expect.poll(() => shown(page, [30, 0])).toEqual(GREY);
  expect(await shown(page, [-30, 0])).toEqual(WHITE);
  await page.getByRole("tab", { name: "Layers" }).click();
  await expect(page.getByLabel("Clipped to the layer below")).toHaveCount(1);

  // Ctrl+Alt+G again releases it.
  await page.keyboard.press("Control+Alt+g");
  await expect.poll(() => shown(page, [30, 0])).toEqual(WHITE);
  await page.keyboard.press("Control+Alt+g");
  await expect.poll(() => shown(page, [30, 0])).toEqual(GREY);

  // Flattening bakes what the screen shows: with the layers gone, the photo shows it.
  await chooseMenu(page, "Layer", "Flatten image");
  await expect.poll(async () => (await autosavedObjects(page)).length).toBe(1);
  await expect.poll(() => shown(page, [30, 0])).toEqual(GREY);
  expect(await shown(page, [-30, 0])).toEqual(WHITE);
  expect(await shown(page, [-70, 0])).toEqual(BLACK);
});

test("a group's opacity fades its layers together, and Merge group bakes them into one layer with it", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080");
  await paintedLayer(page, [-100, -50], [-20, 50], "foreground");
  await page.keyboard.press("Control+g");
  await page.getByRole("tab", { name: "Layers" }).click();
  const opacity = page.getByRole("slider", { name: "Layer opacity" });
  await opacity.focus();
  for (let step = 0; step < 5; step += 1) await page.keyboard.press("PageDown");
  await expect.poll(async () => (await autosavedObjects(page)).find((object) => object.type === "LayerGroup")?.opacity).toBe(0.5);
  await expect.poll(async () => (await shown(page, [-60, 0]))[0]).toBeGreaterThan(60);
  expect((await shown(page, [-60, 0]))[0]).toBeLessThan(68);

  await page.getByRole("group", { name: "Group 1 group" }).click();
  await chooseMenu(page, "Layer", "Merge group");
  await expect.poll(() => types(page)).toEqual(["Image:Background", "Image:Group 1"]);
  const merged = (await autosavedObjects(page))[1]!;
  expect(merged.opacity).toBe(0.5);
  // Still half see-through, now as the merged layer's own setting.
  await expect.poll(async () => (await shown(page, [-60, 0]))[0]).toBeGreaterThan(60);
  expect((await shown(page, [-60, 0]))[0]).toBeLessThan(68);
});
