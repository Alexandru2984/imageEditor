import { FabricText, IText, util, type TPointerEvent } from "fabric";

/**
 * Editing text on a path. Fabric lays the letters along the path but still
 * draws the cursor and the selection, and finds the letter under a click, as
 * if the text were one straight line; here they follow the letters where
 * they sit on the path. And as in Photoshop, letters that run past the end
 * of an open path are hidden, where Fabric would wrap them back over the
 * first ones; a closed path takes them on around.
 */

interface PathGrapheme {
  kernedWidth: number;
  /** Where the letter's middle sits on the path, from the text's centre, and the path's direction there. */
  renderLeft?: number;
  renderTop?: number;
  angle?: number;
  /** Past either end of an open path: not drawn. */
  pastPathEnd?: boolean;
}

interface FollowedPath {
  path?: unknown[];
  segmentsInfo?: { length: number }[];
}

type PathText = IText & {
  path?: FollowedPath;
  pathAlign?: string;
  __charBounds: PathGrapheme[][];
  _textLines: string[][];
  _fontSizeFraction: number;
  _currentCursorOpacity: number;
  missingNewlineOffset(lineIndex: number): number;
};

/** How far a letter reaches either side of the path, in its own frame (y across the path, down positive). */
export function letterSpan(pathAlign: string | undefined, fontSize: number, descentFraction: number): [number, number] {
  switch (pathAlign) {
    case "center":
      return [-fontSize / 2, fontSize / 2];
    case "ascender":
      return [0, fontSize];
    case "descender":
      return [-fontSize, 0];
    default:
      return [-fontSize * (1 - descentFraction), fontSize * descentFraction];
  }
}

/**
 * Which letters fall off an open path `total` long, laid out as Fabric does:
 * from the start, the middle or the end by `align`, moved by `offset`, and
 * run back from the end when `reverse` (the text flipped to the path's
 * other side). A letter fits when all of it is on the path.
 */
export function lettersPastTheEnd(widths: readonly number[], total: number, align: string | undefined, reverse: boolean, offset: number): boolean[] {
  const width = widths.reduce((sum, value) => sum + value, 0);
  let position = align === "left" ? (reverse ? total - width : 0) : align === "center" ? (total - width) / 2 : align === "right" ? (reverse ? 0 : total - width) : 0;
  position += offset * (reverse ? -1 : 1);
  const past = new Array<boolean>(widths.length).fill(false);
  for (let step = 0; step < widths.length; step += 1) {
    const index = reverse ? widths.length - 1 - step : step;
    const letter = widths[index]!;
    past[index] = position < -0.5 || position + letter > total + 0.5;
    position += letter;
  }
  return past;
}

/** A path that ends where it starts: text goes on around it. */
const isClosed = (path: FollowedPath): boolean => {
  const last = path.path?.at(-1);
  return Array.isArray(last) && /^z$/i.test(String(last[0]));
};

const placed = (box: PathGrapheme | undefined): box is Required<PathGrapheme> =>
  !!box && !box.pastPathEnd && box.renderLeft !== undefined && box.renderTop !== undefined && box.angle !== undefined;

/** Draw in the frame of a letter on the path: x along it, y across it. */
function inLetterFrame(ctx: CanvasRenderingContext2D, box: Required<PathGrapheme>, draw: () => void) {
  ctx.save();
  ctx.translate(box.renderLeft, box.renderTop);
  ctx.rotate(box.angle);
  draw();
  ctx.restore();
}

let installed = false;

export function installTextOnPathEditing(): void {
  if (installed) return;
  installed = true;
  const prototype = IText.prototype as unknown as {
    _renderSelection(this: PathText, ctx: CanvasRenderingContext2D, selection: { selectionStart: number; selectionEnd: number }, boundaries: unknown): void;
    _renderCursor(this: PathText, ctx: CanvasRenderingContext2D, boundaries: unknown, selectionStart: number): void;
    getSelectionStartFromPointer(this: PathText, event: TPointerEvent): number;
  };

  const text = FabricText.prototype as unknown as {
    _measureLine(this: PathText, lineIndex: number): unknown;
    _renderChar(this: PathText, method: string, ctx: CanvasRenderingContext2D, lineIndex: number, charIndex: number, ...rest: unknown[]): void;
  };
  const measureLine = text._measureLine;
  text._measureLine = function (lineIndex) {
    const measured = measureLine.call(this, lineIndex);
    const total = this.path?.segmentsInfo?.at(-1)?.length;
    const bounds = this.__charBounds[lineIndex];
    if (this.path && total && bounds && !isClosed(this.path)) {
      const widths = bounds.slice(0, this._textLines[lineIndex]!.length).map((box) => box.kernedWidth);
      lettersPastTheEnd(widths, total, this.textAlign, this.pathSide === "right", this.pathStartOffset).forEach((past, index) => {
        if (past) bounds[index]!.pastPathEnd = true;
      });
    }
    return measured;
  };
  const renderChar = text._renderChar;
  text._renderChar = function (method, ctx, lineIndex, charIndex, ...rest) {
    if (this.path && this.__charBounds[lineIndex]?.[charIndex]?.pastPathEnd) return;
    renderChar.call(this, method, ctx, lineIndex, charIndex, ...rest);
  };

  const renderSelection = prototype._renderSelection;
  prototype._renderSelection = function (ctx, selection, boundaries) {
    if (!this.path) return renderSelection.call(this, ctx, selection, boundaries);
    ctx.fillStyle = this.selectionColor;
    for (let index = selection.selectionStart; index < selection.selectionEnd; index += 1) {
      const { lineIndex, charIndex } = this.get2DCursorLocation(index);
      const box = this.__charBounds[lineIndex]?.[charIndex];
      if (!placed(box)) continue;
      const [top, bottom] = letterSpan(this.pathAlign, this.getValueOfPropertyAt(lineIndex, charIndex, "fontSize") as number, this._fontSizeFraction);
      inLetterFrame(ctx, box, () => ctx.fillRect(-box.kernedWidth / 2, top, box.kernedWidth, bottom - top));
    }
  };

  const renderCursor = prototype._renderCursor;
  prototype._renderCursor = function (ctx, boundaries, selectionStart) {
    if (!this.path) return renderCursor.call(this, ctx, boundaries, selectionStart);
    const { lineIndex, charIndex } = this.get2DCursorLocation(selectionStart);
    const line = this.__charBounds[lineIndex];
    // Before the letter at the cursor, or after the line's last one.
    let box = line?.[charIndex];
    let edge = -1;
    if (!placed(box)) {
      box = line?.[charIndex - 1];
      edge = 1;
    }
    if (!placed(box) || !this.canvas) return;
    const styleIndex = charIndex > 0 ? charIndex - 1 : 0;
    const [top, bottom] = letterSpan(this.pathAlign, this.getValueOfPropertyAt(lineIndex, styleIndex, "fontSize") as number, this._fontSizeFraction);
    const width = this.cursorWidth / (this.getObjectScaling().x * this.canvas.getZoom());
    const letter = box;
    inLetterFrame(ctx, letter, () => {
      ctx.fillStyle = this.cursorColor || (this.getValueOfPropertyAt(lineIndex, styleIndex, "fill") as string);
      ctx.globalAlpha = this._currentCursorOpacity;
      ctx.fillRect((edge * letter.kernedWidth) / 2 - width / 2, top, width, bottom - top);
    });
  };

  const selectionStartFromPointer = prototype.getSelectionStartFromPointer;
  prototype.getSelectionStartFromPointer = function (event) {
    if (!this.path || !this.canvas) return selectionStartFromPointer.call(this, event);
    const point = this.canvas.getScenePoint(event).transform(util.invertTransform(this.calcTransformMatrix()));
    let best = { distance: Infinity, index: 0 };
    let lineStart = 0;
    for (let lineIndex = 0; lineIndex < this._textLines.length; lineIndex += 1) {
      const length = this._textLines[lineIndex]!.length;
      for (let charIndex = 0; charIndex < length; charIndex += 1) {
        const box = this.__charBounds[lineIndex]?.[charIndex];
        if (!placed(box)) continue;
        const [top, bottom] = letterSpan(this.pathAlign, this.getValueOfPropertyAt(lineIndex, charIndex, "fontSize") as number, this._fontSizeFraction);
        const dx = point.x - box.renderLeft;
        const dy = point.y - box.renderTop;
        const along = dx * Math.cos(box.angle) + dy * Math.sin(box.angle);
        const across = -dx * Math.sin(box.angle) + dy * Math.cos(box.angle);
        // How far the click is outside the letter's box (0 inside it).
        const distance = Math.hypot(
          Math.max(0, Math.abs(along) - box.kernedWidth / 2),
          Math.max(0, Math.abs(across - (top + bottom) / 2) - (bottom - top) / 2)
        );
        if (distance < best.distance) {
          best = { distance, index: lineStart + charIndex + (along > 0 ? 1 : 0) };
        }
      }
      lineStart += length + this.missingNewlineOffset(lineIndex);
    }
    return Math.min(best.index, this.text.length);
  };
}
