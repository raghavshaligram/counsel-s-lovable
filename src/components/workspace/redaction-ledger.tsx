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
        <div className="grid grid-cols-[28px_1fr_1.4fr] gap-2 border-b border-border/60 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
          <span>#</span>
          <span>Page · Type</span>
          <span>Region</span>
        </div>
        <ul className="max-h-[180px] overflow-y-auto">
          {rows.map((r) => (
            <li
              key={r.idx}
              className="grid grid-cols-[28px_1fr_1.4fr] items-start gap-2 border-b border-border/40 px-2.5 py-1.5 last:border-b-0"
            >
              <span className="font-mono tabular-nums text-text-muted">{r.idx}</span>
              <span className="text-foreground">
                <span className="font-mono">p.{r.page}</span>{" "}
                <span className="text-text-2">· {r.category}</span>
              </span>
              <span className="font-mono text-text-2">{r.region}</span>
            </li>
          ))}
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
