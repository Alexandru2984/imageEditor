import type { ComponentType, ReactNode } from "react";
import { Menu, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { EDITOR_MENUS } from "@/commands/menus";
import { formatShortcut } from "@/commands/shortcuts";
import type { CommandMap, MenuEntry } from "@/commands/types";
import { useTheme, type ThemePreference } from "@/theme/theme";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/* The menu bar and the phone's dropdown share one renderer; only the Radix
 * parts differ. */
interface ItemProps {
  children?: ReactNode;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
}
interface MenuKit {
  Item: ComponentType<ItemProps>;
  CheckboxItem: ComponentType<
    ItemProps & { checked?: boolean | "indeterminate"; onCheckedChange?: (checked: boolean) => void }
  >;
  Separator: ComponentType;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ children?: ReactNode }>;
  SubContent: ComponentType<{ children?: ReactNode }>;
  RadioGroup: ComponentType<{
    children?: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }>;
  RadioItem: ComponentType<{ children?: ReactNode; value: string }>;
}

const MENUBAR_KIT: MenuKit = {
  Item: MenubarItem,
  CheckboxItem: MenubarCheckboxItem,
  Separator: MenubarSeparator,
  Sub: MenubarSub,
  SubTrigger: MenubarSubTrigger,
  SubContent: MenubarSubContent,
  RadioGroup: MenubarRadioGroup,
  RadioItem: MenubarRadioItem,
};

const DROPDOWN_KIT: MenuKit = {
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
};

const ShortcutHint = ({ children }: { children: ReactNode }) => (
  <span className="ml-auto pl-6 text-xs tracking-wide text-muted-foreground">{children}</span>
);

function ThemeEntry({ kit }: { kit: MenuKit }) {
  const { preference, setPreference, resolved } = useTheme();
  const Icon = resolved === "dark" ? Moon : preference === "system" ? Monitor : Sun;
  return (
    <kit.Sub>
      <kit.SubTrigger>
        <Icon />
        Theme
      </kit.SubTrigger>
      <kit.SubContent>
        <kit.RadioGroup
          value={preference}
          onValueChange={(value) => setPreference(value as ThemePreference)}
        >
          {THEME_OPTIONS.map(({ value, label }) => (
            <kit.RadioItem key={value} value={value}>
              {label}
            </kit.RadioItem>
          ))}
        </kit.RadioGroup>
      </kit.SubContent>
    </kit.Sub>
  );
}

function MenuEntries({
  entries,
  commands,
  kit,
  showShortcuts,
}: {
  entries: readonly MenuEntry[];
  commands: CommandMap;
  kit: MenuKit;
  showShortcuts: boolean;
}) {
  return (
    <>
      {entries.map((entry, index) => {
        if (entry === "-") return <kit.Separator key={`separator-${index}`} />;
        if (entry === "theme") return <ThemeEntry key="theme" kit={kit} />;
        if (typeof entry !== "string") {
          return (
            <kit.Sub key={entry.label}>
              <kit.SubTrigger>{entry.label}</kit.SubTrigger>
              <kit.SubContent>
                <MenuEntries
                  entries={entry.items}
                  commands={commands}
                  kit={kit}
                  showShortcuts={showShortcuts}
                />
              </kit.SubContent>
            </kit.Sub>
          );
        }
        const command = commands[entry];
        if (!command) return null;
        // Evaluated when the menu opens, so it reflects the current selection.
        const disabled = command.isEnabled ? !command.isEnabled() : false;
        const shortcut = showShortcuts && command.shortcuts?.[0];
        const Icon = command.icon;
        if (command.toggle) {
          return (
            <kit.CheckboxItem
              key={command.id}
              checked={command.isChecked?.() ?? false}
              disabled={disabled}
              onCheckedChange={() => command.run()}
              // Stay open, so the new state is visible.
              onSelect={(event) => event.preventDefault()}
            >
              {command.label}
              {shortcut && <ShortcutHint>{formatShortcut(shortcut)}</ShortcutHint>}
            </kit.CheckboxItem>
          );
        }
        return (
          <kit.Item key={command.id} disabled={disabled} onSelect={() => command.run()}>
            {Icon ? <Icon /> : <span className="w-4" aria-hidden="true" />}
            {command.label}
            {shortcut && <ShortcutHint>{formatShortcut(shortcut)}</ShortcutHint>}
          </kit.Item>
        );
      })}
    </>
  );
}

/** File, Edit, Image, … across the top of the editor on wide screens. */
export function EditorMenuBar({ commands }: { commands: CommandMap }) {
  return (
    <Menubar aria-label="Menu bar">
      {EDITOR_MENUS.map((menu) => (
        <MenubarMenu key={menu.label}>
          <MenubarTrigger>{menu.label}</MenubarTrigger>
          <MenubarContent>
            <MenuEntries entries={menu.items} commands={commands} kit={MENUBAR_KIT} showShortcuts />
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  );
}

/** The same menus on a phone, as submenus of a single button. */
export function EditorMobileMenu({ commands }: { commands: CommandMap }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Menu">
          <Menu className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {EDITOR_MENUS.map((menu) => (
          <DropdownMenuSub key={menu.label}>
            <DropdownMenuSubTrigger>{menu.label}</DropdownMenuSubTrigger>
            {/* Beside the main menu, a submenu may only be as wide as the room left on the phone. */}
            <DropdownMenuSubContent
              collisionPadding={8}
              className="max-h-[70dvh] max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-y-auto"
            >
              <MenuEntries
                entries={menu.items}
                commands={commands}
                kit={DROPDOWN_KIT}
                showShortcuts={false}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
