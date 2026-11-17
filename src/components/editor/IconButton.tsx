import { forwardRef, type ComponentType, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  icon: ComponentType<{ className?: string }>;
  /** Accessible name and tooltip text. */
  label: string;
  /** Optional visible text next to the icon. */
  text?: ReactNode;
  shortcut?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  active?: boolean;
}

/** An icon button with an accessible name, a tooltip and an optional label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon: Icon,
      label,
      text,
      shortcut,
      tooltipSide = "bottom",
      active,
      className,
      variant,
      size,
      ...props
    },
    ref
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant={variant ?? (active ? "secondary" : "ghost")}
          size={size ?? (text ? "sm" : "icon")}
          aria-label={label}
          className={cn(
            text ? "h-9 gap-1.5 px-2.5" : "h-9 w-9",
            active && "bg-primary/15 text-primary hover:bg-primary/20",
            className
          )}
          {...props}
        >
          <Icon className="h-4 w-4" />
          {text}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && (
          <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px] text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  )
);
IconButton.displayName = "IconButton";
