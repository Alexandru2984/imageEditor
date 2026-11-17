import type { Canvas as FabricCanvas } from "fabric";
import { findBackgroundImage } from "./editorObjects";

/**
 * The Fabric canvas itself stays transparent so exports, crops and selections
 * keep real alpha. The workspace colour comes from CSS behind the canvas
 * element, and a transparency checkerboard is painted under the artboard only
 * while rendering to the on-screen context — never into an export canvas.
 */

export type CheckerTheme = "light" | "dark";

const CELL = 8;
const PALETTES: Record<CheckerTheme, [string, string]> = {
  dark: ["#2b2a33", "#3a3944"],
  light: ["#ffffff", "#e6e5ec"],
};

let currentTheme: CheckerTheme = "dark";
const tileCache = new Map<CheckerTheme, HTMLCanvasElement>();

function checkerTile(theme: CheckerTheme): HTMLCanvasElement {
  const cached = tileCache.get(theme);
  if (cached) return cached;
  const [base, alt] = PALETTES[theme];
  const tile = document.createElement("canvas");
  tile.width = CELL * 2;
  tile.height = CELL * 2;
  const ctx = tile.getContext("2d");
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, CELL * 2, CELL * 2);
    ctx.fillStyle = alt;
    ctx.fillRect(0, 0, CELL, CELL);
    ctx.fillRect(CELL, CELL, CELL, CELL);
  }
  tileCache.set(theme, tile);
  return tile;
}

export function setCheckerTheme(theme: CheckerTheme): void {
  currentTheme = theme;
}

/** Strip legacy canvas fills that older builds baked into every document. */
export function clearDocumentBackground(canvas: FabricCanvas): void {
  canvas.backgroundColor = "";
}

export function installWorkspaceRenderer(canvas: FabricCanvas): () => void {
  const handleBeforeRender = ({ ctx }: { ctx: CanvasRenderingContext2D }) => {
    // Exports render into a detached canvas; only decorate the visible one.
    if (ctx !== canvas.getContext()) return;
    const background = findBackgroundImage(canvas);
    if (!background) return;

    const bounds = background.getBoundingRect();
    const [scaleX, , , scaleY, translateX, translateY] =
      canvas.viewportTransform;
    const left = bounds.left * scaleX + translateX;
    const top = bounds.top * scaleY + translateY;
    const width = bounds.width * scaleX;
    const height = bounds.height * scaleY;
    if (![left, top, width, height].every(Number.isFinite)) return;

    const pattern = ctx.createPattern(checkerTile(currentTheme), "repeat");
    if (!pattern) return;
    ctx.save();
    ctx.fillStyle = pattern;
    ctx.fillRect(left, top, width, height);
    ctx.restore();
  };

  canvas.on("before:render", handleBeforeRender);
  return () => {
    canvas.off("before:render", handleBeforeRender);
  };
}
