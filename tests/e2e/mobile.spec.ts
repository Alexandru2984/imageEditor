import { test, expect, type Locator, type Page } from "@playwright/test";
import { PNG_BASE64, autosavedLayerPixels, autosavedObjects, canvasCenter, uploadSolidImage } from "./helpers";

// Runs in the "mobile" project (a touch phone, see playwright.config.ts).

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/**
 * The element ends up entirely on screen, not clipped by the phone's edges.
 * Retried, because sheets slide in from below.
 */
async function expectOnScreen(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  await expect(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error("Nothing to measure");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
  }).toPass({ timeout: 3_000 });
}

async function openPhoto(page: Page) {
  await page.getByTestId("image-input").setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
}

async function tapCanvasCenter(page: Page) {
  const center = await canvasCenter(page);
  await page.touchscreen.tap(center.x, center.y);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the start screen fits the phone and the sample photo opens", async ({ page }) => {
  await expect(page.locator("h1")).toContainText("Free photo editor");
  await expectOnScreen(page, page.getByRole("button", { name: "Upload an image" }));
  await expectNoSidewaysScroll(page);

  await page.getByText("Try a sample photo").tap();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expectOnScreen(page, page.getByRole("button", { name: "Export", exact: true }));
  await expectNoSidewaysScroll(page);
});

test("fits the screen without sideways scrolling and opens the panel sheet", async ({
  page,
}) => {
  await openPhoto(page);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.getByRole("button", { name: "Toggle properties" }).tap();
  await expect(page.getByRole("tab", { name: "Layers" })).toBeVisible();
  await page.getByRole("tab", { name: "Layers" }).tap();
  await expect(page.locator("[data-layer-id]").filter({ hasText: "Background" })).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).tap();
  await expect(page.getByRole("tab", { name: "Layers" })).toHaveCount(0);
});

test("tapping with the Text tool adds text that can be styled", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Text (T)" }).tap();
  await tapCanvasCenter(page);
  await expect
    .poll(async () => (await autosavedObjects(page)).some((object) => object.type === "IText"))
    .toBe(true);
  // Typing straight away edits the new text.
  await page.keyboard.press("Escape");

  const meme = page.getByRole("button", { name: "Meme text style" });
  if (!(await meme.isVisible())) {
    await page.getByRole("button", { name: "Toggle properties" }).tap();
  }
  await meme.tap();
  await expect
    .poll(
      async () =>
        (await autosavedObjects(page)).find((object) => object.type === "IText")?.fontFamily
    )
    .toBe("Anton");
  await expectNoSidewaysScroll(page);
});

test("stickers and the export dialog fit on the phone", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Stickers" }).tap();
  const sticker = page.getByRole("button", { name: "Add sticker 🔥" });
  await expectOnScreen(page, sticker);
  await sticker.tap();
  await expect
    .poll(async () => (await autosavedObjects(page)).some((object) => object.text === "🔥"))
    .toBe(true);

  await page.getByRole("button", { name: "Export", exact: true }).tap();
  const dialog = page.getByRole("dialog");
  await expectOnScreen(page, dialog);
  await expectOnScreen(page, dialog.getByRole("button", { name: "Download" }));
  await page.getByRole("radio", { name: "JPG", exact: true }).tap();
  await expect(page.getByTestId("export-dimensions")).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test("the crop bar fits on the phone and applies a square crop", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Crop (C)" }).tap();
  await expectOnScreen(page, page.getByRole("button", { name: "Apply crop" }));
  await expectOnScreen(page, page.getByRole("button", { name: "Cancel" }));

  const square = page.getByRole("radio", { name: "1:1" });
  await square.tap();
  await expect(square).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("crop-size")).toHaveText(/^(\d+) × \1 px$/);

  await page.getByRole("button", { name: "Apply crop" }).tap();
  await expect(page.getByRole("button", { name: "Apply crop" })).toHaveCount(0);
  await expectNoSidewaysScroll(page);
});

test("every submenu of the phone menu fits on the screen", async ({ page }) => {
  await openPhoto(page);
  const width = page.viewportSize()!.width;
  for (const name of ["File", "Edit", "Image", "Layer", "Select", "Filter", "View", "Help"]) {
    await page.getByRole("button", { name: "Menu" }).tap();
    await page.getByRole("menuitem", { name, exact: true }).tap();
    const submenu = page.getByRole("menu").nth(1);
    await expect(submenu).toBeVisible();
    await expect.poll(async () => {
      const box = (await submenu.boundingBox())!;
      return box.x >= 0 && box.x + box.width <= width;
    }, { message: `${name} fits` }).toBe(true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
});

test("the menu reaches every command on the phone, on screen", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Menu" }).tap();
  for (const name of ["File", "Edit", "Image", "Layer", "Select", "Filter", "View", "Help"]) {
    await expectOnScreen(page, page.getByRole("menuitem", { name, exact: true }));
  }
  await page.getByRole("menuitem", { name: "View", exact: true }).tap();
  const layersPanel = page.getByRole("menuitemcheckbox", { name: "Layers panel" });
  await expectOnScreen(page, layersPanel);
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: "test-results/mobile-menu.png" });
  await layersPanel.tap();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Layers", selected: true })).toBeVisible();
});

test("rulers show on the phone, and a finger drags a guide out of one", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Menu" }).tap();
  await page.getByRole("menuitem", { name: "View", exact: true }).tap();
  await page.getByRole("menuitemcheckbox", { name: /^Rulers/ }).tap();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  const ruler = page.getByTestId("ruler-vertical");
  await expect(ruler).toBeVisible();
  await expect(page.getByTestId("ruler-horizontal")).toBeVisible();
  await expectNoSidewaysScroll(page);

  const box = (await ruler.boundingBox())!;
  const y = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 10, y }] });
  for (let step = 1; step <= 8; step += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 10 + step * 20, y }] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect
    .poll(async () => {
      const photo = (await autosavedObjects(page)).find((object) => object.__isBackground);
      return (photo?.guides as { axis: string }[] | undefined)?.map((guide) => guide.axis);
    })
    .toEqual(["x"]);
  await page.screenshot({ path: "test-results/mobile-rulers.png" });
});

test("brush settings sit above the tools only while painting", async ({ page }) => {
  await openPhoto(page);
  const options = page.getByRole("group", { name: "Tool options" });
  await expect(options).toHaveCount(0);
  await page.getByRole("button", { name: "Brush (B)" }).tap();
  await expectOnScreen(page, options.getByRole("slider", { name: "Brush size" }));
  await expectOnScreen(page, options.getByRole("group", { name: "Colors" }));
  await expectNoSidewaysScroll(page);

  // Tapping the armed Brush offers the Marker, with its stroke styles.
  await page.getByRole("button", { name: "Brush (B)" }).tap();
  await page.getByRole("button", { name: /^Marker/ }).tap();
  await expect(options.getByRole("radio", { name: "Neon" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Marker (B)" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Select (V)" }).tap();
  await expect(options).toHaveCount(0);
});

test("the command search opens from the menu and fits the phone", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Menu" }).tap();
  await page.getByRole("menuitem", { name: "Help", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^Search commands/ }).tap();
  const palette = page.getByRole("dialog", { name: "Command search" });
  await expectOnScreen(page, palette.getByRole("combobox", { name: "Search commands" }));
  await palette.getByRole("combobox").fill("layers panel");
  await palette.getByRole("option", { name: /Layers panel/ }).tap();
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Layers", selected: true })).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test("a finger paints with the brush on a new pixel layer", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  await page.getByRole("button", { name: "Brush (B)" }).tap();
  const center = await canvasCenter(page);
  await page.touchscreen.tap(center.x, center.y);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[200, 150]]))?.pixels[0]?.[3])
    .toBe(255);
  // No stray handles or menus open; the canvas keeps the screen.
  await expectNoSidewaysScroll(page);
});

test("the paint bucket fills with a tap, its settings on screen", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  await page.getByRole("button", { name: "Paint bucket (G)" }).tap();
  const options = page.getByRole("group", { name: "Tool options" });
  await expectOnScreen(page, options.getByRole("slider", { name: "Fill tolerance" }));
  await expectNoSidewaysScroll(page);
  const center = await canvasCenter(page);
  await page.touchscreen.tap(center.x, center.y);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[10, 10]]))?.pixels[0]?.[3])
    .toBe(255);
});

test("the gradient is picked from the fill tools, its settings on screen", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Paint bucket (G)" }).tap();
  await page.getByRole("button", { name: "Paint bucket (G)" }).tap();
  await page.getByRole("button", { name: /^Gradient/ }).tap();
  await expect(page.getByRole("button", { name: "Gradient (G)" })).toHaveAttribute("aria-pressed", "true");
  const options = page.getByRole("group", { name: "Tool options" });
  await expectOnScreen(page, options.getByRole("radiogroup", { name: "Gradient colors" }));
  await expectNoSidewaysScroll(page);
});

test("selections are made with taps, the modes and actions on screen", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff", [{ x: 0, y: 0, width: 200, height: 300, color: "#00aa00" }]);
  // The lasso group holds the magic wand.
  await page.getByRole("button", { name: "Lasso (L)" }).tap();
  await page.getByRole("button", { name: "Lasso (L)" }).tap();
  await page.getByRole("button", { name: /^Magic wand/ }).tap();
  const options = page.getByRole("group", { name: "Tool options" });
  await expectOnScreen(page, options.getByRole("radiogroup", { name: "Selection mode" }));
  await expectNoSidewaysScroll(page);

  const center = await canvasCenter(page);
  await page.touchscreen.tap(center.x + 40, center.y);
  await expectOnScreen(page, page.getByRole("button", { name: "New layer", exact: true }));
  await expectNoSidewaysScroll(page);
  await page.getByRole("button", { name: "New layer", exact: true }).tap();
  // The white half of the photo.
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Layer 1", [[0, 0]]))?.width)
    .toBe(200);

  // Corner by corner with the polygonal lasso, closed from the task bar.
  await page.getByRole("button", { name: "Magic wand (W)" }).tap();
  await page.getByRole("button", { name: "Magic wand (W)" }).tap();
  await page.getByRole("button", { name: /^Polygonal lasso/ }).tap();
  for (const [dx, dy] of [
    [-40, -40],
    [40, -40],
    [0, 40],
  ]) {
    await page.touchscreen.tap(center.x + dx!, center.y + dy!);
  }
  await expectOnScreen(page, page.getByRole("button", { name: "Close shape" }));
  await page.getByRole("button", { name: "Close shape" }).tap();
  await expectOnScreen(page, page.getByRole("button", { name: "Redact" }));
});

test("the layer style dialog fits the phone and styles the photo", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  await page.getByRole("button", { name: "Menu" }).tap();
  await page.getByRole("menuitem", { name: "Layer", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^Layer style/ }).tap();
  const dialog = page.getByRole("dialog", { name: "Layer style" });
  await dialog.getByLabel("Stroke", { exact: true }).tap();
  await expectOnScreen(page, dialog.getByRole("slider", { name: "Size" }));
  await expectOnScreen(page, dialog.getByRole("radio", { name: "Inside" }));
  await expectNoSidewaysScroll(page);
  await dialog.getByRole("button", { name: "OK" }).tap();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const photo = (await autosavedObjects(page)).find((object) => object.type === "Image");
      return (photo?.layerStyle as { stroke?: { enabled: boolean } } | undefined)?.stroke?.enabled;
    })
    .toBe(true);
});

test("Levels opens from the menu, fits the phone and applies", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080");
  await page.getByRole("button", { name: "Menu" }).tap();
  await page.getByRole("menuitem", { name: "Image", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Adjustments", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^Levels/ }).tap();
  const dialog = page.getByRole("dialog", { name: "Levels" });
  const shadows = dialog.getByRole("slider", { name: "Shadows", exact: true });
  await expectOnScreen(page, shadows);
  await expectNoSidewaysScroll(page);
  await shadows.focus();
  await page.keyboard.press("End");
  await dialog.getByRole("button", { name: "OK" }).tap();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await autosavedLayerPixels(page, "Background", [[200, 150]]))?.pixels[0]?.slice(0, 3))
    .toEqual([0, 0, 0]);
});

test("the Histogram panel opens from the menu and fits over the phone's canvas", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#808080");
  await page.getByRole("button", { name: "Menu" }).tap();
  await page.getByRole("menuitem", { name: "View", exact: true }).tap();
  await page.getByRole("menuitemcheckbox", { name: "Histogram" }).tap();
  await page.keyboard.press("Escape");
  const panel = page.getByRole("region", { name: "Histogram" });
  await expectOnScreen(page, panel);
  await expectNoSidewaysScroll(page);
  await expect(panel.getByRole("term").filter({ hasText: "Mean" }).locator("xpath=following-sibling::dd")).toHaveText(
    "128.00"
  );
  await panel.getByRole("button", { name: "Close histogram" }).tap();
  await expect(panel).toHaveCount(0);
});

test("the clone stamp takes its source from a tap after Set source", async ({ page }) => {
  // Red on the left half, grey on the right.
  await uploadSolidImage(page, 400, 300, "#808080", [{ x: 0, y: 0, width: 200, height: 300, color: "#ff0000" }]);
  await page.getByRole("button", { name: "Clone stamp (S)" }).tap();
  const options = page.getByRole("group", { name: "Tool options" });
  await options.getByRole("button", { name: "Set source" }).tap();
  await expectNoSidewaysScroll(page);
  const center = await canvasCenter(page);
  await page.touchscreen.tap(center.x - 60, center.y);
  await expect(options.getByRole("button", { name: "Set source" })).toHaveAttribute("aria-pressed", "false");
  await page.touchscreen.tap(center.x + 60, center.y);
  // The tap landed on the grey and copied the red there.
  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) => {
          const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
          const box = lower.getBoundingClientRect();
          const ratio = lower.width / box.width;
          return [
            ...lower
              .getContext("2d")!
              .getImageData(Math.round((x - box.left) * ratio), Math.round((y - box.top) * ratio), 1, 1)
              .data.slice(0, 3),
          ];
        },
        { x: center.x + 60, y: center.y }
      )
    )
    .toEqual([255, 0, 0]);
});

test("a finger drags a layer by its handle, and the layer options fit the screen", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Toggle properties" }).tap();
  await page.getByRole("tab", { name: "Layers" }).tap();
  await page.getByRole("button", { name: "Create a new layer" }).tap();
  await page.getByRole("button", { name: "Create a new layer" }).tap();
  const names = async () => (await autosavedObjects(page)).map((object) => object.name);
  await expect.poll(names).toEqual(["Background", "Layer 1", "Layer 2"]);

  // Layer 1's handle, dragged up over the top half of Layer 2: real touch events.
  const handle = (await page.getByLabel("Drag Layer 1").boundingBox())!;
  const target = (await page.getByRole("group", { name: "Layer 2 layer" }).boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const at = (x: number, y: number) => [{ x: Math.round(x), y: Math.round(y) }];
  let x = handle.x + handle.width / 2;
  let y = handle.y + handle.height / 2;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(x, y) });
  const toY = target.y + 6;
  for (let step = 1; step <= 8; step += 1) {
    y += (toY - y) / (9 - step);
    x += 0;
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(x, y) });
  }
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(names).toEqual(["Background", "Layer 2", "Layer 1"]);

  await page.getByRole("button", { name: "Layer options" }).tap();
  await expectOnScreen(page, page.getByRole("menu", { name: "Layer options" }));
  await page.getByRole("menuitem", { name: /Group layers/ }).tap();
  await expect.poll(names).toEqual(["Background", "Layer 2", undefined, "Layer 1", "Group 1"]);
  await expectNoSidewaysScroll(page);
});

test("an adjustment layer is added from the Layers panel and set in Properties on the phone", async ({ page }) => {
  await openPhoto(page);
  await page.getByRole("button", { name: "Toggle properties" }).tap();
  await page.getByRole("tab", { name: "Layers" }).tap();
  await page.getByRole("button", { name: "Add a fill or adjustment layer" }).tap();
  const menu = page.getByRole("menu", { name: "Add a fill or adjustment layer" });
  await expectOnScreen(page, menu);
  await menu.getByRole("menuitem", { name: /^Levels/ }).tap();
  const settings = page.getByRole("region", { name: "Adjustment settings" });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("Levels");
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.type)).toEqual(["Image", "AdjustmentLayer"]);
  await expectNoSidewaysScroll(page);
});

test("a dialog opened from the phone menu leaves the page tappable when it closes", async ({ page }) => {
  await openPhoto(page);
  for (const [menu, item, title] of [
    ["Image", "Image Size…", "Image Size"],
    ["Select", "Color Range…", "Color Range"],
  ] as const) {
    await page.getByRole("button", { name: "Menu" }).tap();
    await page.getByRole("menuitem", { name: menu, exact: true }).tap();
    await page.getByRole("menuitem", { name: item }).first().tap();
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).tap();
    await expect(dialog).toBeHidden();
    // Menus and dialogs share one record of what blocks the page, so it is unblocked again.
    await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).not.toBe("none");
  }
  await page.getByRole("button", { name: "Menu" }).tap();
  await expect(page.getByRole("menuitem", { name: "File", exact: true })).toBeVisible();
});

test("Liquify fits the phone, its buttons clear of OK and Cancel", async ({ page }) => {
  await uploadSolidImage(page, 400, 300);
  await page.getByRole("button", { name: "Menu" }).tap();
  await page.getByRole("menuitem", { name: "Filter", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^Liquify/ }).tap();
  const dialog = page.getByRole("dialog", { name: "Liquify" });
  await expect(dialog.getByRole("toolbar", { name: "Liquify tools" })).toBeVisible();
  await expectNoSidewaysScroll(page);
  const thaw = await dialog.getByRole("button", { name: "Thaw All" }).boundingBox();
  const ok = await dialog.getByRole("button", { name: "OK" }).boundingBox();
  // Stacked, not on top of each other; the dialog scrolls to reach them.
  expect(thaw!.y + thaw!.height).toBeLessThanOrEqual(ok!.y);
  await dialog.getByRole("button", { name: "Cancel" }).scrollIntoViewIfNeeded();
  await expectOnScreen(page, dialog.getByRole("button", { name: "Cancel" }));
  await dialog.getByRole("button", { name: "Cancel" }).tap();
  await expect(dialog).toHaveCount(0);
});
