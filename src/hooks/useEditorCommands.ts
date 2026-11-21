import { useMemo } from "react";
import { nameNextStep } from "@/utils/historySteps";
import type { GuideDialogKind } from "@/components/editor/GuideDialog";
import { guidesOf, setGuides } from "@/utils/guides";
import type { WarpMode } from "@/raster/warpLayer";
import { revealAll } from "@/raster/documentSize";
import type { DocumentDialogKind } from "@/components/editor/DocumentDialog";
import { ActiveSelection, type Canvas as FabricCanvas, type FabricObject } from "fabric";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crop,
  Download,
  Eraser,
  FilePlus2,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  ImageIcon,
  ImagePlus,
  ChartArea,
  Keyboard,
  Lock,
  Maximize,
  MousePointer2,
  MousePointerSquareDashed,
  Blend,
  CircleDashed,
  Combine,
  Lasso,
  Pentagon,
  WandSparkles,
  Contrast,
  Grid2x2,
  Highlighter,
  Layers2,
  Merge,
  PaintBucket,
  Paintbrush,
  SquarePlus,
  Pipette,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scaling,
  Proportions,
  FileDown,
  History,
  Spline,
  Move3d,
  RotateCwSquare,
  Expand,
  Shrink,
  Maximize2,
  Scissors,
  CircleDot,
  Sparkle,
  Search,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  SquareDashed,
  Stamp,
  Bandage,
  Syringe,
  Lollipop,
  Hand,
  Droplets,
  Droplet,
  Triangle,
  Pointer,
  Trash2,
  Type,
  Undo2,
  XCircle,
  ZoomIn,
  ZoomOut,
  FolderPlus,
  Group,
  Ungroup,
  CornerDownRight,
} from "lucide-react";
import {
  addGroup,
  canUngroup,
  clippingAction,
  deleteGroup,
  duplicateGroup,
  groupSelected,
  hasClippedSelection,
  selectedGroup,
  setClipping,
  ungroupSelected,
} from "@/layers/layerGroups";
import { toast } from "sonner";
import { KEYMAP } from "@/commands/keymap";
import { formatShortcut } from "@/commands/shortcuts";
import type { Command, CommandMap } from "@/commands/types";
import {
  clearUnlockedLayers,
  deselect,
  selectAllLayers,
  toggleSelectionLock,
  type ArrangeAction,
} from "@/utils/canvasActions";
import {
  findBackgroundImage,
  isEditorChrome,
  isObjectLocked,
  removeSelectedObjects,
} from "@/utils/editorObjects";
import { SHAPE_KINDS, isShapeKind, type ShapeKind } from "@/utils/shapes";
import type { AiActions } from "@/hooks/useAiActions";
import { Mask } from "@/selection/mask";
import { documentGrid, selectionOf, type PixelSelection } from "@/selection/state";
import { copySelectionToLayer } from "@/selection/actions";
import { clearTarget, editPixels, paintTarget } from "@/selection/edits";
import {
  addLayerMask,
  applyLayerMask,
  deleteLayerMask,
  hasLayerMask,
  invertLayerMask,
  maskLayer,
  maskTargetOf,
  setLayerMaskEnabled,
  type MaskContent,
  type MaskedImage,
} from "@/raster/layerMask";
import type { SelectionModification } from "@/components/editor/SelectionModifyDialog";
import { hasEffects, type LayerStyle } from "@/raster/layerStyleData";
import { PixelPreview, adjustTarget } from "@/raster/pixelPreview";
import { invertLut, uniformLuts } from "@/raster/adjustments";
import type { PixelJob } from "@/raster/pixelJobs";
import type { AdjustmentKind } from "@/components/editor/adjustments/AdjustmentDialog";
import type { PanelTab, Tool, ViewOptions } from "@/types/editor";
import {
  isBrushTool,
  isHealingTool,
  isToningTool,
  usesPaintBrush,
  type HealingTool,
  type ToningTool,
  isFillTool,
  isMarqueeTool,
  isSelectionTool,
  type BrushTool,
  type FillTool,
  type LassoTool,
  type MarqueeTool,
} from "@/components/editor/toolGroups";
import {
  addEmptyLayer,
  planFlatten,
  planMergeGroup,
  planMergeDown,
  planMergeVisible,
  planRasterize,
  runMerge,
  type MergePlan,
  type Refusal,
} from "@/raster/layerOps";

/** Commands whose change is a History step named after them. */
const NAMED_STEP_PREFIXES = ["edit.", "image.", "layer.", "filter."];
/** …except these, which change nothing themselves or arm a tool that names its own step. */
const UNNAMED_STEPS = new Set([
  "edit.undo",
  "edit.redo",
  "edit.copy",
  "edit.freeTransform",
  "edit.distort",
  "edit.perspective",
]);

export interface EditorCommandContext {
  canvas: FabricCanvas | null;
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  lastShape: ShapeKind;
  lastBrushTool: BrushTool;
  lastFillTool: FillTool;
  lastHealingTool: HealingTool;
  lastToningTool: ToningTool;
  lastMarqueeTool: MarqueeTool;
  lastLassoTool: LassoTool;
  undo: () => void;
  redo: () => void;
  /** Live checks: a shortcut can arrive before React re-renders. */
  hasUndo: () => boolean;
  hasRedo: () => boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fitOnScreen: () => void;
  actualPixels: () => void;
  rotate: (degrees: number) => void;
  flip: (axis: "x" | "y") => void;
  arrange: (action: ArrangeAction) => void;
  duplicate: () => void;
  copy: () => void;
  paste: () => void;
  canPaste: () => boolean;
  requestNew: () => void;
  requestOpenImage: () => void;
  requestOpenProject: () => void;
  placeImage: () => void;
  saveProject: () => void;
  /** File › Save as Photoshop (PSD). */
  savePsd: () => void;
  exportImage: () => void;
  ai: AiActions;
  pickColor: () => void;
  snapping: boolean;
  setSnapping: (enabled: boolean) => void;
  viewOptions: ViewOptions;
  setViewOption: (option: keyof ViewOptions, value: boolean) => void;
  openGuideDialog: (kind: GuideDialogKind) => void;
  panel: PanelTab | null;
  togglePanel: (tab: PanelTab) => void;
  /** View › Histogram, which floats over the canvas. */
  histogram: boolean;
  setHistogram: (open: boolean) => void;
  /** View › History, which floats over the canvas too. */
  historyPanel: boolean;
  setHistoryPanel: (open: boolean) => void;
  openPanel: (tab: PanelTab) => void;
  showShortcuts: () => void;
  /** Opens Select › Modify's dialog. */
  modifySelection: (modification: SelectionModification) => void;
  /** [ ] and Shift+[ ]: brush size and hardness. */
  adjustBrush: (setting: "width" | "hardness", direction: 1 | -1) => void;
  swapColors: () => void;
  /** Foreground and background colours, for Edit › Fill. */
  colors: { foreground: string; background: string };
  /** Edit › Stroke's dialog. */
  strokeSelection: () => void;
  /** Layer › Layer style's dialog, for a layer. */
  openLayerStyle: (layer: FabricObject) => void;
  /** An Image menu dialog that changes the whole document. */
  openDocumentDialog: (kind: DocumentDialogKind) => void;
  /** Edit › Transform › Distort or Perspective on the selected layer. */
  startWarp: (mode: WarpMode) => void;
  /** An Image › Adjustments dialog. */
  openAdjustment: (kind: AdjustmentKind) => void;
  resetColors: () => void;
  openCommandPalette: () => void;
}

/** Whether a document layer (not editor chrome) is selected. */
const hasSelection = (canvas: FabricCanvas | null): boolean => {
  const active = canvas?.getActiveObject();
  return !!active && !isEditorChrome(active);
};

const reportFailure = (error: unknown) => {
  console.error("Layer command failed:", error);
  toast.error(error instanceof Error ? error.message : "That did not work");
};

/** Why each layer command cannot run right now, or what it would merge. */
type LayerPlanner = (canvas: FabricCanvas) => MergePlan | Refusal;

/** Every command the editor offers, keyed by id. */
export function useEditorCommands(context: EditorCommandContext): CommandMap {
  const {
    canvas,
    activeTool,
    onToolChange,
    lastShape,
    lastBrushTool,
    lastFillTool,
    lastHealingTool,
    lastToningTool,
    lastMarqueeTool,
    lastLassoTool,
    undo,
    redo,
    hasUndo,
    hasRedo,
    zoomIn,
    zoomOut,
    fitOnScreen,
    actualPixels,
    rotate,
    flip,
    arrange,
    duplicate,
    copy,
    paste,
    canPaste,
    requestNew,
    requestOpenImage,
    requestOpenProject,
    placeImage,
    saveProject,
    savePsd,
    exportImage,
    ai,
    pickColor,
    snapping,
    setSnapping,
    viewOptions,
    setViewOption,
    openGuideDialog,
    panel,
    togglePanel,
    histogram,
    setHistogram,
    historyPanel,
    setHistoryPanel,
    openPanel,
    showShortcuts,
    modifySelection,
    adjustBrush,
    swapColors,
    colors,
    strokeSelection,
    openLayerStyle,
    openDocumentDialog,
    startWarp,
    openAdjustment,
    resetColors,
    openCommandPalette,
  } = context;
  // The AI actions object is rebuilt on every render; its parts are stable.
  const { isProcessing: aiBusy, removeBackground, extractSubject, selectSubject } = ai;

  return useMemo(() => {
    // A layer on the canvas, or a group picked in the Layers panel.
    const selected = () => hasSelection(canvas) || (!!canvas && !!selectedGroup(canvas));
    const pixelSelection = () => (canvas ? selectionOf(canvas).current() : null);

    /** Delete with a selection: clear its pixels on the layer (or the photo). */
    const clearPixels = (selection: PixelSelection) => {
      if (!canvas) return;
      const target = clearTarget(canvas);
      if (typeof target === "string") {
        toast.error(target);
        return;
      }
      void editPixels(canvas, target, selection, { kind: "clear" }).catch(reportFailure);
    };

    /** Edit › Fill: the selection, or the whole layer, in a colour. */
    const fillPixels = (color: string) => {
      if (!canvas) return;
      const target = paintTarget(canvas);
      if (typeof target === "string") {
        toast.error(target);
        return;
      }
      void editPixels(canvas, target, pixelSelection(), { kind: "fill", color }).catch(reportFailure);
    };

    /** Image › Adjustments act on the selected layer's pixels (or its mask). */
    const canAdjust = () => !!canvas && typeof adjustTarget(canvas) !== "string";
    const adjust = (kind: AdjustmentKind) => {
      if (!canvas) return;
      const target = adjustTarget(canvas);
      if (typeof target === "string") toast.error(target);
      else openAdjustment(kind);
    };
    /** Adjustments with nothing to set (Invert, Desaturate) apply at once. */
    const adjustNow = async (title: string, job: PixelJob) => {
      if (!canvas) return;
      const target = adjustTarget(canvas);
      const preview =
        typeof target === "string" ? target : PixelPreview.open(canvas, target, selectionOf(canvas).current());
      if (typeof preview === "string") {
        toast.error(preview);
        return;
      }
      try {
        preview.present(await preview.compute(job));
        await preview.commit();
      } catch (error) {
        console.error(`${title} failed:`, error);
        toast.error(`${title} could not be applied`);
      }
    };

    /**
     * Edit › Content-Aware Fill: rebuild the selected pixels from the rest of
     * the layer around them, in the worker.
     */
    const contentAwareFill = async () => {
      if (!canvas) return;
      const selection = pixelSelection();
      if (!selection) {
        toast.error("Select what to fill first");
        return;
      }
      const target = adjustTarget(canvas);
      const preview = typeof target === "string" ? target : PixelPreview.open(canvas, target, selection);
      if (typeof preview === "string") {
        toast.error(preview);
        return;
      }
      const { region, weights } = preview;
      const width = region.right - region.left;
      const height = region.bottom - region.top;
      const hole = new Uint8Array(width * height);
      let filling = 0;
      for (let index = 0; index < hole.length; index += 1) {
        if (!weights || weights[index]! > 0) {
          hole[index] = 1;
          filling += 1;
        }
      }
      // The fill copies from around the selection: as far again as its size,
      // within reason for memory.
      let reach = Math.max(48, Math.min(512, Math.max(width, height)));
      while (reach > 48 && (width + reach * 2) * (height + reach * 2) > 8_000_000) reach = Math.floor(reach * 0.8);
      const around = preview.around(reach);
      if (filling === hole.length && around.width === width && around.height === height) {
        preview.cancel();
        toast.error("Leave part of the layer unselected to fill from");
        return;
      }
      const notice = toast.loading("Filling…");
      try {
        preview.present(await preview.compute({ op: "inpaint", hole, reach }));
        await preview.commit();
        toast.dismiss(notice);
      } catch (error) {
        console.error("Content-aware fill failed:", error);
        preview.cancel();
        toast.error("The selection could not be filled", { id: notice });
      }
    };

    /**
     * Edit › Free Transform: the Move tool's handles (and its numbers) on
     * the selected layer.
     */
    const freeTransform = () => {
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active || isEditorChrome(active)) {
        toast.error("Select a layer to transform");
        return;
      }
      if (!(active instanceof ActiveSelection) && isObjectLocked(active)) {
        toast.error("Unlock the layer first");
        return;
      }
      onToolChange("select");
      canvas.setActiveObject(active);
      canvas.requestRenderAll();
    };

    /** Image › Reveal All: grow the document around every layer. */
    const revealEverything = async () => {
      if (!canvas) return;
      try {
        const result = await revealAll(canvas, colors.background);
        if (typeof result === "string") toast.message(result);
        else if (result) fitOnScreen();
      } catch (error) {
        console.error("Reveal all failed:", error);
        toast.error("The canvas could not be grown");
      }
    };

    /** The layer a layer style goes on: the selected one, else the photo. */
    const styleLayer = (): FabricObject | string => {
      if (!canvas) return "Open a photo first";
      const active = canvas.getActiveObject();
      const layer = active && !isEditorChrome(active) ? active : findBackgroundImage(canvas);
      if (!layer) return "Open a photo first";
      if (layer instanceof ActiveSelection) return "Select a single layer first";
      if (isObjectLocked(layer)) return "Unlock the layer first";
      return layer;
    };
    const styled = () => {
      const layer = styleLayer();
      return typeof layer !== "string" && hasEffects((layer as FabricObject & { layerStyle?: LayerStyle }).layerStyle)
        ? layer
        : null;
    };

    /** The layer mask commands' layer, when they can act on it. */
    const maskedLayer = (): MaskedImage | null => {
      if (!canvas) return null;
      const layer = maskLayer(canvas);
      return typeof layer === "string" ? null : layer;
    };
    const withMaskLayer = (run: (canvas: FabricCanvas, layer: MaskedImage) => unknown) => () => {
      if (!canvas) return;
      const layer = maskLayer(canvas);
      if (typeof layer === "string") {
        toast.error(layer);
        return;
      }
      void Promise.resolve()
        .then(() => run(canvas, layer))
        .catch(reportFailure);
    };
    /** Give the layer a mask and paint on it next, as Photoshop does. */
    const createMask = (content: () => MaskContent | null) =>
      withMaskLayer(async (canvas, layer) => {
        const chosen = content();
        if (!chosen) return;
        if (!(await addLayerMask(canvas, layer, chosen))) return;
        // The selection became the mask.
        if (typeof chosen !== "string") selectionOf(canvas).set(null);
        maskTargetOf(canvas).set(layer);
      });
    const canAddMask = () => {
      const layer = maskedLayer();
      return !!layer && !hasLayerMask(layer);
    };
    const withMask = () => {
      const layer = maskedLayer();
      return layer && hasLayerMask(layer) ? layer : null;
    };

    /** New layer via Copy (Ctrl+J) or via Cut (Ctrl+Shift+J) from the selection. */
    const layerViaSelection = (cut: boolean) => {
      const selection = pixelSelection();
      if (!canvas || !selection) return;
      const source = cut ? clearTarget(canvas) : null;
      if (typeof source === "string") {
        toast.error(source);
        return;
      }
      void (async () => {
        const result = await copySelectionToLayer(canvas, selection);
        if (!result) return;
        selectionOf(canvas).set(null);
        if (source) await editPixels(canvas, source, selection, { kind: "clear" }, { select: false });
      })().catch(reportFailure);
    };
    const aiIdle = () => !aiBusy;

    const removeSelection = (): number => {
      if (!canvas) return 0;
      const active = canvas.getActiveObject() as
        | (ReturnType<FabricCanvas["getActiveObject"]> & { __isCropOverlay?: boolean })
        | undefined;
      if (!active) return 0;
      // The crop frame is UI: Delete cancels the crop instead of removing it.
      if (active.__isCropOverlay) {
        onToolChange("select");
        return 0;
      }
      const removed = removeSelectedObjects(canvas);
      if (removed === 0) toast.error("Unlock the layer before deleting it");
      return removed;
    };

    const tool = (
      id: string,
      target: Tool,
      label: string,
      icon: Command["icon"],
      shortcuts: Command["shortcuts"],
      keywords?: string
    ): Command => ({
      id,
      label,
      icon,
      shortcuts,
      keywords,
      run: () => onToolChange(target),
      isChecked: () => activeTool === target,
    });

    // Layer commands are disabled while they cannot run; if the document
    // changes between the check and the run, the refusal is explained.
    const layerOp = (
      id: string,
      label: string,
      icon: Command["icon"],
      planner: LayerPlanner,
      shortcuts: Command["shortcuts"],
      keywords: string
    ): Command => ({
      id,
      label,
      icon,
      shortcuts,
      keywords,
      run: () => {
        if (!canvas) return;
        const plan = planner(canvas);
        if (typeof plan === "string") {
          toast.error(plan);
          return;
        }
        runMerge(canvas, plan)
          .then((result) => {
            if (result?.limited) {
              toast.warning("The result was rendered at a lower resolution to stay within browser limits");
            }
          })
          .catch(reportFailure);
      },
      isEnabled: () => !!canvas && typeof planner(canvas) !== "string",
    });

    const nextShape = (): ShapeKind => {
      const current = isShapeKind(activeTool) ? activeTool : lastShape;
      if (!isShapeKind(activeTool)) return current;
      return SHAPE_KINDS[(SHAPE_KINDS.indexOf(current) + 1) % SHAPE_KINDS.length]!;
    };

    const list: Command[] = [
      // ---------- File ----------
      { id: "file.new", label: "New…", icon: FilePlus2, run: requestNew, keywords: "start over blank" },
      {
        id: "file.openImage",
        label: "Open image…",
        icon: ImageIcon,
        shortcuts: KEYMAP.openImage,
        run: requestOpenImage,
        keywords: "photoshop psd file",
      },
      { id: "file.openProject", label: "Open project file…", icon: FolderOpen, run: requestOpenProject },
      {
        id: "file.placeImage",
        label: "Place image as layer…",
        icon: ImagePlus,
        run: placeImage,
        keywords: "add import overlay",
      },
      {
        id: "file.saveProject",
        label: "Save project",
        icon: Save,
        shortcuts: KEYMAP.saveProject,
        run: saveProject,
      },
      {
        id: "file.savePsd",
        label: "Save as Photoshop (PSD)",
        icon: FileDown,
        run: savePsd,
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "psd photoshop layers download",
      },
      {
        id: "file.export",
        label: "Export…",
        icon: Download,
        shortcuts: KEYMAP.exportImage,
        run: exportImage,
        keywords: "download png jpg webp save as",
      },

      // ---------- Edit ----------
      {
        id: "edit.undo",
        label: "Undo",
        icon: Undo2,
        shortcuts: KEYMAP.undo,
        repeat: true,
        run: undo,
        isEnabled: hasUndo,
      },
      {
        id: "edit.redo",
        label: "Redo",
        icon: Redo2,
        shortcuts: KEYMAP.redo,
        repeat: true,
        run: redo,
        isEnabled: hasRedo,
      },
      {
        id: "edit.cut",
        label: "Cut",
        icon: Scissors,
        shortcuts: KEYMAP.cut,
        run: () => {
          const selection = pixelSelection();
          if (!selection) {
            copy();
            removeSelection();
            return;
          }
          const target = canvas ? clearTarget(canvas) : null;
          if (typeof target === "string") {
            toast.error(target);
            return;
          }
          // The copy reads the pixels before they are cleared.
          copy();
          clearPixels(selection);
        },
        isEnabled: () => selected() || !!pixelSelection(),
      },
      {
        id: "edit.copy",
        label: "Copy",
        icon: Copy,
        shortcuts: KEYMAP.copy,
        run: copy,
        isEnabled: () => selected() || !!pixelSelection(),
      },
      {
        id: "edit.paste",
        label: "Paste",
        icon: ClipboardPaste,
        shortcuts: KEYMAP.paste,
        shortcutsDisplayOnly: true,
        run: paste,
        isEnabled: canPaste,
      },
      {
        id: "edit.delete",
        label: "Delete",
        icon: Trash2,
        shortcuts: KEYMAP.delete,
        run: () => {
          const selection = pixelSelection();
          const group = canvas ? selectedGroup(canvas) : null;
          if (selection) clearPixels(selection);
          else if (canvas && group) {
            const result = deleteGroup(canvas, group);
            if (typeof result === "string") toast.error(result);
          } else removeSelection();
        },
        isEnabled: () => selected() || !!pixelSelection(),
      },
      {
        id: "edit.fillForeground",
        label: "Fill with foreground colour",
        icon: PaintBucket,
        shortcuts: KEYMAP.fillForeground,
        run: () => fillPixels(colors.foreground),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "fill selection color paint",
      },
      {
        id: "edit.fillBackground",
        label: "Fill with background colour",
        shortcuts: KEYMAP.fillBackground,
        run: () => fillPixels(colors.background),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "fill selection color paint",
      },
      {
        id: "edit.contentAwareFill",
        label: "Content-Aware Fill",
        icon: Sparkles,
        shortcuts: KEYMAP.contentAwareFill,
        run: () => void contentAwareFill(),
        isEnabled: () => !!pixelSelection(),
        keywords: "remove object erase heal patch inpaint fill selection",
      },
      {
        id: "edit.freeTransform",
        label: "Free Transform",
        icon: Move3d,
        shortcuts: KEYMAP.freeTransform,
        run: freeTransform,
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "scale rotate skew resize size angle transform",
      },
      {
        id: "edit.distort",
        label: "Distort",
        icon: Spline,
        run: () => startWarp("distort"),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "corner pin warp transform reshape",
      },
      {
        id: "edit.perspective",
        label: "Perspective",
        icon: Spline,
        run: () => startWarp("perspective"),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "keystone tilt warp transform",
      },
      {
        id: "edit.stroke",
        label: "Stroke…",
        run: strokeSelection,
        isEnabled: () => !!pixelSelection(),
        keywords: "outline border selection edge",
      },

      // ---------- Image ----------
      {
        id: "image.rotateCounterClockwise",
        label: "Rotate 90° counter-clockwise",
        icon: RotateCcw,
        run: () => rotate(-90),
        keywords: "turn left",
      },
      {
        id: "image.rotateClockwise",
        label: "Rotate 90° clockwise",
        icon: RotateCw,
        run: () => rotate(90),
        keywords: "turn right",
      },
      {
        id: "image.rotate180",
        label: "Rotate 180°",
        icon: RotateCw,
        run: () => rotate(180),
        keywords: "turn upside down",
      },
      {
        id: "image.rotateArbitrary",
        label: "Rotate Canvas…",
        icon: RotateCwSquare,
        run: () => openDocumentDialog("rotate"),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "turn straighten tilt angle degrees arbitrary",
      },
      {
        id: "image.flipHorizontal",
        label: "Flip horizontal",
        icon: FlipHorizontal2,
        shortcuts: KEYMAP.flipHorizontal,
        run: () => flip("x"),
        keywords: "mirror",
      },
      {
        id: "image.imageSize",
        label: "Image Size…",
        icon: Proportions,
        shortcuts: KEYMAP.imageSize,
        run: () => openDocumentDialog("imageSize"),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "resize resample scale dimensions pixels",
      },
      {
        id: "image.canvasSize",
        label: "Canvas Size…",
        icon: Expand,
        shortcuts: KEYMAP.canvasSize,
        run: () => openDocumentDialog("canvasSize"),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "extend border margin padding enlarge document",
      },
      {
        id: "image.trim",
        label: "Trim…",
        icon: Shrink,
        run: () => openDocumentDialog("trim"),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "remove empty transparent edges autocrop",
      },
      {
        id: "image.revealAll",
        label: "Reveal All",
        icon: Maximize2,
        run: () => void revealEverything(),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "expand canvas show layers outside",
      },
      {
        id: "image.flipVertical",
        label: "Flip vertical",
        icon: FlipVertical2,
        shortcuts: KEYMAP.flipVertical,
        run: () => flip("y"),
        keywords: "mirror upside down",
      },
      ...(
        [
          ["brightnessContrast", "Brightness/Contrast…", undefined, "lighter darker"],
          ["levels", "Levels…", KEYMAP.levels, "black point white point gamma midtones histogram auto"],
          ["curves", "Curves…", KEYMAP.curves, "tone curve contrast negative"],
          ["exposure", "Exposure…", undefined, "stops light gamma offset"],
          ["hueSaturation", "Hue/Saturation…", KEYMAP.hueSaturation, "colour colorize tint lightness"],
          ["colorBalance", "Color Balance…", KEYMAP.colorBalance, "colour cast shadows midtones highlights"],
          ["blackWhite", "Black & White…", KEYMAP.blackWhite, "grayscale greyscale monochrome"],
          ["posterize", "Posterize…", undefined, "levels flat"],
          ["threshold", "Threshold…", undefined, "black white"],
          ["gradientMap", "Gradient Map…", undefined, "duotone tones"],
        ] as const
      ).map(
        ([kind, label, shortcuts, keywords]): Command => ({
          id: `image.adjust.${kind}`,
          label,
          shortcuts,
          run: () => adjust(kind),
          isEnabled: canAdjust,
          keywords,
        })
      ),
      ...(
        [
          ["gaussianBlur", "Gaussian Blur…", "soften smooth"],
          ["motionBlur", "Motion Blur…", "movement speed streak"],
          ["addNoise", "Add Noise…", "grain film"],
          ["mosaic", "Mosaic…", "pixelate blocks censor"],
          ["unsharpMask", "Unsharp Mask…", "sharpen detail crisp"],
          ["emboss", "Emboss…", "relief"],
          ["highPass", "High Pass…", "detail sharpen"],
        ] as const
      ).map(
        ([kind, label, keywords]): Command => ({
          id: `filter.${kind}`,
          label,
          run: () => adjust(kind),
          isEnabled: canAdjust,
          keywords,
        })
      ),
      {
        id: "filter.findEdges",
        label: "Find Edges",
        run: () => void adjustNow("Find Edges", { op: "findEdges" }),
        isEnabled: canAdjust,
        keywords: "outline sketch",
      },
      {
        id: "image.adjust.invert",
        label: "Invert",
        shortcuts: KEYMAP.invert,
        run: () => void adjustNow("Invert", { op: "luts", luts: uniformLuts(invertLut()) }),
        isEnabled: canAdjust,
        keywords: "negative",
      },
      {
        id: "image.adjust.desaturate",
        label: "Desaturate",
        shortcuts: KEYMAP.desaturate,
        run: () => void adjustNow("Desaturate", { op: "desaturate" }),
        isEnabled: canAdjust,
        keywords: "grey gray remove colour",
      },
      {
        id: "ai.removeBackground",
        label: "Remove background",
        icon: Scissors,
        run: () => void removeBackground(),
        isEnabled: aiIdle,
        keywords: "ai cutout transparent",
      },
      {
        id: "ai.extractSubject",
        label: "Extract subject to layer",
        icon: Sparkles,
        run: () => void extractSubject(),
        isEnabled: aiIdle,
        keywords: "ai cutout person object",
      },

      // ---------- Layer ----------
      {
        id: "layer.duplicate",
        label: "Duplicate layer",
        icon: CopyPlus,
        shortcuts: KEYMAP.duplicate,
        // With a pixel selection, Ctrl+J is New layer via copy.
        run: () => {
          const group = canvas ? selectedGroup(canvas) : null;
          if (pixelSelection()) layerViaSelection(false);
          else if (canvas && group) duplicateGroup(canvas, group).catch(reportFailure);
          else duplicate();
        },
        isEnabled: () => selected() || !!pixelSelection(),
        keywords: "copy clone",
      },
      {
        id: "layer.viaCopy",
        label: "New layer via copy",
        icon: CopyPlus,
        shortcuts: KEYMAP.duplicate,
        // Ctrl+J itself runs layer.duplicate, which copies a selection.
        shortcutsDisplayOnly: true,
        run: () => layerViaSelection(false),
        isEnabled: () => !!pixelSelection(),
        keywords: "selection copy pixels",
      },
      {
        id: "layer.mask.add",
        label: "Add layer mask",
        icon: CircleDot,
        // From the selection when there is one, as Photoshop does.
        run: createMask(() => {
          const selection = pixelSelection();
          return selection ? { selection } : "reveal";
        }),
        isEnabled: canAddMask,
        keywords: "mask hide reveal non-destructive",
      },
      {
        id: "layer.mask.revealAll",
        label: "Reveal all",
        run: createMask(() => "reveal"),
        isEnabled: canAddMask,
        keywords: "layer mask white",
      },
      {
        id: "layer.mask.hideAll",
        label: "Hide all",
        run: createMask(() => "hide"),
        isEnabled: canAddMask,
        keywords: "layer mask black",
      },
      {
        id: "layer.mask.revealSelection",
        label: "Reveal selection",
        run: createMask(() => {
          const selection = pixelSelection();
          return selection ? { selection } : null;
        }),
        isEnabled: () => canAddMask() && !!pixelSelection(),
        keywords: "layer mask from selection",
      },
      {
        id: "layer.mask.hideSelection",
        label: "Hide selection",
        run: createMask(() => {
          const selection = pixelSelection();
          return selection ? { selection, hide: true } : null;
        }),
        isEnabled: () => canAddMask() && !!pixelSelection(),
        keywords: "layer mask from selection",
      },
      {
        id: "layer.mask.edit",
        label: "Edit layer mask",
        shortcuts: KEYMAP.editLayerMask,
        toggle: true,
        isChecked: () => !!canvas && maskTargetOf(canvas).isTarget(withMask()),
        run: () => {
          const layer = withMask();
          if (!canvas || !layer) return;
          const target = maskTargetOf(canvas);
          target.set(target.isTarget(layer) ? null : layer);
        },
        isEnabled: () => !!withMask(),
        keywords: "paint on mask target",
      },
      {
        id: "layer.mask.disable",
        label: "Disable layer mask",
        toggle: true,
        isChecked: () => withMask()?.layerMask?.enabled === false,
        run: withMaskLayer((canvas, layer) => {
          if (hasLayerMask(layer)) setLayerMaskEnabled(canvas, layer, !layer.layerMask.enabled);
        }),
        isEnabled: () => !!withMask(),
        keywords: "turn off mask show whole layer",
      },
      {
        id: "layer.mask.invert",
        label: "Invert layer mask",
        run: withMaskLayer((canvas, layer) => invertLayerMask(canvas, layer)),
        isEnabled: () => !!withMask(),
        keywords: "swap shown hidden",
      },
      {
        id: "layer.mask.apply",
        label: "Apply layer mask",
        run: withMaskLayer((canvas, layer) => applyLayerMask(canvas, layer)),
        isEnabled: () => !!withMask(),
        keywords: "bake erase hidden pixels",
      },
      {
        id: "layer.mask.delete",
        label: "Delete layer mask",
        run: withMaskLayer((canvas, layer) => deleteLayerMask(canvas, layer)),
        isEnabled: () => !!withMask(),
        keywords: "remove mask",
      },
      {
        id: "layer.style",
        label: "Layer style…",
        icon: Sparkle,
        run: () => {
          const layer = styleLayer();
          if (typeof layer === "string") toast.error(layer);
          else openLayerStyle(layer);
        },
        isEnabled: () => typeof styleLayer() !== "string",
        keywords: "fx effects drop shadow outer glow stroke outline colour overlay",
      },
      {
        id: "layer.style.clear",
        label: "Clear layer style",
        run: () => {
          const layer = styled();
          if (!canvas || !layer) return;
          (layer as FabricObject & { layerStyle?: LayerStyle }).layerStyle = undefined;
          layer.dirty = true;
          canvas.requestRenderAll();
          canvas.fire("object:modified", { target: layer });
        },
        isEnabled: () => !!styled(),
        keywords: "fx effects remove",
      },
      {
        id: "layer.viaCut",
        label: "New layer via cut",
        icon: Scissors,
        shortcuts: KEYMAP.layerViaCut,
        run: () => layerViaSelection(true),
        isEnabled: () => !!pixelSelection(),
        keywords: "selection cut pixels",
      },
      {
        id: "layer.new",
        label: "New layer",
        icon: SquarePlus,
        shortcuts: KEYMAP.newLayer,
        keywords: "empty transparent pixel blank",
        run: () => {
          if (!canvas) return;
          addEmptyLayer(canvas).catch(reportFailure);
        },
        isEnabled: () => !!canvas,
      },
      {
        id: "layer.newGroup",
        label: "New group",
        icon: FolderPlus,
        run: () => {
          if (canvas) addGroup(canvas);
        },
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "folder layers",
      },
      {
        id: "layer.group",
        label: "Group layers",
        icon: Group,
        shortcuts: KEYMAP.groupLayers,
        run: () => {
          if (!canvas) return;
          const result = groupSelected(canvas);
          if (typeof result === "string") toast(result);
        },
        isEnabled: selected,
        keywords: "folder",
      },
      {
        id: "layer.ungroup",
        label: "Ungroup layers",
        icon: Ungroup,
        shortcuts: KEYMAP.ungroupLayers,
        run: () => {
          if (!canvas) return;
          const result = ungroupSelected(canvas);
          if (typeof result === "string") toast(result);
        },
        isEnabled: () => !!canvas && canUngroup(canvas),
        keywords: "folder",
      },
      {
        id: "layer.createClippingMask",
        label: "Create clipping mask",
        icon: CornerDownRight,
        shortcuts: KEYMAP.clippingMask,
        // Ctrl+Alt+G toggles, as in Photoshop.
        run: () => {
          if (!canvas) return;
          const clip = clippingAction(canvas);
          if (clip === null) toast("Select a layer to clip to the one below");
          else setClipping(canvas, clip);
        },
        isEnabled: () => !!canvas && clippingAction(canvas) !== null,
        keywords: "clip inside below",
      },
      {
        id: "layer.releaseClippingMask",
        label: "Release clipping mask",
        icon: CornerDownRight,
        run: () => {
          if (canvas) setClipping(canvas, false);
        },
        isEnabled: () => !!canvas && hasClippedSelection(canvas),
        keywords: "unclip",
      },
      layerOp("layer.mergeGroup", "Merge group", Merge, planMergeGroup, undefined, "group flatten combine folder"),
      layerOp("layer.rasterize", "Rasterize layer", Grid2x2, planRasterize, undefined, "pixels convert text shape bake"),
      layerOp("layer.mergeDown", "Merge down", Merge, planMergeDown, KEYMAP.mergeDown, "merge layers combine"),
      layerOp("layer.mergeVisible", "Merge visible", Combine, planMergeVisible, KEYMAP.mergeVisible, "merge all combine"),
      layerOp("layer.flatten", "Flatten image", Layers2, planFlatten, undefined, "merge all background"),
      {
        id: "layer.bringToFront",
        label: "Bring to front",
        icon: ArrowUpToLine,
        shortcuts: KEYMAP.bringToFront,
        run: () => arrange("front"),
        isEnabled: selected,
      },
      {
        id: "layer.bringForward",
        label: "Bring forward",
        icon: ChevronUp,
        shortcuts: KEYMAP.bringForward,
        run: () => arrange("forward"),
        isEnabled: selected,
      },
      {
        id: "layer.sendBackward",
        label: "Send backward",
        icon: ChevronDown,
        shortcuts: KEYMAP.sendBackward,
        run: () => arrange("backward"),
        isEnabled: selected,
      },
      {
        id: "layer.sendToBack",
        label: "Send to back",
        icon: ArrowDownToLine,
        shortcuts: KEYMAP.sendToBack,
        run: () => arrange("back"),
        isEnabled: selected,
      },
      {
        id: "layer.toggleLock",
        label: "Lock or unlock layer",
        icon: Lock,
        shortcuts: KEYMAP.lockLayer,
        run: () => {
          if (canvas && toggleSelectionLock(canvas) === null) toast("Select a layer to lock");
        },
        isEnabled: selected,
      },
      {
        id: "layer.clearUnlocked",
        label: "Clear unlocked layers",
        icon: XCircle,
        run: () => {
          if (!canvas) return;
          const removed = clearUnlockedLayers(canvas);
          if (removed === 0) toast("Nothing to clear: only the photo and locked layers remain");
          else
            toast.success(`Cleared ${removed} layer${removed === 1 ? "" : "s"}`, {
              description: `Press ${formatShortcut(KEYMAP.undo[0]!)} to bring them back.`,
            });
        },
        keywords: "remove all reset",
      },

      // ---------- Select ----------
      {
        id: "select.all",
        label: "All",
        icon: SquareDashed,
        shortcuts: KEYMAP.selectAll,
        run: () => {
          const grid = canvas ? documentGrid(canvas) : null;
          if (canvas && grid) selectionOf(canvas).set(Mask.full(grid.width, grid.height), grid);
        },
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "select everything pixels",
      },
      {
        id: "select.deselect",
        label: "Deselect",
        shortcuts: KEYMAP.deselect,
        // The pixel selection first, as in Photoshop; then the layers.
        run: () => {
          if (!canvas) return;
          if (pixelSelection()) selectionOf(canvas).set(null);
          else deselect(canvas);
        },
        isEnabled: () => !!pixelSelection() || selected(),
      },
      {
        id: "select.reselect",
        label: "Reselect",
        shortcuts: KEYMAP.reselect,
        run: () => {
          if (canvas) selectionOf(canvas).reselect();
        },
        isEnabled: () => !!canvas && !pixelSelection() && selectionOf(canvas).canReselect(),
      },
      {
        id: "select.inverse",
        label: "Inverse",
        icon: Contrast,
        shortcuts: KEYMAP.selectInverse,
        run: () => {
          const current = pixelSelection();
          if (canvas && current) selectionOf(canvas).set(current.mask.inverted(), current.grid);
        },
        isEnabled: () => !!pixelSelection(),
        keywords: "invert selection",
      },
      {
        id: "select.subject",
        label: "Subject",
        icon: Sparkles,
        run: () => {
          void selectSubject().then((selected) => {
            // Show the selection's actions.
            if (selected && !isSelectionTool(activeTool)) onToolChange(lastMarqueeTool);
          });
        },
        isEnabled: aiIdle,
        keywords: "ai person object select subject",
      },
      {
        id: "select.allLayers",
        label: "All layers",
        icon: MousePointerSquareDashed,
        shortcuts: KEYMAP.selectAllLayers,
        run: () => {
          if (canvas) selectAllLayers(canvas);
        },
        keywords: "select everything",
      },
      {
        id: "select.feather",
        label: "Feather…",
        shortcuts: KEYMAP.featherSelection,
        run: () => modifySelection("feather"),
        isEnabled: () => !!pixelSelection(),
        keywords: "soften blur edge selection",
      },
      {
        id: "select.expand",
        label: "Expand…",
        run: () => modifySelection("expand"),
        isEnabled: () => !!pixelSelection(),
        keywords: "grow selection",
      },
      {
        id: "select.contract",
        label: "Contract…",
        run: () => modifySelection("contract"),
        isEnabled: () => !!pixelSelection(),
        keywords: "shrink selection",
      },

      // ---------- Filter ----------
      {
        id: "filter.adjustments",
        // The Adjust panel's sliders and looks stay editable, unlike Image › Adjustments.
        label: "Quick adjustments…",
        icon: SlidersHorizontal,
        run: () => openPanel("adjust"),
        keywords: "brightness contrast saturation filters presets",
      },

      // ---------- View ----------
      {
        id: "view.zoomIn",
        label: "Zoom in",
        icon: ZoomIn,
        shortcuts: KEYMAP.zoomIn,
        repeat: true,
        run: zoomIn,
      },
      {
        id: "view.zoomOut",
        label: "Zoom out",
        icon: ZoomOut,
        shortcuts: KEYMAP.zoomOut,
        repeat: true,
        run: zoomOut,
      },
      {
        id: "view.fitOnScreen",
        label: "Fit on screen",
        icon: Maximize,
        shortcuts: KEYMAP.fitOnScreen,
        run: fitOnScreen,
      },
      {
        id: "view.actualPixels",
        label: "100%",
        icon: Scaling,
        shortcuts: KEYMAP.actualPixels,
        run: actualPixels,
        keywords: "actual pixels zoom",
      },
      {
        id: "view.rulers",
        label: "Rulers",
        shortcuts: KEYMAP.rulers,
        run: () => setViewOption("rulers", !viewOptions.rulers),
        isChecked: () => viewOptions.rulers,
        toggle: true,
        keywords: "measure show",
      },
      {
        id: "view.grid",
        label: "Grid",
        shortcuts: KEYMAP.showGrid,
        run: () => setViewOption("grid", !viewOptions.grid),
        isChecked: () => viewOptions.grid,
        toggle: true,
        keywords: "show grid lines",
      },
      {
        id: "view.guides",
        label: "Guides",
        shortcuts: KEYMAP.showGuides,
        run: () => setViewOption("guides", !viewOptions.guides),
        isChecked: () => viewOptions.guides,
        toggle: true,
        keywords: "show guide lines",
      },
      {
        id: "view.snap",
        label: "Snap to guides",
        shortcuts: KEYMAP.toggleSnap,
        run: () => setSnapping(!snapping),
        isChecked: () => snapping,
        toggle: true,
      },
      {
        id: "view.lockGuides",
        label: "Lock guides",
        shortcuts: KEYMAP.lockGuides,
        run: () => setViewOption("lockGuides", !viewOptions.lockGuides),
        isChecked: () => viewOptions.lockGuides,
        toggle: true,
      },
      {
        id: "view.newGuide",
        label: "New guide…",
        run: () => openGuideDialog("newGuide"),
        isEnabled: () => !!canvas && documentGrid(canvas) !== null,
        keywords: "add guide position",
      },
      {
        id: "view.clearGuides",
        label: "Clear guides",
        run: () => {
          if (canvas) setGuides(canvas, []);
        },
        isEnabled: () => !!canvas && guidesOf(canvas).length > 0,
        keywords: "remove delete guides",
      },
      {
        id: "view.gridSettings",
        label: "Grid settings…",
        run: () => openGuideDialog("grid"),
        keywords: "grid spacing subdivisions preferences",
      },
      {
        id: "view.propertiesPanel",
        label: "Properties panel",
        run: () => togglePanel("properties"),
        isChecked: () => panel === "properties",
        toggle: true,
      },
      {
        id: "view.adjustPanel",
        label: "Adjustments panel",
        run: () => togglePanel("adjust"),
        isChecked: () => panel === "adjust",
        toggle: true,
      },
      {
        id: "view.layersPanel",
        label: "Layers panel",
        shortcuts: KEYMAP.layersPanel,
        run: () => togglePanel("layers"),
        isChecked: () => panel === "layers",
        toggle: true,
      },
      {
        id: "view.history",
        label: "History",
        icon: History,
        run: () => setHistoryPanel(!historyPanel),
        isChecked: () => historyPanel,
        toggle: true,
        keywords: "steps undo states",
      },
      {
        id: "view.histogram",
        label: "Histogram",
        icon: ChartArea,
        run: () => setHistogram(!histogram),
        isChecked: () => histogram,
        toggle: true,
      },

      // ---------- Help ----------
      {
        id: "help.commandPalette",
        label: "Search commands…",
        icon: Search,
        shortcuts: KEYMAP.commandPalette,
        run: openCommandPalette,
        keywords: "find palette run",
      },
      {
        id: "help.shortcuts",
        label: "Keyboard shortcuts",
        icon: Keyboard,
        shortcuts: KEYMAP.shortcuts,
        run: showShortcuts,
      },

      // ---------- Tools ----------
      tool("tool.select", "select", "Select and move", MousePointer2, KEYMAP.selectTool, "move"),
      {
        id: "tool.brush",
        label: "Brush",
        icon: Paintbrush,
        shortcuts: KEYMAP.brushTool,
        keywords: "paint pixels",
        run: () => onToolChange(lastBrushTool),
        isChecked: () => isBrushTool(activeTool),
      },
      {
        id: "tool.nextBrush",
        label: "Switch between Brush and Marker",
        icon: Paintbrush,
        shortcuts: KEYMAP.nextBrushTool,
        run: () => onToolChange(activeTool === "brush" ? "draw" : activeTool === "draw" ? "brush" : lastBrushTool),
      },
      tool("tool.draw", "draw", "Marker", Highlighter, undefined, "draw pen highlighter neon dashed strokes"),
      tool("tool.eraser", "eraser", "Eraser", Eraser, KEYMAP.eraserTool),
      tool("tool.cloneStamp", "cloneStamp", "Clone stamp", Stamp, KEYMAP.cloneStampTool, "clone copy retouch duplicate"),
      {
        id: "tool.healing",
        label: "Healing brushes",
        icon: Bandage,
        shortcuts: KEYMAP.healingTool,
        keywords: "heal retouch blemish spot repair",
        run: () => onToolChange(lastHealingTool),
        isChecked: () => isHealingTool(activeTool),
      },
      {
        id: "tool.nextHealing",
        label: "Switch between Spot healing and Healing brush",
        icon: Bandage,
        shortcuts: KEYMAP.nextHealingTool,
        run: () =>
          onToolChange(
            activeTool === "spotHealing" ? "healingBrush" : activeTool === "healingBrush" ? "spotHealing" : lastHealingTool
          ),
      },
      tool("tool.spotHealing", "spotHealing", "Spot healing brush", Bandage, undefined, "heal blemish remove spot content aware"),
      {
        id: "tool.toning",
        label: "Dodge, burn or sponge",
        icon: Lollipop,
        shortcuts: KEYMAP.toningTool,
        keywords: "lighten darken saturate desaturate toning",
        run: () => onToolChange(lastToningTool),
        isChecked: () => isToningTool(activeTool),
      },
      {
        id: "tool.nextToning",
        label: "Next of Dodge, Burn and Sponge",
        icon: Lollipop,
        shortcuts: KEYMAP.nextToningTool,
        run: () =>
          onToolChange(
            activeTool === "dodge" ? "burn" : activeTool === "burn" ? "sponge" : activeTool === "sponge" ? "dodge" : lastToningTool
          ),
      },
      tool("tool.dodge", "dodge", "Dodge", Lollipop, undefined, "lighten brighten"),
      tool("tool.burn", "burn", "Burn", Hand, undefined, "darken"),
      tool("tool.sponge", "sponge", "Sponge", Droplets, undefined, "saturate desaturate colour color"),
      tool("tool.blur", "blur", "Blur tool", Droplet, undefined, "soften focus"),
      tool("tool.sharpen", "sharpen", "Sharpen tool", Triangle, undefined, "crisp focus detail"),
      tool("tool.smudge", "smudge", "Smudge", Pointer, undefined, "smear finger drag blend"),
      tool("tool.healingBrush", "healingBrush", "Healing brush", Syringe, undefined, "heal repair retouch source"),
      {
        id: "tool.fill",
        label: "Paint bucket or gradient",
        icon: PaintBucket,
        shortcuts: KEYMAP.fillTool,
        keywords: "fill",
        run: () => onToolChange(lastFillTool),
        isChecked: () => isFillTool(activeTool),
      },
      {
        id: "tool.nextFill",
        label: "Switch between Paint bucket and Gradient",
        icon: PaintBucket,
        shortcuts: KEYMAP.nextFillTool,
        run: () =>
          onToolChange(
            activeTool === "bucket" ? "gradient" : activeTool === "gradient" ? "bucket" : lastFillTool
          ),
      },
      tool("tool.bucket", "bucket", "Paint bucket", PaintBucket, undefined, "fill flood colour color"),
      tool("tool.gradient", "gradient", "Gradient", Blend, undefined, "fill blend fade linear radial"),
      {
        id: "tool.shape",
        label: "Shape",
        icon: Shapes,
        shortcuts: KEYMAP.shapeTool,
        keywords: "rectangle ellipse circle triangle star line arrow",
        run: () => onToolChange(lastShape),
        isChecked: () => isShapeKind(activeTool),
      },
      {
        id: "tool.nextShape",
        label: "Next shape",
        icon: Shapes,
        shortcuts: KEYMAP.nextShape,
        run: () => onToolChange(nextShape()),
      },
      tool("tool.text", "text", "Text", Type, KEYMAP.textTool, "type font"),
      {
        id: "tool.marquee",
        label: "Rectangle or ellipse select",
        icon: SquareDashed,
        shortcuts: KEYMAP.marqueeTool,
        keywords: "marquee region selection",
        run: () => onToolChange(lastMarqueeTool),
        isChecked: () => isMarqueeTool(activeTool),
      },
      {
        id: "tool.nextMarquee",
        label: "Switch between Rectangle and Ellipse select",
        icon: SquareDashed,
        shortcuts: KEYMAP.nextMarqueeTool,
        run: () =>
          onToolChange(
            activeTool === "marquee"
              ? "ellipseMarquee"
              : activeTool === "ellipseMarquee"
                ? "marquee"
                : lastMarqueeTool
          ),
      },
      tool("tool.rectSelect", "marquee", "Rectangle select", SquareDashed, undefined, "marquee rectangular"),
      tool("tool.ellipseSelect", "ellipseMarquee", "Ellipse select", CircleDashed, undefined, "marquee elliptical oval circle"),
      {
        id: "tool.lasso",
        label: "Lasso",
        icon: Lasso,
        shortcuts: KEYMAP.lassoTool,
        keywords: "freehand selection",
        run: () => onToolChange(lastLassoTool === "magicWand" ? "lasso" : lastLassoTool),
        isChecked: () => activeTool === "lasso" || activeTool === "polygonLasso",
      },
      {
        id: "tool.nextLasso",
        label: "Switch between Lasso and Polygonal lasso",
        icon: Lasso,
        shortcuts: KEYMAP.nextLassoTool,
        run: () => onToolChange(activeTool === "lasso" ? "polygonLasso" : "lasso"),
      },
      tool("tool.polygonLasso", "polygonLasso", "Polygonal lasso", Pentagon, undefined, "polygon selection corners"),
      tool("tool.magicWand", "magicWand", "Magic wand", WandSparkles, KEYMAP.magicWandTool, "colour color similar selection"),
      tool("tool.crop", "crop", "Crop", Crop, KEYMAP.cropTool, "trim aspect ratio"),
      {
        id: "tool.eyedropper",
        label: "Pick a colour",
        icon: Pipette,
        shortcuts: KEYMAP.eyedropper,
        run: pickColor,
        keywords: "eyedropper color sample",
      },
    ];

    const painting = () => activeTool === "draw" || usesPaintBrush(activeTool);
    const brushKey = (
      id: string,
      label: string,
      shortcuts: Command["shortcuts"],
      setting: "width" | "hardness",
      direction: 1 | -1
    ): Command => ({
      id,
      label,
      shortcuts,
      repeat: true,
      run: () => adjustBrush(setting, direction),
      isEnabled: painting,
    });
    list.push(
      {
        id: "color.swap",
        label: "Swap foreground and background colors",
        shortcuts: KEYMAP.swapColors,
        run: swapColors,
        keywords: "colour exchange",
      },
      {
        id: "color.reset",
        label: "Default colors (black and white)",
        shortcuts: KEYMAP.defaultColors,
        run: resetColors,
        keywords: "colour reset",
      },
      brushKey("brush.smaller", "Smaller brush", KEYMAP.brushSmaller, "width", -1),
      brushKey("brush.larger", "Larger brush", KEYMAP.brushLarger, "width", 1),
      brushKey("brush.softer", "Softer brush", KEYMAP.brushSofter, "hardness", -1),
      brushKey("brush.harder", "Harder brush", KEYMAP.brushHarder, "hardness", 1)
    );

    // What a command changes is a History step named after it.
    const named = list.map((command) =>
      canvas && NAMED_STEP_PREFIXES.some((prefix) => command.id.startsWith(prefix)) && !command.toggle && !UNNAMED_STEPS.has(command.id)
        ? {
            ...command,
            run: () => {
              nameNextStep(canvas, command.label);
              command.run();
            },
          }
        : command
    );
    return Object.fromEntries(named.map((command) => [command.id, command]));
  }, [
    activeTool,
    aiBusy,
    arrange,
    actualPixels,
    adjustBrush,
    canPaste,
    canvas,
    copy,
    duplicate,
    exportImage,
    extractSubject,
    selectSubject,
    fitOnScreen,
    flip,
    hasRedo,
    hasUndo,
    lastBrushTool,
    lastFillTool,
    lastHealingTool,
    lastToningTool,
    lastMarqueeTool,
    lastLassoTool,
    lastShape,
    onToolChange,
    openCommandPalette,
    openPanel,
    panel,
    histogram,
    setHistogram,
    historyPanel,
    setHistoryPanel,
    paste,
    pickColor,
    placeImage,
    redo,
    removeBackground,
    requestNew,
    resetColors,
    requestOpenImage,
    requestOpenProject,
    rotate,
    saveProject,
    savePsd,
    setSnapping,
    showShortcuts,
    modifySelection,
    snapping,
    swapColors,
    colors,
    strokeSelection,
    openLayerStyle,
    openDocumentDialog,
    startWarp,
    viewOptions,
    setViewOption,
    openGuideDialog,
    openAdjustment,
    togglePanel,
    undo,
    zoomIn,
    zoomOut,
  ]);
}
