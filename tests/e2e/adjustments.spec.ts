import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, canvasCenter, chooseSubmenu, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

/** What the canvas shows at an offset from its centre. */
async function shown(page: Page, dx = 0, dy = 0): Promise<number[]> {
  const center = await canvasCenter(page);
  return page.evaluate(
    ({ x, y }) => {
      const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
      const box = lower.getBoundingClientRect();
      const ratio = lower.width / box.width;
      return [
        ...lower
          .getContext("2d")!
          .getImageData(Math.round((x - box.left) * ratio), Math.round((y - box.top) * ratio), 1, 1).data,
      ];
    },
    { x: center.x + dx, y: center.y + dy }
  );
}

const photoPixels = async (page: Page, points: [number, number][]) =>
  (await autosavedLayerPixels(page, "Background", points))?.pixels.map((pixel) => pixel.slice(0, 3));

async function openGreyPhoto(page: Page) {
  await uploadSolidImage(page, 400, 300, "#808080");
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[128, 128, 128]]);
  await settle(page);
}

test("Levels darkens the photo while it is set, Cancel restores it, and OK applies it in the selection", async ({
  page,
}) => {
  await openGreyPhoto(page);

  await page.keyboard.press("Control+l");
  let dialog = page.getByRole("dialog", { name: "Levels" });
  await dialog.getByRole("slider", { name: "Shadows", exact: true }).focus();
  await page.keyboard.press("End");
  // Everything below the new black point turns black, on screen at once.
  await expect.poll(async () => (await shown(page))[0]).toBeLessThan(10);
  await dialog.getByLabel("Preview").uncheck();
  await expect.poll(async () => (await shown(page))[0]).toBeGreaterThan(120);
  await dialog.getByLabel("Preview").check();
  await expect.poll(async () => (await shown(page))[0]).toBeLessThan(10);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await shown(page))[0]).toBeGreaterThan(120);

  // Only the selected left half changes.
  await page.keyboard.press("m");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Rectangle select");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - 400, center.y - 280);
  await page.mouse.down();
  await page.mouse.move(center.x - 200, center.y, { steps: 4 });
  await page.mouse.move(center.x, center.y + 280, { steps: 4 });
  await page.mouse.up();
  await chooseSubmenu(page, "Image", "Adjustments", "Levels…");
  dialog = page.getByRole("dialog", { name: "Levels" });
  await dialog.getByRole("slider", { name: "Shadows", exact: true }).focus();
  await page.keyboard.press("End");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(() => photoPixels(page, [[100, 150], [300, 150]]))
    .toEqual([
      [0, 0, 0],
      [128, 128, 128],
    ]);

  // One step back undoes it.
  await page.keyboard.press("Control+z");
  await expect.poll(() => photoPixels(page, [[100, 150]])).toEqual([[128, 128, 128]]);
});

test("Curves applies a preset and a point set by number", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#336699");
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[0x33, 0x66, 0x99]]);
  await settle(page);

  await page.keyboard.press("Control+m");
  let dialog = page.getByRole("dialog", { name: "Curves" });
  await dialog.getByLabel("Preset").selectOption("negative");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[0xcc, 0x99, 0x66]]);

  // A point added on the graph, then placed exactly: 0xcc (204) becomes 102.
  await page.keyboard.press("Control+m");
  dialog = page.getByRole("dialog", { name: "Curves" });
  const graph = dialog.getByRole("application", { name: "Curve" });
  const box = (await graph.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
  await dialog.getByLabel("Input").fill("204");
  await dialog.getByLabel("Output").fill("102");
  await expect(dialog.getByLabel("Preset")).toHaveValue("custom");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect.poll(async () => (await photoPixels(page, [[200, 150]]))?.[0]?.[0]).toBe(102);
});

test("Invert, Desaturate and Hue/Saturation give the expected colours", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#336699");
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[0x33, 0x66, 0x99]]);
  await settle(page);

  await page.keyboard.press("Control+i");
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[0xcc, 0x99, 0x66]]);
  await page.keyboard.press("Control+Shift+u");
  // HSL lightness of #cc9966: (204 + 102) / 2.
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[153, 153, 153]]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[0xcc, 0x99, 0x66]]);

  // Half way round the colour wheel.
  await page.keyboard.press("Control+u");
  const dialog = page.getByRole("dialog", { name: "Hue/Saturation" });
  await dialog.getByRole("slider", { name: "Hue" }).focus();
  await page.keyboard.press("End");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(async () => (await photoPixels(page, [[200, 150]]))?.[0]?.map((value) => Math.round(value / 4)))
    .toEqual([0x66, 0x99, 0xcc].map((value) => Math.round(value / 4)));
});

test("every adjustment in the menu changes the photo", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#6b8e23");
  await expect.poll(() => photoPixels(page, [[200, 150]])).toEqual([[0x6b, 0x8e, 0x23]]);
  await settle(page);
  let before = [0x6b, 0x8e, 0x23];
  const steps: [string, string | null][] = [
    ["Brightness/Contrast…", "Brightness"],
    ["Exposure…", "Exposure"],
    ["Hue/Saturation…", "Hue"],
    ["Color Balance…", "Cyan – Red"],
    ["Posterize…", null],
    ["Gradient Map…", null],
    ["Invert", null],
    ["Black & White…", null],
    ["Threshold…", null],
  ];
  for (const [item, slider] of steps) {
    await chooseSubmenu(page, "Image", "Adjustments", item);
    if (item.endsWith("…")) {
      const dialog = page.getByRole("dialog", { name: item.slice(0, -1) });
      if (slider) {
        await dialog.getByRole("slider", { name: slider, exact: true }).focus();
        for (let step = 0; step < 20; step += 1) await page.keyboard.press("ArrowRight");
      }
      await dialog.getByRole("button", { name: "OK" }).click();
      await expect(dialog).toHaveCount(0);
    }
    await expect
      .poll(async () => JSON.stringify((await photoPixels(page, [[200, 150]]))?.[0]), { message: item })
      .not.toBe(JSON.stringify(before));
    before = (await photoPixels(page, [[200, 150]]))![0]!;
  }
});

test("Gaussian Blur inside a selection blurs across its edge from the pixels outside", async ({ page }) => {
  // Black left half, white right half.
  await uploadSolidImage(page, 400, 300, "#ffffff", [{ x: 0, y: 0, width: 200, height: 300, color: "#000000" }]);
  await expect.poll(() => photoPixels(page, [[100, 150], [300, 150]])).toEqual([[0, 0, 0], [255, 255, 255]]);
  await settle(page);

  // Select only the white half.
  await page.keyboard.press("m");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Rectangle select");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x, center.y - 280);
  await page.mouse.down();
  await page.mouse.move(center.x + 200, center.y, { steps: 4 });
  await page.mouse.move(center.x + 400, center.y + 280, { steps: 4 });
  await page.mouse.up();

  await chooseSubmenu(page, "Filter", "Blur", "Gaussian Blur…");
  const dialog = page.getByRole("dialog", { name: "Gaussian Blur" });
  await dialog.getByRole("slider", { name: "Radius" }).focus();
  for (let step = 0; step < 30; step += 1) await page.keyboard.press("ArrowRight");
  await dialog.getByRole("button", { name: "OK" }).click();
  // The black from outside bleeds into the selected edge; the black half itself stays black.
  await expect.poll(async () => (await photoPixels(page, [[202, 150]]))?.[0]?.[0] ?? 255).toBeLessThan(200);
  expect((await photoPixels(page, [[150, 150], [380, 150]]))!).toEqual([
    [0, 0, 0],
    [255, 255, 255],
  ]);
});

test("each filter in the Filter menu changes the photo", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#4b8bbe", [{ x: 150, y: 100, width: 100, height: 100, color: "#ffd43b" }]);
  await settle(page);
  const steps: [string, string][] = [
    ["Blur", "Motion Blur…"],
    ["Sharpen", "Unsharp Mask…"],
    ["Noise", "Add Noise…"],
    ["Pixelate", "Mosaic…"],
    ["Stylize", "Emboss…"],
    ["Stylize", "Find Edges"],
    ["Other", "High Pass…"],
  ];
  // Pixels on and around the yellow square's edge.
  const probe: [number, number][] = [[150, 150], [148, 150], [152, 150], [200, 100], [30, 30]];
  for (const [submenu, item] of steps) {
    const before = JSON.stringify(await photoPixels(page, probe));
    await chooseSubmenu(page, "Filter", submenu, item);
    if (item.endsWith("…")) {
      const dialog = page.getByRole("dialog", { name: item.slice(0, -1) });
      await dialog.getByRole("button", { name: "OK" }).click();
      await expect(dialog).toHaveCount(0);
    }
    await expect.poll(async () => JSON.stringify(await photoPixels(page, probe)), { message: item }).not.toBe(before);
  }
});
