/** Blank documents and a generated sample photo for the start screen. */

export interface CanvasPreset {
  id: string;
  label: string;
  hint: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: "square", label: "Square post", hint: "1080 × 1080", width: 1080, height: 1080 },
  { id: "portrait", label: "Portrait post", hint: "1080 × 1350", width: 1080, height: 1350 },
  { id: "story", label: "Story", hint: "1080 × 1920", width: 1080, height: 1920 },
  { id: "thumbnail", label: "Video thumbnail", hint: "1280 × 720", width: 1280, height: 720 },
  { id: "hd", label: "Full HD", hint: "1920 × 1080", width: 1920, height: 1080 },
  { id: "a4", label: "A4 at 150 dpi", hint: "1240 × 1754", width: 1240, height: 1754 },
];

export const MAX_BLANK_SIDE = 8192;

const canvasToFile = (canvas: HTMLCanvasElement, name: string): Promise<File> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) reject(new Error("The browser could not create the image"));
      else resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  });

/** A PNG of the given size, filled with `fill` or left transparent when null. */
export function createBlankImage(
  width: number,
  height: number,
  fill: string | null
): Promise<File> {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!(w >= 1 && h >= 1 && w <= MAX_BLANK_SIDE && h <= MAX_BLANK_SIDE)) {
    return Promise.reject(
      new Error(`Canvas sides must be between 1 and ${MAX_BLANK_SIDE} pixels`)
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  if (fill) {
    const context = canvas.getContext("2d");
    if (!context) return Promise.reject(new Error("Canvas is not available"));
    context.fillStyle = fill;
    context.fillRect(0, 0, w, h);
  }
  return canvasToFile(canvas, `blank-${w}x${h}.png`);
}

/** A seeded pseudo-random generator so the sample is identical every time. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A procedurally drawn landscape (sunset sky, sun, layered mountains, lake
 * reflection). Generated locally, so there is no licensing or network cost.
 */
export function createSampleImage(width = 1600, height = 1000): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas is not available"));
  const random = mulberry32(20261117);
  const horizon = height * 0.66;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#1e1b4b");
  sky.addColorStop(0.45, "#7c3aed");
  sky.addColorStop(0.75, "#f472b6");
  sky.addColorStop(1, "#fdba74");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  // Stars in the upper sky.
  for (let i = 0; i < 140; i += 1) {
    const x = random() * width;
    const y = random() * horizon * 0.45;
    ctx.globalAlpha = 0.25 + random() * 0.6;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;

  // Sun with a soft glow.
  const sunX = width * 0.64;
  const sunY = horizon - height * 0.3;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, height * 0.42);
  glow.addColorStop(0, "rgba(254, 240, 138, 0.85)");
  glow.addColorStop(0.25, "rgba(253, 186, 116, 0.35)");
  glow.addColorStop(1, "rgba(253, 186, 116, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, horizon);
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.arc(sunX, sunY, height * 0.075, 0, Math.PI * 2);
  ctx.fill();

  const ridge = (base: number, amplitude: number, color: string, roughness: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    let y = base;
    for (let x = 0; x <= width; x += width / 48) {
      y += (random() - 0.5) * amplitude * roughness;
      y = Math.min(horizon - 4, Math.max(base - amplitude, y));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, horizon);
    ctx.closePath();
    ctx.fill();
  };
  ridge(horizon - height * 0.22, height * 0.12, "#6d28d9", 0.9);
  ridge(horizon - height * 0.14, height * 0.1, "#4c1d95", 1);
  ridge(horizon - height * 0.07, height * 0.06, "#2e1065", 1.1);

  // Lake: mirrored, darkened sky with ripples.
  ctx.save();
  ctx.translate(0, horizon * 2);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.55;
  ctx.drawImage(canvas, 0, 0, width, horizon, 0, 0, width, horizon);
  ctx.restore();
  const water = ctx.createLinearGradient(0, horizon, 0, height);
  water.addColorStop(0, "rgba(30, 27, 75, 0.35)");
  water.addColorStop(1, "rgba(15, 12, 41, 0.9)");
  ctx.fillStyle = water;
  ctx.fillRect(0, horizon, width, height - horizon);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#fde68a";
  for (let i = 0; i < 26; i += 1) {
    const w = (0.04 + random() * 0.1) * width;
    const y = horizon + 6 + random() * (height - horizon) * 0.6;
    ctx.fillRect(sunX - w / 2 + (random() - 0.5) * 40, y, w, 2);
  }
  ctx.globalAlpha = 1;

  return canvasToFile(canvas, "sample-landscape.png");
}
