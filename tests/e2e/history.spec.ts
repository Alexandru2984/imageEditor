import { test, expect, type Page } from "@playwright/test";
import { autosavedObjects, canvasCenter, chooseMenu, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop menu tests");
  await page.goto("/");
});

const layerNames = async (page: Page) => (await autosavedObjects(page)).map((object) => object.name);

test("the History panel names each step and goes back and forth to any of them", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", []);
  await settle(page);
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "History", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const panel = page.getByRole("region", { name: "History" });
  const steps = async () => (await panel.getByRole("listitem").allInnerTexts()).map((text) => text.trim());
  const step = (name: string) => panel.getByRole("button", { name, exact: true });
  await expect.poll(steps).toEqual(["Open"]);

  // A brush stroke is named after the brush; a command after itself.
  await page.keyboard.press("b");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Brush");
  await settle(page);
  const centre = await canvasCenter(page);
  await page.mouse.move(centre.x - 80, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 80, centre.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(steps).toEqual(["Open", "Brush"]);
  await chooseMenu(page, "Image", "Flip horizontal");
  await expect.poll(steps).toEqual(["Open", "Brush", "Flip horizontal"]);
  await expect(step("Flip horizontal")).toHaveAttribute("aria-current", "step");

  // Back to the start: the painted layer goes; the later steps wait, greyed.
  await step("Open").click();
  await expect.poll(() => layerNames(page)).not.toContain("Layer 1");
  await expect(step("Open")).toHaveAttribute("aria-current", "step");
  expect(await steps()).toEqual(["Open", "Brush", "Flip horizontal"]);

  // And forward again.
  await step("Flip horizontal").click();
  await expect.poll(() => layerNames(page)).toContain("Layer 1");
  await expect(step("Flip horizontal")).toHaveAttribute("aria-current", "step");

  // A new change after an earlier step replaces the steps that followed it.
  await step("Brush").click();
  await expect(step("Brush")).toHaveAttribute("aria-current", "step");
  await page.getByRole("menuitem", { name: "Layer", exact: true }).click();
  // Not "New layer via copy" or "via cut".
  await page.getByRole("menuitem", { name: /^New layer(?! via)/ }).click();
  await expect.poll(steps).toEqual(["Open", "Brush", "New layer"]);
  // Ctrl+Z moves the panel's mark too.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+z");
  await expect(step("Brush")).toHaveAttribute("aria-current", "step");
});

/** How many overlay pixels the marching ants cover. */
const antPixels = (page: Page) =>
  page.evaluate(() => {
    const overlay = document.querySelector<HTMLCanvasElement>('[data-testid="selection-overlay"]')!;
    const data = overlay.getContext("2d")!.getImageData(0, 0, overlay.width, overlay.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) count += 1;
    return count;
  });

test("selections are steps in the history, and undo brings back the one each step had", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", []);
  await settle(page);
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "History", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  const panel = page.getByRole("region", { name: "History" });
  const steps = async () => (await panel.getByRole("listitem").allInnerTexts()).map((text) => text.trim());
  const step = (name: string) => panel.getByRole("button", { name, exact: true });
  const keys = async (combo: string) => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(combo);
  };

  // A rectangle, named after its tool; then Deselect.
  await page.keyboard.press("m");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Rectangle select");
  await settle(page);
  const centre = await canvasCenter(page);
  await page.mouse.move(centre.x - 60, centre.y - 40);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(steps).toEqual(["Open", "Rectangular Marquee"]);
  const selected = await antPixels(page);
  expect(selected).toBeGreaterThan(0);
  await keys("Control+d");
  await expect.poll(steps).toEqual(["Open", "Rectangular Marquee", "Deselect"]);
  await expect.poll(() => antPixels(page)).toBe(0);

  // Undo brings the rectangle back, then nothing; redo, the rectangle again.
  await keys("Control+z");
  await expect(step("Rectangular Marquee")).toHaveAttribute("aria-current", "step");
  await expect.poll(() => antPixels(page)).toBe(selected);
  await keys("Control+z");
  await expect(step("Open")).toHaveAttribute("aria-current", "step");
  await expect.poll(() => antPixels(page)).toBe(0);
  await keys("Control+Shift+z");
  await expect.poll(() => antPixels(page)).toBe(selected);

  // Select All and Inverse are named for themselves; a later change drops Deselect.
  await keys("Control+a");
  await keys("Control+Shift+i");
  await expect.poll(steps).toEqual(["Open", "Rectangular Marquee", "Select All", "Inverse"]);
  // Inverse of everything is nothing.
  await expect.poll(() => antPixels(page)).toBe(0);
  await step("Rectangular Marquee").click();
  await expect.poll(() => antPixels(page)).toBe(selected);

  // Pixels cleared in the selection, then deselected: undo brings back the
  // selection, then the pixels with the selection they were cleared in.
  await keys("Delete");
  await expect.poll(async () => (await steps()).length).toBe(3);
  const cleared = (await steps())[2]!;
  await keys("Control+d");
  await expect.poll(steps).toEqual(["Open", "Rectangular Marquee", cleared, "Deselect"]);
  await keys("Control+z");
  await expect.poll(() => antPixels(page)).toBe(selected);
  await keys("Control+z");
  await expect(step("Rectangular Marquee")).toHaveAttribute("aria-current", "step");
  await expect.poll(() => antPixels(page)).toBe(selected);
});
