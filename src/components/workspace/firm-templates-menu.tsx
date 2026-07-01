/**
 * Firm Templates menu — reusable "Save as Firm Template" + saved list
 * dropdown for config-heavy tool panels (Bates, header/footer, stamp).
 *
 * Saving is gated behind a free signup. Viewing/applying saved templates
 * requires sign-in too (the configs live in the user's account). Logged-out
 * users see the Save button open a signup CTA; nothing is persisted until
 * an authenticated session is confirmed.
 *
 * Only configuration JSON is stored — never the file the user was editing
 * when they saved the template.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useLoginModal } from "@/components/login-modal";
import {
  deleteFirmTemplate,
  listFirmTemplates,
  saveFirmTemplate,
  type FirmTemplate,
  type FirmTemplateKind,
} from "@/lib/firm-templates.functions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<FirmTemplateKind, string> = {
  bates: "Bates layout",
  "header-footer": "Header / footer",
  stamp: "Stamp preset",
};

function summarizeConfig(config: unknown): Array<[string, string]> {
  if (!config || typeof config !== "object") return [];
  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    entries.push([k, String(v)]);
  }
  return entries.slice(0, 10);
}

type Props<T> = {
  kind: FirmTemplateKind;
  /** Snapshot the current panel config to persist. */
  getConfig: () => T;
  /** Restore a saved template into the active panel state. */
  onApply: (config: T) => void;
  /** Optional name of the active document for record-keeping. */
  sourceName?: string | null;
};

export function FirmTemplatesMenu<T>({ kind, getConfig, onApply, sourceName }: Props<T>) {
  const openLogin = useLoginModal((s) => s.openLogin);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [items, setItems] = useState<FirmTemplate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [pendingConfig, setPendingConfig] = useState<T | null>(null);
  const configSummary = useMemo(
    () => summarizeConfig(pendingConfig),
    [pendingConfig],
  );

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setAuthed(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") setAuthed(!!session);
      if (event === "SIGNED_OUT") {
        setAuthed(false);
        setItems(null);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const rows = await listFirmTemplates({ data: { kind } });
      setItems(rows);
    } catch (err) {
      console.warn("[firm-templates] list failed", err);
    }
  }, [kind]);

  useEffect(() => {
    if (authed && open && !items) void refresh();
  }, [authed, open, items, refresh]);

  const openSaveDialog = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      toast("Save your court styles and case templates across sessions — create a free account.", {
        action: { label: "Sign in", onClick: () => openLogin() },
      });
      openLogin();
      return;
    }
    setPendingConfig(getConfig());
    setName(sourceName ? `${sourceName.replace(/\.pdf$/i, "")} — ${KIND_LABEL[kind]}` : "");
    setSaveOpen(true);
  }, [getConfig, kind, openLogin, sourceName]);

  const confirmSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give this template a name");
      return;
    }
    if (!pendingConfig) return;
    setBusy(true);
    try {
      await saveFirmTemplate({
        data: {
          kind,
          name: trimmed,
          config: pendingConfig as never,
          sourceName: sourceName ?? null,
        },
      });
      toast.success("Template saved");
      setSaveOpen(false);
      setName("");
      setPendingConfig(null);
      setItems(null);
      await refresh();
    } catch (err) {
      console.error("[firm-templates] save failed", err);
      toast.error("Couldn't save template", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [kind, name, pendingConfig, refresh, sourceName]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteFirmTemplate({ data: { id } });
        setItems((prev) => prev?.filter((t) => t.id !== id) ?? null);
      } catch (err) {
        toast.error("Couldn't delete template", { description: (err as Error).message });
      }
    },
    [],
  );

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void openSaveDialog()}
        disabled={busy}
        className={cn(
          "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40",
          busy && "cursor-not-allowed opacity-60",
        )}
        title={authed ? "Save as firm template" : "Save your styles across sessions — free account"}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
        {authed ? "Save as firm template" : "Save as template — free account"}
      </button>
      {authed && (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-text-2 hover:border-vault/40 hover:text-foreground"
              title="Saved templates"
            >
              Saved <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
              Saved templates
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {!items ? (
              <DropdownMenuItem disabled>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </DropdownMenuItem>
            ) : items.length === 0 ? (
              <DropdownMenuItem disabled>No saved templates yet</DropdownMenuItem>
            ) : (
              items.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    onApply(t.config as unknown as T);
                    setOpen(false);
                    toast.success(`Applied: ${t.name}`);
                  }}
                  className="flex items-start gap-2"
                >
                  <Bookmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vault" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-foreground">{t.name}</span>
                    {t.sourceName && (
                      <span className="block truncate text-[10.5px] text-text-muted">
                        from {t.sourceName}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(t.id);
                    }}
                    className="rounded p-0.5 text-text-muted hover:bg-surface-2 hover:text-foreground"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog
        open={saveOpen}
        onOpenChange={(next) => {
          if (busy) return;
          setSaveOpen(next);
          if (!next) {
            setName("");
            setPendingConfig(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save as firm template</DialogTitle>
            <DialogDescription>
              Reuse this {KIND_LABEL[kind].toLowerCase()} across future matters. Only the
              settings below are saved — never the document itself.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="firm-template-name"
                className="mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-text-muted"
              >
                Template name
              </label>
              <input
                id="firm-template-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) {
                    e.preventDefault();
                    void confirmSave();
                  }
                }}
                placeholder="e.g. Smith v. Jones — Bates layout"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:border-vault/60 focus:outline-none focus:ring-2 focus:ring-vault/30"
              />
            </div>

            <div className="rounded-md border border-border bg-surface-1/60 p-3">
              <div className="mb-2 text-[10.5px] uppercase tracking-[0.14em] text-text-muted">
                What will be saved
              </div>
              {configSummary.length === 0 ? (
                <div className="text-[12px] text-text-muted">No configurable values.</div>
              ) : (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                  {configSummary.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="truncate text-text-2">{k}</dt>
                      <dd className="truncate font-mono text-foreground">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {sourceName && (
                <div className="mt-2 truncate text-[11px] text-text-muted">
                  From: {sourceName}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setSaveOpen(false)}
              disabled={busy}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-foreground hover:border-vault/40 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmSave()}
              disabled={busy || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-vault/60 bg-vault/15 px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-vault/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
              Save template
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

