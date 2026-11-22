import { test, expect, type Page } from "@playwright/test";
import { autosavedObjects, chooseMenu, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop menu tests");
  await page.goto("/");
});

interface SavedGuide {
  axis: "x" | "y";
  position: number;
}

/** The guides saved with the document, and the photo's scene frame to read them against. */
async function savedGuides(page: Page) {
  const objects = await autosavedObjects(page);
  const photo = objects.find((object) => object.__isBackground);
  return ((photo?.guides as SavedGuide[] | undefined) ?? []).map((guide) => ({ ...guide }));
}

/** An object's left and top edges in the scene (unrotated). */
const edges = (object: Record<string, unknown>) => {
  const width = (object.width as number) * (object.scaleX as number);
  const height = (object.height as number) * (object.scaleY as number);
  const left = (object.left as number) - (object.originX === "center" ? width / 2 : 0);
  const top = (object.top as number) - (object.originY === "center" ? height / 2 : 0);
  return { left, top, width, height };
};

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

/** Whether the lower canvas shows anything but plain grey within a pixel of a point on the page. */
const marked = (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y }) => {
      const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
      const box = lower.getBoundingClientRect();
      const ratio = lower.width / box.width;
      const { data } = lower.getContext("2d")!.getImageData(Math.round((x - box.left) * ratio) - 1, Math.round((y - box.top) * ratio) - 1, 3, 3);
      for (let at = 0; at < data.length; at += 4) if (data[at] !== 128 || data[at + 1] !== 128 || data[at + 2] !== 128) return true;
      return false;
    },
    { x, y }
  );

const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
};

test("guides come out of the rulers, move, go back, undo, and layers snap to them", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", []);
  await settle(page);
  const box = await photoBox(page);
  const perPixel = (box.right - box.left) / 400;
  const at = (x: number, y: number) => ({ x: box.left + x * perPixel, y: box.top + y * perPixel });

  await page.keyboard.press("Control+r");
  const vertical = (await page.getByTestId("ruler-vertical").boundingBox())!;
  const horizontal = (await page.getByTestId("ruler-horizontal").boundingBox())!;

  // A vertical guide at x = 100 and a horizontal one at y = 50, on whole pixels.
  await drag(page, { x: vertical.x + 10, y: at(0, 150).y }, at(100.3, 150));
  await drag(page, { x: at(200, 0).x, y: horizontal.y + 10 }, at(200, 49.8));
  await expect.poll(async () => (await savedGuides(page)).map((guide) => guide.axis)).toEqual(["x", "y"]);
  const photo = edges((await autosavedObjects(page)).find((object) => object.__isBackground)!);
  const scenePerPixel = photo.width / 400;
  const [first, second] = await savedGuides(page);
  // Saved documents round the photo's place a little.
  expect((first!.position - photo.left) / scenePerPixel).toBeCloseTo(100, 1);
  expect((second!.position - photo.top) / scenePerPixel).toBeCloseTo(50, 1);
  // Drawn over the photo, not saved into it.
  expect(await marked(page, at(100, 200).x, at(100, 200).y)).toBe(true);

  // A small layer, dragged near the vertical guide, lands on it.
  await page.keyboard.press("m");
  await drag(page, at(10, 150), at(70, 210));
  await page.keyboard.press("Control+j");
  await expect.poll(async () => (await autosavedObjects(page)).some((object) => object.name === "Layer 1")).toBe(true);
  await page.keyboard.press("v");
  // Left alone it would stop a pixel short of the guide.
  await drag(page, at(40, 180), at(129, 180));
  await expect
    .poll(async () => {
      const layer = (await autosavedObjects(page)).find((object) => object.name === "Layer 1");
      return layer ? Math.abs((edges(layer).left - first!.position) / scenePerPixel) < 1e-3 : null;
    })
    .toBe(true);

  // The Move tool drags a guide along; onto a ruler, it goes; undo brings it back.
  await drag(page, at(200, 50), at(200, 120));
  await expect.poll(async () => Math.round(((await savedGuides(page))[1]!.position - photo.top) / scenePerPixel)).toBe(120);
  await drag(page, at(250, 120), { x: at(250, 0).x, y: horizontal.y + 10 });
  await expect.poll(async () => (await savedGuides(page)).length).toBe(1);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await savedGuides(page)).length).toBe(2);

  // Hidden guides neither show nor move; Clear guides removes them all.
  await page.keyboard.press("Control+;");
  await expect.poll(() => marked(page, at(300, 120).x, at(300, 120).y)).toBe(false);
  await page.keyboard.press("Control+;");
  await chooseMenu(page, "View", "Clear guides");
  await expect.poll(async () => (await savedGuides(page)).length).toBe(0);

  // New guide… puts one at an exact place.
  await chooseMenu(page, "View", "New guide…");
  await page.getByRole("radio", { name: "Vertical" }).click();
  await page.getByLabel("Position").fill("250");
  await page.getByRole("button", { name: "OK" }).click();
  await expect.poll(async () => (await savedGuides(page)).map((guide) => Math.round((guide.position - photo.left) / scenePerPixel))).toEqual([250]);
});

test("the grid shows over the document, and its spacing can be set", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", []);
  await settle(page);
  const box = await photoBox(page);
  const perPixel = (box.right - box.left) / 400;
  const at = (x: number, y: number) => ({ x: box.left + x * perPixel, y: box.top + y * perPixel });

  await chooseMenu(page, "View", "Grid settings…");
  await page.getByLabel("Gridline every").fill("50");
  await page.getByLabel("Subdivisions").fill("1");
  await page.getByRole("button", { name: "OK" }).click();
  // Setting the grid shows it: a line every 50 pixels, none between.
  await expect.poll(() => marked(page, at(150, 75).x, at(175, 75).y)).toBe(true);
  expect(await marked(page, at(175, 75).x, at(175, 60).y)).toBe(false);
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: /^Grid/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+'");
  await expect.poll(() => marked(page, at(150, 75).x, at(175, 75).y)).toBe(false);
});

test("cropping keeps the guides inside the crop, in place on the cropped photo", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080", []);
  await settle(page);
  const addGuide = async (axis: "Vertical" | "Horizontal", position: number) => {
    await chooseMenu(page, "View", "New guide…");
    await page.getByRole("radio", { name: axis }).click();
    await page.getByLabel("Position").fill(String(position));
    await page.getByRole("button", { name: "OK" }).click();
  };
  await addGuide("Vertical", 100);
  await addGuide("Vertical", 20);
  await addGuide("Horizontal", 120);
  await expect.poll(async () => (await savedGuides(page)).length).toBe(3);

  // A square from the middle: 50..350 across, all of it down.
  await page.getByRole("button", { name: "Crop (C)" }).click();
  await page.getByRole("radio", { name: "1:1" }).click();
  await expect(page.getByTestId("crop-size")).toHaveText("300 × 300 px");
  await page.getByRole("button", { name: "Apply crop" }).click();
  await expect(page.getByRole("button", { name: "Apply crop" })).toHaveCount(0);

  const inPixels = async () => {
    const photo = edges((await autosavedObjects(page)).find((object) => object.__isBackground)!);
    const perPixel = photo.width / 300;
    return (await savedGuides(page)).map((guide) => ({
      axis: guide.axis,
      position: Math.round((guide.position - (guide.axis === "x" ? photo.left : photo.top)) / perPixel),
    }));
  };
  // The guide left of the crop is gone.
  await expect.poll(inPixels).toEqual([
    { axis: "x", position: 50 },
    { axis: "y", position: 120 },
  ]);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await savedGuides(page)).length).toBe(3);
});
