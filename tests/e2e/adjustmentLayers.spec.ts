import { test, expect, type Page } from "@playwright/test";
import { autosavedLayerPixels, autosavedObjects, chooseMenu, chooseSubmenu, settle } from "./helpers";
import { BLEND_IDS, blendColors } from "../../src/compositing/blendMath";
import {
  applyLuts,
  blackWhite,
  brightnessContrastLut,
  colorBalance,
  curvesLuts,
  defaultColorBalance,
  defaultCurves,
  defaultLevels,
  exposureLut,
  gradientMap,
  gradientMapLuts,
  hueSaturation,
  invertLut,
  levelsLuts,
  posterizeLut,
  threshold,
  uniformLuts,
} from "../../src/raster/adjustments";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop adjustment tests");
  await page.goto("/");
});

/** Six stripes across the photo, each its own colour. */
const STRIPES: [number, number, number][] = [
  [200, 100, 50],
  [50, 150, 200],
  [224, 192, 64],
  [30, 30, 30],
  [240, 240, 240],
  [128, 128, 128],
];
const WIDTH = 240;
const HEIGHT = 60;

async function stripedPng(page: Page, columns = STRIPES.length): Promise<string> {
  return page.evaluate(
    ({ stripes, width, height, columns }) => {
      const canvas = document.createElement("canvas");
      canvas.width = (width / stripes.length) * columns;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      stripes.slice(0, columns).forEach(([r, g, b], index) => {
        context.fillStyle = `rgb(${r}, ${g}, ${b})`;
        context.fillRect((index * width) / stripes.length, 0, width / stripes.length, height);
      });
      return canvas.toDataURL("image/png");
    },
    { stripes: STRIPES, width: WIDTH, height: HEIGHT, columns }
  );
}

/** A photo-sized PNG all of LAYER_COLOUR. */
const LAYER_COLOUR: [number, number, number] = [100, 180, 60];
async function solidPng(page: Page): Promise<string> {
  return page.evaluate(
    ({ colour, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = `rgb(${colour.join(", ")})`;
      context.fillRect(0, 0, width, height);
      return canvas.toDataURL("image/png");
    },
    { colour: LAYER_COLOUR, width: WIDTH, height: HEIGHT }
  );
}

const image = (src: string, width: number, extra: Record<string, unknown> = {}) => ({
  type: "Image",
  version: "7.0.0",
  originX: "left",
  originY: "top",
  left: 0,
  top: 0,
  width,
  height: HEIGHT,
  scaleX: 1,
  scaleY: 1,
  src,
  ...extra,
});

/** Open a project of the striped photo with more objects above it. */
async function openProject(page: Page, objects: (srcs: string[]) => Record<string, unknown>[]) {
  const srcs = [await stripedPng(page), await stripedPng(page, 3), await solidPng(page)];
  const photo = image("__snapshot_src_0", WIDTH, { __isBackground: true, name: "Background", selectable: false, evented: false, __layerId: "photo" });
  const snapshot = { json: JSON.stringify({ version: "7.0.0", objects: [photo, ...objects(srcs)] }), srcs };
  await page.getByTestId("project-input").setInputFiles({
    name: "adjusted.imgedit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, snapshot })),
  });
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect.poll(async () => (await autosavedObjects(page)).length).toBeGreaterThan(0);
  await settle(page);
}

const adjustment = (id: string, value: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "AdjustmentLayer",
  version: "7.0.0",
  __layerId: id,
  name: id,
  adjustment: value,
  ...extra,
});

/** What the screen shows at the middle of each stripe. */
async function stripes(page: Page): Promise<number[][]> {
  return page.evaluate((count) => {
    const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
    const { data, width, height } = lower.getContext("2d")!.getImageData(0, 0, lower.width, lower.height);
    const row = Math.floor(height / 2);
    const opaque = (x: number) => data[(row * width + x) * 4 + 3]! > 0;
    let left = 0;
    while (left < width && !opaque(left)) left += 1;
    let right = width - 1;
    while (right > left && !opaque(right)) right -= 1;
    const span = right - left + 1;
    return Array.from({ length: count }, (_, index) => {
      const x = Math.round(left + ((index + 0.5) * span) / count);
      return [...data.slice((row * width + x) * 4, (row * width + x) * 4 + 3)];
    });
  }, STRIPES.length);
}

/** Each stripe's colour through a pixel function from src/raster/adjustments.ts. */
function expected(apply: (source: Uint8ClampedArray, target: Uint8ClampedArray) => void): number[][] {
  return STRIPES.map((colour) => {
    const source = new Uint8ClampedArray([...colour, 255]);
    const target = new Uint8ClampedArray(4);
    apply(source, target);
    return [...target.slice(0, 3)];
  });
}

const near = (actual: number[][], wanted: number[][], tolerance = 2) => {
  for (let index = 0; index < wanted.length; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs(actual[index]![channel]! - wanted[index]![channel]!), `stripe ${index} channel ${channel}: ${actual[index]} vs ${wanted[index]}`).toBeLessThanOrEqual(
        tolerance
      );
    }
  }
};

const original = STRIPES.map((colour) => [...colour]);

const levels = defaultLevels();
levels.rgb = { inBlack: 20, inWhite: 220, gamma: 1.4, outBlack: 10, outWhite: 245 };
levels.blue = { inBlack: 0, inWhite: 200, gamma: 0.8, outBlack: 0, outWhite: 255 };
const curves = defaultCurves();
curves.rgb = [
  [0, 0],
  [64, 40],
  [190, 220],
  [255, 255],
];
curves.red = [
  [0, 30],
  [255, 230],
];
const balance = { ...defaultColorBalance(), shadows: [20, -10, 5] as [number, number, number], midtones: [-30, 40, 10] as [number, number, number] };

/** Each kind with settings, and the same change made by src/raster/adjustments.ts. */
const CASES: [string, Record<string, unknown>, (source: Uint8ClampedArray, target: Uint8ClampedArray) => void][] = [
  ["Invert", { kind: "invert", settings: {} }, (s, t) => applyLuts(s, t, uniformLuts(invertLut()))],
  ["Levels", { kind: "levels", settings: levels }, (s, t) => applyLuts(s, t, levelsLuts(levels))],
  ["Curves", { kind: "curves", settings: curves }, (s, t) => applyLuts(s, t, curvesLuts(curves))],
  [
    "Brightness/Contrast",
    { kind: "brightnessContrast", settings: { brightness: 40, contrast: 30 } },
    (s, t) => applyLuts(s, t, uniformLuts(brightnessContrastLut({ brightness: 40, contrast: 30 }))),
  ],
  [
    "Exposure",
    { kind: "exposure", settings: { exposure: 0.7, offset: 0.02, gamma: 1.2 } },
    (s, t) => applyLuts(s, t, uniformLuts(exposureLut({ exposure: 0.7, offset: 0.02, gamma: 1.2 }))),
  ],
  ["Posterize", { kind: "posterize", settings: { levels: 3 } }, (s, t) => applyLuts(s, t, uniformLuts(posterizeLut(3)))],
  ["Threshold", { kind: "threshold", settings: { level: 120 } }, (s, t) => threshold(s, t, 120)],
  [
    "Gradient Map",
    { kind: "gradientMap", settings: { from: "#200040", to: "#ffd080", reverse: false } },
    (s, t) => gradientMap(s, t, gradientMapLuts({ from: "#200040", to: "#ffd080", reverse: false })),
  ],
  [
    "Black & White",
    { kind: "blackWhite", settings: { reds: 70, yellows: 20, greens: -40, cyans: 110, blues: 30, magentas: 80 } },
    (s, t) => blackWhite(s, t, { reds: 70, yellows: 20, greens: -40, cyans: 110, blues: 30, magentas: 80 }),
  ],
  [
    "Hue/Saturation",
    { kind: "hueSaturation", settings: { hue: 50, saturation: -30, lightness: 15, colorize: false } },
    (s, t) => hueSaturation(s, t, { hue: 50, saturation: -30, lightness: 15, colorize: false }),
  ],
  [
    "Hue/Saturation, colorized",
    { kind: "hueSaturation", settings: { hue: 200, saturation: 60, lightness: -20, colorize: true } },
    (s, t) => hueSaturation(s, t, { hue: 200, saturation: 60, lightness: -20, colorize: true }),
  ],
  ["Color Balance", { kind: "colorBalance", settings: balance }, (s, t) => colorBalance(s, t, balance)],
  [
    "Color Balance, without preserving luminosity",
    { kind: "colorBalance", settings: { ...balance, preserveLuminosity: false } },
    (s, t) => colorBalance(s, t, { ...balance, preserveLuminosity: false }),
  ],
];

for (const [name, value, apply] of CASES) {
  test(`a ${name} adjustment layer shows the photo as Image › Adjustments would change it`, async ({ page }) => {
    await openProject(page, () => [adjustment("adjust", value)]);
    await expect.poll(() => stripes(page)).not.toEqual(original);
    near(await stripes(page), expected(apply));
  });
}

test("opacity, blend mode, clipping and isolated groups limit what an adjustment layer changes", async ({ page }) => {
  const inverted = STRIPES.map((colour) => colour.map((value) => 255 - value));
  // Half strength, multiplied: each colour times its inverse, half way there.
  await openProject(page, () => [adjustment("adjust", { kind: "invert", settings: {} }, { opacity: 0.5, globalCompositeOperation: "multiply" })]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(
    await stripes(page),
    STRIPES.map((colour) => colour.map((value) => Math.round(value + ((value * (255 - value)) / 255 - value) * 0.5)))
  );

  // Clipped to a layer over the left half: only that half changes.
  await page.goto("/");
  await openProject(page, () => [
    image("__snapshot_src_1", WIDTH / 2, { __layerId: "left", name: "Left" }),
    adjustment("adjust", { kind: "invert", settings: {} }, { __clipped: true }),
  ]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(await stripes(page), [...inverted.slice(0, 3), ...original.slice(3)]);

  // In an isolated group with that layer: the same; in a Pass Through one, all of it.
  for (const passThrough of [false, true]) {
    await page.goto("/");
    await openProject(page, () => [
      { type: "LayerGroupEnd", version: "7.0.0", __layerId: "end" },
      image("__snapshot_src_1", WIDTH / 2, { __layerId: "left", name: "Left" }),
      adjustment("adjust", { kind: "invert", settings: {} }),
      { type: "LayerGroup", version: "7.0.0", __layerId: "group", name: "Group 1", passThrough },
    ]);
    await expect.poll(() => stripes(page)).not.toEqual(original);
    near(await stripes(page), passThrough ? inverted : [...inverted.slice(0, 3), ...original.slice(3)]);
  }
});

test("an adjustment layer is made from the Layer menu, set in Properties, and kept apart from the pixels", async ({ page }) => {
  await openProject(page, () => []);
  const photoSrc = (await autosavedObjects(page))[0]!.src;
  await chooseSubmenu(page, "Layer", "New adjustment layer", "Hue/Saturation…");
  // Its settings open in the Properties panel.
  const settings = page.getByRole("region", { name: "Adjustment settings" });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("Hue/Saturation");
  await settings.getByRole("slider", { name: "Saturation" }).focus();
  await page.keyboard.press("Home");
  // No saturation: every stripe its HSL lightness.
  const grey = expected((s, t) => hueSaturation(s, t, { hue: 0, saturation: -100, lightness: 0, colorize: false }));
  await expect.poll(async () => near(await stripes(page), grey)).toBeUndefined();
  await expect.poll(async () => (await autosavedObjects(page)).at(-1)?.adjustment).toMatchObject({ settings: { saturation: -100 } });
  // The photo's pixels are as they were.
  expect((await autosavedObjects(page))[0]!.src).toBe(photoSrc);

  // In the Layers panel: a row with its icon, hidden with its eye, back with undo.
  await page.getByRole("tab", { name: "Layers" }).click();
  const row = page.getByRole("group", { name: "Hue/Saturation 1 layer" });
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(row.getByRole("button", { name: "Settings of Hue/Saturation 1" })).toBeVisible();
  await row.getByRole("button", { name: "Hide Hue/Saturation 1" }).click();
  await expect.poll(() => stripes(page)).toEqual(original);
  await expect.poll(async () => (await autosavedObjects(page)).at(-1)?.visible).toBe(false);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => near(await stripes(page), grey)).toBeUndefined();

  // Double-clicking its icon opens its settings again.
  await row.getByRole("button", { name: "Settings of Hue/Saturation 1" }).dblclick();
  await expect(settings).toBeVisible();

  // It stays after a reload (once saved shown again).
  await expect.poll(async () => (await autosavedObjects(page)).at(-1)?.visible).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect.poll(async () => near(await stripes(page), grey)).toBeUndefined();

  // Flatten bakes it into the photo.
  await chooseMenu(page, "Layer", "Flatten image");
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.type)).toEqual(["Image"]);
  const baked = await autosavedLayerPixels(page, "Background", [[20, 30]]);
  near([baked!.pixels[0]!.slice(0, 3)], [grey[0]!]);
});

test("an adjustment layer is picked, duplicated, merged down and deleted from the Layers panel", async ({ page }) => {
  await openProject(page, (srcs) => [image("__snapshot_src_1", WIDTH / 2, { __layerId: "left", name: "Left" }), adjustment("Invert 1", { kind: "invert", settings: {} })]);
  void (await stripes(page));
  await page.getByRole("tab", { name: "Layers" }).click();
  const row = (name: string) => page.getByRole("group", { name: `${name} layer` });
  await row("Invert 1").click();
  await expect(row("Invert 1")).toHaveAttribute("aria-current", "true");
  // Picked in the panel only: nothing is selected on the canvas.
  await page.keyboard.press("Control+j");
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.name)).toEqual(["Background", "Left", "Invert 1", "Invert 1 copy"]);
  // Two inversions cancel out.
  await expect.poll(() => stripes(page)).toEqual(original);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.name)).toEqual(["Background", "Left", "Invert 1"]);

  // Merge down applies it to the layer below's pixels.
  await row("Invert 1").click();
  await page.keyboard.press("Control+e");
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => `${object.type}:${object.name}`)).toEqual(["Image:Background", "Image:Left"]);
  const left = await autosavedLayerPixels(page, "Left", [[20, 30]]);
  expect(left!.pixels[0]!.slice(0, 3)).toEqual(STRIPES[0]!.map((value) => 255 - value));
});

/** The document's box on screen, from the pixels the canvas shows. */
async function documentBox(page: Page) {
  return page.evaluate(() => {
    const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
    const { data, width, height } = lower.getContext("2d")!.getImageData(0, 0, lower.width, lower.height);
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (data[(y * width + x) * 4 + 3]! === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    const box = lower.getBoundingClientRect();
    const ratio = lower.width / box.width;
    return { left: box.left + left / ratio, top: box.top + top / ratio, width: (right - left) / ratio, height: (bottom - top) / ratio };
  });
}

type Box = Awaited<ReturnType<typeof documentBox>>;
const at = (box: Box, x: number, y: number) => ({ x: box.left + box.width * x, y: box.top + box.height * y });

/** A rectangle selection from one fraction of the document to another. */
async function selectPart(page: Page, box: Box, from: [number, number], to: [number, number]) {
  await page.keyboard.press("m");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Rectangle select");
  const start = at(box, ...from);
  const end = at(box, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

const inverted = STRIPES.map((colour) => colour.map((value) => 255 - value));
const leftKept = [...original.slice(0, 3), ...inverted.slice(3)];
const maskOf = async (page: Page) =>
  (await autosavedObjects(page)).find((object) => object.type === "AdjustmentLayer")?.layerMask as
    | { src: string; enabled: boolean }
    | undefined;

test("the paint tools paint a picked adjustment layer's mask, which hides it where black", async ({ page }) => {
  await openProject(page, () => [adjustment("Invert 1", { kind: "invert", settings: {} })]);
  await expect.poll(() => stripes(page)).toEqual(inverted);
  const box = await documentBox(page);
  await page.getByRole("tab", { name: "Layers" }).click();
  const row = page.getByRole("group", { name: "Invert 1 layer" });
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");

  // Black (the default foreground) into the left half of its mask.
  await page.keyboard.press("d");
  await selectPart(page, box, [0.002, -0.3], [0.5, 1.3]);
  await page.keyboard.press("g");
  await expect(page.getByRole("group", { name: "Tool options" })).toContainText("Paint bucket");
  const inside = at(box, 0.25, 0.5);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(async () => near(await stripes(page), leftKept)).toBeUndefined();
  // Its mask, shown in the Layers panel; no layer was added and the photo is as it was.
  await expect.poll(async () => (await maskOf(page))?.enabled).toBe(true);
  await expect(row.getByRole("button", { name: "Invert 1 layer mask" })).toBeVisible();
  expect((await autosavedObjects(page)).map((object) => object.type)).toEqual(["Image", "AdjustmentLayer"]);
  const photo = await autosavedLayerPixels(page, "Background", [[20, 30]]);
  expect(photo!.pixels[0]!.slice(0, 3)).toEqual(STRIPES[0]);

  // Shift+click on the mask turns it off, and back on.
  await row.getByRole("button", { name: "Invert 1 layer mask" }).click({ modifiers: ["Shift"] });
  await expect.poll(() => stripes(page)).toEqual(inverted);
  await row.getByRole("button", { name: "Invert 1 layer mask" }).click({ modifiers: ["Shift"] });
  await expect.poll(async () => near(await stripes(page), leftKept)).toBeUndefined();

  // Undone step by step, the layer has no mask again; redone, it is back.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await maskOf(page))?.enabled).toBe(false);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await maskOf(page))?.enabled).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(() => maskOf(page)).toBeUndefined();
  await expect.poll(() => stripes(page)).toEqual(inverted);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await maskOf(page))?.enabled).toBe(true);
  await expect.poll(async () => near(await stripes(page), leftKept)).toBeUndefined();

  // It stays after a reload, and Flatten keeps the inversion to the right half.
  await expect.poll(async () => (await maskOf(page))?.src).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect.poll(async () => near(await stripes(page), leftKept)).toBeUndefined();
  await chooseMenu(page, "Layer", "Flatten image");
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.type)).toEqual(["Image"]);
  const flat = await autosavedLayerPixels(page, "Background", [
    [20, 30],
    [220, 30],
  ]);
  expect(flat!.pixels[0]!.slice(0, 3)).toEqual(STRIPES[0]);
  expect(flat!.pixels[1]!.slice(0, 3)).toEqual(inverted[5]);
});

test("a selection becomes the mask of a new adjustment layer", async ({ page }) => {
  await openProject(page, () => []);
  const box = await documentBox(page);
  await selectPart(page, box, [0.5, -0.3], [1.1, 1.3]);
  await chooseSubmenu(page, "Layer", "New adjustment layer", "Invert");
  // Only the selected right half is inverted, and the selection is gone.
  await expect.poll(async () => near(await stripes(page), leftKept)).toBeUndefined();
  await expect.poll(async () => (await maskOf(page))?.enabled).toBe(true);
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.name)).toEqual(["Background", "Invert 1"]);
  // One step made it: undone, nothing is left of it.
  await page.keyboard.press("Control+z");
  await expect.poll(() => stripes(page)).toEqual(original);
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.name)).toEqual(["Background"]);
});

const fillLayer = (id: string, fillContent: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "FillLayer",
  version: "7.0.0",
  __layerId: id,
  name: id,
  fillContent,
  ...extra,
});

const BLUE = [51, 102, 204];

test("a Color Fill layer covers the document with its colour, opacity and blend mode", async ({ page }) => {
  await openProject(page, () => [fillLayer("Color Fill 1", { kind: "solid", color: "#3366cc" })]);
  await expect.poll(() => stripes(page)).toEqual(STRIPES.map(() => BLUE));

  await page.goto("/");
  await openProject(page, () => [fillLayer("Color Fill 1", { kind: "solid", color: "#3366cc" }, { opacity: 0.5 })]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(await stripes(page), STRIPES.map((colour) => colour.map((value, channel) => (value + BLUE[channel]!) / 2)));

  await page.goto("/");
  await openProject(page, () => [fillLayer("Color Fill 1", { kind: "solid", color: "#3366cc" }, { globalCompositeOperation: "multiply" })]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(await stripes(page), STRIPES.map((colour) => colour.map((value, channel) => (value * BLUE[channel]!) / 255)));

  // Clipped to a layer over the left half: only there.
  await page.goto("/");
  await openProject(page, () => [
    image("__snapshot_src_1", WIDTH / 2, { __layerId: "left", name: "Left" }),
    fillLayer("Color Fill 1", { kind: "solid", color: "#3366cc" }, { __clipped: true }),
  ]);
  await expect.poll(() => stripes(page)).toEqual([BLUE, BLUE, BLUE, ...original.slice(3)]);
});

test("a Gradient Fill layer lays its gradient over the document", async ({ page }) => {
  const gradient = { kind: "gradient", from: "#000000", to: "#ffffff", style: "linear", angle: 0, scale: 100, reverse: false };
  const across = STRIPES.map((_, index) => {
    const value = (255 * (index + 0.5)) / STRIPES.length;
    return [value, value, value];
  });
  await openProject(page, () => [fillLayer("Gradient Fill 1", gradient)]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(await stripes(page), across, 4);

  // Reversed, it runs the other way; reflected, from black in the middle.
  await page.goto("/");
  await openProject(page, () => [fillLayer("Gradient Fill 1", { ...gradient, reverse: true })]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(await stripes(page), [...across].reverse(), 4);

  await page.goto("/");
  await openProject(page, () => [fillLayer("Gradient Fill 1", { ...gradient, style: "reflected" })]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(
    await stripes(page),
    STRIPES.map((_, index) => {
      const value = 255 * Math.abs(((index + 0.5) / STRIPES.length - 0.5) * 2);
      return [value, value, value];
    }),
    4
  );
});

test("a fill layer is made from the Layer menu, set in Properties, and merged into the layer below", async ({ page }) => {
  await openProject(page, () => [image("__snapshot_src_1", WIDTH / 2, { __layerId: "left", name: "Left" })]);
  // Black, the default foreground.
  await page.keyboard.press("d");
  await chooseSubmenu(page, "Layer", "New fill layer", "Solid color…");
  const settings = page.getByRole("region", { name: "Fill settings" });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("Color Fill");
  await expect.poll(() => stripes(page)).toEqual(STRIPES.map(() => [0, 0, 0]));
  await settings.getByLabel("Fill colour").fill("#3366cc");
  await expect.poll(() => stripes(page)).toEqual(STRIPES.map(() => BLUE));
  await expect
    .poll(async () => (await autosavedObjects(page)).at(-1)?.fillContent)
    .toEqual({ kind: "solid", color: "#3366cc" });

  // In the Layers panel, with its swatch; undone, black again.
  await page.getByRole("tab", { name: "Layers" }).click();
  const row = page.getByRole("group", { name: "Color Fill 1 layer" });
  await expect(row).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Control+z");
  await expect.poll(() => stripes(page)).toEqual(STRIPES.map(() => [0, 0, 0]));
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => stripes(page)).toEqual(STRIPES.map(() => BLUE));

  // It stays after a reload.
  await expect.poll(async () => ((await autosavedObjects(page)).at(-1)?.fillContent as { color?: string })?.color).toBe("#3366cc");
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect.poll(() => stripes(page)).toEqual(STRIPES.map(() => BLUE));

  // Double-clicking its swatch opens its settings again; Merge Down makes it pixels over the whole document.
  await page.getByRole("tab", { name: "Layers" }).click();
  await row.getByRole("button", { name: "Settings of Color Fill 1" }).dblclick();
  await expect(settings).toBeVisible();
  await page.getByRole("tab", { name: "Layers" }).click();
  await row.click();
  await page.keyboard.press("Control+e");
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => `${object.type}:${object.name}`)).toEqual(["Image:Background", "Image:Left"]);
  await expect.poll(() => stripes(page)).toEqual(STRIPES.map(() => BLUE));
  const merged = await autosavedLayerPixels(page, "Left", [[220, 30]]);
  expect(merged!.pixels[0]).toEqual([...BLUE, 255]);
});

test("a selection becomes the mask of a new fill layer", async ({ page }) => {
  await openProject(page, () => []);
  const box = await documentBox(page);
  await selectPart(page, box, [0.5, -0.3], [1.1, 1.3]);
  await page.keyboard.press("d");
  await chooseSubmenu(page, "Layer", "New fill layer", "Solid color…");
  await expect.poll(async () => near(await stripes(page), [...original.slice(0, 3), [0, 0, 0], [0, 0, 0], [0, 0, 0]])).toBeUndefined();
  await expect.poll(async () => (await autosavedObjects(page)).at(-1)?.layerMask).toMatchObject({ enabled: true });
});

const CUSTOM_MODES = ["linear-burn", "linear-dodge", "vivid-light", "linear-light", "pin-light", "hard-mix", "subtract", "divide", "darker-color", "lighter-color"];

/** Each stripe with `source` over it in `mode`, by the formulas in blendMath.ts. */
const blendedStripes = (mode: string, source: (colour: number[]) => number[]) =>
  STRIPES.map((colour) => {
    const cb = colour.map((value) => value / 255) as [number, number, number];
    const cs = source(colour).map((value) => value / 255) as [number, number, number];
    return blendColors(BLEND_IDS[mode]!, cb, cs).map((value) => value * 255);
  });

for (const mode of CUSTOM_MODES) {
  test(`a layer in ${mode} blends as Photoshop's formula says`, async ({ page }) => {
    await openProject(page, () => [image("__snapshot_src_2", WIDTH, { __layerId: "top", name: "Top", globalCompositeOperation: mode })]);
    await expect.poll(() => stripes(page)).not.toEqual(STRIPES.map(() => LAYER_COLOUR));
    near(await stripes(page), blendedStripes(mode, () => LAYER_COLOUR));
  });
}

test("Photoshop's own blend modes work on groups, clipped layers and adjustment layers too", async ({ page }) => {
  const subtracted = blendedStripes("subtract", () => LAYER_COLOUR);
  // An isolated group in Subtract, with the layer in Normal inside.
  await openProject(page, () => [
    { type: "LayerGroupEnd", version: "7.0.0", __layerId: "end" },
    image("__snapshot_src_2", WIDTH, { __layerId: "top", name: "Top" }),
    { type: "LayerGroup", version: "7.0.0", __layerId: "group", name: "Group 1", passThrough: false, globalCompositeOperation: "subtract" },
  ]);
  await expect.poll(() => stripes(page)).not.toEqual(STRIPES.map(() => LAYER_COLOUR));
  near(await stripes(page), subtracted);

  // Clipped to the left half, in Divide.
  await page.goto("/");
  await openProject(page, () => [
    image("__snapshot_src_1", WIDTH / 2, { __layerId: "left", name: "Left" }),
    image("__snapshot_src_2", WIDTH, { __layerId: "top", name: "Top", __clipped: true, globalCompositeOperation: "divide" }),
  ]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(await stripes(page), [...blendedStripes("divide", () => LAYER_COLOUR).slice(0, 3), ...original.slice(3)]);

  // An Invert adjustment in Linear Light.
  await page.goto("/");
  await openProject(page, () => [adjustment("adjust", { kind: "invert", settings: {} }, { globalCompositeOperation: "linear-light" })]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  near(await stripes(page), blendedStripes("linear-light", (colour) => colour.map((value) => 255 - value)));
});

test("Photoshop's own blend modes leave the transparency checkerboard alone", async ({ page }) => {
  await openProject(page, () => [image("__snapshot_src_2", WIDTH, { __layerId: "top", name: "Top", globalCompositeOperation: "subtract" })]);
  await expect.poll(() => stripes(page)).not.toEqual(STRIPES.map(() => LAYER_COLOUR));
  // With nothing under it, a layer shows as it is, whatever its mode.
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByRole("button", { name: "Hide Background" }).click();
  await expect.poll(() => stripes(page)).toEqual(STRIPES.map(() => LAYER_COLOUR));
});

test("Dissolve shows each pixel of a layer wholly or not at all, by its opacity", async ({ page }) => {
  await openProject(page, () => [image("__snapshot_src_2", WIDTH, { __layerId: "top", name: "Top", globalCompositeOperation: "dissolve", opacity: 0.5 })]);
  await expect.poll(() => stripes(page)).not.toEqual(original);
  const counts = await page.evaluate(
    ({ colour, stripes }) => {
      const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
      const { data, width, height } = lower.getContext("2d")!.getImageData(0, 0, lower.width, lower.height);
      const row = Math.floor(height / 2);
      let layer = 0;
      let below = 0;
      let other = 0;
      for (let x = 0; x < width; x += 1) {
        const at = (row * width + x) * 4;
        if (data[at + 3] === 0) continue;
        const pixel = [data[at]!, data[at + 1]!, data[at + 2]!];
        const close = (wanted: number[]) => wanted.every((value, channel) => Math.abs(value - pixel[channel]!) <= 2);
        if (close(colour)) layer += 1;
        else if (stripes.some(close)) below += 1;
        else other += 1;
      }
      return { layer, below, other };
    },
    { colour: LAYER_COLOUR, stripes: STRIPES }
  );
  // A few edge pixels blend with the photo's own edge.
  expect(counts.other).toBeLessThan((counts.layer + counts.below) * 0.05);
  expect(counts.layer / (counts.layer + counts.below)).toBeGreaterThan(0.35);
  expect(counts.layer / (counts.layer + counts.below)).toBeLessThan(0.65);
});
