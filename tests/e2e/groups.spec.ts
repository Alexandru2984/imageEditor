import { test, expect } from "@playwright/test";
import { autosavedObjects, chooseMenu, uploadSolidImage } from "./helpers";
import { BLACK, GREY, paintedLayer, shown, types, WHITE } from "./layerHelpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop layer tests");
  await page.goto("/");
});

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
