import type { Canvas as FabricCanvas } from "fabric";
import { findBackgroundImage } from "./editorObjects";
import { checkerTile, getCheckerTheme } from "./checkerTheme";

export { setCheckerTheme, type CheckerTheme } from "./checkerTheme";

/**
 * The Fabric canvas itself stays transparent so exports, crops and selections
 * keep real alpha. The workspace colour comes from CSS behind the canvas
 * element, and a transparency checkerboard is painted under the artboard only
 * while rendering to the on-screen context — never into an export canvas.
 */

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

    const pattern = ctx.createPattern(checkerTile(getCheckerTheme()), "repeat");
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
