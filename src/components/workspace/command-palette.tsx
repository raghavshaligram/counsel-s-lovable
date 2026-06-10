import { useEffect, useState } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useNavigate } from "@tanstack/react-router";

/**
 * Global ⌘K palette. A7.1 registered commands:
 *  Redact PII · Lock Vault · Clear Cache · Switch Model
 *  Open Recent · Export & Sign · Toggle Verifiable Mode
 */

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  run: (ctx: { navigate: ReturnType<typeof useNavigate> }) => void;
};

const COMMANDS: Cmd[] = [
  { id: "open-workspace", label: "Open Workspace", run: ({ navigate }) => navigate({ to: "/workspace" }) },
  { id: "open-vault", label: "Open Vault Settings", run: ({ navigate }) => navigate({ to: "/vault" }) },
  { id: "redact-pii", label: "Redact PII", hint: "in current document", run: ({ navigate }) => navigate({ to: "/workspace", search: { tool: "redact" } as any }) },
  { id: "lock-vault", label: "Lock Vault", run: () => window.dispatchEvent(new CustomEvent("vault:lock")) },
  { id: "clear-cache", label: "Clear Document Cache", run: () => window.dispatchEvent(new CustomEvent("vault:clear-cache")) },
  { id: "switch-model", label: "Switch Model", run: ({ navigate }) => navigate({ to: "/vault" }) },
  { id: "export-sign", label: "Export & Sign", run: () => window.dispatchEvent(new CustomEvent("workspace:export")) },
  { id: "toggle-verifiable", label: "Toggle Verifiable Mode", run: () => window.dispatchEvent(new CustomEvent("workspace:toggle-verifiable")) },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No matching commands.</CommandEmpty>
          <CommandGroup heading="Commands">
            {COMMANDS.map((c) => (
              <CommandItem
                key={c.id}
                value={c.label}
                onSelect={() => {
                  setOpen(false);
                  c.run({ navigate });
                }}
              >
                <span>{c.label}</span>
                {c.hint && <span className="ml-2 text-xs text-ink/40">{c.hint}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
