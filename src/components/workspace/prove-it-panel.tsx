import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, X, FileCheck2, ExternalLink, Copy, Eraser } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  getRequestLog,
  subscribeRequestLog,
  clearRequestLog,
  isOfflineEnabled,
  subscribeOffline,
  getBlockedCount,
  type RequestLogEntry,
  type RequestCategory,
} from "@/lib/network-isolation";

const CATEGORY_LABEL: Record<RequestCategory, string> = {
  "app-assets": "App assets loaded",
  license: "License / account check",
  ai: "AI assistance call",
  other: "Other app traffic",
};

function plainLine(e: RequestLogEntry): string {
  const base = CATEGORY_LABEL[e.category];
  const docNote = e.docBytes > 0 ? "⚠ contained binary upload" : "no document data";
  return `${base} (${docNote})`;
}

function formatBytes(n: number): string {
  if (n === 0) return "0 bytes";
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ProveItButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
          "bg-surface-2 text-foreground hover:bg-surface-3",
          open && "bg-surface-3",
        )}
        title="Prove it — show that no document data left this device"
        aria-label="Prove it — privacy verification"
        aria-expanded={open}
      >
        <FileCheck2 className="h-3 w-3" strokeWidth={2.5} />
        <span className={compact ? "hidden md:inline" : ""}>Prove it</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-[24rem] max-h-[80vh] overflow-hidden rounded-xl border border-border bg-surface-2 shadow-[var(--shadow-float)] flex flex-col"
            role="dialog"
            aria-label="Privacy verification"
          >
            <ProveItPanelBody onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}

export function ProveItPanelBody({ onClose }: { onClose?: () => void }) {
  const [entries, setEntries] = useState<RequestLogEntry[]>(() => getRequestLog());
  const [offline, setOffline] = useState({
    enabled: isOfflineEnabled(),
    blocked: getBlockedCount(),
  });
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => subscribeRequestLog(setEntries), []);
  useEffect(() => subscribeOffline(setOffline), []);

  const sent = useMemo(() => entries.filter((e) => !e.blocked), [entries]);
  const blockedEntries = useMemo(() => entries.filter((e) => e.blocked), [entries]);
  const docBytes = useMemo(() => sent.reduce((n, e) => n + e.docBytes, 0), [sent]);
  const totalUpload = useMemo(() => sent.reduce((n, e) => n + e.uploadBytes, 0), [sent]);

  const summary = useMemo(() => {
    const byCat = new Map<RequestCategory, number>();
    for (const e of sent) byCat.set(e.category, (byCat.get(e.category) || 0) + 1);
    return Array.from(byCat.entries());
  }, [sent]);

  const copyRaw = () => {
    const text = entries
      .map(
        (e) =>
          `${new Date(e.ts).toISOString()} ${e.blocked ? "BLOCKED" : "SENT  "} ${e.method} ${e.kind} ${e.url} body=${e.bodyKind} upload=${e.uploadBytes}B doc=${e.docBytes}B status=${e.status ?? "-"}`,
      )
      .join("\n");
    void navigator.clipboard?.writeText(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 p-4 pb-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-md text-text-muted hover:bg-surface-3 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="flex items-start gap-3 pr-5">
          <div
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full",
              docBytes === 0 ? "bg-success/15" : "bg-destructive/15",
            )}
          >
            <ShieldCheck
              className={cn("h-4 w-4", docBytes === 0 ? "text-success" : "text-destructive")}
              strokeWidth={2.5}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">
              {docBytes === 0
                ? "Your documents never left this device. ✓"
                : `⚠ ${formatBytes(docBytes)} of binary data was uploaded`}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-text-2">
              {offline.enabled
                ? `Offline — all network blocked. ${blockedEntries.length} request${blockedEntries.length === 1 ? "" : "s"} blocked this session.`
                : "Measured live by watching every fetch / XHR this app makes."}
            </p>
          </div>
        </div>
      </div>

      <div className="shrink-0 grid grid-cols-2 gap-2 px-4">
        <div className="rounded-md border border-border bg-surface-1 p-2">
          <div className="text-[10px] uppercase tracking-wide text-text-muted">
            Document data uploaded
          </div>
          <div
            className={cn(
              "mt-0.5 text-[15px] font-semibold tabular-nums",
              docBytes === 0 ? "text-success" : "text-destructive",
            )}
          >
            {formatBytes(docBytes)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-1 p-2">
          <div className="text-[10px] uppercase tracking-wide text-text-muted">
            App / license traffic
          </div>
          <div className="mt-0.5 text-[15px] font-semibold text-foreground tabular-nums">
            {formatBytes(totalUpload - docBytes)}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {showRaw ? (
          <pre className="rounded-md bg-surface-1 p-2 font-mono text-[10px] leading-snug text-text-2 overflow-x-auto">
            {entries.length === 0
              ? "(no requests recorded yet)"
              : entries
                  .map(
                    (e) =>
                      `${new Date(e.ts).toLocaleTimeString()} ${e.blocked ? "BLOCKED" : "SENT   "} ${e.method.padEnd(5)} ${e.kind.padEnd(5)} ${e.host || "(local)"} body=${e.bodyKind} ↑${e.uploadBytes}B doc=${e.docBytes}B ${e.status ? `→${e.status}` : ""}`,
                  )
                  .join("\n")}
          </pre>
        ) : (
          <>
            <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              What this app talked to
            </div>
            {summary.length === 0 ? (
              <p className="mt-2 text-[12px] text-text-2">
                No network activity recorded this session.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {summary.map(([cat, count]) => (
                  <li
                    key={cat}
                    className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="text-foreground">{CATEGORY_LABEL[cat]}</span>
                    <span className="text-text-muted tabular-nums">×{count}</span>
                  </li>
                ))}
              </ul>
            )}
            {blockedEntries.length > 0 && (
              <div className="mt-3 rounded-md border border-vault/30 bg-vault/10 px-2.5 py-1.5 text-[11px] text-vault">
                {blockedEntries.length} outgoing request
                {blockedEntries.length === 1 ? "" : "s"} blocked while offline.
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
              Plain-language rule: a request only counts as “document data” if it
              carries binary content (a file, blob or raw bytes). Short JSON like a
              license check is app traffic.
            </p>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-surface-3 px-2 text-[11px] font-medium text-foreground hover:bg-surface-1"
        >
          {showRaw ? "Hide raw log" : "View raw log (IT)"}
        </button>
        {showRaw && (
          <>
            <button
              type="button"
              onClick={copyRaw}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-surface-3 px-2 text-[11px] font-medium text-foreground hover:bg-surface-1"
              title="Copy raw log"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
            <button
              type="button"
              onClick={() => clearRequestLog()}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-surface-3 px-2 text-[11px] font-medium text-foreground hover:bg-surface-1"
              title="Clear log"
            >
              <Eraser className="h-3 w-3" /> Clear
            </button>
          </>
        )}
        <Link
          to="/verify-privacy"
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md text-[11px] font-medium text-vault hover:underline"
        >
          Verify it yourself <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
