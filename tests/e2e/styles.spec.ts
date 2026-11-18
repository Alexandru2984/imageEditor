import { test, expect, type Page } from "@playwright/test";
import { autosavedObjects, canvasCenter, chooseMenu, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

async function arm(page: Page, key: string, name: string) {
  await page.keyboard.press(key);
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText(name);
}

/** What the canvas shows along a line from its centre (RGBA per pixel). */
async function line(page: Page, dx: number, dy: number, length: number): Promise<number[][]> {
  const center = await canvasCenter(page);
  return page.evaluate(
    ({ x, y, dx, dy, length }) => {
      const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
      const box = lower.getBoundingClientRect();
      const ratio = lower.width / box.width;
      const context = lower.getContext("2d")!;
      const pixels: number[][] = [];
      for (let step = 0; step < length; step += 1) {
        const px = Math.round((x + dx * step - box.left) * ratio);
        const py = Math.round((y + dy * step - box.top) * ratio);
        pixels.push([...context.getImageData(px, py, 1, 1).data]);
      }
      return pixels;
    },
    { x: center.x, y: center.y, dx, dy, length }
  );
}

const PURPLE = (p: number[]) => p[0]! > 140 && p[0]! < 200 && p[1]! < 120 && p[2]! > 200;
const DARK = (p: number[]) => p[0]! < 90 && p[1]! < 90 && p[2]! < 90;
const RED = (p: number[]) => p[0]! > 220 && p[1]! < 40 && p[2]! < 40;

/** How many pixels along a line show `effect`. */
const count = (pixels: number[][], effect: (p: number[]) => boolean) => pixels.filter(effect).length;

const styleOf = async (page: Page, match: (object: Record<string, unknown>) => boolean) =>
  (await autosavedObjects(page)).find(match)?.layerStyle as Record<string, { enabled: boolean }> | undefined;
const rect = (object: Record<string, unknown>) => object.type === "Rect";

async function openStyle(page: Page) {
  await chooseMenu(page, "Layer", "Layer style…");
  return page.getByRole("dialog", { name: "Layer style" });
}

test("a stroke outlines a shape, a drop shadow falls below it, and Cancel leaves it as it was", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  await arm(page, "u", "Shape");
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect(page.getByRole("button", { name: "Select (V)" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => styleOf(page, rect)).toBeUndefined();
  expect(count(await line(page, 1, 0, 200), DARK)).toBe(0);

  // Colour overlay shows at once, and Cancel takes it away again.
  let dialog = await openStyle(page);
  await dialog.getByLabel("Colour overlay").check();
  await expect.poll(async () => RED((await line(page, 0, 0, 1))[0]!)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(async () => PURPLE((await line(page, 0, 0, 1))[0]!)).toBe(true);

  // A 10px stroke outside the shape.
  dialog = await openStyle(page);
  await dialog.getByLabel("Stroke", { exact: true }).check();
  const size = dialog.getByRole("slider", { name: "Size" });
  await size.focus();
  for (let step = 0; step < 7; step += 1) await page.keyboard.press("ArrowRight");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect.poll(async () => (await styleOf(page, rect))?.stroke?.enabled).toBe(true);
  // As wide on every side.
  const right = count(await line(page, 1, 0, 200), DARK);
  const left = count(await line(page, -1, 0, 200), DARK);
  expect(right).toBeGreaterThanOrEqual(8);
  expect(right).toBeLessThan(80);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(2);

  // One undo removes the style.
  await page.keyboard.press("Control+z");
  await expect.poll(() => styleOf(page, rect)).toBeUndefined();
  expect(count(await line(page, 1, 0, 200), DARK)).toBe(0);

  // A hard drop shadow lands below the shape (light from above).
  await page.mouse.click(center.x, center.y);
  dialog = await openStyle(page);
  await dialog.getByLabel("Drop shadow").check();
  const shadowSize = dialog.getByRole("slider", { name: "Size" });
  await shadowSize.focus();
  await page.keyboard.press("Home");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect.poll(async () => (await styleOf(page, rect))?.dropShadow?.enabled).toBe(true);
  const grey = (p: number[]) => p[0]! < 120 && Math.abs(p[0]! - p[2]!) < 10;
  expect(count(await line(page, 0, 1, 200), grey)).toBeGreaterThanOrEqual(5);
  expect(count(await line(page, 0, -1, 200), grey)).toBe(0);
});

test("a stroke follows the painted pixels of an image layer", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  await arm(page, "b", "Brush");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - 100, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 100, center.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await autosavedObjects(page)).some((o) => o.name === "Layer 1")).toBe(true);

  const dialog = await openStyle(page);
  await dialog.getByLabel("Stroke", { exact: true }).check();
  await dialog.getByLabel("Stroke colour").fill("#ff0000");
  const size = dialog.getByRole("slider", { name: "Size" });
  await size.focus();
  for (let step = 0; step < 7; step += 1) await page.keyboard.press("ArrowRight");
  await dialog.getByRole("button", { name: "OK" }).click();
  const painted = (object: Record<string, unknown>) => object.name === "Layer 1";
  await expect.poll(async () => (await styleOf(page, painted))?.stroke?.enabled).toBe(true);
  // Above the painted line: a red outline, then white again.
  const up = await line(page, 0, -1, 120);
  expect(count(up, RED)).toBeGreaterThanOrEqual(8);
  expect(RED(up.at(-1)!)).toBe(false);
  // The outline follows the line's round end, not the layer's box.
  const along = await line(page, 1, 0, 450);
  expect(count(along.slice(0, 200), RED)).toBeGreaterThanOrEqual(8);
  expect(count(along.slice(250), RED)).toBe(0);
});
