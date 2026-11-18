import {
  Download,
  Layers,
  Loader2,
  Maximize,
  PanelRight,
  Redo2,
  Save,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "./IconButton";
import { Logo } from "./Logo";
import { EditorMenuBar, EditorMobileMenu } from "./EditorMenus";
import { KEYMAP } from "@/commands/keymap";
import { formatShortcut, type Shortcut } from "@/commands/shortcuts";
import type { CommandMap } from "@/commands/types";
import type { AiActions } from "@/hooks/useAiActions";
import type { PanelTab } from "@/types/editor";
import { cn } from "@/lib/utils";

interface TopBarProps {
  isMobile: boolean;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  ai: AiActions;
  onExport: () => void;
  onSaveProject: () => void;
  panel: PanelTab | null;
  onTogglePanel: (tab: PanelTab) => void;
  commands: CommandMap;
}

const hint = (shortcuts: readonly Shortcut[]) => formatShortcut(shortcuts[0]!);

export const TopBar = ({
  isMobile,
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  undo,
  redo,
  canUndo,
  canRedo,
  ai,
  onExport,
  onSaveProject,
  panel,
  onTogglePanel,
  commands,
}: TopBarProps) => {
  const aiBusyIcon = ai.isProcessing ? Loader2 : undefined;

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-editor-panel/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-editor-panel/80 sm:px-3">
      <span className="sr-only" role="status" aria-live="polite">
        {ai.processingMessage ?? ""}
      </span>

      <a
        href="/"
        onClick={(event) => event.preventDefault()}
        className="mr-1 flex shrink-0 items-center gap-2 rounded-md pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Image Editor"
      >
        <Logo className="h-7 w-7" />
        {/* In the editor the brand is the page heading. */}
        <h1 className="sr-only whitespace-nowrap text-[15px] font-semibold tracking-tight 2xl:not-sr-only">
          Image Editor
        </h1>
      </a>

      {!isMobile && <EditorMenuBar commands={commands} />}
      {!isMobile && <Separator orientation="vertical" className="mx-1.5 h-6" />}
      <IconButton
        icon={Undo2}
        label="Undo"
        shortcut={hint(KEYMAP.undo)}
        onClick={undo}
        disabled={!canUndo}
      />
      <IconButton
        icon={Redo2}
        label="Redo"
        shortcut={hint(KEYMAP.redo)}
        onClick={redo}
        disabled={!canRedo}
      />

      {!isMobile && (
        <>
          <Separator
            orientation="vertical"
            className="mx-1.5 hidden h-6 xl:block"
          />
          <div className="hidden items-center xl:flex">
            <IconButton
              icon={ZoomOut}
              label="Zoom out"
              shortcut={hint(KEYMAP.zoomOut)}
              onClick={onZoomOut}
            />
            <button
              type="button"
              onClick={onFit}
              aria-label="Zoom level"
              title="Fit to screen"
              className="h-9 w-14 rounded-md text-center font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {Math.round(zoom * 100)}%
            </button>
            <IconButton
              icon={ZoomIn}
              label="Zoom in"
              shortcut={hint(KEYMAP.zoomIn)}
              onClick={onZoomIn}
            />
            <IconButton
              icon={Maximize}
              label="Fit image to screen"
              shortcut={hint(KEYMAP.fitOnScreen)}
              onClick={onFit}
            />
          </div>
        </>
      )}

      <div className="min-w-0 flex-1" />

      {!isMobile && (
        <>
          {/* Also in the Image menu; below lg the bar has no room for them
              unless they are showing progress. */}
          <div
            className={cn(
              "items-center gap-1",
              ai.isProcessing ? "flex" : "hidden lg:flex",
            )}
          >
            <IconButton
              icon={aiBusyIcon ?? Scissors}
              className={cn(ai.isProcessing && "[&_svg]:animate-spin")}
              label="Remove background"
              text={
                <span className="hidden lg:inline">
                  {ai.isProcessing ? "Working…" : "Remove BG"}
                </span>
              }
              onClick={() => void ai.removeBackground()}
              disabled={ai.isProcessing}
            />
            <IconButton
              icon={Sparkles}
              label="Extract subject to a new layer"
              text={<span className="hidden lg:inline">Extract</span>}
              onClick={() => void ai.extractSubject()}
              disabled={ai.isProcessing}
            />
            <Separator orientation="vertical" className="mx-1.5 h-6" />
          </div>
          <IconButton
            icon={Save}
            label="Save project"
            shortcut={hint(KEYMAP.saveProject)}
            onClick={onSaveProject}
          />
          <Button
            size="sm"
            className="h-9 gap-1.5 px-3.5 shadow-sm"
            onClick={onExport}
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Separator orientation="vertical" className="mx-1.5 h-6" />
          <IconButton
            icon={PanelRight}
            label="Toggle properties"
            active={panel === "properties"}
            aria-pressed={panel === "properties"}
            onClick={() => onTogglePanel("properties")}
          />
          <IconButton
            icon={SlidersHorizontal}
            label="Toggle adjustments"
            active={panel === "adjust"}
            aria-pressed={panel === "adjust"}
            onClick={() => onTogglePanel("adjust")}
          />
          <IconButton
            icon={Layers}
            label="Toggle layers"
            shortcut={hint(KEYMAP.layersPanel)}
            active={panel === "layers"}
            aria-pressed={panel === "layers"}
            onClick={() => onTogglePanel("layers")}
          />
        </>
      )}

      {isMobile && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label="AI tools"
                disabled={ai.isProcessing}
              >
                {ai.isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>On-device AI</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void ai.removeBackground()}>
                <Scissors /> Remove background
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void ai.extractSubject()}>
                <Sparkles /> Extract subject to layer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            icon={SlidersHorizontal}
            label="Toggle properties"
            active={panel !== null}
            aria-pressed={panel !== null}
            onClick={() => onTogglePanel(panel ?? "properties")}
          />
          <Button
            size="icon"
            className="h-9 w-9"
            aria-label="Export"
            onClick={onExport}
          >
            <Download className="h-4 w-4" />
          </Button>
          <EditorMobileMenu commands={commands} />
        </>
      )}
    </header>
  );
};
