/**
 * Redaction Audit Ledger — view + CSV export.
 *
 * Lists every redaction on the current document by PAGE, REGION, and
 * CATEGORY. The actual redacted value is NEVER shown here and NEVER
 * written to the CSV — reproducing it would recreate the leak the
 * redaction was supposed to fix.
 *
 * Viewing is free. Exporting the CSV is gated behind a free signup
 * (no document data is uploaded — only authentication is required).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Download, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLoginModal } from "@/components/login-modal";
import { cn } from "@/lib/utils";

interface RedactBox {
  page: number; // zero-based
  x: number;
  y: number;
  w: number;
  h: number;
  category?: string;
}

interface Props {
  sourceName: string;
  redactions: RedactBox[];
}

const CATEGORY_LABEL: Record<string, string> = {
  name: "Person name",
  ssn: "Social Security number",
  email: "Email address",
  creditCard: "Credit card number",
  phone: "Phone number",
  date: "Date",
  ipAddress: "IP address",
  iban: "IBAN",
  pattern: "Pattern match",
  manual: "Manual selection",
};

function labelFor(category?: string): string {
  if (!category) return "Manual selection";
  return CATEGORY_LABEL[category] ?? category;
}

export function RedactionAuditLedger({ sourceName, redactions }: Props) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const openLogin = useLoginModal((s) => s.openLogin);
  // Re-trigger the export once a signed-out user signs in mid-flow.
  const [pendingExport, setPendingExport] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setAuthed(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") setAuthed(!!session);
      if (event === "SIGNED_OUT") setAuthed(false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const rows = useMemo(() => {
    return redactions
      .slice()
      .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
      .map((r, i) => ({
        idx: i + 1,
        page: r.page + 1,
        category: labelFor(r.category),
        region: `x=${r.x.toFixed(1)}, y=${r.y.toFixed(1)}, w=${r.w.toFixed(1)}, h=${r.h.toFixed(1)}`,
      }));
  }, [redactions]);

  // Group rows by category label for a scannable summary; each group can be
  // expanded to a sampled list. Sorted by count (largest first) so the
  // biggest sources are at the top.
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = m.get(r.category) ?? [];
      arr.push(r);
      m.set(r.category, arr);
    }
    return Array.from(m.entries())
      .map(([label, items]) => ({ label, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [rows]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const SAMPLE = 10;

  const buildCsv = useCallback(() => {
    const header = ["#", "Page", "Type", "Region (PDF pts)"];
    const lines = [header.map(csvEscape).join(",")];
    for (const r of rows) {
      lines.push([String(r.idx), String(r.page), r.category, r.region].map(csvEscape).join(","));
    }
    return lines.join("\r\n") + "\r\n";
  }, [rows]);

  const downloadCsv = useCallback(async () => {
    setBusy(true);
    try {
      // Defense in depth: confirm a live session before writing.
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        toast.error("Sign in required", {
          description: "Create a free account to export the audit trail.",
        });
        setPendingExport(true);
        openLogin();
        return;
      }
      const csv = buildCsv();
      const base = sourceName.replace(/\.pdf$/i, "");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}-redaction-audit.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Audit trail exported");
      setPendingExport(false);
    } catch (err) {
      console.error("[audit-ledger] export failed", err);
      toast.error("Couldn't export audit trail", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [buildCsv, openLogin, sourceName]);

  // Auto-finish the export once the user signs in.
  useEffect(() => {
    if (pendingExport && authed && !busy) void downloadCsv();
  }, [authed, pendingExport, busy, downloadCsv]);

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface-2/40 px-3 py-2.5 text-[11.5px] text-text-2">
        Mark a redaction to start the audit ledger. Entries appear here by page and region — never the redacted value.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-surface-2/40 text-[11.5px]">
        <div className="border-b border-border/60 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
          {rows.length.toLocaleString()} committed redaction{rows.length === 1 ? "" : "s"} · {groups.length} type{groups.length === 1 ? "" : "s"}
        </div>
        <ul className="max-h-[240px] overflow-y-auto">
          {groups.map((g) => {
            const isOpen = expanded.has(g.label);
            const seeAll = showAll.has(g.label);
            const items = seeAll ? g.items : g.items.slice(0, SAMPLE);
            const hidden = g.items.length - items.length;
            const pages = new Set(g.items.map((r) => r.page));
            return (
              <li key={g.label} className="border-b border-border/40 last:border-b-0">
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.label)) next.delete(g.label);
                      else next.add(g.label);
                      return next;
                    })
                  }
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2"
                >
                  <span className="text-foreground">{g.label}</span>
                  <span className="text-[10.5px] text-text-2">
                    {g.items.length.toLocaleString()} · {pages.size} page{pages.size === 1 ? "" : "s"}
                    <span className="ml-1.5 text-text-muted">{isOpen ? "▾" : "▸"}</span>
                  </span>
                </button>
                {isOpen && (
                  <ul>
                    {items.map((r) => (
                      <li
                        key={r.idx}
                        className="grid grid-cols-[28px_1fr_1.4fr] items-start gap-2 border-t border-border/30 px-2.5 py-1 text-[11px]"
                      >
                        <span className="font-mono tabular-nums text-text-muted">{r.idx}</span>
                        <span className="font-mono text-foreground">p.{r.page}</span>
                        <span className="font-mono text-text-2">{r.region}</span>
                      </li>
                    ))}
                    {hidden > 0 && (
                      <li className="border-t border-border/30 px-2.5 py-1 text-[10.5px] text-text-muted">
                        and {hidden.toLocaleString()} more ·{" "}
                        <button
                          type="button"
                          onClick={() =>
                            setShowAll((prev) => {
                              const next = new Set(prev);
                              next.add(g.label);
                              return next;
                            })
                          }
                          className="rounded px-1 py-0.5 text-text-2 hover:bg-surface-3 hover:text-foreground"
                        >
                          show all
                        </button>
                      </li>
                    )}
                    {seeAll && g.items.length > SAMPLE && (
                      <li className="border-t border-border/30 px-2.5 py-1 text-[10.5px] text-text-muted">
                        <button
                          type="button"
                          onClick={() =>
                            setShowAll((prev) => {
                              const next = new Set(prev);
                              next.delete(g.label);
                              return next;
                            })
                          }
                          className="rounded px-1 py-0.5 hover:bg-surface-3 hover:text-foreground"
                        >
                          show fewer
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-[10.5px] leading-snug text-text-muted">
        <ClipboardList className="mr-1 inline h-3 w-3" />
        Types &amp; locations only — the redacted values themselves never appear
        in the ledger or the exported CSV.
      </p>
      <button
        type="button"
        onClick={downloadCsv}
        disabled={busy}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40",
          busy && "cursor-not-allowed opacity-60",
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" strokeWidth={2} />}
        {busy ? "Working…" : authed ? "Export audit trail (CSV)" : "Export audit trail (CSV) — free account"}
      </button>
    </div>
  );
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
