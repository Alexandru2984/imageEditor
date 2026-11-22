import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import {
  ChevronRight,
  Circle,
  CornerDownRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Minus,
  MoveRight,
  Pencil,
  Square,
  Type,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EffectName } from "@/raster/layerStyleData";
import type { LayerItem } from "./layerRows";
import { ADJUSTMENT_ICONS } from "./adjustmentIcons";

const TYPE_ICONS: Record<string, typeof Square> = {
  rect: Square,
  circle: Circle,
  ellipse: Circle,
  line: Minus,
  path: Pencil,
  pencilbrush: Pencil,
  itext: Type,
  text: Type,
  textbox: Type,
  fabrictext: Type,
  image: ImageIcon,
  triangle: MoveRight,
  polygon: MoveRight,
};

const CHECKERBOARD =
  "linear-gradient(45deg,hsl(var(--muted)) 25%,transparent 25%,transparent 75%,hsl(var(--muted)) 75%),linear-gradient(45deg,hsl(var(--muted)) 25%,transparent 25%,transparent 75%,hsl(var(--muted)) 75%)";

/** Indentation per group level, in pixels. */
const INDENT = 14;

export interface LayerRowHandlers {
  onClick(layer: LayerItem, event: MouseEvent): void;
  onPointerDown(layer: LayerItem, event: PointerEvent): void;
  onHandlePointerDown(layer: LayerItem, event: PointerEvent): void;
  onContextMenu(layer: LayerItem, event: MouseEvent): void;
  onKeyDown(layer: LayerItem, event: KeyboardEvent): void;
  onEyePointerDown(layer: LayerItem, event: PointerEvent): void;
  onEyePointerEnter(layer: LayerItem, event: PointerEvent): void;
  onEyeClick(layer: LayerItem, event: MouseEvent): void;
  onToggleCollapsed(layer: LayerItem, event: MouseEvent): void;
  /** A click on the layer's thumbnail (`mask` false) or its mask's. */
  onThumbnail(layer: LayerItem, mask: boolean, event: MouseEvent): void;
  onToggleLock(layer: LayerItem, event: MouseEvent): void;
  onStartRename(layer: LayerItem): void;
  onRenameChange(value: string): void;
  onCommitRename(): void;
  onCancelRename(): void;
  onToggleEffects(layer: LayerItem, event: MouseEvent): void;
  onToggleEffect(layer: LayerItem, effect: EffectName): void;
  onEditEffects(layer: LayerItem): void;
  /** Double-click on an adjustment layer's icon: its settings. */
  onEditAdjustment(layer: LayerItem): void;
}

interface LayerRowProps {
  layer: LayerItem;
  selected: boolean;
  /** Paint tools work on this layer's mask. */
  paintingMask: boolean;
  renaming: boolean;
  renameValue: string;
  effectsOpen: boolean;
  /** Where a drag would drop relative to this row. */
  drop: "above" | "below" | "inside" | null;
  /** Being dragged. */
  dragged: boolean;
  handlers: LayerRowHandlers;
}

/** One row of the Layers panel, and the list of its effects when open. */
export function LayerRow({
  layer,
  selected,
  paintingMask,
  renaming,
  renameValue,
  effectsOpen,
  drop,
  dragged,
  handlers,
}: LayerRowProps) {
  const TypeIcon = TYPE_ICONS[layer.type] ?? Square;
  const isGroup = layer.kind === "group";
  const shown = layer.visible && !layer.hiddenByGroup;
  const indent = { paddingLeft: `${layer.depth * INDENT}px` };

  return (
    <>
      <div
        data-layer-id={layer.id}
        data-layer-kind={layer.kind}
        data-collapsed={isGroup ? String(layer.collapsed) : undefined}
        data-selected={selected ? "true" : undefined}
        role="group"
        tabIndex={0}
        aria-label={isGroup ? `${layer.name} group` : `${layer.name} layer`}
        aria-current={selected ? "true" : undefined}
        onClick={(event) => handlers.onClick(layer, event)}
        onPointerDown={(event) => handlers.onPointerDown(layer, event)}
        onContextMenu={(event) => handlers.onContextMenu(layer, event)}
        onKeyDown={(event) => handlers.onKeyDown(layer, event)}
        className={cn(
          "group relative flex cursor-pointer select-none items-center gap-1.5 rounded-md border py-1 pl-1 pr-1.5 transition-colors duration-100 [contain-intrinsic-size:auto_40px] [content-visibility:auto]",
          selected ? "border-primary/30 bg-primary/15" : "border-transparent hover:bg-accent",
          dragged && "opacity-40",
          drop === "inside" && "ring-2 ring-primary",
          drop === "above" && "shadow-[inset_0_2px_0_0_hsl(var(--primary))]",
          drop === "below" && "shadow-[inset_0_-2px_0_0_hsl(var(--primary))]"
        )}
      >
        <button
          type="button"
          aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
          title="Alt+click to show only this layer · drag across eyes to change several"
          onPointerDown={(event) => handlers.onEyePointerDown(layer, event)}
          onPointerEnter={(event) => handlers.onEyePointerEnter(layer, event)}
          onClick={(event) => handlers.onEyeClick(layer, event)}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground",
            layer.visible && layer.hiddenByGroup && "opacity-40"
          )}
        >
          {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>

        <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", !shown && "opacity-50")} style={indent}>
          {isGroup ? (
            <button
              type="button"
              aria-label={`${layer.collapsed ? "Open" : "Close"} ${layer.name}`}
              aria-expanded={!layer.collapsed}
              onClick={(event) => handlers.onToggleCollapsed(layer, event)}
              className="-mr-1 flex h-5 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", !layer.collapsed && "rotate-90")} />
            </button>
          ) : (
            layer.clipped && (
              <CornerDownRight aria-label="Clipped to the layer below" className="-mr-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            )
          )}

          {isGroup ? (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
              {layer.collapsed ? <Folder className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
            </div>
          ) : layer.adjustment || layer.fill ? (
            <button
              type="button"
              data-thumbnail=""
              aria-label={`Settings of ${layer.name}`}
              title={layer.fill ? "Double-click for the fill's settings" : "Double-click for the adjustment's settings"}
              onClick={(event) => event.detail === 0 && handlers.onEditAdjustment(layer)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                handlers.onEditAdjustment(layer);
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-muted text-muted-foreground"
            >
              {layer.adjustment ? (
                (() => {
                  const Icon = ADJUSTMENT_ICONS[layer.adjustment];
                  return <Icon className="h-4 w-4" />;
                })()
              ) : (
                <span className="h-full w-full rounded-[3px]" style={{ background: layer.fill ?? undefined }} />
              )}
            </button>
          ) : (
            <div
              data-thumbnail=""
              role={layer.mask ? "button" : undefined}
              aria-label={layer.mask ? `Paint on ${layer.name}` : undefined}
              aria-pressed={layer.mask ? !paintingMask : undefined}
              title="Ctrl+click to select the layer's pixels"
              onClick={(event) => handlers.onThumbnail(layer, false, event)}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-[length:8px_8px] bg-[position:0_0,4px_4px]",
                layer.mask && selected && !paintingMask ? "border-primary ring-1 ring-primary" : "border-border"
              )}
              style={{ backgroundImage: CHECKERBOARD }}
            >
              {layer.thumbnail ? (
                <img src={layer.thumbnail} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
              ) : (
                <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
          )}

          {layer.mask && (
            <button
              type="button"
              aria-label={`${layer.name} layer mask`}
              aria-pressed={paintingMask}
              title="Click to paint on the mask · Shift+click to turn it off"
              onClick={(event) => handlers.onThumbnail(layer, true, event)}
              className={cn(
                "relative -ml-1 h-7 w-7 shrink-0 overflow-hidden rounded border bg-black",
                paintingMask ? "border-primary ring-1 ring-primary" : "border-border"
              )}
            >
              {layer.mask.thumbnail && (
                <img src={layer.mask.thumbnail} alt="" className="h-full w-full object-contain" draggable={false} />
              )}
              {!layer.mask.enabled && (
                <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full text-red-500" aria-hidden>
                  <path d="M4 4 24 24M24 4 4 24" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              )}
            </button>
          )}

          {renaming ? (
            <input
              autoFocus
              aria-label={`Rename ${layer.name}`}
              value={renameValue}
              maxLength={256}
              onChange={(event) => handlers.onRenameChange(event.target.value)}
              onBlur={handlers.onCommitRename}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") handlers.onCommitRename();
                else if (event.key === "Escape") handlers.onCancelRename();
              }}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-6 min-w-0 flex-1 rounded border border-primary bg-background px-1 text-xs"
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-xs"
              onDoubleClick={(event) => {
                event.stopPropagation();
                handlers.onStartRename(layer);
              }}
            >
              {layer.name}
            </span>
          )}
        </div>

        {layer.effects.length > 0 && (
          <button
            type="button"
            aria-label={`${effectsOpen ? "Hide" : "Show"} the effects of ${layer.name}`}
            aria-expanded={effectsOpen}
            onClick={(event) => handlers.onToggleEffects(layer, event)}
            className="flex h-6 shrink-0 items-center gap-0.5 rounded px-0.5 text-[10px] font-semibold italic text-muted-foreground hover:text-foreground"
          >
            fx
            <ChevronRight className={cn("h-3 w-3 transition-transform", effectsOpen && "rotate-90")} />
          </button>
        )}

        {isGroup ? (
          <span className="h-6 w-6 shrink-0" />
        ) : (
          <button
            type="button"
            aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
            title={layer.locked ? "Unlock" : "Lock"}
            disabled={layer.isBackground}
            onClick={(event) => handlers.onToggleLock(layer, event)}
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:pointer-events-none",
              !layer.locked && !layer.partlyLocked && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
            )}
          >
            {layer.locked ? (
              <Lock className="h-3 w-3 text-amber-500" />
            ) : layer.partlyLocked ? (
              // Photoshop's hollow padlock: some locks are on.
              <Lock aria-hidden className="h-3 w-3 opacity-60" />
            ) : (
              <Unlock className="h-3 w-3" />
            )}
          </button>
        )}

        {!layer.isBackground && (
          <span
            aria-label={`Drag ${layer.name}`}
            data-drag-handle=""
            onPointerDown={(event) => handlers.onHandlePointerDown(layer, event)}
            onContextMenu={(event) => event.preventDefault()}
            className="hidden h-7 w-6 shrink-0 touch-none items-center justify-center text-muted-foreground [@media(pointer:coarse)]:flex"
          >
            <GripVertical className="h-4 w-4" />
          </span>
        )}
      </div>

      {effectsOpen && layer.effects.length > 0 && (
        <div role="list" aria-label={`Effects of ${layer.name}`} className="space-y-0.5">
          {layer.effects.map((effect) => (
            <div
              key={effect.name}
              role="listitem"
              onDoubleClick={() => handlers.onEditEffects(layer)}
              className="flex items-center gap-1.5 rounded-md py-0.5 pl-1 pr-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <button
                type="button"
                aria-label={`${effect.enabled ? "Hide" : "Show"} the ${effect.label.toLowerCase()} of ${layer.name}`}
                onClick={() => handlers.onToggleEffect(layer, effect.name)}
                className="flex h-5 w-6 shrink-0 items-center justify-center rounded hover:text-foreground"
              >
                {effect.enabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
              <span className={cn("truncate", !effect.enabled && "opacity-50")} style={{ paddingLeft: `${layer.depth * INDENT + 40}px` }}>
                {effect.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
