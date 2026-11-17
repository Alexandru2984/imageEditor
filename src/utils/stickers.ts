import { FabricText } from "fabric";
import type { Canvas as FabricCanvas } from "fabric";
import type { EditorFabricObject } from "./editorObjects";

export const STICKER_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

export const STICKER_GROUPS: { title: string; items: string[] }[] = [
  { title: "Faces", items: ["😀", "😂", "🥹", "😍", "🤩", "😎", "🥳", "😜", "🤔", "😴", "😱", "😭", "😡", "🤯", "🥶", "🤡"] },
  { title: "Love", items: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💖", "💯", "✨", "🔥", "⭐", "🌈", "💥", "💫", "🎉"] },
  { title: "Hands", items: ["👍", "👎", "👏", "🙌", "🙏", "👌", "✌️", "🤘", "👉", "👈", "👆", "👇", "💪", "🤝", "✍️", "👋"] },
  { title: "Things", items: ["📸", "🎁", "🎂", "🏆", "🎵", "💡", "📌", "📍", "⚠️", "✅", "❌", "❓", "💬", "🗯️", "🕶️", "👑"] },
  { title: "Nature", items: ["☀️", "🌙", "⛅", "❄️", "🌊", "🌸", "🌻", "🍀", "🌴", "🐶", "🐱", "🦄", "🐝", "🦋", "🍕", "☕"] },
];

/** Whether a text object is an emoji sticker (styled as an image, not text). */
export const isSticker = (object: { fontFamily?: unknown }): boolean =>
  typeof object.fontFamily === "string" && object.fontFamily.includes("Color Emoji");

/** Add an emoji sticker at the centre of the current view, sized for the screen. */
export function addSticker(canvas: FabricCanvas, emoji: string): FabricText {
  const zoom = canvas.getZoom() || 1;
  const fontSize = Math.round(120 / zoom);
  const sticker = new FabricText(emoji, { fontSize, fontFamily: STICKER_FONT });
  const center = canvas.getVpCenter();
  sticker.set({
    left: center.x - sticker.width / 2,
    top: center.y - sticker.height / 2,
  });
  (sticker as EditorFabricObject).name = "Sticker";
  canvas.add(sticker);
  canvas.setActiveObject(sticker);
  canvas.requestRenderAll();
  return sticker;
}
