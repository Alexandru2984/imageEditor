import { test, expect, type Page } from "@playwright/test";
import { autosavedObjects, canvasCenter, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

const picker = (page: Page) => page.getByRole("dialog", { name: "Color picker" });
const value = (page: Page, label: string) => picker(page).getByLabel(label, { exact: true });

test("the colour picker sets the foreground colour from its field, its numbers or hex; Cancel keeps the old one", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  const foreground = page.getByRole("group", { name: "Colors" }).getByRole("button", { name: "Foreground color" });
  const before = await foreground.getAttribute("data-color");

  await foreground.click();
  await expect(picker(page)).toContainText("Foreground color");
  // RGB in, HSB and Lab out: Photoshop's numbers for pure red.
  await value(page, "Red").fill("255");
  await value(page, "Green").fill("0");
  await value(page, "Blue").fill("0");
  await expect(picker(page).getByTestId("new-color")).toHaveAttribute("data-color", "#ff0000");
  await expect(value(page, "Hex")).toHaveValue("ff0000");
  for (const [label, number] of [["Hue degrees", "0"], ["Saturation", "100"], ["Brightness", "100"], ["Lightness", "54"], ["Lab a", "81"], ["Lab b", "70"]] as const) {
    await expect(value(page, label)).toHaveValue(number);
  }
  // Dragging: the top of the hue strip is red again, its middle cyan.
  const strip = picker(page).getByTestId("hue-strip");
  const box = (await strip.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(value(page, "Hue degrees")).toHaveValue("180");
  await expect(picker(page).getByTestId("new-color")).toHaveAttribute("data-color", "#00ffff");
  // The field's bottom left is black, whatever the hue (dragged past it).
  const field = (await picker(page).getByTestId("color-field").boundingBox())!;
  await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2);
  await page.mouse.down();
  await page.mouse.move(field.x - 30, field.y + field.height + 30, { steps: 5 });
  await page.mouse.up();
  await expect(picker(page).getByTestId("new-color")).toHaveAttribute("data-color", "#000000");
  await expect(value(page, "Hue degrees")).toHaveValue("180");
  // Arrow keys move through it too.
  await page.keyboard.press("Shift+ArrowUp");
  await expect(picker(page).getByRole("slider", { name: "Saturation and brightness" })).toHaveAttribute("aria-valuetext", /brightness 10%/);

  await picker(page).getByRole("button", { name: "Cancel" }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(foreground).toHaveAttribute("data-color", before!);

  // Hex, then OK: the brush paints with it.
  await foreground.click();
  await value(page, "Hex").fill("3366cc");
  await picker(page).getByRole("button", { name: "OK" }).click();
  await expect(foreground).toHaveAttribute("data-color", "#3366cc");
  await page.keyboard.press("b");
  await settle(page);
  await page.keyboard.press("Shift+b");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Marker");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - 60, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 60, center.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await autosavedObjects(page)).find((object) => object.type === "Path")?.stroke).toBe("#3366cc");

  // It is now a recent colour, a click away.
  await foreground.click();
  await picker(page).getByRole("button", { name: "Recent color #3366cc" }).isVisible();
  await value(page, "Hex").fill("ffffff");
  await picker(page).getByRole("button", { name: "Recent color #3366cc" }).click();
  await expect(value(page, "Hex")).toHaveValue("3366cc");
  // The current colour comes back with a click.
  await value(page, "Hex").fill("000000");
  await picker(page).getByRole("button", { name: "Back to the current color #3366cc" }).click();
  await expect(value(page, "Hex")).toHaveValue("3366cc");
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
});

test("swatches: the colour is added from the picker or the panel, kept in the browser and deleted", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  const swatches = page.getByRole("group", { name: "Swatches" });
  const foreground = page.getByRole("group", { name: "Colors" }).getByRole("button", { name: "Foreground color" });
  await foreground.click();
  await value(page, "Hex").fill("123abc");
  await picker(page).getByRole("button", { name: "Add to swatches" }).click();
  await expect(picker(page).getByRole("button", { name: "In the swatches" })).toBeDisabled();
  await picker(page).getByRole("button", { name: "OK" }).click();
  await expect(swatches.getByRole("button", { name: "Use color #123abc" })).toHaveAttribute("aria-pressed", "true");

  // A built-in swatch sets the colour; the + adds one that is not there.
  await swatches.getByRole("button", { name: "Use color #22c55e" }).click();
  await expect(foreground).toHaveAttribute("data-color", "#22c55e");
  await expect(swatches.getByRole("button", { name: "Add the color to the swatches" })).toBeDisabled();
  await page.getByRole("button", { name: "Custom active color" }).click();
  await value(page, "Hex").fill("fedcba");
  await picker(page).getByRole("button", { name: "OK" }).click();
  await expect(foreground).toHaveAttribute("data-color", "#fedcba");
  await swatches.getByRole("button", { name: "Add the color to the swatches" }).click();
  await expect(swatches.getByRole("button", { name: "Use color #fedcba" })).toBeVisible();

  // Kept in this browser.
  await page.reload();
  await uploadSolidImage(page, 400, 300);
  await expect(swatches.getByRole("button", { name: "Use color #123abc" })).toBeVisible();
  await swatches.getByRole("button", { name: "Use color #fedcba" }).click();
  await expect(foreground).toHaveAttribute("data-color", "#fedcba");
  await swatches.getByRole("button", { name: "Use color #123abc" }).hover();
  await swatches.getByRole("button", { name: "Delete the swatch #123abc" }).click();
  await expect(swatches.getByRole("button", { name: "Use color #123abc" })).toHaveCount(0);
  await page.reload();
  await uploadSolidImage(page, 400, 300);
  await expect(swatches.getByRole("button", { name: "Use color #fedcba" })).toBeVisible();
  await expect(swatches.getByRole("button", { name: "Use color #123abc" })).toHaveCount(0);
});

test("the picker's eyedropper takes a colour from the screen where the browser has one", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: "#123456" });
      }
    };
  });
  await page.reload();
  await uploadSolidImage(page, 400, 300);
  await page.getByRole("group", { name: "Colors" }).getByRole("button", { name: "Background color" }).click();
  await expect(picker(page)).toContainText("Background color");
  await picker(page).getByRole("button", { name: "Pick from the screen" }).click();
  await expect(picker(page).getByTestId("new-color")).toHaveAttribute("data-color", "#123456");
  // Enter in a field is OK.
  await value(page, "Red").press("Enter");
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Colors" }).getByRole("button", { name: "Background color" })).toHaveAttribute("data-color", "#123456");
});
