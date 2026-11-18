import { expect, type Page } from "@playwright/test";

// A valid 4x4 PNG (red, green, blue and white quadrants) for the upload input.
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAI0lEQVR42mN47+LyH4SVjsaBMQOGgHXTt/8g/OvXLzDGEAAAbBUtZYYAvvUAAAAASUVORK5CYII=";

export async function uploadImage(page: Page) {
  await page.getByTestId("image-input").setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });
  // The editor replaces the upload screen with the canvas + actions
  await expect(page.getByText("Remove BG")).toBeVisible();
}

export async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator("canvas.upper-canvas").boundingBox();
  if (!box) throw new Error("Canvas is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getAutosaveJson(page: Page): Promise<string | null> {
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

export async function autosavedObjects(page: Page): Promise<Array<Record<string, unknown>>> {
  const json = await getAutosaveJson(page);
  return json ? (JSON.parse(json).objects as Array<Record<string, unknown>>) : [];
}

/** A menu item by its label; its accessible name also carries the shortcut. */
export const menuItem = (page: Page, label: string) =>
  page.getByRole("menuitem", {
    name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  });

/** Pick an item from the editor's menu bar, e.g. File › New…. */
export async function chooseMenu(page: Page, menu: string, item: string) {
  await page.getByRole("menuitem", { name: menu, exact: true }).click();
  await menuItem(page, item).click();
  // The menu animates out; wait so it no longer covers what it opened.
  await expect(page.getByRole("menu")).toHaveCount(0);
}

export const TOP_IMAGE = "__top_image__";

export interface PaintedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** Open a solid-colour photo of the given size, with rectangles painted on it. */
export async function uploadSolidImage(
  page: Page,
  width: number,
  height: number,
  color = "#ffffff",
  rects: PaintedRect[] = []
) {
  const base64 = await page.evaluate(
    ({ width, height, color, rects }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
      for (const rect of rects) {
        context.fillStyle = rect.color;
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      return canvas.toDataURL("image/png").split(",")[1]!;
    },
    { width, height, color, rects }
  );
  await page.getByTestId("image-input").setInputFiles({
    name: "solid.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  // The photo is on the canvas once the document has been saved with it.
  await expect.poll(async () => (await autosavedObjects(page)).length).toBeGreaterThan(0);
}

/** Two frames: React has run the effects of what is on screen. */
export const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );

/**
 * RGBA values of an autosaved image layer at the given pixel positions, or
 * null while no such layer has been saved. `name` picks the layer by its saved
 * name; TOP_IMAGE picks the topmost image layer.
 */
export async function autosavedLayerPixels(
  page: Page,
  name: string,
  points: [number, number][]
): Promise<{ width: number; height: number; pixels: number[][] } | null> {
  return page.evaluate(
    async ({ name, points }) => {
      const value = await new Promise<{ snapshot?: { json?: string; srcs?: string[] } } | undefined>(
        (resolve, reject) => {
          const open = indexedDB.open("image-editor", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("projects")) {
              db.close();
              resolve(undefined);
              return;
            }
            const request = db.transaction("projects", "readonly").objectStore("projects").get("autosave");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              resolve(request.result);
              db.close();
            };
          };
        }
      );
      const json = value?.snapshot?.json;
      if (!json) return null;
      const objects = (JSON.parse(json).objects ?? []) as Array<{
        name?: string;
        src?: string;
        type?: string;
      }>;
      const layer =
        name === "__top_image__"
          ? objects.filter((object) => object.type?.toLowerCase() === "image").at(-1)
          : objects.find((object) => object.name === name);
      const placeholder = /^__snapshot_src_(\d+)$/.exec(layer?.src ?? "");
      const src = placeholder ? value?.snapshot?.srcs?.[Number(placeholder[1])] : layer?.src;
      if (!src) return null;
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: points.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)),
      };
    },
    { name, points }
  );
}
