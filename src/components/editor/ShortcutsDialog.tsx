import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Tools",
    items: [
      ["V", "Select"],
      ["B", "Draw"],
      ["E", "Eraser"],
      ["R / C / Y / S", "Rectangle, ellipse, triangle, star"],
      ["L / A", "Line, arrow"],
      ["T", "Text"],
      ["M", "Select region"],
      ["K", "Crop"],
      ["I", "Pick a colour"],
    ],
  },
  {
    title: "Edit",
    items: [
      [`${MOD} Z`, "Undo"],
      [`${MOD} ⇧ Z`, "Redo"],
      [`${MOD} C / ${MOD} V`, "Copy and paste layers or images"],
      [`${MOD} D`, "Duplicate"],
      [`${MOD} A`, "Select all"],
      ["Del", "Delete selection"],
      ["Arrows", "Nudge (Shift for 10 px)"],
      ["Alt drag", "Move without snapping to guides"],
      [`${MOD} ] / ${MOD} [`, "Bring forward, send backward"],
      ["⇧ H / ⇧ V", "Flip horizontal, vertical"],
    ],
  },
  {
    title: "View and file",
    items: [
      ["+ / −", "Zoom in, out"],
      [`${MOD} 0`, "Fit to screen"],
      [`${MOD} scroll`, "Zoom at the pointer"],
      ["Space drag", "Pan"],
      [`${MOD} S`, "Save project file"],
      [`${MOD} E`, "Export image"],
      ["?", "This list"],
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work faster without leaving the canvas.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-3">
          {GROUPS.map((group) => (
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
      </DialogContent>
    </Dialog>
  );
}
