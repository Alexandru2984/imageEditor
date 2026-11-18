import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Tool } from "@/types/editor";
import { cn } from "@/lib/utils";
import { ACTIVE_TOOL_CLASS, IDLE_TOOL_CLASS } from "./toolStyles";

interface GroupTool {
  id: Tool;
  icon: LucideIcon;
  label: string;
  name: string;
  description: string;
}

interface ToolGroupButtonProps {
  tools: readonly GroupTool[];
  /** The group's tool the button arms (the last one used). */
  current: Tool;
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  className: string;
  side: "right" | "top";
}

/**
 * Photoshop's grouped tool slot: the button arms the group's last tool, and
 * once that is armed, pressing it again shows the other tools of the group.
 */
export function ToolGroupButton({
  tools,
  current,
  activeTool,
  onToolChange,
  className,
  side,
}: ToolGroupButtonProps) {
  const [open, setOpen] = useState(false);
  const shown = tools.find((tool) => tool.id === current) ?? tools[0]!;
  const active = tools.some((tool) => tool.id === activeTool);
  const Icon = shown.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={shown.label}
              aria-pressed={active}
              aria-haspopup="dialog"
              onClick={(event) => {
                if (active) return;
                // Not armed yet: arm it rather than open the list.
                event.preventDefault();
                onToolChange(shown.id);
              }}
              className={cn(className, "relative", active ? ACTIVE_TOOL_CLASS : IDLE_TOOL_CLASS)}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span
                aria-hidden="true"
                className="absolute bottom-1 right-1 h-0 w-0 border-l-[4px] border-t-[4px] border-l-transparent border-t-current opacity-70 [transform:rotate(-90deg)]"
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>
          {shown.label}
          {active ? " · press again for more" : ""}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side={side} align="start" className="w-64 p-1.5">
        <div role="group" aria-label={`${tools[0]!.name} tools`} className="grid gap-0.5">
          {tools.map((tool) => {
            const ToolIcon = tool.icon;
            const selected = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  onToolChange(tool.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-primary/15 text-primary"
                    : "text-foreground hover:bg-accent"
                )}
              >
                <ToolIcon className="h-[18px] w-[18px] shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm">{tool.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{tool.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
