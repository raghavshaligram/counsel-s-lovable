import { useEffect, useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useNavigate } from "@tanstack/react-router";

/**
 * Global ⌘K palette. A7.1 registered commands:
 *  Redact PII · Lock Vault · Clear Cache · Switch Model
 *  Open Recent · Export & Sign · Toggle Verifiable Mode
 *
 * Phase 5: accepts a context-aware `suggestions` group that the workspace
 * derives from the document insights engine, so the palette surfaces what
 * the user most likely wants next, not just a static command list.
 */

export type PaletteSuggestion = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

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

export function CommandPalette({ suggestions = [] }: { suggestions?: PaletteSuggestion[] }) {
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
      <CommandInput placeholder="Search actions — try 'redact', 'ocr', 'export'…" />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        {suggestions.length > 0 && (
          <>
            <CommandGroup heading="Suggested for this document">
              {suggestions.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.label} ${s.hint ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    s.run();
                  }}
                >
                  <span>{s.label}</span>
                  {s.hint && <span className="ml-2 text-xs text-ink/40">{s.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup heading="Commands">
          {COMMANDS.map((c) => (
            <CommandItem
              key={c.id}
              value={`${c.label} ${c.hint ?? ""}`}
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
    </CommandDialog>
  );
}
