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
