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

test("serves the production bundle with the hardened browser policy", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  const headers = response.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).not.toMatch(
    /script-src[^;]*'unsafe-inline'/
  );
});

test("uploading an image opens the editor", async ({ page }) => {
  await uploadImage(page);
  await expect(page.getByText("Upload an Image")).toHaveCount(0);
  // Fabric renders a lower- and upper-canvas; assert at least one is shown
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("rejects a spoofed image MIME type before decoding", async ({ page }) => {
  await page.getByTestId("image-input").setInputFiles({
    name: "not-really-a-png.png",
    mimeType: "image/png",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
  });

  await expect(page.getByText("Upload an Image")).toBeVisible();
  await expect(page.getByText(/Unsupported or invalid image/)).toBeVisible();
});

test("recovers when a signed image is still undecodable", async ({ page }) => {
  const corruptPng = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    corruptPng
  );
  Buffer.from("IHDR").copy(corruptPng, 12);
  corruptPng.writeUInt32BE(4, 16);
  corruptPng.writeUInt32BE(4, 20);

  await page.getByTestId("image-input").setInputFiles({
    name: "corrupt.png",
    mimeType: "image/png",
    buffer: corruptPng,
  });

  await expect(page.getByText("Upload an Image")).toBeVisible();
  await expect(page.getByText(/could not be decoded safely/)).toBeVisible();
});

test("rejects project patterns that could fetch an external resource", async ({
  page,
}) => {
  let externalRequestSeen = false;
  page.on("request", (request) => {
    if (request.url().startsWith("https://evil.example/")) {
      externalRequestSeen = true;
    }
  });
  const snapshot = {
    json: JSON.stringify({
      objects: [
        {
          type: "Rect",
          width: 10,
          height: 10,
          fill: {
            type: "pattern",
            source: "https://evil.example/pixel.png",
          },
        },
      ],
    }),
    srcs: [],
  };

  await page.getByTestId("project-input").setInputFiles({
    name: "hostile.imgedit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, snapshot })),
  });

  await expect(page.getByText("Upload an Image")).toBeVisible();
  await expect(page.getByText(/unsupported object type/i)).toBeVisible();
  expect(externalRequestSeen).toBe(false);
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
  await page.getByRole("button", { name: "Arrow (A)" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.imgedit\.json$/);

  const savedPath = await download.path();
  expect(savedPath).toBeTruthy();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Start new" }).click();
  await page.getByTestId("project-input").setInputFiles(savedPath!);
  await expect(page.getByText("Remove BG")).toBeVisible();
});

test("drawing and erasing remain compatible with saved projects", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await uploadImage(page);

  const canvas = page.locator(".upper-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const centerX = box!.x + box!.width / 2;
  const centerY = box!.y + box!.height / 2;

  await page.getByRole("button", { name: "Draw (B)" }).click();
  await page.mouse.move(centerX - 60, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 60, centerY, { steps: 8 });
  await page.mouse.up();

  await page.getByRole("button", { name: "Eraser (E)" }).click();
  await page.mouse.move(centerX, centerY - 30);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY + 30, { steps: 6 });
  await page.mouse.up();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).toBeTruthy();

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Start new" }).click();
  await page.getByTestId("project-input").setInputFiles(savedPath!);
  await expect(page.getByText("Remove BG")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
