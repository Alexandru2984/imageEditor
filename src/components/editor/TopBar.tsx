import { useRef, useState } from "react";
import {
  Download,
  FilePlus2,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Keyboard,
  Layers,
  Magnet,
  Loader2,
  Maximize,
  Monitor,
  Moon,
  MoreHorizontal,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IconButton } from "./IconButton";
import { Logo } from "./Logo";
import { useTheme, type ThemePreference } from "@/theme/theme";
import type { AiActions } from "@/hooks/useAiActions";
import type { PanelTab } from "@/types/editor";
import { cn } from "@/lib/utils";

interface TopBarProps {
  hasDocument: boolean;
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
  onRotate: (degrees: number) => void;
  onFlip: (axis: "x" | "y") => void;
  onExport: () => void;
  onSaveProject: () => void;
  onOpenProject: (file: File) => void;
  onNewProject: () => void;
  onShowShortcuts: () => void;
  snapping: boolean;
  onSnappingChange: (enabled: boolean) => void;
  panel: PanelTab | null;
  onTogglePanel: (tab: PanelTab) => void;
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export const TopBar = ({
  hasDocument,
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
  onRotate,
  onFlip,
  onExport,
  onSaveProject,
  onOpenProject,
  onNewProject,
  onShowShortcuts,
  snapping,
  onSnappingChange,
  panel,
  onTogglePanel,
}: TopBarProps) => {
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const { preference, setPreference, resolved } = useTheme();
  const ThemeIcon = resolved === "dark" ? Moon : Sun;

  const projectInput = (
    <input
      ref={projectInputRef}
      type="file"
      accept=".json,application/json"
      className="hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) onOpenProject(file);
      }}
    />
  );

  const themeSubmenu = (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ThemeIcon className="text-muted-foreground" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => setPreference(value as ThemePreference)}
        >
          {THEME_OPTIONS.map(({ value, label }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  const transformItems = (
    <>
      <DropdownMenuItem onSelect={() => onRotate(-90)}>
        <RotateCcw /> Rotate left
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onRotate(90)}>
        <RotateCw /> Rotate right
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onFlip("x")}>
        <FlipHorizontal2 /> Flip horizontal
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onFlip("y")}>
        <FlipVertical2 /> Flip vertical
      </DropdownMenuItem>
    </>
  );

  const newProjectDialog = (
    <AlertDialog open={confirmNew} onOpenChange={setConfirmNew}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Start a new project?</AlertDialogTitle>
          <AlertDialogDescription>
            The current image and all edits will be discarded. Save a project file first if
            you want to keep editing later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              ai.cancel();
              onNewProject();
            }}
          >
            Start new
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const aiBusyIcon = ai.isProcessing ? Loader2 : undefined;

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-editor-panel/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-editor-panel/80 sm:px-3">
      <span className="sr-only" role="status" aria-live="polite">
        {ai.processingMessage ?? ""}
      </span>
      {projectInput}
      {newProjectDialog}

      <a
        href="/"
        onClick={(event) => event.preventDefault()}
        className="mr-1 flex shrink-0 items-center gap-2 rounded-md pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Image Editor"
      >
        <Logo className="h-7 w-7" />
        {!isMobile && (
          <h1 className="whitespace-nowrap text-[15px] font-semibold tracking-tight">Image Editor</h1>
        )}
      </a>

      {hasDocument && (
        <>
          {!isMobile && <Separator orientation="vertical" className="mx-1.5 h-6" />}
          <IconButton icon={Undo2} label="Undo" shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo} />
          <IconButton icon={Redo2} label="Redo" shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo} />

          {!isMobile && (
            <>
              <Separator orientation="vertical" className="mx-1.5 h-6" />
              <IconButton icon={ZoomOut} label="Zoom out" shortcut="−" onClick={onZoomOut} />
              <button
                type="button"
                onClick={onFit}
                aria-label="Zoom level"
                title="Fit to screen"
                className="h-9 w-14 rounded-md text-center font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {Math.round(zoom * 100)}%
              </button>
              <IconButton icon={ZoomIn} label="Zoom in" shortcut="+" onClick={onZoomIn} />
              <IconButton icon={Maximize} label="Fit image to screen" shortcut="Ctrl+0" onClick={onFit} />
            </>
          )}
        </>
      )}

      <div className="min-w-0 flex-1" />

      {hasDocument && !isMobile && (
        <>
          <IconButton
            icon={aiBusyIcon ?? Scissors}
            className={cn(ai.isProcessing && "[&_svg]:animate-spin")}
            label="Remove background"
            text={<span className="hidden lg:inline">{ai.isProcessing ? "Working…" : "Remove BG"}</span>}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Rotate and flip">
                <RotateCw className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Selection, or whole image</DropdownMenuLabel>
              {transformItems}
            </DropdownMenuContent>
          </DropdownMenu>
          <Separator orientation="vertical" className="mx-1.5 h-6" />
          <IconButton icon={Save} label="Save project" shortcut="Ctrl+S" onClick={onSaveProject} />
          <Button size="sm" className="h-9 gap-1.5 px-3.5 shadow-sm" onClick={onExport}>
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
            active={panel === "layers"}
            aria-pressed={panel === "layers"}
            onClick={() => onTogglePanel("layers")}
          />
          <Separator orientation="vertical" className="mx-1.5 h-6" />
          <Button
            variant="ghost"
            size="sm"
            aria-label="New"
            className="h-9 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={() => setConfirmNew(true)}
          >
            <FilePlus2 className="h-4 w-4" />
            <span className="hidden xl:inline">New</span>
          </Button>
        </>
      )}

      {hasDocument && isMobile && (
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
          <Button size="icon" className="h-9 w-9" aria-label="Export" onClick={onExport}>
            <Download className="h-4 w-4" />
          </Button>
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="More options">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {hasDocument && isMobile && (
            <>
              <DropdownMenuItem onSelect={onZoomIn}>
                <ZoomIn /> Zoom in
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onZoomOut}>
                <ZoomOut /> Zoom out
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onFit}>
                <Maximize /> Fit to screen
                <DropdownMenuShortcut>{Math.round(zoom * 100)}%</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {transformItems}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSaveProject}>
                <Save /> Save project file
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => projectInputRef.current?.click()}>
            <FolderOpen /> Open project file…
          </DropdownMenuItem>
          {hasDocument && isMobile && (
            <DropdownMenuItem onSelect={() => setConfirmNew(true)}>
              <FilePlus2 /> New project
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {hasDocument && (
            <DropdownMenuCheckboxItem
              checked={snapping}
              onCheckedChange={(checked) => onSnappingChange(checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <Magnet /> Snap to guides
            </DropdownMenuCheckboxItem>
          )}
          {themeSubmenu}
          {!isMobile && (
            <DropdownMenuItem onSelect={onShowShortcuts}>
              <Keyboard /> Keyboard shortcuts
              <DropdownMenuShortcut>?</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};
