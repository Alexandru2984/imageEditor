import { useRef } from "react";
import { FolderOpen, Monitor, Moon, MoreHorizontal, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "./Logo";
import { useTheme, type ThemePreference } from "@/theme/theme";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

interface StartHeaderProps {
  onOpenProject: (file: File) => void;
}

/**
 * The header shown before a document is open. It stays free of the editor
 * (and of Fabric), so the start screen loads without the editing engine.
 */
export const StartHeader = ({ onOpenProject }: StartHeaderProps) => {
  const projectInputRef = useRef<HTMLInputElement>(null);
  const { preference, setPreference, resolved } = useTheme();
  const ThemeIcon = resolved === "dark" ? Moon : Sun;

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-editor-panel/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-editor-panel/80 sm:px-3">
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
      <a
        href="/"
        onClick={(event) => event.preventDefault()}
        className="mr-1 flex shrink-0 items-center gap-2 rounded-md pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Image Editor"
      >
        <Logo className="h-7 w-7" />
        {/* The start screen's hero is its h1. */}
        <span className="hidden whitespace-nowrap text-[15px] font-semibold tracking-tight sm:inline">
          Image Editor
        </span>
      </a>
      <div className="min-w-0 flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="More options">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => projectInputRef.current?.click()}>
            <FolderOpen /> Open project file…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};
