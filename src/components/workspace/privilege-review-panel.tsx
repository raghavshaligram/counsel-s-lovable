/**
 * Privilege Review (Pro, Legal rail).
 *
 * Scans the active document for privilege/confidentiality indicators and
 * lets the user triage each one (Privileged / Not / Unreviewed) with an
 * optional note. Exports a privilege LOG (page / type / basis / notes) —
 * deliberately WITHOUT the privileged content itself.
 *
 * This panel surfaces SUGGESTIONS only. It never auto-concludes a finding
 * is privileged — every determination is the attorney's call.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScanSearch,
  Gavel,
  AlertTriangle,
  Download,
  ChevronRight,
  Eraser,
  StickyNote,
  Loader2,
  X,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

import type { ToolPanelCtx } from "./tool-panels";
import type {
  PrivilegeFinding,
  PrivilegeFindingType,
  PrivilegeScanResult,
} from "@/lib/pdf/privilege-scan";
import { importChunk } from "@/lib/chunk-import";
import { useIsPro, useRequirePro } from "@/lib/pro-gate";
import { cn } from "@/lib/utils";

type Status = "unreviewed" | "privileged" | "not-privileged";

interface ReviewState {
  status: Status;
  note: string;
}

const TYPE_COLORS: Record<PrivilegeFindingType, string> = {
  "attorney-client": "text-amber-300 border-amber-400/30 bg-amber-400/10",
  "work-product": "text-amber-300 border-amber-400/30 bg-amber-400/10",
  "confidentiality-legend": "text-rose-300 border-rose-400/30 bg-rose-400/10",
  "litigation-anticipation": "text-amber-300 border-amber-400/30 bg-amber-400/10",
  "legal-advice": "text-amber-300 border-amber-400/30 bg-amber-400/10",
  "counsel-email": "text-sky-300 border-sky-400/30 bg-sky-400/10",
  "common-interest": "text-amber-300 border-amber-400/30 bg-amber-400/10",
  "settlement": "text-rose-300 border-rose-400/30 bg-rose-400/10",
  "other": "text-vault border-vault/30 bg-vault/10",
};

function PrivilegeReviewPanelInner({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, editorDispatch, editorState } = ctx;
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<PrivilegeScanResult | null>(null);
  const [review, setReview] = useState<Record<string, ReviewState>>({});
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<PrivilegeFindingType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");

  // Reset when the open file changes (per name+size).
  const fileKey = file ? `${file.name}::${file.size}` : "";
  useEffect(() => {
    setResult(null);
    setReview({});
    setOpenNote(null);
    setTypeFilter("all");
    setStatusFilter("all");
  }, [fileKey]);

  const runScan = useCallback(async () => {
    if (!file) return;
    setScanning(true);
    setResult(null);
    setProgress("Reading text layer…");
    try {
      const mod = await importChunk(() => import("@/lib/pdf/privilege-scan"));
      const out = await mod.scanPrivilege(file, (p) => {
        setProgress(`Scanning page ${p.page}/${p.totalPages}`);
      });
      setResult(out);
      const total = out.findings.length;
      if (total === 0 && out.scannedPages.length === out.totalPages) {
        toast.info("Scanned document — no text layer", {
          description: "Run Make Searchable (OCR) first, then re-scan for privilege.",
        });
      } else if (total === 0) {
        toast.success("No privilege indicators found", {
          description: "Review manually — privilege determinations still require attorney judgment.",
        });
      } else {
        toast.warning(`${total} privilege indicator${total === 1 ? "" : "s"} — review before producing`);
      }
    } catch (err) {
      console.error("[privilege-scan] failed", err);
      toast.error("Privilege scan failed", { description: (err as Error).message });
    } finally {
      setScanning(false);
      setProgress("");
    }
  }, [file]);

  const setStatus = useCallback((id: string, status: Status) => {
    setReview((r) => ({
      ...r,
      [id]: { status, note: r[id]?.note ?? "" },
    }));
  }, []);

  const setNote = useCallback((id: string, note: string) => {
    setReview((r) => ({
      ...r,
      [id]: { status: r[id]?.status ?? "unreviewed", note },
    }));
  }, []);

  const jumpTo = useCallback(
    (f: PrivilegeFinding) => {
      // detect-pii / privilege-scan use 1-based; editor uses 0-based.
      editorDispatch({ type: "SET_PAGE", n: Math.max(0, f.page - 1) });
    },
    [editorDispatch],
  );

  const findings = result?.findings ?? [];
  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (typeFilter !== "all" && f.type !== typeFilter) return false;
      const s = review[f.id]?.status ?? "unreviewed";
      if (statusFilter !== "all" && s !== statusFilter) return false;
      return true;
    });
  }, [findings, typeFilter, statusFilter, review]);

  const counts = useMemo(() => {
    let priv = 0;
    let not = 0;
    let un = 0;
    for (const f of findings) {
      const s = review[f.id]?.status ?? "unreviewed";
      if (s === "privileged") priv++;
      else if (s === "not-privileged") not++;
      else un++;
    }
    return { priv, not, un, total: findings.length };
  }, [findings, review]);

  const typeBreakdown = useMemo(() => {
    const m = new Map<PrivilegeFindingType, { label: string; n: number }>();
    for (const f of findings) {
      const cur = m.get(f.type);
      if (cur) cur.n++;
      else m.set(f.type, { label: f.typeLabel, n: 1 });
    }
    return [...m.entries()];
  }, [findings]);

  const exportLog = useCallback(() => {
    if (!result) return;
    const privFindings = findings.filter((f) => (review[f.id]?.status ?? "unreviewed") === "privileged");
    if (privFindings.length === 0) {
      toast.warning("No findings marked privileged", {
        description: "Mark items as Privileged first, then export the log.",
      });
      return;
    }
    // CSV — page / type / basis / notes. Deliberately omits the matched
    // term and snippet so the log can be shared without exposing the
    // privileged content itself.
    const rows: string[][] = [
      ["Entry", "Page", "Type", "Basis", "Notes"],
    ];
    privFindings.forEach((f, idx) => {
      rows.push([
        String(idx + 1),
        String(f.page),
        f.typeLabel,
        `Document flagged for ${f.typeLabel.toLowerCase()} language`,
        review[f.id]?.note?.trim() ?? "",
      ]);
    });
    const csv = rows
      .map((r) =>
        r
          .map((c) => {
            if (/[",\n]/.test(c)) return `"${c.replace(/"/g, '""')}"`;
            return c;
          })
          .join(","),
      )
      .join("\n");
    const base = (file?.name ?? "document").replace(/\.pdf$/i, "");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}-privilege-log.csv`;
      a.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    toast.success(`Privilege log saved (${privFindings.length} entr${privFindings.length === 1 ? "y" : "ies"})`, {
      description: "The log records page, type, and basis — not the privileged content itself.",
    });
  }, [findings, review, result, file]);

  const handoffToRedact = useCallback(() => {
    const privFindings = findings.filter((f) => (review[f.id]?.status ?? "unreviewed") === "privileged");
    if (privFindings.length === 0) {
      toast.warning("Mark items as Privileged first", {
        description: "Only confirmed-privileged findings will be queued for redaction.",
      });
      return;
    }
    let added = 0;
    for (const f of privFindings) {
      if (!f.pdfRect) continue;
      // Pad the bbox slightly so the matched phrase is fully covered.
      const rect = f.pdfRect;
      const pad = 1;
      editorDispatch({
        type: "ADD_ANNO",
        a: {
          id: `pv-${f.id}-${Date.now().toString(36)}`,
          kind: "redact",
          page: f.page - 1,
          x: Math.max(0, rect.x - pad),
          y: Math.max(0, rect.y - pad),
          w: rect.w + pad * 2,
          h: rect.h + pad * 2,
          color: { r: 0, g: 0, b: 0 },
          opacity: 1,
        },
      });
      added++;
    }
    toast.success(`Queued ${added} redaction${added === 1 ? "" : "s"} in Redact`, {
      description: "Review and apply in the Redact panel.",
    });
    navigate({ to: "/workspace", search: { tool: "redact" } as never });
  }, [findings, review, editorDispatch, navigate]);

  if (!file) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
        Open a document to scan it for privilege indicators.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-surface-2 p-3 text-[12px] text-text-2">
        <div className="mb-1 flex items-center gap-1.5 text-foreground">
          <Gavel className="h-3.5 w-3.5 text-vault" />
          Privilege review
        </div>
        Flags attorney–client, work product, confidentiality legends,
        common-interest, settlement language, and counsel emails. Findings
        are SUGGESTIONS — privilege determinations require attorney review.
      </div>

      {!result && (
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={scanning}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90 disabled:opacity-60"
        >
          {scanning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress || "Scanning…"}
            </>
          ) : (
            <>
              <ScanSearch className="h-3.5 w-3.5" /> Scan for privilege
            </>
          )}
        </button>
      )}

      {result && (
        <>
          <div className="rounded-md border border-border bg-surface-2 p-3 text-[12px] text-text-2 space-y-2">
            <div className="flex items-center gap-1.5 text-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              {counts.total === 0
                ? "No privilege indicators found."
                : `${counts.total} privilege indicator${counts.total === 1 ? "" : "s"} found — review before producing.`}
            </div>
            {counts.total > 0 && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-sm border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 text-rose-300">
                  {counts.priv} privileged
                </span>
                <span className="rounded-sm border border-border bg-surface-1 px-1.5 py-0.5 text-text-2">
                  {counts.not} not
                </span>
                <span className="rounded-sm border border-border bg-surface-1 px-1.5 py-0.5 text-text-2">
                  {counts.un} unreviewed
                </span>
              </div>
            )}
            {result.scannedPages.length > 0 && (
              <div className="text-[11px] text-amber-400/90">
                {result.scannedPages.length} page{result.scannedPages.length === 1 ? "" : "s"} had no text layer
                — run Make Searchable (OCR), then re-scan.
              </div>
            )}
            <div className="text-[10.5px] uppercase tracking-[0.16em] text-text-muted pt-1 border-t border-border">
              Attorney review required — these are flagged for your assessment.
            </div>
          </div>

          {counts.total > 0 && (
            <>
              {/* Filters */}
              <div className="flex flex-wrap gap-1">
                <FilterChip
                  active={typeFilter === "all"}
                  onClick={() => setTypeFilter("all")}
                  label={`All types · ${counts.total}`}
                />
                {typeBreakdown.map(([type, { label, n }]) => (
                  <FilterChip
                    key={type}
                    active={typeFilter === type}
                    onClick={() => setTypeFilter(typeFilter === type ? "all" : type)}
                    label={`${label} · ${n}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                <FilterChip
                  active={statusFilter === "all"}
                  onClick={() => setStatusFilter("all")}
                  label="All status"
                />
                <FilterChip
                  active={statusFilter === "unreviewed"}
                  onClick={() => setStatusFilter(statusFilter === "unreviewed" ? "all" : "unreviewed")}
                  label="Unreviewed"
                />
                <FilterChip
                  active={statusFilter === "privileged"}
                  onClick={() => setStatusFilter(statusFilter === "privileged" ? "all" : "privileged")}
                  label="Privileged"
                />
                <FilterChip
                  active={statusFilter === "not-privileged"}
                  onClick={() => setStatusFilter(statusFilter === "not-privileged" ? "all" : "not-privileged")}
                  label="Not"
                />
              </div>

              {/* Findings list */}
              <ul className="flex flex-col gap-1.5 max-h-[42vh] overflow-y-auto pr-1 -mr-1">
                {filtered.length === 0 && (
                  <li className="text-[11.5px] text-text-muted px-1 py-2">
                    No findings match the current filter.
                  </li>
                )}
                {filtered.map((f) => {
                  const state = review[f.id] ?? { status: "unreviewed" as Status, note: "" };
                  const onCurrent = (editorState?.current ?? -1) === f.page - 1;
                  return (
                    <li
                      key={f.id}
                      className={cn(
                        "rounded-md border bg-surface-2 p-2.5 text-[12px]",
                        state.status === "privileged"
                          ? "border-rose-400/30"
                          : state.status === "not-privileged"
                          ? "border-border opacity-70"
                          : "border-border",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            "shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]",
                            TYPE_COLORS[f.type],
                          )}
                        >
                          {f.typeLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => jumpTo(f)}
                          className={cn(
                            "ml-auto inline-flex items-center gap-1 rounded-sm border border-border bg-surface-1 px-1.5 py-0.5 text-[10.5px] text-text-2 hover:border-vault/40 hover:text-foreground",
                            onCurrent && "border-vault/40 text-foreground",
                          )}
                          title={`Jump to page ${f.page}`}
                        >
                          p.{f.page} <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1.5 text-foreground font-mono text-[11.5px] break-words">
                        {f.term}
                      </div>
                      <div className="mt-1 text-[11px] text-text-muted leading-snug">
                        …{f.snippet}…
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <StatusBtn
                          active={state.status === "privileged"}
                          tone="priv"
                          onClick={() => setStatus(f.id, "privileged")}
                          label="Privileged"
                        />
                        <StatusBtn
                          active={state.status === "not-privileged"}
                          tone="neutral"
                          onClick={() => setStatus(f.id, "not-privileged")}
                          label="Not"
                        />
                        <StatusBtn
                          active={state.status === "unreviewed"}
                          tone="neutral"
                          onClick={() => setStatus(f.id, "unreviewed")}
                          label="Unreview"
                        />
                        <button
                          type="button"
                          onClick={() => setOpenNote(openNote === f.id ? null : f.id)}
                          className="ml-auto inline-flex items-center gap-1 rounded-sm border border-border bg-surface-1 px-1.5 py-0.5 text-[10.5px] text-text-2 hover:border-vault/40 hover:text-foreground"
                          title="Add note (appears on the privilege log)"
                        >
                          <StickyNote className="h-3 w-3" />
                          {state.note ? "Note" : "Note…"}
                        </button>
                      </div>
                      {openNote === f.id && (
                        <textarea
                          value={state.note}
                          onChange={(e) => setNote(f.id, e.target.value)}
                          rows={2}
                          placeholder="Basis / notes for the privilege log…"
                          className="mt-2 w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[11.5px] text-foreground focus:outline-none focus:ring-2 focus:ring-vault/40"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Actions */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
                <button
                  type="button"
                  onClick={exportLog}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40"
                >
                  <Download className="h-3.5 w-3.5" /> Export privilege log (CSV)
                </button>
                <button
                  type="button"
                  onClick={handoffToRedact}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40"
                >
                  <Eraser className="h-3.5 w-3.5" /> Send privileged to Redact
                </button>
                <button
                  type="button"
                  onClick={() => void runScan()}
                  disabled={scanning}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-transparent px-2.5 py-1 text-[11.5px] text-text-2 hover:border-vault/40 hover:text-foreground"
                >
                  {scanning ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> {progress || "Re-scanning…"}
                    </>
                  ) : (
                    <>
                      <ScanSearch className="h-3 w-3" /> Re-scan
                    </>
                  )}
                </button>
              </div>
              <div className="text-[10.5px] text-text-muted leading-snug">
                <Shield className="inline h-3 w-3 text-vault mr-1" />
                The exported log records page, type, and basis only —
                it never includes the privileged content itself.
              </div>
            </>
          )}

          {counts.total === 0 && result.scannedPages.length < result.totalPages && (
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={scanning}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-2 hover:border-vault/40 hover:text-foreground"
            >
              <ScanSearch className="h-3.5 w-3.5" /> Re-scan
            </button>
          )}
        </>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-[10.5px]",
        active
          ? "border-vault/50 bg-vault/10 text-foreground"
          : "border-border bg-surface-2 text-text-2 hover:border-vault/30",
      )}
    >
      {label}
    </button>
  );
}

function StatusBtn({
  active,
  tone,
  onClick,
  label,
}: {
  active: boolean;
  tone: "priv" | "neutral";
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-[10.5px]",
        active
          ? tone === "priv"
            ? "border-rose-400/50 bg-rose-400/10 text-rose-200"
            : "border-vault/50 bg-vault/10 text-foreground"
          : "border-border bg-surface-1 text-text-2 hover:border-vault/30",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Pro gate. Whole-tool gating is already enforced in workspace-shell's
 * `openTool` (PAID_TOOL_IDS includes "privilege-scan"), so by the time
 * this panel mounts the user is entitled. The fallback here is defensive.
 */
export function PrivilegeReviewPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const isPro = useIsPro();
  const requirePro = useRequirePro();
  useEffect(() => {
    if (!isPro) {
      requirePro("Privilege review (AI)");
    }
  }, [isPro, requirePro]);
  if (!isPro) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
        Privilege review is a Pro feature.
      </p>
    );
  }
  return <PrivilegeReviewPanelInner ctx={ctx} />;
}
