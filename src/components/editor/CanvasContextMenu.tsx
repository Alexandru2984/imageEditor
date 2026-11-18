import { useEffect, useState } from "react";
import { ActiveSelection, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Layers,
  FlipHorizontal2,
  FlipVertical2,
  Lock,
  LockOpen,
  Maximize,
  MousePointerSquareDashed,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isBackgroundObject,
  isEditorChrome,
  isObjectLocked,
  removeSelectedObjects,
  setObjectLocked,
} from "@/utils/editorObjects";
import { selectAllLayers, selectedObjects, type ArrangeAction } from "@/utils/canvasActions";
import { KEYMAP } from "@/commands/keymap";
import { formatShortcut, type Shortcut } from "@/commands/shortcuts";

const hint = (shortcuts: readonly Shortcut[]) => formatShortcut(shortcuts[0]!);

interface CanvasContextMenuProps {
  canvas: FabricCanvas | null;
  /** Only the Select tool owns right-clicks; drawing tools keep them. */
  enabled: boolean;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: () => boolean;
  onDuplicate: () => void;
  onArrange: (action: ArrangeAction) => void;
  onFlip: (axis: "x" | "y") => void;
  onFit: () => void;
}

interface MenuState {
  x: number;
  y: number;
  hasSelection: boolean;
  locked: boolean;
  canPaste: boolean;
}

/** Right-click menu for layers on the canvas. */
export function CanvasContextMenu({
  canvas,
  enabled,
  onCopy,
  onPaste,
  canPaste,
  onDuplicate,
  onArrange,
  onFlip,
  onFit,
}: CanvasContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!canvas || !enabled) return;
    const element = canvas.upperCanvasEl;
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const { target } = canvas.findTarget(event);
      const active = canvas.getActiveObject();
      const usable = (object: FabricObject | undefined): object is FabricObject =>
        !!object && !isEditorChrome(object) && !isBackgroundObject(object);

      if (usable(target)) {
        const alreadySelected =
          active === target ||
          (active instanceof ActiveSelection && active.getObjects().includes(target));
        if (!alreadySelected) {
          canvas.setActiveObject(target);
          canvas.requestRenderAll();
        }
      } else if (active && !target) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
      const objects = selectedObjects(canvas).filter((object) => !isBackgroundObject(object));
      setMenu({
        x: event.clientX,
        y: event.clientY,
        hasSelection: objects.length > 0,
        locked: objects.length > 0 && objects.every((object) => isObjectLocked(object)),
        canPaste: canPaste(),
      });
    };
    element.addEventListener("contextmenu", handleContextMenu);
    return () => element.removeEventListener("contextmenu", handleContextMenu);
  }, [canvas, enabled, canPaste]);

  const toggleLock = () => {
    if (!canvas || !menu) return;
    const objects = selectedObjects(canvas).filter((object) => !isBackgroundObject(object));
    if (objects.length === 0) return;
    for (const object of objects) setObjectLocked(object, !menu.locked);
    canvas.fire("object:modified", { target: canvas.getActiveObject() ?? objects[0]! });
    canvas.requestRenderAll();
  };

  const remove = () => {
    if (canvas) removeSelectedObjects(canvas);
  };

  const selectAll = () => {
    if (canvas) selectAllLayers(canvas);
  };

  return (
    <DropdownMenu open={!!menu} onOpenChange={(open) => !open && setMenu(null)} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed h-px w-px"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className="w-56" aria-label="Layer actions">
        {menu?.hasSelection ? (
          <>
            <DropdownMenuItem onSelect={onCopy}>
              <Copy /> Copy <DropdownMenuShortcut>{hint(KEYMAP.copy)}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPaste} disabled={!menu.canPaste}>
              <ClipboardPaste /> Paste <DropdownMenuShortcut>{hint(KEYMAP.paste)}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <CopyPlus /> Duplicate <DropdownMenuShortcut>{hint(KEYMAP.duplicate)}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={menu.locked}>
                <Layers /> Arrange
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuItem onSelect={() => onArrange("front")}>
                  <ArrowUpToLine /> Bring to front <DropdownMenuShortcut>{hint(KEYMAP.bringToFront)}</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onArrange("forward")}>
                  <ChevronUp /> Bring forward <DropdownMenuShortcut>{hint(KEYMAP.bringForward)}</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onArrange("backward")}>
                  <ChevronDown /> Send backward <DropdownMenuShortcut>{hint(KEYMAP.sendBackward)}</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onArrange("back")}>
                  <ArrowDownToLine /> Send to back <DropdownMenuShortcut>{hint(KEYMAP.sendToBack)}</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => onFlip("x")} disabled={menu.locked}>
              <FlipHorizontal2 /> Flip horizontal <DropdownMenuShortcut>{hint(KEYMAP.flipHorizontal)}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onFlip("y")} disabled={menu.locked}>
              <FlipVertical2 /> Flip vertical <DropdownMenuShortcut>{hint(KEYMAP.flipVertical)}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleLock}>
              {menu.locked ? <LockOpen /> : <Lock />} {menu.locked ? "Unlock" : "Lock"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={remove}
              disabled={menu.locked}
              className="text-destructive focus:text-destructive [&_svg]:text-destructive"
            >
              <Trash2 /> Delete <DropdownMenuShortcut>{hint(KEYMAP.delete)}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={onPaste} disabled={!menu?.canPaste}>
              <ClipboardPaste /> Paste <DropdownMenuShortcut>{hint(KEYMAP.paste)}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={selectAll}>
              <MousePointerSquareDashed /> Select all layers <DropdownMenuShortcut>{hint(KEYMAP.selectAllLayers)}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onFit}>
              <Maximize /> Fit to screen <DropdownMenuShortcut>{hint(KEYMAP.fitOnScreen)}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
