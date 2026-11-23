import { test, expect, type Page } from "@playwright/test";
import { autosavedObjects, canvasCenter, uploadImage } from "./helpers";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer tests");
  await page.goto("/");
});

const textLayer = async (page: Page) =>
  (await autosavedObjects(page)).find((object) => object.type === "IText") as Record<string, unknown> | undefined;

/** A text layer reading `lines`, selected and not being edited. */
async function addText(page: Page, lines: string[]) {
  await uploadImage(page);
  await page.getByRole("button", { name: "Text (T)" }).click();
  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect(page.getByRole("button", { name: "Meme text style" })).toBeVisible();
  await page.keyboard.press("Control+a");
  for (const [index, line] of lines.entries()) {
    if (index > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await textLayer(page))?.text).toBe(lines.join("\n"));
}

test("Character: strikethrough, change case, and superscript on the selected characters", async ({ page }) => {
  await addText(page, ["Hello world"]);
  await page.getByRole("button", { name: "Strikethrough" }).click();
  await expect.poll(async () => (await textLayer(page))?.linethrough).toBe(true);
  await expect(page.getByRole("button", { name: "Strikethrough" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Uppercase" }).click();
  await expect.poll(async () => (await textLayer(page))?.text).toBe("HELLO WORLD");
  await page.getByRole("button", { name: "Title case" }).click();
  await expect.poll(async () => (await textLayer(page))?.text).toBe("Hello World");
  await page.getByRole("button", { name: "Lowercase" }).click();
  await expect.poll(async () => (await textLayer(page))?.text).toBe("hello world");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await textLayer(page))?.text).toBe("Hello World");

  // Editing, the first five characters selected: only they go up.
  const center = await canvasCenter(page);
  // The text starts where it was placed and runs right and down.
  await page.mouse.dblclick(center.x + 20, center.y + 15);
  await page.keyboard.press("Home");
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "Superscript" }).click();
  const scripted = async () => {
    const styles = ((await textLayer(page))?.styles ?? []) as Array<{ start: number; end: number; style: { deltaY?: number } }>;
    return styles.filter((range) => (range.style.deltaY ?? 0) < 0).map((range) => [range.start, range.end]);
  };
  await expect.poll(scripted).toEqual([[0, 5]]);
  await expect(page.getByRole("button", { name: "Superscript" })).toHaveAttribute("aria-pressed", "true");
  // Subscript in its place, then back on the baseline.
  await page.getByRole("button", { name: "Subscript" }).click();
  await expect(page.getByRole("button", { name: "Subscript" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Subscript" }).click();
  await expect.poll(async () => ((await textLayer(page))?.styles ?? []) as unknown[]).toEqual([]);
});

test("Paragraph: seven alignments, and space between paragraphs that is saved", async ({ page }) => {
  await addText(page, ["one two three", "four", "five six"]);
  const alignment = page.getByRole("radiogroup", { name: "Paragraph alignment" });
  await expect(alignment.getByRole("radio")).toHaveCount(7);
  await alignment.getByRole("radio", { name: "Justify all" }).click();
  await expect.poll(async () => (await textLayer(page))?.textAlign).toBe("justify");
  await expect(alignment.getByRole("radio", { name: "Justify all" })).toHaveAttribute("aria-checked", "true");
  await alignment.getByRole("radio", { name: "Justify last centered" }).click();
  await expect.poll(async () => (await textLayer(page))?.textAlign).toBe("justify-center");

  const before = (await textLayer(page))!.height as number;
  await page.getByLabel("Space after paragraph").fill("20");
  await page.getByLabel("Space before paragraph").fill("5");
  await page.getByLabel("Space before paragraph").blur();
  // Two gaps of 25 between three paragraphs.
  await expect.poll(async () => (await textLayer(page))?.paragraphSpaceAfter).toBe(20);
  await expect.poll(async () => Math.round(((await textLayer(page))!.height as number) - before)).toBe(50);

  // Kept after a reload.
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  const kept = (await textLayer(page))!;
  expect([kept.paragraphSpaceBefore, kept.paragraphSpaceAfter, kept.textAlign]).toEqual([5, 20, "justify-center"]);
  expect(Math.round((kept.height as number) - before)).toBe(50);
});
