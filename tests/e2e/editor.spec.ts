import { test, expect, type Page } from "@playwright/test";

// A tiny valid 4x4 PNG, decoded from base64 into a file the upload input accepts.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAvyQP4rvqiVQAAAABJRU5ErkJggg==";

async function uploadImage(page: Page) {
  await page.getByTestId("image-input").setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });
  // The editor replaces the upload screen with the canvas + actions
  await expect(page.getByText("Remove BG")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows the upload screen on first load", async ({ page }) => {
  await expect(page.getByText("Upload an Image")).toBeVisible();
});

test("uploading an image opens the editor", async ({ page }) => {
  await uploadImage(page);
  await expect(page.getByText("Upload an Image")).toHaveCount(0);
  // Fabric renders a lower- and upper-canvas; assert at least one is shown
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("adding a shape selects it, and undo removes it", async ({ page }) => {
  await uploadImage(page);

  // Clicking a shape tool drops a shape at center and selects it
  await page.getByRole("button", { name: "Rectangle (R)" }).click();
  await expect(page.getByText("Object Properties")).toBeVisible();

  // Ctrl+Z removes the shape, clearing the selection
  await page.keyboard.press("Control+z");
  await expect(page.getByText("Object Properties")).toHaveCount(0);
});

test("keyboard shortcut selects the marquee tool", async ({ page }) => {
  await uploadImage(page);
  // Focus a neutral, non-input element so the shortcut isn't swallowed
  await page.getByText("Image Editor").click();
  await page.keyboard.press("m");
  await expect(page.getByText("Drag to select a region")).toBeVisible();
});

test("exports a PNG", async ({ page }) => {
  await uploadImage(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test("saves a re-editable project file", async ({ page }) => {
  await uploadImage(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.imgedit\.json$/);
});
