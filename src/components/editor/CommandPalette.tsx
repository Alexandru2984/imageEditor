import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EDITOR_MENUS } from "@/commands/menus";
import { searchCommands } from "@/commands/search";
import { formatShortcut } from "@/commands/shortcuts";
import type { Command, CommandMap, MenuEntry } from "@/commands/types";
import { cn } from "@/lib/utils";

const PALETTE_COMMAND = "help.commandPalette";

const GROUPS: [prefix: string, place: string][] = [
  ["tool.", "Tool"],
  ["brush.", "Brush"],
  ["color.", "Color"],
];

function menuPlaces(entries: readonly MenuEntry[], place: string, into: Map<string, string>) {
  for (const entry of entries) {
    if (entry === "-" || entry === "theme") continue;
    if (typeof entry === "string") {
      if (!into.has(entry)) into.set(entry, place);
    } else {
      menuPlaces(entry.items, `${place} › ${entry.label}`, into);
    }
  }
}

/** Every command in menu order, then the rest, with where each one lives. */
function catalogue(commands: CommandMap): { command: Command; place: string }[] {
  const places = new Map<string, string>();
  for (const menu of EDITOR_MENUS) menuPlaces(menu.items, menu.label, places);
  const ordered = [
    ...[...places.keys()].map((id) => commands[id]),
    ...Object.values(commands).filter((command) => !places.has(command.id)),
  ].filter((command): command is Command => !!command && command.id !== PALETTE_COMMAND);
  return ordered.map((command) => ({
    command,
    place:
      places.get(command.id) ??
      GROUPS.find(([prefix]) => command.id.startsWith(prefix))?.[1] ??
      "",
  }));
}

function PaletteBody({
  commands,
  onChoose,
}: {
  commands: CommandMap;
  onChoose: (command: Command) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const entries = useMemo(() => catalogue(commands), [commands]);
  const results = useMemo(() => {
    const places = new Map(entries.map((entry) => [entry.command.id, entry.place]));
    return searchCommands(
      entries.map((entry) => entry.command),
      query
    ).map((command) => ({
      command,
      place: places.get(command.id) ?? "",
      // Evaluated as the palette opens and as the query changes.
      disabled: command.isEnabled ? !command.isEnabled() : false,
    }));
  }, [entries, query]);

  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  const choose = (index: number) => {
    const result = results[index];
    if (result && !result.disabled) onChoose(result.command);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    const last = results.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: activeIndex === last ? 0 : activeIndex + 1,
      ArrowUp: activeIndex === 0 ? last : activeIndex - 1,
      PageDown: Math.min(last, activeIndex + 8),
      PageUp: Math.max(0, activeIndex - 8),
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]!);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  const optionId = (index: number) => `${id}-option-${index}`;

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search commands and tools…"
          autoComplete="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ul
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label="Commands"
        className="max-h-[min(24rem,55dvh)] overflow-y-auto overscroll-contain p-1.5"
      >
        {results.map(({ command, place, disabled }, index) => {
          const Icon = command.icon;
          const shortcut = command.shortcuts?.[0];
          return (
            <li
              key={command.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={disabled || undefined}
              data-active={index === activeIndex}
              onMouseMove={() => {
                if (index !== activeIndex) setActive(index);
              }}
              onClick={() => choose(index)}
              className={cn(
                "flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
                index === activeIndex && "bg-accent",
                disabled && "opacity-50"
              )}
            >
              {Icon ? <Icon /> : <span className="w-4" aria-hidden="true" />}
              <span className="truncate">{command.label}</span>
              {command.isChecked?.() && <Check aria-label="On" />}
              <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">{place}</span>
              {shortcut && (
                <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground sm:inline">
                  {formatShortcut(shortcut)}
                </kbd>
              )}
            </li>
          );
        })}
        {results.length === 0 && (
          <li role="presentation" className="px-3 py-8 text-center text-sm text-muted-foreground">
            No commands match “{query.trim()}”
          </li>
        )}
      </ul>
    </>
  );
}

/** Ctrl+K: find and run any command or tool by name. */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: CommandMap;
}) {
  // Runs once the palette has closed, so whatever the command opens (a
  // dialog, a file picker) gets the focus.
  const pendingRef = useRef<Command | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:top-[12%] sm:max-w-xl sm:translate-y-0 sm:p-0 [&>button:last-child]:hidden"
        onCloseAutoFocus={(event) => {
          const command = pendingRef.current;
          pendingRef.current = null;
          if (!command) return;
          event.preventDefault();
          command.run();
        }}
      >
        <DialogTitle className="sr-only">Command search</DialogTitle>
        <DialogDescription className="sr-only">
          Type to find a command, use the arrow keys to pick one and Enter to run it.
        </DialogDescription>
        <PaletteBody
          commands={commands}
          onChoose={(command) => {
            pendingRef.current = command;
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
