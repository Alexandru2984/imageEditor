import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

const RED = [200, 30, 30, 255];

/** The preview pixel over image pixel (x, y) of a 400×300 photo. */
const previewPixel = (page: Page, x: number, y: number) =>
  page.getByTestId("liquify-preview").evaluate(
    (element: HTMLCanvasElement, [x, y]) =>
      Array.from(
        element
          .getContext("2d")!
          .getImageData(Math.floor((x / 400) * element.width), Math.floor((y / 300) * element.height), 1, 1).data
      ),
    [x, y] as const
  );

/** Drag in the preview between image pixels of a 400×300 photo. */
async function brush(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId("liquify-preview").boundingBox())!;
  const at = ([x, y]: [number, number]) => [box.x + (box.width * x) / 400, box.y + (box.height * y) / 300] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at(to), { steps: 12 });
  await page.mouse.up();
}

test("Filter › Liquify pushes, undoes, freezes and applies as one step", async ({ page }) => {
  // A red bar down the middle of a white photo.
  await uploadSolidImage(page, 400, 300, "#ffffff", [{ x: 195, y: 0, width: 10, height: 300, color: "#c81e1e" }]);
  await page.keyboard.press("Control+Shift+x");
  const dialog = page.getByRole("dialog", { name: "Liquify" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => previewPixel(page, 200, 150)).toEqual(RED);
  expect(await previewPixel(page, 238, 150)).toEqual([255, 255, 255, 255]);
  await dialog.getByLabel("Size value").fill("80");

  // Forward Warp drags the bar's middle to the right.
  await brush(page, [200, 150], [240, 150]);
  await expect.poll(() => previewPixel(page, 238, 150)).toEqual(RED);
  // Far from the brush the bar has not moved.
  expect(await previewPixel(page, 200, 20)).toEqual(RED);

  // Ctrl+Z in the dialog takes the stroke back.
  await page.keyboard.press("Control+z");
  await expect.poll(() => previewPixel(page, 238, 150)).toEqual([255, 255, 255, 255]);

  // Frozen, the bar's lower part stays put while the whole bar is pushed.
  await page.keyboard.press("f");
  await expect(dialog.getByRole("button", { name: "Freeze Mask" })).toHaveAttribute("aria-pressed", "true");
  await brush(page, [200, 230], [200, 290]);
  await page.keyboard.press("w");
  await dialog.getByLabel("Size value").fill("400");
  await brush(page, [200, 150], [240, 150]);
  await expect.poll(async () => (await previewPixel(page, 200, 150))[1]).toBe(255);
  // Frozen parts show tinted red; without the tint, the bar is still there.
  expect((await previewPixel(page, 200, 270))[1]).toBeLessThan(30);
  await dialog.getByLabel("Show frozen areas").uncheck();
  await expect.poll(() => previewPixel(page, 200, 270)).toEqual(RED);

  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  // The photo itself changed: its middle moved right, its frozen foot did not.
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Background", [[200, 150]]))?.pixels[0]?.[1])
    .toBe(255);
  const after = (await autosavedLayerPixels(page, "Background", [[200, 270], [238, 150]]))!.pixels;
  expect(after[0]).toEqual(RED);
  expect(after[1]).toEqual(RED);

  // One undo step puts it all back.
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Background", [[200, 150]]))?.pixels[0])
    .toEqual(RED);
});
