import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { autosavedObjects, canvasCenter, uploadSolidImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

/** The files in a stored zip, by name. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const files = new Map<string, Buffer>();
  let at = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index += 1) {
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + bytes.readUInt16LE(local + 26);
    files.set(name, bytes.subarray(start, start + size));
    at += 46 + nameLength;
  }
  return files;
}

/** A PNG's size, from its header. */
const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

/** The RGBA of an image file at a point given as fractions of its size, decoded by the browser. */
const pixelOf = (page: Page, bytes: Buffer, mime: string, x: number, y: number) =>
  page.evaluate(
    async ({ data, mime, x, y }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: mime }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return { size: [bitmap.width, bitmap.height], rgba: Array.from(context.getImageData(Math.floor(x * bitmap.width), Math.floor(y * bitmap.height), 1, 1).data) };
    },
    { data: bytes.toString("base64"), mime, x, y }
  );

async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Download" }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}

test("Export As writes several sizes at once into a zip, a custom width among them", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#2080c0", [{ x: 0, y: 0, width: 200, height: 150, color: "#ff0000" }]);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export As" });
  await dialog.getByRole("button", { name: "50%", exact: true }).click();
  await dialog.getByRole("button", { name: "200%", exact: true }).click();
  await dialog.getByRole("button", { name: "Custom", exact: true }).click();
  await dialog.getByLabel("Custom width").fill("123");
  await expect(page.getByTestId("export-dimensions")).toHaveText("200 × 150, 400 × 300, 800 × 600, 123 × 92 px");
  await expect(dialog.getByText("4 files in one zip")).toBeVisible();

  const { name, bytes } = await download(page);
  expect(name).toBe("solid.zip");
  const files = unzip(bytes);
  expect([...files.keys()]).toEqual(["solid@0.5x.png", "solid.png", "solid@2x.png", "solid-123w.png"]);
  expect(pngSize(files.get("solid@0.5x.png")!)).toEqual([200, 150]);
  expect(pngSize(files.get("solid@2x.png")!)).toEqual([800, 600]);
  expect(pngSize(files.get("solid-123w.png")!)).toEqual([123, 92]);
  // The same picture at every size: red top left, blue elsewhere.
  for (const file of files.values()) {
    expect((await pixelOf(page, file, "image/png", 0.2, 0.2)).rgba).toEqual([255, 0, 0, 255]);
    expect((await pixelOf(page, file, "image/png", 0.8, 0.8)).rgba).toEqual([0x20, 0x80, 0xc0, 255]);
  }
});

test("Export As writes AVIF, encoded on the device", async ({ page }) => {
  await uploadSolidImage(page, 240, 160, "#2080c0", [{ x: 0, y: 0, width: 120, height: 80, color: "#ff0000" }]);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export As" });
  await dialog.getByRole("radio", { name: "AVIF", exact: true }).click();
  await expect(dialog.getByRole("slider", { name: "Export quality" })).toBeVisible();
  const { name, bytes } = await download(page);
  expect(name).toBe("solid.avif");
  // An ISO-BMFF file of brand "avif".
  expect(bytes.subarray(4, 12).toString("latin1")).toBe("ftypavif");
  const red = await pixelOf(page, bytes, "image/avif", 0.2, 0.2);
  expect(red.size).toEqual([240, 160]);
  expect(red.rgba[0]).toBeGreaterThan(220);
  expect(red.rgba[1]).toBeLessThan(40);
  const blue = await pixelOf(page, bytes, "image/avif", 0.8, 0.8);
  expect(Math.abs(blue.rgba[2]! - 0xc0)).toBeLessThan(20);
  await expect(page.getByText(/Exported 240×160 AVIF/)).toBeVisible();
});

test("Export Layers to Files: each visible layer on its own, over the document's area", async ({ page }) => {
  await uploadSolidImage(page, 400, 300, "#ffffff");
  // A rectangle in the middle, and a hidden one.
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Rectangle (U)" }).click();
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await autosavedObjects(page)).filter((object) => object.type === "Rect").length).toBe(1);
  await page.keyboard.press("Control+j");
  await expect.poll(async () => (await autosavedObjects(page)).filter((object) => object.type === "Rect").length).toBe(2);
  await page.getByRole("button", { name: "Toggle layers" }).click();
  await page.getByRole("button", { name: "Hide Rectangle 2", exact: true }).click();
  await expect.poll(async () => (await autosavedObjects(page)).find((object) => object.name === "Rectangle 2")?.visible).toBe(false);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export As" });
  await dialog.getByRole("radio", { name: "Each layer" }).click();
  await expect(dialog.getByTestId("export-layer-count")).toContainText("2 visible layers");
  const { name, bytes } = await download(page);
  expect(name).toBe("solid.zip");
  const files = unzip(bytes);
  expect([...files.keys()].sort()).toEqual(["solid-Background.png", "solid-Rectangle-1.png"]);
  const rectangle = files.get("solid-Rectangle-1.png")!;
  expect(pngSize(rectangle)).toEqual([400, 300]);
  // The rectangle alone: its colour in the middle, nothing at the corners.
  expect((await pixelOf(page, rectangle, "image/png", 0.5, 0.5)).rgba[3]).toBe(255);
  expect((await pixelOf(page, rectangle, "image/png", 0.02, 0.02)).rgba[3]).toBe(0);
  expect((await pixelOf(page, files.get("solid-Background.png")!, "image/png", 0.5, 0.5)).rgba).toEqual([255, 255, 255, 255]);

  // A group is one file, its layers together.
  await page.getByRole("button", { name: "Show Rectangle 2", exact: true }).click();
  await page.getByRole("group", { name: "Rectangle 1 layer" }).click();
  await page.getByRole("group", { name: "Rectangle 2 layer" }).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+g");
  await expect.poll(async () => (await autosavedObjects(page)).some((object) => object.name === "Group 1")).toBe(true);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByRole("radio", { name: "Each layer" }).click();
  await expect(dialog.getByTestId("export-layer-count")).toContainText("2 visible layers");
  const grouped = unzip((await download(page)).bytes);
  expect([...grouped.keys()].sort()).toEqual(["solid-Background.png", "solid-Group-1.png"]);
  expect((await pixelOf(page, grouped.get("solid-Group-1.png")!, "image/png", 0.5, 0.5)).rgba[3]).toBe(255);
});
