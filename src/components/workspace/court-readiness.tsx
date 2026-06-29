/**
 * Pre-flight Court Readiness Scan — runs over an exported PDF.
 *
 * Scan is FREE: shows a per-check readout (size, font embedding, hidden
 * content). "Auto-Fix to Court Standards" is gated behind a free signup
 * and only repairs what the app actually can — currently the hidden /
 * metadata content. File size and font embedding warnings link the user
 * out to Compress / specialist tooling.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Wand2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLoginModal } from "@/components/login-modal";
import { importChunk } from "@/lib/chunk-import";
import { downloadPdf } from "@/lib/pdf/download";
import { scanCourtReadiness, type CourtReadinessReport } from "@/lib/pdf/court-readiness";
import { cn } from "@/lib/utils";

interface Props {
  /** A function that returns the freshest export bytes for the active file. */
  getBytes: () => Promise<Uint8Array>;
  sourceName: string;
}

export function CourtReadinessSection({ getBytes, sourceName }: Props) {
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [report, setReport] = useState<CourtReadinessReport | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pendingFix, setPendingFix] = useState(false);
  const openLogin = useLoginModal((s) => s.openLogin);

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

  const runScan = useCallback(async () => {
    setBusy(true);
    try {
      const bytes = await getBytes();
      const r = await scanCourtReadiness(bytes);
      setReport(r);
    } catch (err) {
      console.error("[court-readiness] scan failed", err);
      toast.error("Couldn't run scan", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [getBytes]);

  const runAutoFix = useCallback(async () => {
    setFixing(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        toast.error("Sign in required", {
          description: "Create a free account to auto-fix and download.",
        });
        setPendingFix(true);
        openLogin();
        return;
      }
      const bytes = await getBytes();
      const { sanitizePdfBytes } = await importChunk(() => import("@/lib/pdf/sanitize"));
      const fixed = await sanitizePdfBytes(bytes);
      const base = sourceName.replace(/\.pdf$/i, "");
      await downloadPdf(fixed, `${base}-court-ready.pdf`);
      // Re-scan the fixed file so the UI immediately reflects ✓.
      const after = await scanCourtReadiness(fixed);
      setReport(after);
      toast.success("Auto-fix complete — downloaded court-ready copy");
      setPendingFix(false);
    } catch (err) {
      console.error("[court-readiness] auto-fix failed", err);
      toast.error("Auto-fix failed", { description: (err as Error).message });
    } finally {
      setFixing(false);
    }
  }, [getBytes, openLogin, sourceName]);

  useEffect(() => {
    if (pendingFix && authed && !fixing) void runAutoFix();
  }, [authed, pendingFix, fixing, runAutoFix]);

  const fixable = report?.anyFixable ?? false;

  const summary = useMemo(() => {
    if (!report) return null;
    const ok = report.checks.filter((c) => c.status === "ok").length;
    const warn = report.checks.filter((c) => c.status === "warn").length;
    return { ok, warn, total: report.checks.length };
  }, [report]);

  return (
    <div className="rounded-md border border-border bg-surface-2/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-vault" />
            Court Readiness Scan
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
            Free pre-flight check for PACER size caps, font embedding, and hidden / metadata content.
          </p>
        </div>
        {!report && (
          <button
            type="button"
            onClick={runScan}
            disabled={busy}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-vault/40 bg-accent-soft px-2.5 py-1.5 text-[12px] font-medium text-vault hover:bg-vault/15",
              busy && "cursor-not-allowed opacity-60",
            )}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {busy ? "Scanning…" : "Run scan"}
          </button>
        )}
      </div>

      {report && (
        <>
          <ul className="mt-3 flex flex-col gap-1.5">
            {report.checks.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-2 rounded-md border border-border/60 bg-surface-1/60 px-2.5 py-2 text-[11.5px]"
              >
                <CheckIcon status={c.status} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{c.label}</div>
                  <div className="text-[11px] leading-snug text-text-2">{c.message}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-text-muted">
              {summary?.ok ?? 0}/{summary?.total ?? 0} passing
              {summary?.warn ? ` · ${summary.warn} to review` : ""}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={runScan}
                disabled={busy || fixing}
                className="rounded-md px-2 py-1 text-[11.5px] text-text-2 transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
              >
                Re-scan
              </button>
              {fixable && (
                <button
                  type="button"
                  onClick={runAutoFix}
                  disabled={fixing}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
                    fixing && "cursor-not-allowed opacity-60",
                  )}
                >
                  {fixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {fixing
                    ? "Fixing…"
                    : authed
                      ? "Auto-Fix to Court Standards"
                      : "Auto-Fix — free account"}
                </button>
              )}
            </div>
          </div>
          {!fixable && report.anyWarn && (
            <p className="mt-2 text-[10.5px] leading-snug text-text-muted">
              Auto-fix only repairs hidden / metadata content. File size and font embedding need the Compress tool or a re-export from source.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CheckIcon({ status }: { status: "ok" | "warn" | "info" }) {
  if (status === "ok") return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vault" />;
  if (status === "warn") return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />;
  return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />;
}
