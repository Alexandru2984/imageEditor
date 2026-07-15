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

async function getAutosaveJson(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open("image-editor", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("projects")) {
            open.result.createObjectStore("projects");
          }
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("projects", "readonly");
          const request = tx.objectStore("projects").get("autosave");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const value = request.result as
              | { snapshot?: { json?: unknown } }
              | undefined;
            resolve(
              typeof value?.snapshot?.json === "string"
                ? value.snapshot.json
                : null
            );
          };
          tx.oncomplete = () => db.close();
          tx.onabort = () => db.close();
        };
      })
  );
}

async function putAutosave(page: Page, value: unknown): Promise<void> {
  await page.evaluate(
    (record) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("image-editor", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("projects")) {
            open.result.createObjectStore("projects");
          }
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("projects", "readwrite");
          tx.objectStore("projects").put(record, "autosave");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    value
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows the upload screen on first load", async ({ page }) => {
  await expect(page.getByText("Upload an Image")).toBeVisible();
});

test("serves the production bundle with the hardened browser policy", async ({
  page,
  request,
}) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  const headers = response.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).not.toMatch(
    /script-src[^;]*'unsafe-inline'/
  );
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
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

test("rejects hostile filter parameters before Fabric renders them", async ({
  page,
}) => {
  const snapshot = {
    json: JSON.stringify({
      objects: [
        {
          type: "Image",
          filters: [{ type: "Blur", blur: 1_000_000 }],
        },
      ],
    }),
    srcs: [],
  };

  await page.getByTestId("project-input").setInputFiles({
    name: "hostile-filter.imgedit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, snapshot })),
  });

  await expect(page.getByText("Upload an Image")).toBeVisible();
  await expect(page.getByText(/unsafe blur filter value/i)).toBeVisible();
});

test("quarantines an unsafe IndexedDB autosave before Fabric loads it", async ({
  page,
}) => {
  let externalRequestSeen = false;
  page.on("request", (request) => {
    if (request.url().startsWith("https://evil.example/")) {
      externalRequestSeen = true;
    }
  });
  await putAutosave(page, {
    savedAt: Date.now(),
    snapshot: {
      json: JSON.stringify({
        objects: [
          {
            type: "Image",
            src: "https://evil.example/tracker.png",
          },
        ],
      }),
      srcs: [],
    },
  });

  await page.reload();
  await expect(page.getByText(/corrupt local autosave was removed/i)).toBeVisible();
  await expect(page.getByText("Continue last project")).toHaveCount(0);
  await expect.poll(() => getAutosaveJson(page)).toBeNull();
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

test("commits autosaved edits and restores them after reload", async ({
  page,
}) => {
  await uploadImage(page);
  await page.getByRole("button", { name: "Rectangle (R)" }).click();

  await expect
    .poll(() => getAutosaveJson(page))
    .toMatch(/"type":"Rect"/i);

  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByText("Continue last project")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Toggle layers" }).click();
  await expect(page.getByText("Rectangle 1", { exact: true })).toBeVisible();
});

test("new project cannot be overwritten by a pending autosave", async ({
  page,
}) => {
  await uploadImage(page);
  await page.getByRole("button", { name: "Rectangle (R)" }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Start new" }).click();

  await expect(page.getByText("Upload an Image")).toBeVisible();
  await expect.poll(() => getAutosaveJson(page)).toBeNull();
});

test("locked image layers stay visible, protected, and persist", async ({
  page,
}) => {
  await uploadImage(page);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add image layer" }).click();
  await (await fileChooserPromise).setFiles({
    name: "overlay.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });
  await page.getByRole("button", { name: "Toggle layers" }).click();

  await expect(
    page.locator("[data-layer-id]").filter({ hasText: "Background" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unlock Background" })
  ).toBeDisabled();
  await page.getByRole("button", { name: "Lock Image 1" }).click();
  await expect(
    page.getByRole("button", { name: "Unlock Image 1" })
  ).toBeVisible();
  await expect(page.getByLabel("Object fill color")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Align left" })).toBeDisabled();
  await expect(
    page.getByRole("slider", { name: "Brightness filter" })
  ).toBeDisabled();

  // Locking used to mark image layers as background and made them disappear.
  // It must now also protect the selected layer from keyboard deletion.
  await page.keyboard.press("Delete");
  await expect(page.getByText("Image 1", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const savedPath = await (await downloadPromise).path();
  expect(savedPath).toBeTruthy();

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Start new" }).click();
  await page.getByTestId("project-input").setInputFiles(savedPath!);
  await expect(
    page.getByRole("button", { name: "Unlock Image 1" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Unlock Image 1" }).click();
  await page.getByText("Image 1", { exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(page.getByText("Image 1", { exact: true })).toHaveCount(0);
  await expect(
    page.locator("[data-layer-id]").filter({ hasText: "Background" })
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Export PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test("applies and undoes a crop without corrupting the canvas", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await uploadImage(page);

  await page.getByRole("button", { name: "Crop (K)" }).click();
  await page.getByRole("button", { name: "Apply crop" }).click();
  await expect(page.getByRole("button", { name: "Apply crop" })).toHaveCount(0);
  await expect(page.locator("canvas").first()).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(page.locator("canvas").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("runs the pinned background-removal model end to end", async ({ page }) => {
  test.skip(
    process.env.RUN_AI_E2E !== "1",
    "Set RUN_AI_E2E=1 for the network- and compute-heavy model check"
  );
  test.setTimeout(5 * 60_000);
  const inferenceRequests = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co")) {
      inferenceRequests.add(`${url.hostname}${url.pathname}`);
    } else if (
      url.pathname.endsWith(".wasm") ||
      url.pathname.includes("backgroundRemoval.worker")
    ) {
      inferenceRequests.add(
        url.origin === new URL(page.url()).origin
          ? url.pathname
          : `${url.hostname}${url.pathname}`
      );
    }
  });
  await uploadImage(page);

  await page.getByRole("button", { name: "Remove background" }).click();

  try {
    await expect
      .poll(
        async () => {
          const notifications = await page
            .locator("[data-sonner-toast]")
            .allTextContents();
          if (
            notifications.some((message) =>
              message.includes("Background removed successfully!")
            )
          ) {
            return "success";
          }
          return notifications[notifications.length - 1] ?? "waiting";
        },
        { timeout: 4 * 60_000 }
      )
      .toBe("success");
  } finally {
    // Paths only: never print signed redirect query parameters.
    console.log(`AI inference requests: ${JSON.stringify([...inferenceRequests])}`);
  }

  expect(
    [...inferenceRequests].some((path) => path.endsWith(".wasm"))
  ).toBe(true);
  expect(
    [...inferenceRequests].some((path) => path.includes("model_quantized.onnx"))
  ).toBe(true);
  expect(
    [...inferenceRequests].filter((path) => path.includes("cdn.jsdelivr.net"))
  ).toEqual([]);
  expect([...inferenceRequests].filter((path) => path.includes("/main/"))).toEqual(
    []
  );
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
