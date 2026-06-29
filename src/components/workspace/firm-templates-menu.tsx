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
import { useCallback, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";

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

  const save = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      toast("Save your court styles and case templates across sessions — create a free account.", {
        action: { label: "Sign in", onClick: () => openLogin() },
      });
      openLogin();
      return;
    }
    const name = window.prompt("Template name (e.g. 'Smith v. Jones — Bates layout')");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      await saveFirmTemplate({
        data: {
          kind,
          name: name.trim(),
          config: getConfig() as unknown as Parameters<typeof saveFirmTemplate>[0]["data"]["config"],
          sourceName: sourceName ?? null,
        },
      });
      toast.success("Template saved");
      setItems(null);
      await refresh();
    } catch (err) {
      console.error("[firm-templates] save failed", err);
      toast.error("Couldn't save template", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [authed, getConfig, kind, openLogin, refresh, sourceName]);

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
        onClick={save}
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
    </div>
  );
}
