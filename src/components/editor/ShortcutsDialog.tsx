import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EDITOR_MENUS } from "@/commands/menus";
import { formatShortcut, isApplePlatform } from "@/commands/shortcuts";
import type { CommandMap, MenuEntry } from "@/commands/types";

const MOD = isApplePlatform() ? "⌘" : "Ctrl";

/** Gestures with no command behind them. */
const CANVAS_GESTURES: [string, string][] = [
  ["Arrows", "Nudge the selection (Shift for 10 px)"],
  ["Esc", "Deselect"],
  ["Space drag", "Pan"],
  [`${MOD} scroll`, "Zoom at the pointer"],
  ["Alt drag", "Move without snapping to guides"],
];

const TOOL_IDS = [
  "tool.select",
  "tool.marquee",
  "tool.crop",
  "tool.draw",
  "tool.eraser",
  "tool.shape",
  "tool.nextShape",
  "tool.text",
  "tool.eyedropper",
];

function commandIds(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry === "-" || entry === "theme") return [];
    if (typeof entry === "string") return [entry];
    return commandIds(entry.items);
  });
}

export function ShortcutsDialog({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: CommandMap;
}) {
  const row = (id: string): [string, string] | null => {
    const command = commands[id];
    const shortcut = command?.shortcuts?.[0];
    return command && shortcut ? [formatShortcut(shortcut), command.label.replace(/…$/, "")] : null;
  };
  const groups: { title: string; items: [string, string][] }[] = [
    { title: "Tools", items: TOOL_IDS.map(row).filter((item) => item !== null) },
    ...EDITOR_MENUS.map((menu) => ({
      title: menu.label,
      items: [...new Set(commandIds(menu.items))].map(row).filter((item) => item !== null),
    })),
    { title: "Canvas", items: CANVAS_GESTURES },
  ].filter((group) => group.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Photoshop’s keys, where the browser allows them.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70dvh] pr-3">
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <section key={group.title}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h3>
                <dl className="space-y-1.5">
                  {group.items.map(([keys, action]) => (
                    <div key={action} className="flex items-start justify-between gap-3 text-sm">
                      <dt className="text-foreground/90">{action}</dt>
                      <dd className="shrink-0">
                        <kbd className="whitespace-nowrap rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
                          {keys}
                        </kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
