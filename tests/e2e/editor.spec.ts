import { test, expect, type FileChooser, type Page } from "@playwright/test";

// A valid 4x4 PNG (red, green, blue and white quadrants) for the upload input.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAI0lEQVR42mN47+LyH4SVjsaBMQOGgHXTt/8g/OvXLzDGEAAAbBUtZYYAvvUAAAAASUVORK5CYII=";

async function uploadImage(page: Page) {
  await page.getByTestId("image-input").setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });
  // The editor replaces the upload screen with the canvas + actions
  await expect(page.getByText("Remove BG")).toBeVisible();
}

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator("canvas.upper-canvas").boundingBox();
  if (!box) throw new Error("Canvas is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const SHAPE_LABELS = new Set([
  "Rectangle (R)",
  "Ellipse (C)",
  "Triangle (Y)",
  "Star (S)",
  "Line (L)",
  "Arrow (A)",
]);

/** Arm a tool; shape tools live in the Shapes flyout. */
async function armTool(page: Page, toolLabel: string) {
  if (SHAPE_LABELS.has(toolLabel)) {
    await page.getByRole("button", { name: "Shapes" }).click();
  }
  await page.getByRole("button", { name: toolLabel }).click();
}

/** Open the export dialog, pick a format and download. */
async function exportAs(page: Page, format: "PNG" | "JPG" | "WebP") {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("radio", { name: format, exact: true }).click();
  await page.getByRole("button", { name: "Download" }).click();
}

/** Arm a shape tool and click the canvas centre to drop a default shape. */
async function addShape(page: Page, toolLabel = "Rectangle (R)") {
  await armTool(page, toolLabel);
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect(page.getByRole("button", { name: "Select (V)" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
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

test("renders unknown routes without logging user-controlled paths", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/missing-%3Cscript%3E");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await page.getByRole("link", { name: "Return to Home" }).click();
  await expect(page.getByText("Upload an Image")).toBeVisible();
  expect(consoleErrors.filter((message) => message.includes("404 Error"))).toEqual(
    []
  );
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

test("supports keyboard upload and labels the core editor controls", async ({
  page,
}) => {
  const upload = page.getByRole("button", { name: "Upload an image" });
  await upload.focus();
  await expect(upload).toBeFocused();

  // Headless Chromium occasionally drops the native chooser event under
  // parallel load; retry the keyboard activation instead of the whole test.
  let fileChooser: FileChooser | null = null;
  for (let attempt = 0; attempt < 3 && !fileChooser; attempt += 1) {
    const chooserPromise = page
      .waitForEvent("filechooser", { timeout: 5_000 })
      .catch(() => null);
    await upload.focus();
    await page.keyboard.press("Enter");
    fileChooser = await chooserPromise;
  }
  if (!fileChooser) throw new Error("The keyboard never opened the file chooser");
  await fileChooser.setFiles({
    name: "keyboard-upload.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });

  await expect(page.getByText("Remove BG")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fit image to screen" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Select (V)" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
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

  // Arming a shape tool and clicking the canvas drops a selected shape
  await addShape(page);
  await expect(page.getByText("Object Properties")).toBeVisible();

  // Ctrl+Z removes the shape, clearing the selection
  await page.keyboard.press("Control+z");
  await expect(page.getByText("Object Properties")).toHaveCount(0);
});

test("coalesces filter changes and stores only active adjustments", async ({
  page,
}) => {
  await uploadImage(page);
  await page.getByRole("tab", { name: "Adjust" }).click();
  const brightness = page.getByRole("slider", { name: "Brightness filter" });
  await brightness.focus();
  await page.keyboard.press("ArrowRight");

  await expect
    .poll(async () => {
      const json = await getAutosaveJson(page);
      if (!json) return null;
      const document = JSON.parse(json) as {
        objects?: Array<{ type?: string; filters?: unknown[] }>;
      };
      return document.objects?.find((object) =>
        object.type?.toLowerCase().includes("image")
      )?.filters?.length;
    })
    .toBe(1);
});

test("keyboard slider edits always reach history and autosave", async ({
  page,
}) => {
  await uploadImage(page);
  await addShape(page);

  const savedRectangleOpacity = async () => {
    const json = await getAutosaveJson(page);
    if (!json) return null;
    const document = JSON.parse(json) as {
      objects?: Array<{ type?: string; opacity?: number }>;
    };
    return document.objects?.find(
      (object) => object.type?.toLowerCase() === "rect"
    )?.opacity;
  };

  await page.getByRole("slider", { name: "Object opacity" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(savedRectangleOpacity).toBe(0.99);

  await page.getByRole("button", { name: "Toggle layers" }).click();
  await page.getByRole("slider", { name: "Layer opacity" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(savedRectangleOpacity).toBe(0.98);
});

test("commits autosaved edits and restores them after reload", async ({
  page,
}) => {
  await uploadImage(page);
  await addShape(page);

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
  await addShape(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Start new" }).click();

  await expect(page.getByText("Upload an Image")).toBeVisible();
  await expect.poll(() => getAutosaveJson(page)).toBeNull();
});

test("a newer clear in another tab blocks a stale pending autosave", async ({
  page,
  context,
}) => {
  const secondPage = await context.newPage();
  await secondPage.goto("/");
  await uploadImage(page);
  await uploadImage(secondPage);

  // Let both initial snapshots settle so the only pending write below is the
  // deliberately stale edit from the first tab.
  await expect.poll(() => getAutosaveJson(page)).not.toBeNull();
  await page.waitForTimeout(900);

  // Open the confirmation first so a single click lands the clear well
  // inside the first tab's autosave delay, even on a loaded machine.
  await secondPage.getByRole("button", { name: "New", exact: true }).click();
  const startNew = secondPage.getByRole("button", { name: "Start new" });
  await expect(startNew).toBeVisible();
  await addShape(page);
  await startNew.click();

  await expect(secondPage.getByText("Upload an Image")).toBeVisible();
  await expect.poll(() => getAutosaveJson(secondPage)).toBeNull();
  await page.waitForTimeout(1_000);
  await expect.poll(() => getAutosaveJson(page)).toBeNull();
  await expect(page.getByText(/newer autosave exists in another tab/i)).toBeVisible();
  await secondPage.close();
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
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByLabel("Object fill color")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Align left" })).toBeDisabled();
  await page.getByRole("tab", { name: "Adjust" }).click();
  await expect(
    page.getByRole("slider", { name: "Brightness filter" })
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Layers" }).click();

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

test("caps synchronous layer thumbnail rendering on large documents", async ({
  page,
}) => {
  await page.evaluate(() => {
    const trackedWindow = window as Window & { __thumbnailRenderCount?: number };
    trackedWindow.__thumbnailRenderCount = 0;
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (
      ...args: Parameters<HTMLCanvasElement["toDataURL"]>
    ) {
      trackedWindow.__thumbnailRenderCount =
        (trackedWindow.__thumbnailRenderCount ?? 0) + 1;
      return original.apply(this, args);
    };
  });

  const snapshot = {
    json: JSON.stringify({
      objects: Array.from({ length: 250 }, (_, index) => ({
        type: "Rect",
        width: 20,
        height: 20,
        left: index % 25,
        top: Math.floor(index / 25),
        fill: "#ff0000",
      })),
    }),
    srcs: [],
  };
  await page.getByTestId("project-input").setInputFiles({
    name: "many-layers.imgedit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, snapshot })),
  });
  await expect(page.getByText("Remove BG")).toBeVisible();
  await page.getByRole("button", { name: "Toggle layers" }).click();
  await expect(page.getByText("Rectangle 250", { exact: true })).toBeVisible();

  const thumbnailRenders = await page.evaluate(
    () =>
      (window as Window & { __thumbnailRenderCount?: number })
        .__thumbnailRenderCount ?? 0
  );
  expect(thumbnailRenders).toBeGreaterThan(0);
  expect(thumbnailRenders).toBeLessThanOrEqual(120);
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
  await exportAs(page, "PNG");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

async function uploadTransparentPng(page: Page, name = "transparent.png") {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByTestId("image-input").setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByText("Remove BG")).toBeVisible();
}

async function samplePixel(
  page: Page,
  file: string,
  mime: string,
  x: number,
  y: number
): Promise<number[]> {
  const fs = await import("node:fs");
  const data = fs.readFileSync(file).toString("base64");
  return page.evaluate(
    async ({ data, mime, x, y }) => {
      const image = new Image();
      image.src = `data:${mime};base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return Array.from(
        ctx.getImageData(
          Math.round(x * image.width),
          Math.round(y * image.height),
          1,
          1
        ).data
      );
    },
    { data, mime, x, y }
  );
}

test("fits an uploaded image centred in the workspace", async ({ page }) => {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#ffff00";
    ctx.fillRect(350, 250, 100, 100);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByTestId("image-input").setInputFiles({
    name: "centred.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByText("Remove BG")).toBeVisible();
  // The yellow square sits at the image centre, so it must be under the
  // centre of the visible canvas when the image is fitted correctly.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const lower = document.querySelector("canvas") as HTMLCanvasElement;
        const ctx = lower.getContext("2d")!;
        const pixel = ctx.getImageData(
          Math.floor(lower.width / 2),
          Math.floor(lower.height / 2),
          1,
          1
        ).data;
        return [pixel[0]! > 200, pixel[1]! > 200, pixel[2]! < 60];
      })
    )
    .toEqual([true, true, true]);
});

test("drag draws a shape where the pointer went, even when zoomed", async ({
  page,
}) => {
  await uploadImage(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await armTool(page, "Rectangle (R)");
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - 60, center.y - 40);
  await page.mouse.down();
  await page.mouse.move(center.x, center.y, { steps: 4 });
  await page.mouse.move(center.x + 60, center.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText("Object Properties")).toBeVisible();

  // The drawn rectangle sits under the drag: its centre pixel is the fill.
  const pixel = await page.evaluate(() => {
    const lower = document.querySelector("canvas") as HTMLCanvasElement;
    const ctx = lower.getContext("2d")!;
    return Array.from(
      ctx.getImageData(
        Math.floor(lower.width / 2),
        Math.floor(lower.height / 2),
        1,
        1
      ).data
    );
  });
  // #a855f7 is the default active colour.
  expect(pixel.slice(0, 3)).toEqual([168, 85, 247]);
});

test("clicking a shape tool twice still adds a second shape", async ({ page }) => {
  await uploadImage(page);
  await addShape(page);
  await addShape(page);
  await page.getByRole("button", { name: "Toggle layers" }).click();
  await expect(page.getByText("Rectangle 2", { exact: true })).toBeVisible();
});

test("Ctrl+Shift+Z redoes an undone edit", async ({ page }) => {
  await uploadImage(page);
  await addShape(page);
  await page.getByText("Image Editor").click();
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();
  await page.keyboard.press("Control+Shift+Z");
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("colour swatches recolour a line's stroke", async ({ page }) => {
  await uploadImage(page);
  await addShape(page, "Line (L)");
  await page.getByRole("button", { name: "Use color #22c55e" }).click();
  await expect
    .poll(async () => {
      const json = await getAutosaveJson(page);
      const objects = json ? (JSON.parse(json).objects as Array<Record<string, unknown>>) : [];
      return objects.find((object) => object.type === "Line")?.stroke ?? null;
    })
    .toBe("#22c55e");
});

test("PNG export keeps transparent pixels transparent", async ({ page }) => {
  await uploadTransparentPng(page);
  const downloadPromise = page.waitForEvent("download");
  await exportAs(page, "PNG");
  const file = await (await downloadPromise).path();
  expect(await samplePixel(page, file!, "image/png", 0.9, 0.9)).toEqual([
    0, 0, 0, 0,
  ]);
  const opaque = await samplePixel(page, file!, "image/png", 0.1, 0.1);
  expect(opaque[0]).toBeGreaterThan(200);
  expect(opaque[3]).toBe(255);
});

test("JPEG export flattens transparency onto white", async ({ page }) => {
  await uploadTransparentPng(page);
  const downloadPromise = page.waitForEvent("download");
  await exportAs(page, "JPG");
  const file = await (await downloadPromise).path();
  const pixel = await samplePixel(page, file!, "image/jpeg", 0.9, 0.9);
  expect(pixel[0]).toBeGreaterThan(240);
  expect(pixel[1]).toBeGreaterThan(240);
  expect(pixel[2]).toBeGreaterThan(240);
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
  await armTool(page, "Arrow (A)");
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

async function autosavedObjects(page: Page): Promise<Array<Record<string, unknown>>> {
  const json = await getAutosaveJson(page);
  return json ? (JSON.parse(json).objects as Array<Record<string, unknown>>) : [];
}

test("crossing the mobile breakpoint keeps the canvas and its history", async ({
  page,
}) => {
  await uploadImage(page);
  await addShape(page);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect
    .poll(async () => (await autosavedObjects(page)).filter((o) => o.type === "Rect").length)
    .toBe(1);
  await page.getByRole("button", { name: "Toggle layers" }).click();
  await expect(page.getByText("Rectangle 1", { exact: true })).toBeVisible();
});

test("export dialog writes WebP at the chosen size and file name", async ({ page }) => {
  await uploadTransparentPng(page, "holiday photo.png");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("radio", { name: "WebP", exact: true }).click();
  await page.getByRole("radio", { name: "50%", exact: true }).click();
  await expect(page.getByTestId("export-dimensions")).toHaveText("32 × 32 px");
  await expect(page.getByLabel("File name")).toHaveValue("holiday-photo");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("holiday-photo.webp");
  const file = await download.path();
  // WebP keeps both the opaque red corner and the transparent rest.
  const red = await samplePixel(page, file!, "image/webp", 0.2, 0.2);
  expect(red[0]).toBeGreaterThan(200);
  expect(red[3]).toBe(255);
  const clear = await samplePixel(page, file!, "image/webp", 0.8, 0.8);
  expect(clear[3]).toBeLessThan(10);
});

test("Ctrl+D duplicates the selected layer and Ctrl+C / Ctrl+V pastes it", async ({
  page,
}) => {
  await uploadImage(page);
  await addShape(page);
  await page.keyboard.press("Control+d");
  await expect
    .poll(async () => (await autosavedObjects(page)).filter((o) => o.type === "Rect").length)
    .toBe(2);
  await page.keyboard.press("Control+c");
  await page.evaluate(() => {
    const event = new ClipboardEvent("paste", { clipboardData: new DataTransfer() });
    document.dispatchEvent(event);
  });
  await expect
    .poll(async () => (await autosavedObjects(page)).filter((o) => o.type === "Rect").length)
    .toBe(3);
  const ids = (await autosavedObjects(page)).map((o) => o.__layerId);
  expect(new Set(ids).size).toBe(ids.length);
});

test("dropping an image onto the editor adds it as a layer", async ({ page }) => {
  await uploadImage(page);
  const center = await canvasCenter(page);
  await page.evaluate(
    async ({ base64, x, y }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      const init = { dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true };
      const target = document.querySelector("canvas.upper-canvas")!;
      target.dispatchEvent(new DragEvent("dragenter", init));
      target.dispatchEvent(new DragEvent("dragover", init));
      target.dispatchEvent(new DragEvent("drop", init));
    },
    { base64: PNG_BASE64, x: center.x, y: center.y }
  );
  await expect
    .poll(async () => (await autosavedObjects(page)).filter((o) => o.type === "Image").length)
    .toBe(2);
});

test("blank canvas presets open a document of the preset size", async ({ page }) => {
  await page.getByRole("button", { name: /New Video thumbnail canvas/ }).click();
  await expect(page.getByText("Remove BG")).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByTestId("export-dimensions")).toHaveText("1280 × 720 px");
});

test("the theme choice applies immediately and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("the colour picker samples the canvas when EyeDropper is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
  });
  await page.reload();
  await uploadTransparentPng(page);
  await page.getByRole("button", { name: "Pick color" }).click();
  const overlay = page.getByRole("button", { name: "Pick a color from the canvas" });
  await expect(overlay).toBeVisible();
  // The uploaded image is red in its top-left quarter, centred on the canvas.
  const center = await canvasCenter(page);
  await page.mouse.click(center.x - 5, center.y - 5);
  await expect(overlay).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Hex color" })).toHaveValue("#ff0000");
});

test("Shift+H mirrors the selected layer", async ({ page }) => {
  await uploadImage(page);
  await addShape(page);
  await page.keyboard.press("Shift+H");
  await expect
    .poll(async () => (await autosavedObjects(page)).find((o) => o.type === "Rect")?.flipX)
    .toBe(true);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("fits the screen without sideways scrolling and opens the panel sheet", async ({
    page,
  }) => {
    await expect(page.getByRole("button", { name: "Upload an image" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByTestId("image-input").setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });
    await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByRole("button", { name: "Toggle properties" }).click();
    await expect(page.getByRole("tab", { name: "Layers" })).toBeVisible();
    await page.getByRole("tab", { name: "Layers" }).click();
    await expect(
      page.locator("[data-layer-id]").filter({ hasText: "Background" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Close panel" }).click();
    await expect(page.getByRole("tab", { name: "Layers" })).toHaveCount(0);
  });
});

test("presets, auto enhance and compare are undoable and never leak into saves", async ({
  page,
}) => {
  await uploadImage(page);
  await page.getByRole("tab", { name: "Adjust" }).click();
  const filterTypes = async () =>
    ((await autosavedObjects(page)).find((o) => o.type === "Image")?.filters as
      | Array<{ type: string }>
      | undefined)?.map((filter) => filter.type) ?? [];

  await page.getByRole("button", { name: "Vintage preset" }).click();
  await expect(page.getByRole("button", { name: "Vintage preset" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect.poll(filterTypes).toEqual(["Vintage", "Contrast", "Noise"]);

  // Holding compare shows the original without touching the saved document.
  const compare = page.getByRole("button", { name: "Hold to compare with the original" });
  await compare.hover();
  await page.mouse.down();
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await expect(compare).toHaveAttribute("aria-pressed", "false");
  await expect.poll(filterTypes).toEqual(["Vintage", "Contrast", "Noise"]);

  await page.getByRole("button", { name: "Auto" }).click();
  await expect.poll(filterTypes).not.toContain("Vintage");

  await page.keyboard.press("Control+z");
  await expect.poll(filterTypes).toEqual(["Vintage", "Contrast", "Noise"]);
  await expect(page.getByRole("button", { name: "Vintage preset" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await page.getByRole("button", { name: "Reset adjustments" }).click();
  await expect.poll(filterTypes).toEqual([]);
});

test("text styles, fonts and effects apply to a text layer and persist", async ({ page }) => {
  await uploadImage(page);
  await page.getByRole("button", { name: "Text (T)" }).click();
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect(page.getByRole("button", { name: "Meme text style" })).toBeVisible();

  await page.getByRole("button", { name: "Meme text style" }).click();
  const textLayer = async () =>
    (await autosavedObjects(page)).find((o) => o.type === "IText") as
      | Record<string, unknown>
      | undefined;
  await expect.poll(async () => (await textLayer())?.fontFamily).toBe("Anton");
  const meme = (await textLayer())!;
  expect(meme.text).toBe("YOUR TEXT");
  expect(meme.stroke).toBe("#000000");
  expect(meme.paintFirst).toBe("stroke");

  await page.getByRole("button", { name: "Font family" }).click();
  await page.getByRole("option", { name: /Playfair Display/ }).click();
  await expect.poll(async () => (await textLayer())?.fontFamily).toBe("Playfair Display");
  expect(await page.evaluate(() => document.fonts.check('32px "Playfair Display"'))).toBe(true);

  await page.getByRole("button", { name: "Shadow", exact: true }).click();
  await expect.poll(async () => (await textLayer())?.shadow).not.toBeNull();
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect.poll(async () => (await textLayer())?.textBackgroundColor).toBeTruthy();

  // The styled layer survives a project round trip.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const savedPath = await (await downloadPromise).path();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Start new" }).click();
  await page.getByTestId("project-input").setInputFiles(savedPath!);
  await expect(page.getByText("Remove BG")).toBeVisible();
  await expect.poll(async () => (await textLayer())?.fontFamily).toBe("Playfair Display");
});

test("stickers are added as scalable layers", async ({ page }) => {
  await uploadImage(page);
  await page.getByRole("button", { name: "Stickers" }).click();
  await page.getByRole("button", { name: "Add sticker 🔥" }).click();
  await expect
    .poll(async () => (await autosavedObjects(page)).find((o) => o.type === "Text")?.text)
    .toBe("🔥");
  // Stickers are not edited like text.
  await expect(page.getByRole("button", { name: "Meme text style" })).toHaveCount(0);
});

async function dragMarquee(page: Page, half = 90) {
  await page.getByRole("button", { name: "Select region (M)" }).click();
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - half, center.y - half);
  await page.mouse.down();
  await page.mouse.move(center.x, center.y, { steps: 4 });
  await page.mouse.move(center.x + half, center.y + half, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Redact" })).toBeVisible();
}

test("redact pixelates a region on a new layer and blacks out another", async ({ page }) => {
  await uploadTransparentPng(page);
  await dragMarquee(page, 25);
  await page.getByRole("button", { name: "Redact" }).click();
  await page.getByRole("menuitem", { name: "Pixelate" }).click();
  await expect
    .poll(async () => {
      const layer = (await autosavedObjects(page)).find((o) => o.name === "Pixelated");
      return (layer?.filters as Array<{ type: string }> | undefined)?.map((f) => f.type);
    })
    .toEqual(["Pixelate"]);
  await expect(page.getByRole("button", { name: "Select (V)" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await dragMarquee(page, 12);
  await page.getByRole("button", { name: "Redact" }).click();
  await page.getByRole("menuitem", { name: "Black out" }).click();
  await expect
    .poll(async () => (await autosavedObjects(page)).find((o) => o.name === "Redaction")?.fill)
    .toBe("#000000");
  // The black box covers the dragged area, not a 1px stub.
  const redaction = (await autosavedObjects(page)).find((o) => o.name === "Redaction")!;
  expect(redaction.width as number).toBeGreaterThan(5);
  expect(Math.abs((redaction.width as number) - (redaction.height as number))).toBeLessThan(1);
  const pixelated = (await autosavedObjects(page)).find((o) => o.name === "Pixelated")!;
  expect((pixelated.width as number) * (pixelated.scaleX as number)).toBeGreaterThan(
    (redaction.width as number) * 1.5
  );

  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await autosavedObjects(page)).some((o) => o.name === "Redaction"))
    .toBe(false);
});

test("right-click menu duplicates, locks and deletes layers", async ({ page }) => {
  await uploadImage(page);
  await addShape(page);
  const center = await canvasCenter(page);
  const rects = async () => (await autosavedObjects(page)).filter((o) => o.type === "Rect");

  await page.mouse.click(center.x, center.y, { button: "right" });
  await expect(page.getByRole("menu", { name: "Layer actions" })).toBeVisible();
  await page.getByRole("menuitem", { name: /Duplicate/ }).click();
  await expect.poll(async () => (await rects()).length).toBe(2);

  // Arrange lives in a submenu; the duplicate (on top) goes to the back.
  await page.mouse.click(center.x, center.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Arrange" }).click();
  await page.getByRole("menuitem", { name: /Send to back/ }).click();
  await expect(page.getByRole("menu", { name: "Layer actions" })).toHaveCount(0);

  await page.mouse.click(center.x, center.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Lock" }).click();
  await expect.poll(async () => (await rects()).filter((o) => o.__locked).length).toBe(1);

  // A locked layer cannot be deleted from the menu until it is unlocked.
  await page.mouse.click(center.x, center.y, { button: "right" });
  await expect(page.getByRole("menuitem", { name: /Delete/ })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Unlock" }).click();
  await page.mouse.click(center.x, center.y, { button: "right" });
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await expect.poll(async () => (await rects()).length).toBe(1);

  // Right-click on empty workspace offers document actions.
  const box = (await page.locator("canvas.upper-canvas").boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + 8, { button: "right" });
  await expect(page.getByRole("menuitem", { name: /Select all layers/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Layer actions" })).toHaveCount(0);
});

test("marquee copy and crop use the dragged region", async ({ page }) => {
  await uploadTransparentPng(page);
  await dragMarquee(page, 20);
  await page.getByRole("button", { name: "New layer", exact: true }).click();
  await expect
    .poll(async () => (await autosavedObjects(page)).filter((o) => o.type === "Image").length)
    .toBe(2);
  const copy = (await autosavedObjects(page)).filter((o) => o.type === "Image")[1]!;
  const copyWidth = (copy.width as number) * (copy.scaleX as number);
  const copyHeight = (copy.height as number) * (copy.scaleY as number);
  const photo = (await autosavedObjects(page)).find((o) => o.name === "Background")!;
  const photoWidth = (photo.width as number) * (photo.scaleX as number);
  // A 40px square drag, not a 1px stub and not the whole photo.
  expect(copyWidth).toBeGreaterThan(5);
  expect(copyWidth).toBeLessThan(photoWidth / 2);
  expect(Math.abs(copyWidth - copyHeight)).toBeLessThan(1);

  // A selection hanging past the photo edge is clamped to the photo.
  await page.getByRole("button", { name: "Select region (M)" }).click();
  const center = await canvasCenter(page);
  await page.mouse.move(center.x - 10, center.y - 10);
  await page.mouse.down();
  await page.mouse.move(center.x + 400, center.y + 300, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Crop to this" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dims = await page.getByTestId("export-dimensions").textContent();
  const [w, h] = (dims ?? "").match(/\d+/g)!.map(Number);
  // Unclamped, the 410×310 drag would not be square; clamped to the photo's
  // bottom-right corner it is.
  expect(w).toBeGreaterThan(5);
  expect(w).toBeLessThan(64);
  expect(Math.abs(w! - h!)).toBeLessThanOrEqual(1);
});

test("smart guides snap a dragged layer to the photo centre", async ({ page }) => {
  await uploadImage(page);
  await addShape(page);
  const center = await canvasCenter(page);

  const centres = async () => {
    const objects = await autosavedObjects(page);
    const photo = objects.find((o) => o.__isBackground)!;
    const rect = objects.find((o) => o.type === "Rect")!;
    const mid = (o: Record<string, unknown>, axis: "x" | "y") =>
      axis === "x"
        ? (o.left as number) + ((o.width as number) * (o.scaleX as number)) / 2
        : (o.top as number) + ((o.height as number) * (o.scaleY as number)) / 2;
    return {
      dx: mid(rect, "x") - mid(photo, "x"),
      dy: mid(rect, "y") - mid(photo, "y"),
      left: rect.left as number,
    };
  };

  await expect
    .poll(async () => (await autosavedObjects(page)).some((o) => o.type === "Rect"))
    .toBe(true);

  /** Drag the selected rectangle away and drop it 3px right, 2px below where it started. */
  const dragNearCentre = async (modifier?: "Alt") => {
    const before = (await centres()).left;
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 60, center.y + 40, { steps: 5 });
    await page.mouse.move(center.x + 3, center.y + 2, { steps: 5 });
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
    await expect.poll(async () => (await centres()).left).not.toBe(before);
  };

  // Start from a layer that is not centred.
  await dragNearCentre("Alt");
  const offset = await centres();
  expect(Math.abs(offset.dx)).toBeGreaterThan(0.5);

  // With snapping on, dropping within 6 screen px lands exactly on the centre.
  await page.mouse.move(center.x + 3, center.y + 2);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y + 30, { steps: 5 });
  await page.mouse.move(center.x + 1, center.y + 1, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await centres()).dx)).toBeLessThan(0.01);
  expect(Math.abs((await centres()).dy)).toBeLessThan(0.01);

  // Turned off from the menu (and remembered), the same drop stays off-centre.
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Snap to guides" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Snap to guides" })).toHaveAttribute(
    "aria-checked",
    "false"
  );
  await page.keyboard.press("Escape");
  await dragNearCentre();
  expect(Math.abs((await centres()).dx)).toBeGreaterThan(0.5);
  expect(await page.evaluate(() => localStorage.getItem("ie-snap"))).toBe("0");
});

test("crop presets frame the photo and the label matches the result", async ({ page }) => {
  await page.getByText("Try a sample photo").click();
  await expect(page.getByText("Remove BG")).toBeVisible();
  await page.getByRole("button", { name: "Crop (K)" }).click();

  const size = page.getByTestId("crop-size");
  await page.getByRole("radio", { name: "16:9" }).click();
  await expect(page.getByRole("radio", { name: "16:9" })).toHaveAttribute("aria-checked", "true");
  await expect(size).toHaveText("1600 × 900 px");
  await page.getByRole("radio", { name: "9:16" }).click();
  await expect(size).toHaveText("562 × 1000 px");
  await page.getByRole("radio", { name: "1:1" }).click();
  await expect(size).toHaveText("1000 × 1000 px");

  await page.getByRole("button", { name: "Apply crop" }).click();
  await expect(page.getByRole("button", { name: "Select (V)" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByTestId("export-dimensions")).toHaveText("1000 × 1000 px");
});

test("brush types change how strokes are drawn and saved", async ({ page }) => {
  await uploadImage(page);
  await page.getByRole("button", { name: "Draw (B)" }).click();
  const center = await canvasCenter(page);
  const stroke = async (dy: number) => {
    await page.mouse.move(center.x - 80, center.y + dy);
    await page.mouse.down();
    await page.mouse.move(center.x, center.y + dy + 20, { steps: 6 });
    await page.mouse.move(center.x + 80, center.y + dy, { steps: 6 });
    await page.mouse.up();
  };
  const paths = async () => (await autosavedObjects(page)).filter((o) => o.type === "Path");

  await page.getByRole("radio", { name: "Highlighter" }).click();
  await expect(page.getByRole("radio", { name: "Highlighter" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  // Too thin to read as a highlighter, so it widens; hardness does not apply.
  await expect(page.getByText("14px")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Brush hardness" })).toHaveCount(0);
  await stroke(-60);
  await expect.poll(async () => (await paths()).length).toBe(1);
  const highlight = (await paths())[0]!;
  expect(highlight.globalCompositeOperation).toBe("multiply");
  expect(highlight.stroke).toMatch(/^rgba\(\d+, \d+, \d+, 0\.45\)$/);

  await page.getByRole("radio", { name: "Dashed" }).click();
  await stroke(0);
  await expect.poll(async () => (await paths()).length).toBe(2);
  const dashed = (await paths())[1]!;
  expect(dashed.strokeDashArray).toEqual([35, 28]);
  expect(dashed.globalCompositeOperation).toBe("source-over");

  await page.getByRole("radio", { name: "Neon" }).click();
  await stroke(60);
  await expect.poll(async () => (await paths()).length).toBe(3);
  const neon = (await paths())[2]! as { shadow?: { blur?: number } | null };
  expect(neon.shadow?.blur).toBeGreaterThanOrEqual(10);
});

test("search and sharing metadata are complete and load under the CSP", async ({
  page,
  request,
}) => {
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (detail: string) => violations.push(detail));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { reportViolation: (d: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`
      );
    });
  });
  await page.goto("/");
  await expect(page).toHaveTitle(/Free Online Photo Editor/);
  // One h1 per view: the hero here, the brand once a photo is open.
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toContainText("Free photo editor");
  const head = page.locator("head");
  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://imageeditor.micutu.com/"
  );
  const description = await head.locator('meta[name="description"]').getAttribute("content");
  expect(description!.length).toBeGreaterThan(70);
  expect(description!.length).toBeLessThanOrEqual(170);
  await expect(head.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://imageeditor.micutu.com/og-image.png"
  );
  const jsonLd = JSON.parse(
    (await head.locator('script[type="application/ld+json"]').textContent()) ?? "{}"
  );
  expect(jsonLd["@type"]).toBe("WebApplication");
  expect(jsonLd.offers.price).toBe("0");

  // Every referenced asset exists with the right type.
  const manifest = await (await request.get("/site.webmanifest")).json();
  const assets: Array<[string, RegExp]> = [
    ["/og-image.png", /image\/png/],
    ["/favicon.svg", /image\/svg\+xml/],
    ["/favicon.ico", /image\/(x-icon|vnd\.microsoft\.icon)/],
    ["/apple-touch-icon.png", /image\/png/],
    ["/robots.txt", /text\/plain/],
    ["/sitemap.xml", /xml/],
    ...(manifest.icons as Array<{ src: string }>).map(
      (icon) => [icon.src, /image\//] as [string, RegExp]
    ),
  ];
  for (const [url, type] of assets) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
    expect(response.headers()["content-type"], url).toMatch(type);
  }
  expect(await (await request.get("/robots.txt")).text()).toContain(
    "Sitemap: https://imageeditor.micutu.com/sitemap.xml"
  );

  // The manifest is fetched by the browser itself (manifest-src).
  await page.waitForLoadState("networkidle");
  expect(violations).toEqual([]);
});

test("editing triggers no Content-Security-Policy violations", async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (detail: string) => violations.push(detail));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { reportViolation: (d: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`
      );
    });
  });
  await page.goto("/");
  await page.getByText("Try a sample photo").click();
  await expect(page.getByText("Remove BG")).toBeVisible();

  // Bundled fonts, WebGL filters, previews, stickers and the export dialog.
  await page.getByRole("button", { name: "Text (T)" }).click();
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  await page.getByRole("button", { name: "Meme text style" }).click();
  await page.getByRole("tab", { name: "Adjust" }).click();
  await page.getByRole("button", { name: "Vivid preset" }).click();
  await page.getByRole("button", { name: "Stickers" }).click();
  await page.getByRole("button", { name: "Add sticker 🔥" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("radio", { name: "WebP", exact: true }).click();
  await expect(page.getByTestId("export-dimensions")).toBeVisible();
  await page.waitForTimeout(500);
  expect(violations).toEqual([]);
});
