import { useEffect, useRef } from "react";
import { History, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * View › History: every step the document went through, oldest first, as
 * in Photoshop. Picking one takes the document back (or forward) to it;
 * the steps after it stay, greyed, until a new change replaces them.
 */
export function HistoryPanel({
  steps,
  current,
  onPick,
  onClose,
}: {
  steps: readonly string[];
  current: number;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the current step in view as steps are added (the list alone scrolls).
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>("[aria-current='step']");
    if (!list || !item) return;
    const top = item.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + item.offsetHeight - list.clientHeight;
  }, [current, steps.length]);

  return (
    <section
      aria-label="History"
      className="absolute left-2 top-2 z-10 flex max-h-[45%] w-40 flex-col rounded-lg border border-border bg-popover/95 p-2 text-popover-foreground shadow-lg backdrop-blur sm:left-auto sm:right-3 sm:top-3 sm:max-h-[60%] sm:w-56 sm:p-2.5"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold">History</h2>
        <button
          type="button"
          aria-label="Close history"
          onClick={onClose}
          className="-m-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {steps.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">Nothing yet</p>
      ) : (
        <ol ref={listRef} className="relative -mx-1 min-h-0 overflow-y-auto">
          {steps.map((step, index) => (
            <li key={index}>
              <button
                type="button"
                aria-current={index === current ? "step" : undefined}
                onClick={() => onPick(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  index === current
                    ? "bg-primary/15 font-medium text-foreground"
                    : index > current
                      ? "text-muted-foreground/60 hover:bg-accent"
                      : "hover:bg-accent"
                )}
              >
                <History className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
                <span className="truncate">{step}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
