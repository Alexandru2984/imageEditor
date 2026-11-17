#!/usr/bin/env node
// Regenerate the favicon, app icons and the social preview card in public/.
//
//   npm run build && npm run preview -- --port 4173 &
//   APP_URL=http://127.0.0.1:4173 node scripts/generate-brand-assets.mjs
//
// Icons are rendered from the same mark as src/components/editor/Logo.tsx.
// The social card embeds a live screenshot of the editor from APP_URL; set
// SKIP_CARD=1 to regenerate only the icons. Set E2E_CHROMIUM_PATH to use a
// specific Chromium build.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";

const MARK = `
  <path d="M6 23.5 12.5 15l4.2 5.3 2.8-3.3L26 23.5Z" fill="#fff" fill-opacity=".95"/>
  <circle cx="21.5" cy="10.5" r="2.6" fill="#fde68a"/>
  <path d="M10 7.2l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z" fill="#fff"/>`;
const GRADIENT = `
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#d946ef"/>
  </linearGradient></defs>`;

/** Rounded tile, as in the app header. */
const roundedIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${GRADIENT}
  <rect width="32" height="32" rx="8" fill="url(#g)"/>${MARK}
</svg>`;

/** Full-bleed square for platforms that apply their own mask (iOS, Android). */
const squareIcon = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${GRADIENT}
  <rect width="32" height="32" fill="url(#g)"/>
  <g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${MARK}</g>
</svg>`;

/** Wrap PNG images in an ICO container (PNG-compressed entries). */
function toIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)]);
}

async function renderSvg(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );
  return page.screenshot({ omitBackground: true, type: "png" });
}

async function captureEditor(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(appUrl);
  await page.getByText("Try a sample photo").click();
  await page.getByText("Remove BG").waitFor();
  const canvas = page.locator("canvas.upper-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Editor canvas is not visible");
  const at = (dx, dy) => ({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy });

  // A headline in the Poster style, then a sticker beside the sun.
  await page.getByRole("button", { name: "Text (T)" }).click();
  const headline = at(-150, -150);
  await page.mouse.click(headline.x, headline.y);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Golden hour");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Poster text style" }).click();
  await page.getByRole("button", { name: "Use color #ffffff" }).click();
  await page.getByRole("slider", { name: "Font size" }).focus();
  for (let i = 0; i < 40; i += 1) await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Stickers" }).click();
  await page.getByRole("button", { name: "Add sticker ✨" }).click();
  await page.mouse.click(box.x + 8, box.y + 8);
  await page.getByRole("tab", { name: "Adjust" }).click();
  // Preset previews render in idle time; wait for all of them.
  await page
    .waitForFunction(() => document.querySelectorAll('[aria-label$=" preset"] img').length >= 16, null, {
      timeout: 20_000,
    })
    .catch(() => console.warn("Some preset previews were still rendering"));
  await page.waitForTimeout(300);
  const shot = await page.screenshot({ type: "png" });
  await page.close();
  return shot;
}

async function renderCard(browser, editorShot) {
  const inter = await readFile(
    path.join(root, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")
  );
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const features = ["AI background removal", "Text, stickers & brushes", "Filters & presets", "Crop for any platform"];
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter.toString("base64")}) format("woff2"); font-weight: 100 900; }
    * { box-sizing: border-box; margin: 0; }
    body { width: 1200px; height: 630px; overflow: hidden; font-family: Inter, sans-serif; color: #f4f3f8;
      background: radial-gradient(900px 500px at 0% 0%, #4c1d95 0%, transparent 60%),
                  radial-gradient(700px 500px at 100% 100%, #86198f 0%, transparent 55%), #0b0a10; }
    .copy { position: absolute; left: 64px; top: 72px; width: 470px; }
    .brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 650; letter-spacing: -.01em; }
    .brand svg { width: 48px; height: 48px; }
    h1 { margin-top: 40px; font-size: 54px; line-height: 1.05; font-weight: 750; letter-spacing: -.035em; }
    h1 span { background: linear-gradient(90deg, #c4b5fd, #f0abfc); -webkit-background-clip: text; color: transparent; }
    ul { list-style: none; padding: 0; margin-top: 32px; display: grid; gap: 12px; }
    li { display: flex; align-items: center; gap: 12px; font-size: 21px; color: #d9d6e6; }
    li::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: #c084fc; flex: none; }
    .foot { position: absolute; left: 64px; bottom: 56px; font-size: 18px; color: #a3a0b5; }
    .shot { position: absolute; left: 590px; top: 92px; width: 720px; border-radius: 14px; overflow: hidden;
      border: 1px solid rgba(255,255,255,.14); box-shadow: 0 30px 80px rgba(0,0,0,.55); }
    .shot img { display: block; width: 100%; }
  </style></head><body>
    <div class="copy">
      <div class="brand">${roundedIcon}<span>Image Editor</span></div>
      <h1>Free photo editor <span>in your browser</span></h1>
      <ul>${features.map((feature) => `<li>${feature}</li>`).join("")}</ul>
    </div>
    <div class="foot">imageeditor.micutu.com · Private · No sign-up</div>
    <div class="shot"><img src="data:image/png;base64,${editorShot.toString("base64")}" alt=""></div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const card = await page.screenshot({ type: "png" });
  await page.close();
  return card;
}

const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}
);
try {
  const page = await browser.newPage();
  await writeFile(path.join(publicDir, "favicon.svg"), `${roundedIcon.trim()}\n`);
  const ico = [];
  for (const size of [16, 32, 48]) ico.push({ size, data: await renderSvg(page, roundedIcon, size) });
  await writeFile(path.join(publicDir, "favicon.ico"), toIco(ico));
  await writeFile(path.join(publicDir, "apple-touch-icon.png"), await renderSvg(page, squareIcon(1), 180));
  await writeFile(path.join(publicDir, "icon-192.png"), await renderSvg(page, roundedIcon, 192));
  await writeFile(path.join(publicDir, "icon-512.png"), await renderSvg(page, roundedIcon, 512));
  // Maskable icons keep the mark inside the central 80% safe zone.
  await writeFile(path.join(publicDir, "icon-maskable-512.png"), await renderSvg(page, squareIcon(0.72), 512));
  await page.close();

  if (!process.env.SKIP_CARD) {
    const card = await renderCard(browser, await captureEditor(browser));
    await writeFile(path.join(publicDir, "og-image.png"), card);
  }
  console.log("Brand assets written to public/");
} finally {
  await browser.close();
}
