import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { Brush, CircleDot, Contrast, FolderPlus, Grid2x2, Layers, Lock, MoreHorizontal, Move, Pencil, Search, SquareDashed, SquarePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import type { CommandMap, MenuEntry } from "@/commands/types";
import { EDITOR_MENUS } from "@/commands/menus";
import { useMaskTarget } from "@/hooks/useMaskTarget";
import { isGroupHeader, isGroupMarker, type LayerGroup } from "@/layers/groupMarkers";
import {
  deleteSelectedLayers,
  groupObjects,
  groupPath,
  moveLayers,
  onSelectedGroupChange,
  selectionIds,
  selectLayers,
} from "@/layers/layerGroups";
import type { Anchor } from "@/layers/layerTree";
import { hasLayerMask, maskTargetOf, setLayerMaskEnabled } from "@/raster/layerMask";
import type { EffectName, LayerStyle } from "@/raster/layerStyleData";
import { selectionModeOf, selectLayerPixels } from "@/selection/layerPixels";
import { BLEND_MODES, DEFAULT_BLEND_MODE, objectThumbnail } from "@/utils/blendModes";
import {
  ensureLayerId,
  hasLayerLock,
  isBackgroundObject,
  isEditorChrome,
  isLayerObject,
  isObjectLocked,
  isProtectedObject,
  setLayerLock,
  setObjectLocked,
  type LayerLock,
} from "@/utils/editorObjects";
import { fillOf } from "@/raster/layerStyle";
import { cn } from "@/lib/utils";
import { CommandDropdownItems } from "./EditorMenus";
import { LayerRow, type LayerRowHandlers } from "./layers/LayerRow";
import { isFiltering, layerRows, NO_FILTER, rowRange, type EditorObject, type KindFilter, type LayerItem, type RowFilter } from "./layers/layerRows";
import { useLayerDrag, type DropTarget } from "./layers/useLayerDrag";

interface LayersPanelProps {
  fabricCanvas: FabricCanvas | null;
  /** The editor's commands, for the panel's buttons and its right-click menu. */
  commands: CommandMap;
}

// Generating a Fabric data URL is a real canvas render. Keep previews for the
// top of the stack and use type icons deeper down instead of blocking the UI on
// hundreds (or thousands) of synchronous offscreen renders.
const MAX_LAYER_THUMBNAILS = 120;
const MAX_CACHED_THUMBNAILS = 160;

/** A group's blend mode when its layers blend straight into what is below. */
const PASS_THROUGH = "pass-through";

const LOCKS: { lock: LayerLock; label: string; icon: typeof Lock }[] = [
  { lock: "transparency", label: "Lock transparent pixels", icon: Grid2x2 },
  { lock: "pixels", label: "Lock image pixels", icon: Brush },
  { lock: "position", label: "Lock position", icon: Move },
  { lock: "all", label: "Lock all", icon: Lock },
];

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "pixel", label: "Pixel" },
  { value: "adjustment", label: "Adjustment" },
  { value: "text", label: "Text" },
  { value: "shape", label: "Shape" },
  { value: "group", label: "Group" },
];

/** A submenu of the Layer menu, by its label. */
const layerSubmenu = (label: string): readonly MenuEntry[] =>
  (EDITOR_MENUS.find((menu) => menu.label === "Layer")?.items.find(
    (entry): entry is Exclude<MenuEntry, string> => typeof entry !== "string" && entry.label === label
  )?.items ?? []) as readonly MenuEntry[];

/** The footer's fill or adjustment layer button: New Fill Layer, then New Adjustment Layer, as in Photoshop. */
const ADJUSTMENT_MENU: readonly MenuEntry[] = [...layerSubmenu("New fill layer"), "-", ...layerSubmenu("New adjustment layer")];

/** The commands of the panel's right-click menu and its ⋯ button. */
const layerMenu = (clipped: boolean): readonly MenuEntry[] => [
  "layer.duplicate",
  "layer.group",
  "layer.ungroup",
  "-",
  "layer.mask.add",
  "layer.style",
  "layer.style.clear",
  "-",
  // As in Photoshop, the one that applies.
  clipped ? "layer.releaseClippingMask" : "layer.createClippingMask",
  "layer.toggleLock",
  "-",
  "layer.rasterize",
  "layer.mergeDown",
  "layer.mergeGroup",
  "layer.mergeVisible",
  "layer.flatten",
];

type Styled = FabricObject & { layerStyle?: LayerStyle };

const idOf = (object: FabricObject) => (object as EditorObject).__layerId ?? "";

export const LayersPanel = ({ fabricCanvas, commands }: LayersPanelProps) => {
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const [layerCount, setLayerCount] = useState(0);
  // Which layer's mask the paint tools work on.
  const maskTargetLayer = useMaskTarget(fabricCanvas);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openEffects, setOpenEffects] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<RowFilter>(NO_FILTER);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const anchorRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const thumbnailCacheRef = useRef<Map<FabricObject, string>>(new Map());
  const refreshFrameRef = useRef<number | null>(null);
  const pendingOpacityCommitRef = useRef<FabricObject | null>(null);
  const opacityCommitTimerRef = useRef<number | null>(null);
  const eyeStrokeRef = useRef<{ value: boolean; changed: FabricObject[] } | null>(null);
  const eyeByPointerRef = useRef(false);
  const soloRef = useRef<{ id: string; saved: Map<FabricObject, boolean> } | null>(null);
  // Rename… starts once its menu has closed and let go of the focus.
  const renameAfterMenuRef = useRef<LayerItem | null>(null);

  const syncSelection = useCallback(() => {
    setSelectedIds(fabricCanvas ? new Set(selectionIds(fabricCanvas)) : new Set());
  }, [fabricCanvas]);

  const refreshLayers = useCallback(() => {
    if (!fabricCanvas) {
      setLayers([]);
      setLayerCount(0);
      return;
    }
    const objects = fabricCanvas.getObjects().filter((object) => !isEditorChrome(object));
    const usedIds = new Set<string>();
    for (const object of objects) ensureLayerId(object, usedIds);
    const rows = layerRows(objects, filter);

    // Thumbnails are memoized by object identity and invalidated only when
    // that object changes.
    const cache = thumbnailCacheRef.current;
    let drawn = 0;
    for (const row of rows) {
      if (row.kind === "group" || row.adjustment || row.fill) continue;
      if (drawn >= MAX_LAYER_THUMBNAILS) break;
      drawn += 1;
      if (cache.has(row.fabricObject)) {
        const thumbnail = cache.get(row.fabricObject) ?? "";
        row.thumbnail = thumbnail;
        // Refresh insertion order so the bounded map behaves as a small LRU.
        cache.delete(row.fabricObject);
        cache.set(row.fabricObject, thumbnail);
      } else {
        const thumbnail = objectThumbnail(row.fabricObject);
        cache.set(row.fabricObject, thumbnail);
        if (cache.size > MAX_CACHED_THUMBNAILS) {
          const oldest = cache.keys().next().value as FabricObject | undefined;
          if (oldest) cache.delete(oldest);
        }
        row.thumbnail = thumbnail;
      }
    }
    setLayers(rows);
    setLayerCount(objects.filter((object) => !isGroupMarker(object)).length);
    syncSelection();
  }, [fabricCanvas, filter, syncSelection]);

  const scheduleRefresh = useCallback(
    (target?: FabricObject) => {
      if (target) thumbnailCacheRef.current.delete(target);
      else thumbnailCacheRef.current.clear();
      if (refreshFrameRef.current !== null) return;
      refreshFrameRef.current = window.requestAnimationFrame(() => {
        refreshFrameRef.current = null;
        refreshLayers();
      });
    },
    [refreshLayers]
  );

  useEffect(() => {
    if (!fabricCanvas) return;
    const thumbnailCache = thumbnailCacheRef.current;
    refreshLayers();
    const events = ["object:added", "object:removed", "object:modified"] as const;
    const handler = (event: { target?: FabricObject }) => scheduleRefresh(event.target);
    events.forEach((event) => fabricCanvas.on(event, handler));
    return () => {
      events.forEach((event) => fabricCanvas.off(event, handler));
      if (refreshFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshFrameRef.current);
        refreshFrameRef.current = null;
      }
      thumbnailCache.clear();
    };
  }, [fabricCanvas, refreshLayers, scheduleRefresh]);

  // The selection follows the canvas, once each change has settled (picking
  // groups changes the canvas selection, then the groups).
  useEffect(() => {
    if (!fabricCanvas) return;
    let queued = false;
    const later = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        syncSelection();
      });
    };
    const events = ["selection:created", "selection:updated", "selection:cleared"] as const;
    events.forEach((event) => fabricCanvas.on(event, later));
    const stopGroups = onSelectedGroupChange(fabricCanvas, later);
    syncSelection();
    return () => {
      stopGroups();
      events.forEach((event) => fabricCanvas.off(event, later));
    };
  }, [fabricCanvas, syncSelection]);

  // What is selected, top of the stack first (also what is folded away).
  const selection = useMemo(() => {
    if (!fabricCanvas || selectedIds.size === 0) return [];
    return fabricCanvas
      .getObjects()
      .filter((object) => !isEditorChrome(object) && selectedIds.has(idOf(object)))
      .reverse() as EditorObject[];
    // The rows change whenever the stack does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricCanvas, selectedIds, layers]);
  const primary = selection[0] ?? null;
  const selectionLocked = selection.some(
    (object) => !isGroupHeader(object) && (isBackgroundObject(object) || isObjectLocked(object))
  );
  const allGroups = selection.length > 0 && selection.every(isGroupHeader);
  const single = selection.length === 1 ? layers.find((row) => row.id === idOf(selection[0]!)) ?? null : null;

  // ---------- Opacity and blend mode ----------

  const fireOpacityCommit = useCallback(
    (target: FabricObject): boolean => {
      if (!fabricCanvas || isProtectedObject(target) || !fabricCanvas.getObjects().includes(target)) return false;
      fabricCanvas.fire("object:modified", { target });
      return true;
    },
    [fabricCanvas]
  );

  const flushOpacityCommit = useCallback(() => {
    if (opacityCommitTimerRef.current !== null) {
      window.clearTimeout(opacityCommitTimerRef.current);
      opacityCommitTimerRef.current = null;
    }
    const target = pendingOpacityCommitRef.current;
    pendingOpacityCommitRef.current = null;
    if (target) fireOpacityCommit(target);
  }, [fireOpacityCommit]);

  const scheduleOpacityCommit = useCallback(
    (target: FabricObject) => {
      pendingOpacityCommitRef.current = target;
      if (opacityCommitTimerRef.current !== null) window.clearTimeout(opacityCommitTimerRef.current);
      opacityCommitTimerRef.current = window.setTimeout(() => {
        opacityCommitTimerRef.current = null;
        const pending = pendingOpacityCommitRef.current;
        pendingOpacityCommitRef.current = null;
        if (pending) fireOpacityCommit(pending);
      }, 75);
    },
    [fireOpacityCommit]
  );

  useEffect(() => () => flushOpacityCommit(), [fabricCanvas, flushOpacityCommit]);

  const selectedBlend =
    primary && isGroupHeader(primary) && primary.passThrough !== false
      ? PASS_THROUGH
      : (primary?.globalCompositeOperation as string) || DEFAULT_BLEND_MODE;
  const selectedOpacity = Math.round((primary?.opacity ?? 1) * 100);
  const selectedFill = Math.round((primary ? fillOf(primary) : 1) * 100);
  // The layers (not groups, nor the photo) the locks and Fill apply to.
  const lockable = selection.filter((object) => !isGroupHeader(object) && !isBackgroundObject(object));

  const handleBlendModeChange = (value: string) => {
    if (!fabricCanvas || !primary || selectionLocked) return;
    for (const object of selection) {
      if (isGroupHeader(object)) object.passThrough = value === PASS_THROUGH;
      object.set("globalCompositeOperation", (value === PASS_THROUGH ? "source-over" : value) as GlobalCompositeOperation);
    }
    fabricCanvas.fire("object:modified", { target: primary });
    fabricCanvas.requestRenderAll();
  };

  const handleOpacityChange = (value: number[]) => {
    const opacity = value[0];
    if (!fabricCanvas || !primary || selectionLocked || opacity === undefined) return;
    for (const object of selection) object.set("opacity", opacity / 100);
    fabricCanvas.requestRenderAll();
    // Reflect the new value without waiting for a full refresh.
    setLayers((previous) => [...previous]);
    scheduleOpacityCommit(primary);
  };

  const handleFillChange = (value: number[]) => {
    const fill = value[0];
    if (!fabricCanvas || !primary || selectionLocked || fill === undefined || lockable.length === 0) return;
    for (const object of lockable) {
      // Full is no setting at all.
      (object as EditorObject).__fill = fill >= 100 ? undefined : fill / 100;
      object.dirty = true;
    }
    fabricCanvas.requestRenderAll();
    setLayers((previous) => [...previous]);
    scheduleOpacityCommit(lockable[0]!);
  };

  const toggleLock = (lock: LayerLock) => {
    if (!fabricCanvas || lockable.length === 0) return;
    const on = !lockable.every((object) => hasLayerLock(object, lock));
    for (const object of lockable) setLayerLock(object, lock, on);
    fabricCanvas.fire("object:modified", { target: lockable[0]! });
    fabricCanvas.requestRenderAll();
    scheduleRefresh();
  };

  // ---------- Selecting ----------

  const pick = (ids: readonly string[]) => {
    if (!fabricCanvas) return;
    // None clears the canvas selection and what is picked in the panel.
    selectLayers(fabricCanvas, ids);
    syncSelection();
  };

  const startRename = (layer: LayerItem) => {
    if (layer.locked) return;
    setRenamingId(layer.id);
    setRenameValue(layer.name);
  };

  const commitRename = () => {
    if (!fabricCanvas || renamingId === null) {
      setRenamingId(null);
      return;
    }
    const layer = layers.find((row) => row.id === renamingId);
    const name = renameValue.trim().slice(0, 256);
    if (layer && !layer.locked && name && name !== layer.name) {
      layer.fabricObject.name = name;
      fabricCanvas.fire("object:modified", { target: layer.fabricObject });
    }
    setRenamingId(null);
  };

  // ---------- Visibility ----------

  const setShown = (object: FabricObject, visible: boolean) => {
    object.set("visible", visible);
    fabricCanvas?.requestRenderAll();
    scheduleRefresh(object);
  };

  const commitVisibility = (changed: readonly FabricObject[]) => {
    if (fabricCanvas && changed.length) fabricCanvas.fire("object:modified", { target: changed[0]! });
  };

  /** Alt+click on an eye: only that layer (and the groups around it) shows; again, all comes back. */
  const solo = (layer: LayerItem) => {
    if (!fabricCanvas) return;
    const all = fabricCanvas.getObjects();
    const objects = all.filter((object) => isLayerObject(object) || isGroupHeader(object));
    const previous = soloRef.current;
    const changed: FabricObject[] = [];
    if (previous?.id === layer.id) {
      for (const [object, visible] of previous.saved) {
        if (!all.includes(object) || object.visible === visible) continue;
        object.set("visible", visible);
        changed.push(object);
      }
      soloRef.current = null;
    } else {
      const saved = new Map(objects.map((object) => [object, object.visible !== false]));
      const keep = new Set<FabricObject>([layer.fabricObject, ...groupPath(fabricCanvas, layer.fabricObject).map((node) => all[node.index]!)]);
      // A group shown alone keeps its layers as they are.
      const inside = isGroupHeader(layer.fabricObject) ? new Set(groupObjects(fabricCanvas, layer.fabricObject)) : new Set();
      for (const object of objects) {
        if (inside.has(object) && !keep.has(object)) continue;
        const visible = keep.has(object);
        if ((object.visible !== false) === visible) continue;
        object.set("visible", visible);
        changed.push(object);
      }
      soloRef.current = { id: layer.id, saved };
    }
    fabricCanvas.requestRenderAll();
    commitVisibility(changed);
  };

  // ---------- Drag and drop ----------

  const handleDrop = (ids: string[], target: DropTarget) => {
    if (!fabricCanvas) return;
    if ("trash" in target) {
      selectLayers(fabricCanvas, ids);
      const result = deleteSelectedLayers(fabricCanvas);
      if (typeof result === "string") toast.error(result);
      return;
    }
    const anchor: Anchor = target.where === "inside" ? { id: target.id, where: "insideTop" } : { id: target.id, where: target.where };
    if (!moveLayers(fabricCanvas, ids, anchor)) {
      toast("The layers cannot go there");
      return;
    }
    selectLayers(fabricCanvas, ids);
  };

  const drag = useLayerDrag({ listRef, enabled: !isFiltering(filter) && !!fabricCanvas, onDrop: handleDrop });

  /** What a drag from this row carries: the selection, when the row is in it. */
  const dragIds = (layer: LayerItem): string[] => {
    const ids = selectedIds.has(layer.id) ? layers.filter((row) => selectedIds.has(row.id)).map((row) => row.id) : [layer.id];
    return ids.filter((id) => !layers.find((row) => row.id === id)?.isBackground);
  };

  const deleteSelection = () => {
    if (!fabricCanvas) return;
    const result = deleteSelectedLayers(fabricCanvas);
    if (typeof result === "string") toast.error(result);
  };

  // ---------- Rows ----------

  const handlers: LayerRowHandlers = {
    onClick(layer, event) {
      if (drag.isDragClick() || !fabricCanvas) return;
      if (event.shiftKey && anchorRef.current) {
        pick(rowRange(layers, anchorRef.current, layer.id));
        return;
      }
      anchorRef.current = layer.id;
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(selectedIds);
        if (next.has(layer.id)) next.delete(layer.id);
        else next.add(layer.id);
        pick([...next]);
        return;
      }
      pick([layer.id]);
    },
    onPointerDown(layer, event) {
      if (event.pointerType !== "mouse" || layer.isBackground || renamingId === layer.id) return;
      if ((event.target as HTMLElement).closest("button, input")) return;
      drag.begin(event, dragIds(layer));
    },
    onHandlePointerDown(layer, event) {
      event.stopPropagation();
      drag.begin(event, dragIds(layer));
    },
    onContextMenu(layer, event) {
      event.preventDefault();
      if (!selectedIds.has(layer.id)) {
        anchorRef.current = layer.id;
        pick([layer.id]);
      }
      let { clientX: x, clientY: y } = event;
      // From the keyboard (the menu key, Shift+F10): at the row.
      if (x === 0 && y === 0) {
        const box = event.currentTarget.getBoundingClientRect();
        x = box.left + 24;
        y = box.bottom;
      }
      setContextMenu({ x, y });
    },
    onKeyDown(layer, event: KeyboardEvent) {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        anchorRef.current = layer.id;
        pick([layer.id]);
      } else if (event.key === "F2" && !layer.locked) {
        event.preventDefault();
        startRename(layer);
      }
    },
    onEyePointerDown(layer, event: PointerEvent) {
      event.stopPropagation();
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      eyeByPointerRef.current = true;
      if (event.altKey) {
        solo(layer);
        return;
      }
      // Dragging across eyes sets them all as the first one became: one step.
      const stroke = { value: !layer.visible, changed: [layer.fabricObject as FabricObject] };
      eyeStrokeRef.current = stroke;
      setShown(layer.fabricObject, stroke.value);
      window.addEventListener(
        "pointerup",
        () => {
          eyeStrokeRef.current = null;
          commitVisibility(stroke.changed);
        },
        { once: true }
      );
    },
    onEyePointerEnter(layer, event) {
      const stroke = eyeStrokeRef.current;
      if (!stroke || !(event.buttons & 1) || layer.visible === stroke.value) return;
      stroke.changed.push(layer.fabricObject);
      setShown(layer.fabricObject, stroke.value);
    },
    onEyeClick(layer, event: MouseEvent) {
      event.stopPropagation();
      if (eyeByPointerRef.current) {
        eyeByPointerRef.current = false;
        return;
      }
      // From the keyboard or a touch.
      if (event.altKey) solo(layer);
      else {
        setShown(layer.fabricObject, !layer.visible);
        commitVisibility([layer.fabricObject]);
      }
    },
    onToggleCollapsed(layer, event) {
      event.stopPropagation();
      // Not a change to the document: no history step.
      const header = layer.fabricObject as unknown as LayerGroup;
      header.collapsed = !header.collapsed;
      scheduleRefresh(layer.fabricObject);
    },
    onThumbnail(layer, mask, event) {
      if (!fabricCanvas) return;
      const object = layer.fabricObject;
      // Ctrl+click: the layer's pixels become the selection (Shift adds, Alt subtracts).
      if (!mask && (event.ctrlKey || event.metaKey)) {
        event.stopPropagation();
        if (!selectLayerPixels(fabricCanvas, object, selectionModeOf(event))) toast("The layer has no pixels to select");
        return;
      }
      // Click a thumbnail to paint on the layer or its mask; Shift+click turns the mask off.
      if (!layer.mask) return;
      event.stopPropagation();
      if (mask && event.shiftKey && hasLayerMask(object)) {
        setLayerMaskEnabled(fabricCanvas, object, !object.layerMask.enabled);
        return;
      }
      anchorRef.current = layer.id;
      pick([layer.id]);
      maskTargetOf(fabricCanvas).set(mask ? object : null);
    },
    onToggleLock(layer, event) {
      event.stopPropagation();
      if (!fabricCanvas || layer.isBackground) return;
      setObjectLocked(layer.fabricObject, !layer.locked);
      fabricCanvas.fire("object:modified", { target: layer.fabricObject });
      fabricCanvas.requestRenderAll();
    },
    onStartRename: startRename,
    onRenameChange: setRenameValue,
    onCommitRename: commitRename,
    onCancelRename: () => setRenamingId(null),
    onToggleEffects(layer, event) {
      event.stopPropagation();
      setOpenEffects((open) => {
        const next = new Set(open);
        if (next.has(layer.id)) next.delete(layer.id);
        else next.add(layer.id);
        return next;
      });
    },
    onToggleEffect(layer, name: EffectName) {
      if (!fabricCanvas) return;
      const object = layer.fabricObject as Styled;
      const style = object.layerStyle;
      const effect = style?.[name];
      if (!style || !effect) return;
      if (isObjectLocked(object)) {
        toast("Unlock the layer first");
        return;
      }
      object.layerStyle = { ...style, [name]: { ...effect, enabled: !effect.enabled } };
      object.dirty = true;
      fabricCanvas.requestRenderAll();
      fabricCanvas.fire("object:modified", { target: object });
    },
    onEditAdjustment(layer) {
      anchorRef.current = layer.id;
      pick([layer.id]);
      commands["layer.adjustmentProperties"]?.run();
    },
    onEditEffects(layer) {
      anchorRef.current = layer.id;
      pick([layer.id]);
      commands["layer.style"]?.run();
    },
  };

  const dropOn = (id: string) => {
    const target = drag.target;
    return target && !("trash" in target) && target.id === id ? target.where : null;
  };

  // ---------- The panel's buttons and menu ----------

  const commandButton = (id: string, label: string, icon: React.ReactNode) => {
    const command = commands[id];
    const enabled = !!command && (command.isEnabled ? command.isEnabled() : true);
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={!enabled}
        onClick={() => command?.run()}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        {icon}
      </button>
    );
  };

  const selectPixels = commands["select.layerPixels"];
  const menuItems = (
    <>
      <DropdownMenuItem
        disabled={!single || single.locked}
        onSelect={() => {
          renameAfterMenuRef.current = single;
        }}
      >
        <Pencil /> Rename… <DropdownMenuShortcut>F2</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!selectPixels || (selectPixels.isEnabled ? !selectPixels.isEnabled() : false)}
        onSelect={() => selectPixels?.run()}
      >
        <SquareDashed /> Select pixels
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <CommandDropdownItems
        entries={layerMenu(selection.some((object) => (object as EditorObject & { __clipped?: boolean }).__clipped === true))}
        commands={commands}
      />
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={selection.length === 0 || selectionLocked}
        onSelect={deleteSelection}
        className="text-destructive focus:text-destructive [&_svg]:text-destructive"
      >
        <Trash2 /> Delete
      </DropdownMenuItem>
    </>
  );

  const afterMenu = (event: Event) => {
    event.preventDefault();
    const layer = renameAfterMenuRef.current;
    renameAfterMenuRef.current = null;
    if (layer) startRename(layer);
  };

  const trashTarget = !!drag.target && "trash" in drag.target;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <select
            value={filter.kind}
            aria-label="Filter layers by kind"
            onChange={(event) => setFilter((current) => ({ ...current, kind: event.target.value as KindFilter }))}
            className="h-7 w-24 shrink-0 rounded-md border border-border bg-background px-1.5 text-xs"
          >
            {KIND_FILTERS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={filter.query}
              aria-label="Filter layers by name"
              placeholder="Name"
              maxLength={100}
              onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
              className="h-7 w-full min-w-0 rounded-md border border-border bg-background pl-6 pr-2 text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedBlend}
            aria-label="Layer blend mode"
            disabled={!primary || selectionLocked}
            onChange={(event) => handleBlendModeChange(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
          >
            {allGroups && <option value={PASS_THROUGH}>Pass Through</option>}
            {BLEND_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="w-14 shrink-0 text-xs text-muted-foreground">Opacity</Label>
          <Slider
            value={[selectedOpacity]}
            aria-label="Layer opacity"
            disabled={!primary || selectionLocked}
            onValueChange={handleOpacityChange}
            onValueCommit={flushOpacityCommit}
            min={0}
            max={100}
            step={1}
            className="flex-1"
          />
          <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{selectedOpacity}</span>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Lock" className="flex shrink-0 items-center">
            {LOCKS.map(({ lock, label, icon: Icon }) => {
              const pressed = lockable.length > 0 && lockable.every((object) => hasLayerLock(object, lock));
              return (
                <button
                  key={lock}
                  type="button"
                  aria-label={label}
                  title={label}
                  aria-pressed={pressed}
                  disabled={lockable.length === 0}
                  onClick={() => toggleLock(lock)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                    pressed && "bg-primary/15 text-primary"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
          <Label className="ml-1 shrink-0 text-xs text-muted-foreground">Fill</Label>
          <Slider
            value={[selectedFill]}
            aria-label="Layer fill"
            disabled={lockable.length === 0 || selectionLocked}
            onValueChange={handleFillChange}
            onValueCommit={flushOpacityCommit}
            min={0}
            max={100}
            step={1}
            className="min-w-0 flex-1"
          />
          <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{selectedFill}</span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {layers.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <Layers className="mb-3 h-10 w-10 text-muted-foreground/40" />
            {isFiltering(filter) ? (
              <p className="text-sm text-muted-foreground">No layers match</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">No layers yet</p>
                <p className="mt-1 text-xs text-muted-foreground/60">Draw or add shapes to create layers</p>
              </>
            )}
          </div>
        ) : (
          <div ref={listRef} className={cn("space-y-0.5 p-2", drag.dragged && "cursor-grabbing")}>
            {layers.map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                selected={selectedIds.has(layer.id)}
                // A picked adjustment or fill layer has only its mask to paint.
                paintingMask={
                  maskTargetLayer === layer.fabricObject ||
                  (!!(layer.adjustment || layer.fill) && !!layer.mask && selectedIds.has(layer.id))
                }
                renaming={renamingId === layer.id}
                renameValue={renameValue}
                effectsOpen={openEffects.has(layer.id)}
                drop={dropOn(layer.id)}
                dragged={!!drag.dragged?.includes(layer.id)}
                handlers={handlers}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="flex items-center gap-0.5 border-t border-border px-2 py-1">
        <span className="mr-auto truncate text-xs text-muted-foreground">
          {layerCount} layer{layerCount === 1 ? "" : "s"}
        </span>
        {commandButton("layer.style", "Add a layer style", <span className="text-[11px] font-semibold italic">fx</span>)}
        {commandButton("layer.mask.add", "Add a mask", <CircleDot className="h-4 w-4" />)}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Add a fill or adjustment layer"
              title="Add a fill or adjustment layer"
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Contrast className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            collisionPadding={8}
            className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto"
          >
            <CommandDropdownItems entries={ADJUSTMENT_MENU} commands={commands} />
          </DropdownMenuContent>
        </DropdownMenu>
        {commandButton("layer.newGroup", "Create a new group", <FolderPlus className="h-4 w-4" />)}
        {commandButton("layer.new", "Create a new layer", <SquarePlus className="h-4 w-4" />)}
        <button
          type="button"
          aria-label="Delete layer"
          title="Delete layer (or drag layers here)"
          data-layer-drop="trash"
          disabled={selection.length === 0 && !drag.dragged}
          onClick={deleteSelection}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40",
            trashTarget && "bg-destructive/15 text-destructive"
          )}
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Layer options"
              title="Layer options"
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            collisionPadding={8}
            className="w-72"
            aria-label="Layer options"
            onCloseAutoFocus={afterMenu}
          >
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right-click on a row. */}
      <DropdownMenu open={!!contextMenu} onOpenChange={(open) => !open && setContextMenu(null)} modal={false}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed h-px w-px"
            style={{ left: contextMenu?.x ?? 0, top: contextMenu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={2}
          collisionPadding={8}
          className="w-72"
          aria-label="Layer options"
          onCloseAutoFocus={afterMenu}
        >
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
