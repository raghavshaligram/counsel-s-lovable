/**
 * ExportDialog — phased export flow.
 *
 * Opens BEFORE the file is written. Lets the user toggle document-level
 * finishing options (page numbers, header/footer, flatten) and only writes
 * the file on confirm. Reuses the existing batch ops:
 *   - addPageNumbers (src/lib/batch/ops/page-numbers)
 *   - addHeaderFooter (src/lib/batch/ops/header-footer)
 *   - flatten (src/lib/batch/ops/flatten)
 * and the editor exporter (exportEditedPdf) for the base rebuild. All on-device.
 */
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Download, Hash, Type, Layers, Loader2, Stamp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { exportEditedPdf } from "@/lib/editor/export";
import type { EditorDoc } from "@/lib/editor/types";
import { useBatesSettings, docKey as batesDocKey, computeBatesFingerprint } from "@/lib/workspace/bates-store";
import { importChunk, isChunkLoadError, reloadForFreshChunks } from "@/lib/chunk-import";
import { downloadPdf } from "@/lib/pdf/download";
import { ExportFormatRow } from "./export-format-row";
import { CourtReadinessSection } from "./court-readiness";
import { beginAuditRun, captureStage, endAuditRun, isAuditEnabled, serializeRun, type AuditRun } from "@/lib/pdf/audit-store";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: EditorDoc | null;
  /** Active File — read fresh at confirm so srcBytes detachment can't bite. */
  file: File | null;
};

export function ExportDialog({ open, onOpenChange, doc, file }: Props) {
  // Defaults are OFF — "export as-is" is one click away.
  const [pnOn, setPnOn] = useState(false);
  const [hfOn, setHfOn] = useState(false);
  const [flOn, setFlOn] = useState(false);

  // Bates settings persist per-document via the shared store. The toggle
  // here is mirrored into the same store so the Document Settings inspector
  // and this dialog always agree.
  const [bates, updateBates] = useBatesSettings(batesDocKey(file));
  const batesOn = bates.on;
  const setBatesOn = (on: boolean) => updateBates({ on });
  // "Already stamped" = the current stamp settings match the fingerprint of
  // whatever was burned into the tab bytes via "Apply to active tab". Export
  // must NOT layer a second identical stamp on top. Editing any stamp field
  // invalidates the fingerprint automatically (see bates-store), so the user
  // can always re-stamp by changing a setting.
  const currentBatesFingerprint = computeBatesFingerprint(bates);
  const batesAlreadyStamped =
    !!bates.appliedFingerprint && bates.appliedFingerprint === currentBatesFingerprint;

  // Light, sensible defaults for the three ops.
  const [pnFormat, setPnFormat] = useState<"n" | "page-n" | "n-of-m">("n-of-m");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("Page {page} of {pages}");

  const [busy, setBusy] = useState(false);
  const [auditRun, setAuditRun] = useState<AuditRun | null>(null);

  const reset = () => {
    setBusy(false);
  };

  const run = useCallback(async () => {
    if (!doc) return;
    setBusy(true);
    setAuditRun(null);
    const auditActive = isAuditEnabled();
    if (auditActive) beginAuditRun();
    const tid = "wsx-export-flow";
    toast.loading("Building PDF…", { id: tid });
    try {
      // Prefer live editor bytes: apply-now redaction mutates srcBytes so
      // hidden vectors are gone before flatten/PDF-A/export. If pdf.js has
      // detached that buffer, fall back to the active File.
      const liveBytes = doc.srcBytes.byteLength > 0
        ? doc.srcBytes
        : file
          ? new Uint8Array(await file.arrayBuffer())
          : doc.srcBytes;
      const exportDoc = { ...doc, srcBytes: liveBytes };
      const _mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
      // eslint-disable-next-line no-console
      console.log("[pipeline:size] INPUT", { mb: _mb(liveBytes.byteLength), bytes: liveBytes.byteLength, pages: doc.pages.length });
      if (auditActive) await captureStage("source", liveBytes);
      let bytes = await exportEditedPdf(exportDoc);
      // eslint-disable-next-line no-console
      console.log("[pipeline:size] EXPORT (after exportEditedPdf)", { mb: _mb(bytes.byteLength), bytes: bytes.byteLength });
      if (auditActive) await captureStage("export", bytes);

      if (pnOn) {
        const { addPageNumbers } = await importChunk(() => import("@/lib/batch/ops/page-numbers"));
        bytes = await addPageNumbers(bytes, {
          anchor: "bottom-center",
          format: pnFormat,
          startAt: 1,
          skipFirst: 0,
          fontSize: 10,
          margin: 24,
        });
        if (auditActive) await captureStage("page-numbers", bytes);
      }

      if (hfOn) {
        const { addHeaderFooter } = await importChunk(() => import("@/lib/batch/ops/header-footer"));
        bytes = await addHeaderFooter(bytes, {
          headerText: headerText || undefined,
          footerText: pnOn ? undefined : (footerText || undefined),
          align: "center",
          fontSize: 9,
          margin: 24,
          rule: "all",
          filename: doc.fileName,
        });
        if (auditActive) await captureStage("header-footer", bytes);
      }

      if (flOn) {
        const { flatten } = await importChunk(() => import("@/lib/batch/ops/flatten"));
        bytes = await flatten(bytes, { forms: true, annotations: true });
        if (auditActive) await captureStage("flatten", bytes);
      }

      if (batesOn) {
        if (batesAlreadyStamped) {
          // eslint-disable-next-line no-console
          console.info("[bates] export: skipping addBates — fingerprint matches already-applied stamp", {
            fingerprint: currentBatesFingerprint,
          });
        } else {
          const { addBates } = await importChunk(() => import("@/lib/batch/ops/bates"));
          bytes = await addBates(bytes, {
            prefix: bates.prefix, suffix: bates.suffix, startAt: bates.startAt,
            digits: bates.digits, position: bates.position,
            fontSize: bates.fontSize, color: bates.color, margin: bates.margin,
          });
          if (auditActive) await captureStage("bates", bytes);
        }
      }

      const redactionTargets = doc.annotations.flatMap((a) => {
        if (a.kind !== "redact") return [];
        const diagnosticText = a.sources?.map((s) => (s.redactText || s.originalString || "").trim()).find(Boolean);
        return [{ page: a.page, text: diagnosticText, rect: { x: a.x, y: a.y, w: a.w, h: a.h } }];
      });
      if (redactionTargets.length > 0) {
        // Graceful hard-limit: warn/block on extreme docs before we start.
        const { assessLargeDoc, LargeDocGuardError } = await importChunk(() => import("@/lib/editor/large-doc-guard"));
        const pageCount = doc.pages.length;
        const assess = assessLargeDoc(pageCount);
        if (assess.level === "block") {
          throw new LargeDocGuardError(assess);
        }
        if (assess.level === "warn" && assess.message) {
          toast.message(assess.message, { id: `${tid}-warn`, duration: 6000 });
        }

        toast.loading("Burning redaction regions…", { id: tid });
        const pageRedactions = new Map<number, { x: number; y: number; w: number; h: number }[]>();
        for (const t of redactionTargets) {
          const arr = pageRedactions.get(t.page) ?? [];
          arr.push(t.rect);
          pageRedactions.set(t.page, arr);
        }
        const { runAsJob } = await import("@/lib/jobs/registry");
        const docLabel = file?.name ?? doc.fileName;
        const docId = file ? `${file.name}:${file.size}` : doc.fileName;
        // Wrap rasterize + verify-gate as ONE background job. The gate runs
        // INSIDE the job — a gate failure fails the job and prevents the
        // downstream download (bytes are never written). Cancel via the
        // jobs indicator aborts both phases at page boundaries.
        const { promise } = runAsJob(
          { kind: "redact-export", docId, docLabel },
          async ({ signal, onProgress }) => {
            const { rasterizeRedactedPagesInWorker } = await importChunk(() => import("@/lib/workers/rasterize-client"));
            const rasterResult = await rasterizeRedactedPagesInWorker(bytes, pageRedactions, {
              // "fallback" only rasterizes pages where pdf.js text still
              // intersects a redaction rect after content-stream removal.
              // Pages where rewriteDocument already deleted the glyphs stay
              // in compact text form — avoids ~250KB JPEG × N-page inflation.
              // The redaction-gate below is the backstop: any surviving
              // redacted text fails the gate and forces re-rasterization.
              mode: "fallback",
              scale: 2.5,
              signal,
              onProgress: (done, total) => {
                onProgress({
                  fraction: total ? (done / total) * 0.7 : 0,
                  step: `Burning ${done}/${total}`,
                });
                toast.loading(`Burning redactions ${done}/${total}…`, { id: tid });
              },
            });
            let outBytes = rasterResult.bytes;
            onProgress({ fraction: 0.75, step: "Verifying redaction…" });
            toast.loading("Verifying redaction…", { id: tid });
            const { enforceRedactionGate } = await importChunk(() => import("@/lib/editor/redaction-gate"));
            const gated = await enforceRedactionGate(outBytes, redactionTargets, {
              rasterizedPages: rasterResult.rasterizedPages,
              signal,
              onProgress: (step) => {
                const msg =
                  step === "sanitize" ? "Scrubbing side-channels…"
                  : step === "raster-fallback" ? "Re-burning leaking page…"
                  : "Verifying redaction…";
                onProgress({ fraction: 0.9, step: msg });
                toast.loading(msg, { id: tid });
              },
            });
            outBytes = gated.bytes;
            return outBytes;
          },
        );
        bytes = await promise;
        // eslint-disable-next-line no-console
        console.log("[pipeline:size] RASTERIZE+GATE (after redaction burn)", { mb: _mb(bytes.byteLength), bytes: bytes.byteLength });
        if (auditActive) await captureStage("rasterize+gate", bytes);
      }


      const outName = doc.fileName.replace(/\.pdf$/i, "") + "-edited.pdf";
      // eslint-disable-next-line no-console
      console.log("[pipeline:size] FINAL (handed to downloadPdf)", { mb: _mb(bytes.byteLength), bytes: bytes.byteLength, name: outName });
      if (auditActive) await captureStage("final", bytes);
      await downloadPdf(bytes, outName);

      toast.success("Saved", { id: tid });
      if (auditActive) {
        const run = endAuditRun();
        setAuditRun(run);
        // Keep dialog open so the user can grab the Copy JSON payload.
        if (!run || run.perRun.length < 2) onOpenChange(false);
      } else {
        onOpenChange(false);
      }
      reset();
    } catch (err) {
      console.error("[export-flow] failed", err);
      if (auditActive) {
        const run = endAuditRun();
        setAuditRun(run);
      }
      if (isChunkLoadError(err)) {
        toast.error("App was updated — reloading…", { id: tid });
        reloadForFreshChunks();
      } else {
        toast.error("Export failed", { id: tid, description: (err as Error).message });
      }
    } finally {
      setBusy(false);
    }
  }, [doc, file, pnOn, hfOn, flOn, batesOn, bates, batesAlreadyStamped, currentBatesFingerprint, pnFormat, headerText, footerText, onOpenChange]);


  const anyOn = pnOn || hfOn || flOn || batesOn;

  const batesPreview = `${bates.prefix}${String(bates.startAt).padStart(bates.digits, "0")}${bates.suffix ?? ""}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md bg-surface-1 border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Export PDF</DialogTitle>
          <DialogDescription className="text-[12px] text-text-2">
            Add any finishing touches before saving. Nothing is written until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2.5">
          <ExportFormatRow />
          <OptionRow
            icon={<Hash className="h-3.5 w-3.5" />}
            label="Page numbers"
            on={pnOn}
            onChange={setPnOn}
          >
            <div className="grid grid-cols-3 gap-1.5">
              {(["n", "page-n", "n-of-m"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPnFormat(f)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] transition-colors",
                    pnFormat === f
                      ? "border-vault/50 bg-accent-soft text-vault"
                      : "border-border bg-surface-2 text-text-2 hover:border-vault/30",
                  )}
                >
                  {f === "n" ? "1" : f === "page-n" ? "Page 1" : "1 of N"}
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-text-muted">Centered, bottom of every page.</p>
          </OptionRow>

          <OptionRow
            icon={<Stamp className="h-3.5 w-3.5" />}
            label="Bates numbering"
            on={batesOn}
            onChange={setBatesOn}
          >
            <div className="grid grid-cols-3 gap-1.5">
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Prefix</span>
                <input
                  type="text"
                  value={bates.prefix}
                  onChange={(e) => updateBates({ prefix: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] font-mono text-foreground focus:border-vault/40 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Digits</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={bates.digits}
                  onChange={(e) => updateBates({ digits: Math.min(10, Math.max(1, parseInt(e.target.value || "1", 10))) })}
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] font-mono text-foreground focus:border-vault/40 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Start</span>
                <input
                  type="number"
                  min={0}
                  value={bates.startAt}
                  onChange={(e) => updateBates({ startAt: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] font-mono text-foreground focus:border-vault/40 focus:outline-none"
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Suffix</span>
                <input
                  type="text"
                  value={bates.suffix ?? ""}
                  onChange={(e) => updateBates({ suffix: e.target.value })}
                  placeholder="(optional)"
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] font-mono text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { id: "tl", l: "TL" }, { id: "tc", l: "TC" }, { id: "tr", l: "TR" },
                { id: "bl", l: "BL" }, { id: "bc", l: "BC" }, { id: "br", l: "BR" },
              ] as const).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => updateBates({ position: p.id })}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] transition-colors",
                    bates.position === p.id
                      ? "border-vault/50 bg-accent-soft text-vault"
                      : "border-border bg-surface-2 text-text-2 hover:border-vault/30",
                  )}
                >
                  {p.l}
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-text-muted">
              Preview: <span className="font-mono text-foreground">{batesPreview}</span> · sequential on every page. Full options in Document Settings.
            </p>
            {batesAlreadyStamped ? (
              <p className="rounded-md border border-vault/30 bg-accent-soft px-2 py-1.5 text-[10.5px] text-vault">
                Bates already stamped on this document with these settings — export will skip stamping. Change any Bates setting to re-stamp.
              </p>
            ) : null}
          </OptionRow>


          <OptionRow
            icon={<Type className="h-3.5 w-3.5" />}
            label="Header / footer"
            on={hfOn}
            onChange={setHfOn}
          >
            <input
              type="text"
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Header (leave blank for none)"
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
            />
            <input
              type="text"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Footer (leave blank for none)"
              disabled={pnOn}
              className={cn(
                "w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none",
                pnOn && "opacity-50",
              )}
            />
            <p className="text-[10.5px] text-text-muted">
              Tokens: <code>{"{page}"}</code> <code>{"{pages}"}</code> <code>{"{date}"}</code> <code>{"{filename}"}</code>
              {pnOn && " · Footer disabled while page numbers are on."}
            </p>
          </OptionRow>

          <OptionRow
            icon={<Layers className="h-3.5 w-3.5" />}
            label="Flatten"
            on={flOn}
            onChange={setFlOn}
          >
            <p className="text-[10.5px] text-text-muted">
              Bakes form fields and annotations into the page — permanent and no longer editable.
            </p>
          </OptionRow>
        </div>

        {file && (
          <CourtReadinessSection
            sourceName={file.name}
            getBytes={async () => new Uint8Array(await file.arrayBuffer())}
          />
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { setPnOn(false); setHfOn(false); setFlOn(false); setBatesOn(false); void run(); }}
            disabled={busy}
            className="text-[12px] text-text-2 underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            Export as-is
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground hover:opacity-90",
              busy && "cursor-not-allowed opacity-60",
            )}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" strokeWidth={2.5} />}
            {busy ? "Building…" : anyOn ? "Apply & download" : "Download"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OptionRow({
  icon, label, on, onChange, children,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(
      "rounded-md border bg-surface-2/40 transition-colors",
      on ? "border-vault/40" : "border-border",
    )}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-[12.5px] text-foreground">
          <span className="text-text-2">{icon}</span>
          {label}
        </span>
        <span
          aria-hidden
          className={cn(
            "grid h-4 w-4 shrink-0 place-items-center rounded-sm border transition-colors",
            on ? "border-vault bg-vault text-vault-foreground" : "border-text-muted/40 bg-transparent",
          )}
        >
          {on && (
            <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none">
              <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>
      {on && children && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 px-3 py-2.5">
          {children}
        </div>
      )}
    </div>
  );
}
