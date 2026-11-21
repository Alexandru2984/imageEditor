import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getCompositeImageData, getLayerImageData, initializeCanvas, readPsd, writePsd, type Layer } from "ag-psd";
import { autosavedObjects, chooseMenu, settle, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop file tests");
  await page.goto("/");
});

// Photoshop files are written here from plain pixel arrays.
initializeCanvas(
  () => {
    throw new Error("No canvas in the test runner");
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" }) as ImageData
);

const solid = (width: number, height: number, rgba: [number, number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set(rgba, index * 4);
  return { width, height, data, colorSpace: "srgb" } as ImageData;
};

const layer = (name: string, left: number, top: number, width: number, height: number, rgba: [number, number, number, number], extra: Partial<Layer> = {}): Layer => ({
  name,
  left,
  top,
  right: left + width,
  bottom: top + height,
  imageData: solid(width, height, rgba),
  ...extra,
});

async function openPsd(page: Page, layers: Layer[], extra: Record<string, unknown> = {}) {
  const buffer = writePsd({ width: 200, height: 100, children: layers, ...extra }, { generateThumbnail: false });
  await page.getByTestId("image-input").setInputFiles({ name: "design.psd", mimeType: "image/vnd.adobe.photoshop", buffer: Buffer.from(buffer) });
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
}

test("a Photoshop file opens with its layers, their settings, masks and the guides", async ({ page }) => {
  await openPsd(
    page,
    [
      layer("Paper", 0, 0, 200, 100, [255, 255, 255, 255]),
      layer("Red box", 20, 10, 60, 50, [255, 0, 0, 255], { blendMode: "multiply", opacity: 0.6 }),
      layer("Hidden", 0, 0, 10, 10, [0, 0, 255, 255], { hidden: true }),
      layer("Masked", 100, 20, 80, 60, [0, 255, 0, 255], {
        mask: { left: 100, top: 20, right: 140, bottom: 80, defaultColor: 0, imageData: solid(40, 60, [255, 255, 255, 255]) },
      }),
    ],
    { imageResources: { gridAndGuidesInformation: { guides: [{ location: 50, direction: "vertical" }] } } }
  );
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.name)).toEqual(["Paper", "Red box", "Hidden", "Masked"]);
  const objects = await autosavedObjects(page);
  const [paper, red, hidden, masked] = objects as Record<string, number & string & boolean & object>[];
  const scale = paper!.scaleX as number;
  expect(paper!.__isBackground).toBe(true);
  expect(((red!.left as number) - (paper!.left as number)) / scale).toBeCloseTo(20, 3);
  expect(((red!.top as number) - (paper!.top as number)) / scale).toBeCloseTo(10, 3);
  expect(red!.globalCompositeOperation).toBe("multiply");
  expect(red!.opacity as number).toBeCloseTo(0.6, 2);
  expect(hidden!.visible).toBe(false);
  expect(masked!.layerMask).toMatchObject({ enabled: true });
  expect(((paper!.guides as { axis: string; position: number }[])[0]!.position - (paper!.left as number)) / scale).toBeCloseTo(50, 3);
});

test("a file that is not a readable Photoshop document is turned away with a message", async ({ page }) => {
  await page.getByTestId("image-input").setInputFiles({ name: "broken.psd", mimeType: "image/vnd.adobe.photoshop", buffer: Buffer.from("8BPS this is not a document") });
  await expect(page.getByText(/could not be read|Invalid|not a/i).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tools" })).toHaveCount(0);
});

test("the document saves as a Photoshop file with its layers, settings and guides", async ({ page }) => {
  await uploadSolidImage(page, 120, 80, "#336699", [{ x: 10, y: 10, width: 30, height: 20, color: "#ff0000" }]);
  await settle(page);
  // A layer copied from the whole photo.
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+j");
  await expect.poll(async () => (await autosavedObjects(page)).map((object) => object.name)).toContain("Layer 1");
  await chooseMenu(page, "View", "New guide…");
  await page.getByRole("radio", { name: "Vertical" }).click();
  await page.getByLabel("Position").fill("30");
  await page.getByRole("button", { name: "OK" }).click();
  await expect.poll(async () => !!(await autosavedObjects(page)).find((object) => object.__isBackground)?.guides).toBe(true);

  const download = page.waitForEvent("download");
  await chooseMenu(page, "File", "Save as Photoshop (PSD)");
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.psd$/);
  const psd = readPsd(readFileSync((await file.path())!), { useRawData: true, skipThumbnail: true });
  expect([psd.width, psd.height]).toEqual([120, 80]);
  expect(psd.children?.map((layer) => layer.name)).toEqual(["Background", "Layer 1"]);
  const background = psd.children![0]!;
  expect([background.left, background.top, background.right, background.bottom]).toEqual([0, 0, 120, 80]);
  const pixels = getLayerImageData(background)!;
  // The red patch at (10, 10), the blue around it.
  expect([...pixels.data.slice((15 * 120 + 15) * 4, (15 * 120 + 15) * 4 + 4)]).toEqual([255, 0, 0, 255]);
  expect([...pixels.data.slice((60 * 120 + 100) * 4, (60 * 120 + 100) * 4 + 4)]).toEqual([0x33, 0x66, 0x99, 255]);
  expect(psd.imageResources?.gridAndGuidesInformation?.guides).toEqual([expect.objectContaining({ location: 30, direction: "vertical" })]);
});

test("groups, clipping masks and Fill come in from a Photoshop file and go back out", async ({ page }) => {
  await openPsd(page, [
    layer("Paper", 0, 0, 200, 100, [255, 255, 255, 255]),
    {
      name: "Shapes",
      opacity: 0.5,
      blendMode: "pass through",
      opened: false,
      children: [
        layer("Base", 20, 10, 60, 50, [255, 0, 0, 255]),
        layer("Clip", 0, 0, 200, 100, [0, 0, 255, 255], { clipping: true }),
      ],
    },
    layer("Faint", 150, 10, 30, 30, [0, 255, 0, 255], { fillOpacity: 0.5 }),
  ]);
  const shape = async () =>
    (await autosavedObjects(page)).map((object) => `${object.type}:${object.name ?? ""}`);
  await expect
    .poll(shape)
    .toEqual(["Image:Paper", "LayerGroupEnd:", "Image:Base", "Image:Clip", "LayerGroup:Shapes", "Image:Faint"]);
  const objects = await autosavedObjects(page);
  expect(objects[3]!.__clipped).toBe(true);
  expect(objects[4]).toMatchObject({ passThrough: true, collapsed: true });
  expect(objects[4]!.opacity as number).toBeCloseTo(0.5, 1);
  expect(objects[5]!.__fill as number).toBeCloseTo(0.5, 1);
  // No note about clipping or groups being left out.
  await expect(page.getByText(/clipping masks were left out|groups were flattened/)).toHaveCount(0);

  const download = page.waitForEvent("download");
  await chooseMenu(page, "File", "Save as Photoshop (PSD)");
  const psd = readPsd(readFileSync((await (await download).path())!), { useRawData: true, skipThumbnail: true });
  expect(psd.children?.map((child) => child.name)).toEqual(["Paper", "Shapes", "Faint"]);
  const group = psd.children![1]!;
  expect(group.children?.map((child) => child.name)).toEqual(["Base", "Clip"]);
  expect(group).toMatchObject({ blendMode: "pass through", opened: false });
  expect(group.opacity!).toBeCloseTo(0.5, 1);
  expect(group.children![1]!.clipping).toBe(true);
  expect(psd.children![2]!.fillOpacity!).toBeCloseTo(0.5, 1);
  // The flattened image: blue only inside the red box, at half strength.
  const composite = getCompositeImageData(psd)!.data;
  const at = (x: number, y: number) => [...composite.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)];
  const inside = at(50, 35);
  expect(inside[0]).toBeGreaterThan(110);
  expect(inside[0]).toBeLessThan(145);
  expect(inside[2]).toBe(255);
  expect(at(120, 50)).toEqual([255, 255, 255]);
});
