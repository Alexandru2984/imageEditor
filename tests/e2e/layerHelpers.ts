import { expect, type Locator, type Page } from "@playwright/test";
import { autosavedObjects, canvasCenter, settle } from "./helpers";

/** Drag between two offsets from the canvas centre. */
export async function drag(page: Page, from: [number, number], to: [number, number]) {
  const center = await canvasCenter(page);
  await page.mouse.move(center.x + from[0], center.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(center.x + to[0], center.y + to[1], { steps: 6 });
  await page.mouse.up();
}

/** What the canvas shows at an offset from its centre (RGBA). */
export async function shown(page: Page, offset: [number, number]): Promise<number[]> {
  const center = await canvasCenter(page);
  return page.evaluate(
    ({ x, y }) => {
      const lower = document.querySelector("canvas.lower-canvas") as HTMLCanvasElement;
      const box = lower.getBoundingClientRect();
      const ratio = lower.width / box.width;
      return [
        ...lower.getContext("2d")!.getImageData(Math.round((x - box.left) * ratio), Math.round((y - box.top) * ratio), 1, 1).data,
      ];
    },
    { x: center.x + offset[0], y: center.y + offset[1] }
  );
}

export const GREY = [128, 128, 128, 255];
export const BLACK = [0, 0, 0, 255];
export const WHITE = [255, 255, 255, 255];

/**
 * A new layer with a rectangle in the foreground (black) or background
 * (white) colour: Fill with nothing but the photo selected paints on a new
 * layer, as the brush does.
 */
export async function paintedLayer(page: Page, from: [number, number], to: [number, number], colour: "foreground" | "background") {
  const before = (await autosavedObjects(page)).length;
  await page.keyboard.press("m");
  // Photoshop's default colours: black and white.
  await page.keyboard.press("d");
  await drag(page, from, to);
  await page.keyboard.press(colour === "foreground" ? "Alt+Backspace" : "Control+Backspace");
  await expect.poll(async () => (await autosavedObjects(page)).length).toBe(before + 1);
  await page.keyboard.press("Control+d");
  await settle(page);
}

export const types = async (page: Page) => (await autosavedObjects(page)).map((object) => `${object.type}:${object.name ?? ""}`);


/** Drag one row of the Layers panel onto another: near its top, its bottom or its middle. */
export async function dragRow(page: Page, from: Locator, to: Locator, where: "top" | "bottom" | "middle") {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  const y = where === "top" ? end.y + 4 : where === "bottom" ? end.y + end.height - 4 : end.y + end.height / 2;
  await page.mouse.move(end.x + end.width / 2, y, { steps: 8 });
  await page.mouse.up();
}

/** The layers' names, bottom of the stack first (groups' markers as "[" and "]"). */
export const stack = async (page: Page) =>
  (await autosavedObjects(page)).map((object) =>
    object.type === "LayerGroupEnd" ? "]" : object.type === "LayerGroup" ? `[${object.name}` : String(object.name)
  );
