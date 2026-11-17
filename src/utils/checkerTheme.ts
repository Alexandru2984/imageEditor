// The transparency checkerboard's colours follow the app theme. Kept free of
// Fabric so the theme provider can set it without loading the editor.

export type CheckerTheme = "light" | "dark";

const CELL = 8;
const PALETTES: Record<CheckerTheme, [string, string]> = {
  dark: ["#2b2a33", "#3a3944"],
  light: ["#ffffff", "#e6e5ec"],
};

let currentTheme: CheckerTheme = "dark";
const tileCache = new Map<CheckerTheme, HTMLCanvasElement>();

export function checkerTile(theme: CheckerTheme): HTMLCanvasElement {
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

export const getCheckerTheme = (): CheckerTheme => currentTheme;
