/**
 * Tool panels — per-tool inspector bodies. Exactly ONE renders inside the
 * single Inspector container at any time. No outer card/wrapper here: the
 * Inspector already provides the header, border, and scroll area.
 */
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Sparkles,
  Search,
  Tag,
  ShieldCheck,
  Wand2,
  PenLine,
  FileText,
  Download,
  RefreshCw,
  Trash2,
  Upload,
  Table as TableIcon,
  Lock,
  LockOpen,
  Plus,
  GripVertical,
  X,
  Files as FilesIcon,
  FileStack,
  KeyRound,
  Eye,
  EyeOff,
  ShieldOff,
  Info,
  ChevronDown,
  GitCompare,
  Hash,
  Shield,
  Wrench,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";

/**
 * Uniform empty-state shown in the inspector when no document is open.
 * All tool panels use this so the “open a PDF…” affordance looks identical.
 */
function InspectorEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
      {children}
    </p>
  );
}
import { cn } from "@/lib/utils";
import { SignatureCreator } from "./signature-creators";
import type { Action as EditorAction, State as EditorState } from "@/lib/editor/state";
import type { Anno, Reply } from "@/lib/editor/types";
import { saveSidecarNow } from "@/lib/workspace/persistence";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Check, CornerDownRight, MessageSquare } from "lucide-react";
import {
  detectFormFields,
  applyFormFill,
  type FormFieldInfo,
} from "@/lib/pdf/sign-fill";
import { parseCsv, generateBatch, type CsvData } from "@/lib/pdf/csv-fill";
import {
  listSignatures,
  saveSignature,
  deleteSignature,
  type StoredSignature,
} from "@/lib/workspace/signature-store";
import {
  combinePdfs,
  getPageCount,
  parseRange,
  type MergeItem,
} from "@/lib/pdf/combine";
import {
  parseRanges,
  parseSplitPoints,
  splitPdf,
  downloadBlob,
  getPageCount as getSplitPageCount,
} from "@/lib/pdf/split";
import {
  detectSmartBreaks,
  buildPreview,
  splitByParts,
  type DetectionMode,
  type PartPreview,
  type DetectedBreak,
  type PatternKind,
} from "@/lib/pdf/smart-split";
import { X as XIcon } from "lucide-react";
import { Scissors, RotateCw, RotateCcw, LayoutGrid } from "lucide-react";
import {
  getRotatePageCount,
  resolveRotateScope,
  rotatePdf,
  type RotateAngle,
  type RotateScope,
} from "@/lib/pdf/rotate";
import { densityToGridColumns, useOrganize } from "@/lib/workspace/organize-store";
import { buildPdfFromCells } from "@/lib/pdf/organize";
import { useTray } from "@/lib/tray/store";
import { downloadBytes } from "@/lib/batch/runner";
import { downloadPdf } from "@/lib/pdf/download";
import { ExportFormatRow } from "./export-format-row";
import { RedactionAuditLedger } from "./redaction-ledger";
import { useCompare } from "@/lib/workspace/compare-store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBatesSettings, docKey as batesDocKey, computeBatesFingerprint } from "@/lib/workspace/bates-store";
import { importChunk } from "@/lib/chunk-import";
import { confirmDialog } from "@/components/confirm-dialog";
import { useIsPro, useRequirePro, LockBadge } from "@/lib/pro-gate";
import { FirmTemplatesMenu } from "./firm-templates-menu";
import { CourtReadinessSection } from "./court-readiness";
import { PrivilegeReviewPanel } from "./privilege-review-panel";
import { WorkflowBuilderPanel } from "./workflow-builder-panel";
import { CitationHyperlinkerPanel } from "./citation-hyperlinker-panel";
import { TableOfAuthoritiesPanel } from "./toa-panel";
import { DocumentHashPanel } from "./document-hash-panel";
import { PreDiscoveryPanel } from "./pre-discovery-panel";
import { usePiiScanResultsStore } from "@/lib/jobs/pii-scan-results";
import {
  getDeviceCapability,
  estimateScan,
  formatEstimate,
  tierLabel,
  type DeviceCapability,
} from "@/lib/device/capability";
import { allocationFailureMessage, logAllocationFailure, logHeap } from "@/lib/memory-log";

export type OcrCtx = {
  run: (opts?: { languages?: string[]; highAccuracy?: boolean }) => void | Promise<void>;
  stop: () => void;
  running: boolean;
  progressText: string;
  ocrPagesCount: number;
  ocrPagesCopiedCount: number;
  scannedRemainingCount: number;
  isPartial: boolean;
  defaults: { languages: string[]; highAccuracy: boolean };
};

export type ToolPanelCtx = {
  /** Stable owning workspace tab id for document-scoped background jobs. */
  docId?: string;
  /** The active tab's PDF file (or null when none open). */
  file: File | null;
  /** Replace the active tab's file in place (used by Fill → apply). */
  replaceFile: (f: File) => void;
  /** Dispatch into the active tab's editor state. */
  editorDispatch: (a: EditorAction) => void;
  /** Active editor state (annotations, current page, selection). Optional —
   *  only panels that read editor data need it. */
  editorState?: EditorState;
  /** Close the inspector (used by panels that finish a task and want to dismiss). */
  closeInspector?: () => void;
  /** Other open workspace tabs (excludes the active one). Used by Compare. */
  otherTabs?: Array<{ id: string; name: string; file: File }>;
  /** Workspace-managed OCR controls. */
  ocr?: OcrCtx;
  /** When a panel has multiple sections, deep-link to one of them.
   *  E.g. searching "Bates" in the command bar sets this to "bates"
   *  so the Document Settings panel auto-opens that disclosure. */
  focusSection?: string | null;
  /** Clear focusSection after the consumer has acted on it. */
  clearFocusSection?: () => void;
};

type PanelProps = { toolId: string; ctx: ToolPanelCtx };

export function ToolPanel({ toolId, ctx }: PanelProps) {
  switch (toolId) {
    case "redact":
      return <RedactPanel ctx={ctx} />;
    case "sign":
      return <SignFillPanel ctx={ctx} />;
    case "mail-merge":
      return <MailMergePanel ctx={ctx} />;
    case "merge":
      return <MergePanel ctx={ctx} />;
    case "split":
      return <SplitPanel ctx={ctx} />;
    case "rotate":
      return <RotatePanel ctx={ctx} />;
    case "organize":
      return <OrganizePanel ctx={ctx} />;
    case "extract":
      return <ExtractPanel ctx={ctx} />;
    case "watermark":
      return <WatermarkPanel ctx={ctx} />;
    case "protect":
      return <ProtectPanel ctx={ctx} />;
    case "unlock":
      return <UnlockPanel ctx={ctx} />;
    case "repair":
      return <RepairPanel ctx={ctx} />;
    case "compare":
      return <ComparePanel ctx={ctx} />;
    case "ocr":
      return <OcrPanel ctx={ctx} />;
    case "convert":
      return <ConvertPanel ctx={ctx} />;
    case "image-convert":
      return <ImageConvertPanel ctx={ctx} />;
    case "doc-settings":
      return <DocumentSettingsPanel ctx={ctx} />;
    case "bates":
      return <BatesPanel ctx={ctx} />;
    case "comments":
      return <CommentsInspectorPanel ctx={ctx} />;
    case "outline":
      return <OutlinePanel ctx={ctx} />;
    case "sanitize":
      return <SanitizePanel ctx={ctx} />;
    case "exhibit-binder":
      return <ExhibitBinderPanel />;
    case "court-readiness":
      return <CourtReadinessPanel ctx={ctx} />;
    case "privilege-scan":
      return <PrivilegeReviewPanel ctx={ctx} />;
    case "workflow-builder":
      return <WorkflowBuilderPanel ctx={ctx} />;
    case "citation-hyperlinker":
      return <CitationHyperlinkerPanel ctx={ctx} />;
    case "toa":
      return <TableOfAuthoritiesPanel ctx={ctx} />;
    case "document-hash":
      return <DocumentHashPanel ctx={ctx} />;
    case "pre-discovery":
      return <PreDiscoveryPanel ctx={ctx} />;
    default:
      return <ComingSoonPanel label={toolId} />;
  }
}


/* ======================= Court Readiness ======================= */

function CourtReadinessPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const getBytes = useCallback(async () => {
    if (!file) throw new Error("Open a PDF first");
    return new Uint8Array(await file.arrayBuffer());
  }, [file]);
  if (!file) {
    return (
      <InspectorEmpty>
        Open a PDF to run the free Court Readiness scan — checks PACER size caps, font embedding, and hidden metadata.
      </InspectorEmpty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] leading-snug text-text-muted">
        Pre-flight your filing against court standards. The scan is free; one-click Auto-Fix requires a free account.
      </p>
      <CourtReadinessSection getBytes={getBytes} sourceName={file.name} />
    </div>
  );
}


/* ============================ Sign & Fill ============================ */

function SignFillPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile, editorDispatch } = ctx;

  /* ---- Saved signatures (on-device, IndexedDB) ---- */
  const [saved, setSaved] = useState<StoredSignature[]>([]);
  const [armedSigId, setArmedSigId] = useState<string | null>(null);
  const [pendingSig, setPendingSig] = useState<{ pngDataUrl: string; aspect: number } | null>(null);
  const [pendingName, setPendingName] = useState("");

  useEffect(() => {
    void listSignatures().then(setSaved);
  }, []);

  /* ---- Form fields ---- */
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [flatten, setFlatten] = useState(true);

  /* Re-scan whenever the active file changes. */
  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  const rescan = useCallback(async () => {
    if (!file) {
      setFields(null);
      setValues({});
      return;
    }
    setScanning(true);
    try {
      const f = await detectFormFields(file);
      setFields(f);
      setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
    } catch (err) {
      console.error("[sign-fill] detect failed", err);
      setFields([]);
      toast.error("Couldn't read form fields", { description: (err as Error).message });
    } finally {
      setScanning(false);
    }
  }, [file]);

  useEffect(() => {
    void rescan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  /* ---- Arm a saved sig as the pending image so the editor canvas drops
         it on the next click (reuses image-place tool). */
  const armSignature = useCallback(
    (s: StoredSignature) => {
      const img = new Image();
      img.onload = () => {
        editorDispatch({
          type: "SET_PENDING_IMAGE",
          img: { dataUrl: s.pngDataUrl, mime: "image/png", w: img.naturalWidth, h: img.naturalHeight },
        });
        editorDispatch({ type: "SET_TOOL", t: "image" });
        setArmedSigId(s.id);
        toast.success(`"${s.name}" armed — click a page to place`);
      };
      img.src = s.pngDataUrl;
    },
    [editorDispatch],
  );

  /* Creator emits → hold in `pending`, prompt for a name, then persist. */
  const onCreated = useCallback(
    ({ pngDataUrl, aspect }: { pngDataUrl: string; aspect: number }) => {
      setPendingSig({ pngDataUrl, aspect });
      setPendingName(
        saved.length === 0 ? "Full signature" : `Signature ${saved.length + 1}`,
      );
    },
    [saved.length],
  );

  const commitPending = useCallback(async () => {
    if (!pendingSig) return;
    const next = await saveSignature({
      name: pendingName,
      pngDataUrl: pendingSig.pngDataUrl,
      aspect: pendingSig.aspect,
    });
    setSaved(next);
    const fresh = next[0];
    setPendingSig(null);
    setPendingName("");
    if (fresh) armSignature(fresh);
  }, [pendingSig, pendingName, armSignature]);

  const removeSig = useCallback(async (id: string) => {
    const next = await deleteSignature(id);
    setSaved(next);
    if (armedSigId === id) {
      setArmedSigId(null);
      editorDispatch({ type: "SET_PENDING_IMAGE", img: null });
      editorDispatch({ type: "SET_TOOL", t: "select" });
    }
  }, [armedSigId, editorDispatch]);

  /* ---- One-off apply form fill ---- */
  const applyFill = useCallback(async () => {
    if (!file || !fields || fields.length === 0) return;
    setApplying(true);
    try {
      const out = await applyFormFill({ file, values, flatten });
      replaceFile(out);
      toast.success(flatten ? "Form filled and flattened" : "Form filled");
    } catch (err) {
      console.error("[sign-fill] apply failed", err);
      toast.error("Couldn't apply form values", { description: (err as Error).message });
    } finally {
      setApplying(false);
    }
  }, [file, fields, values, flatten, replaceFile]);

  if (!file) {
    return (
      <InspectorEmpty>Open a document to start signing or filling form fields.</InspectorEmpty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ───────────────── Signature ───────────────── */}
      <Section title="Signature" icon={<PenLine className="h-3 w-3" />}>
        <SignatureCreator onSave={onCreated} />

        {pendingSig && (
          <div className="mt-2 rounded-md border border-vault/40 bg-vault/5 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-text-muted">
              Name & save
            </div>
            <div className="flex items-center gap-1.5">
              <img
                src={pendingSig.pngDataUrl}
                alt=""
                className="h-7 w-12 shrink-0 rounded bg-white object-contain"
              />
              <input
                value={pendingName}
                onChange={(e) => setPendingName(e.target.value)}
                placeholder="e.g. Full signature, Initials"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
                autoFocus
              />
              <button
                type="button"
                onClick={commitPending}
                className="rounded-md bg-vault px-2 py-1 text-[11px] font-medium text-vault-foreground hover:opacity-90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setPendingSig(null); setPendingName(""); }}
                className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-3 hover:text-foreground"
                aria-label="Discard"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {saved.length > 0 && (
          <div className="mt-2.5">
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-text-muted">
              Saved signatures
            </div>
            <ul className="flex flex-col gap-1">
              {saved.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border bg-surface-2 px-1.5 py-1",
                    armedSigId === s.id ? "border-vault/60" : "border-border",
                  )}
                >
                  <img
                    src={s.pngDataUrl}
                    alt=""
                    className="h-7 w-12 shrink-0 rounded bg-white object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => armSignature(s)}
                    className="flex-1 truncate text-left text-[11.5px] text-foreground hover:text-vault"
                    title={s.name}
                  >
                    {s.name}
                    {armedSigId === s.id && (
                      <span className="ml-1 text-[10px] text-text-muted">· click a page</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSig(s.id)}
                    aria-label="Remove signature"
                    className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-3 hover:text-foreground"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-text-muted">
          <Lock className="h-2.5 w-2.5" />
          Signatures are stored only on this device.
        </p>
      </Section>

      {/* ───────────────── One-off form fields ───────────────── */}
      <Section
        title="Form fields"
        icon={<FileText className="h-3 w-3" />}
        right={
          <button
            type="button"
            onClick={rescan}
            disabled={scanning}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-text-2 hover:bg-surface-2 hover:text-foreground"
          >
            <RefreshCw className={cn("h-3 w-3", scanning && "animate-spin")} />
            Rescan
          </button>
        }
      >
        {fields === null || scanning ? (
          <p className="text-[11.5px] text-text-muted">Scanning document…</p>
        ) : fields.length === 0 ? (
          <p className="text-[11.5px] text-text-muted">
            No fillable form fields detected in this document.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {fields.map((f) => (
                <li key={f.name} className="flex flex-col gap-1">
                  <label className="truncate text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
                    {f.name}
                  </label>
                  {f.kind === "text" && (
                    f.multiline ? (
                      <textarea
                        value={values[f.name] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                        rows={2}
                        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
                      />
                    ) : (
                      <input
                        value={values[f.name] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
                      />
                    )
                  )}
                  {f.kind === "checkbox" && (
                    <label className="inline-flex items-center gap-2 text-[12px] text-foreground">
                      <input
                        type="checkbox"
                        checked={(values[f.name] ?? "false") === "true"}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [f.name]: e.target.checked ? "true" : "false" }))
                        }
                        className="h-3.5 w-3.5 accent-[var(--vault)]"
                      />
                      Checked
                    </label>
                  )}
                  {(f.kind === "dropdown" || f.kind === "optionlist" || f.kind === "radio") && (
                    <select
                      value={values[f.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-vault/50"
                    >
                      <option value="">— none —</option>
                      {(f.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                  {f.kind === "other" && (
                    <p className="text-[10.5px] text-text-muted">Unsupported field type.</p>
                  )}
                </li>
              ))}
            </ul>

            <label className="mt-3 flex items-center gap-2 text-[11px] text-text-2">
              <input
                type="checkbox"
                checked={flatten}
                onChange={(e) => setFlatten(e.target.checked)}
                className="h-3 w-3 accent-[var(--vault)]"
              />
              Flatten after apply (fields baked, no longer editable)
            </label>

            <button
              type="button"
              onClick={applyFill}
              disabled={applying}
              className={cn(
                "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
                applying && "opacity-60 cursor-wait",
              )}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
              {applying ? "Applying…" : "Apply to document"}
            </button>
          </>
        )}
      </Section>

      {/* ───────────────── CSV batch fill ───────────────── */}
      <CsvFillSection file={file} fields={fields ?? []} flatten={flatten} />

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ─────────────────── CSV batch fill subsection ─────────────────── */

function CsvFillSection({
  file,
  fields,
  flatten,
}: {
  file: File;
  fields: FormFieldInfo[];
  flatten: boolean;
}) {
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [csvName, setCsvName] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Auto-map: header == field name (case-insensitive) wins. */
  const autoMap = useCallback(
    (headers: string[]) => {
      const m: Record<string, string> = {};
      for (const f of fields) {
        const hit = headers.find((h) => h.toLowerCase() === f.name.toLowerCase());
        m[f.name] = hit ?? "";
      }
      setMapping(m);
    },
    [fields],
  );

  const onCsvFile = useCallback(
    async (f: File) => {
      try {
        const text = await f.text();
        const data = parseCsv(text);
        if (data.headers.length === 0) {
          toast.error("CSV looks empty.");
          return;
        }
        setCsv(data);
        setCsvName(f.name);
        autoMap(data.headers);
        toast.success(`Loaded ${data.rows.length} row${data.rows.length === 1 ? "" : "s"}`);
      } catch (err) {
        console.error(err);
        toast.error("Couldn't read that CSV.");
      }
    },
    [autoMap],
  );

  const mappedCount = useMemo(
    () => Object.values(mapping).filter(Boolean).length,
    [mapping],
  );

  const generate = useCallback(async () => {
    if (!csv || csv.rows.length === 0) return;
    if (mappedCount === 0) {
      toast.error("Map at least one field to a CSV column.");
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: csv.rows.length });
    try {
      const files = await generateBatch({
        file,
        rows: csv.rows,
        mapping,
        flatten,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const zip = new JSZip();
      files.forEach((f) => zip.file(f.name, f));
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const base = file.name.replace(/\.pdf$/i, "");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base} — filled batch.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Generated ${files.length} PDFs`);
    } catch (err) {
      console.error(err);
      toast.error("Batch fill failed", { description: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [csv, mapping, mappedCount, file, flatten]);

  if (fields.length === 0) return null;

  return (
    <Section title="CSV batch fill" icon={<TableIcon className="h-3 w-3" />}>
      {!csv ? (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-[11.5px] text-text-2 hover:border-vault/50 hover:text-foreground"
          >
            <Upload className="h-3 w-3" /> Upload CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onCsvFile(f);
              e.target.value = "";
            }}
          />
          <p className="mt-1.5 text-[10.5px] text-text-muted">
            One row per output PDF. First row = column headers.
          </p>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-1.5 text-[11px] text-text-2">
            <span className="truncate" title={csvName}>
              {csvName} · {csv.rows.length} row{csv.rows.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => { setCsv(null); setMapping({}); setCsvName(""); }}
              className="text-[10.5px] text-text-muted hover:text-foreground"
            >
              Change
            </button>
          </div>

          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-text-muted">
            Map PDF field → CSV column
          </div>
          <ul className="flex flex-col gap-1.5">
            {fields.map((f) => (
              <li key={f.name} className="flex items-center gap-1.5">
                <span
                  className="min-w-0 flex-1 truncate text-[11.5px] text-foreground"
                  title={f.name}
                >
                  {f.name}
                </span>
                <span className="text-text-muted">→</span>
                <select
                  value={mapping[f.name] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.name]: e.target.value }))
                  }
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-1.5 py-1 text-[11.5px] text-foreground focus:outline-none focus:border-vault/50"
                >
                  <option value="">— skip —</option>
                  {csv.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={generate}
            disabled={busy || mappedCount === 0}
            className={cn(
              "mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
              (busy || mappedCount === 0) && "opacity-60 cursor-not-allowed",
            )}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
            {busy && progress
              ? `Generating ${progress.done}/${progress.total}…`
              : `Generate ${csv.rows.length} PDF${csv.rows.length === 1 ? "" : "s"} (zip)`}
          </button>
          <p className="mt-1.5 text-[10.5px] text-text-muted">
            {mappedCount} of {fields.length} field{fields.length === 1 ? "" : "s"} mapped · {flatten ? "flatten on" : "fields stay editable"}
          </p>
        </>
      )}
    </Section>
  );
}

/* ============================== Mail Merge ============================== */

/**
 * Mail Merge inspector — batch-fills the active tab's PDF template with rows
 * from a CSV and downloads a ZIP of named PDFs. Reuses CsvFillSection for the
 * mapping + generation logic (same code path as Sign & Fill's batch section)
 * so there's exactly one implementation of the merge flow. On-device only.
 */
function MailMergePanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const fileKey = file ? `${file.name}::${file.size}::${file.lastModified}` : "";
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [flatten, setFlatten] = useState(true);

  const rescan = useCallback(async () => {
    if (!file) {
      setFields([]);
      return;
    }
    setScanning(true);
    try {
      const info = await detectFormFields(file);
      setFields(info);
    } catch (err) {
      console.error("[mail-merge] field scan failed", err);
      setFields([]);
      toast.error("Couldn't read form fields", { description: (err as Error).message });
    } finally {
      setScanning(false);
    }
  }, [file]);

  useEffect(() => {
    void rescan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  if (!file) {
    return (
      <InspectorEmpty>
        Open a fillable PDF template to run Mail Merge. One row of your CSV = one filled, named PDF.
      </InspectorEmpty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Template" icon={<FileStack className="h-3 w-3" />}>
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div className="truncate text-[12px] text-foreground" title={file.name}>
            {file.name}
          </div>
          <div className="mt-0.5 text-[10.5px] text-text-muted">
            {scanning || fields === null
              ? "Scanning for form fields…"
              : fields.length === 0
                ? "No AcroForm fields detected in this PDF."
                : `${fields.length} fillable field${fields.length === 1 ? "" : "s"} detected`}
          </div>
        </div>
        <button
          type="button"
          onClick={rescan}
          disabled={scanning}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-text-2 hover:bg-surface-2 hover:text-foreground"
        >
          <RefreshCw className={cn("h-3 w-3", scanning && "animate-spin")} />
          Rescan
        </button>
      </Section>

      {fields !== null && fields.length === 0 && !scanning && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Mail Merge currently requires a PDF with AcroForm fields. Use{" "}
            <strong className="text-amber-100">Sign & Fill</strong> to add fields, or export a
            fillable PDF from Acrobat / LibreOffice.
          </span>
        </div>
      )}

      {fields !== null && fields.length > 0 && (
        <>
          <Section title="Options" icon={<FileText className="h-3 w-3" />}>
            <label className="flex items-start gap-2 text-[11.5px] text-foreground">
              <input
                type="checkbox"
                checked={flatten}
                onChange={(e) => setFlatten(e.target.checked)}
                className="mt-0.5 h-3 w-3 accent-[var(--vault)]"
              />
              <span>
                <span className="block">Flatten output</span>
                <span className="block text-[10.5px] text-text-muted">
                  Lock the fields so recipients can't edit. Recommended for sending.
                </span>
              </span>
            </label>
          </Section>

          <CsvFillSection file={file} fields={fields} flatten={flatten} />
        </>
      )}

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}


/* ------------------------------ Redact ------------------------------ */


/**
 * Redact staging bridge — Stage 2 unification.
 *
 * The AI-detect flow keeps its own selected-findings state internally
 * (findings staged in memory until the user hits "Redact selected"), while
 * manual boxes / pattern matches commit to `editorState.doc.annotations`
 * immediately. That's an asymmetry the user sees in the ledger: committed
 * boxes appear, staged AI selections don't.
 *
 * Rather than restructure both flows, `AutoDetectSensitive` publishes its
 * current "selected of total" and a `commit()` callback into this
 * module-level singleton. `RedactPanel` reads it via `useSyncExternalStore`
 * and renders a single "Staged" row alongside the committed ledger, with
 * a "Commit staged" button that calls the SAME `redactSelected` logic —
 * no divergent code path, no change to the burn pipeline.
 *
 * If AI detect is unmounted (non-Pro, or panel not open), the bridge
 * resets to zeros and the row hides itself.
 */
type StagedRedactBridge = {
  selected: number;
  total: number;
  /** Count of ticked side-channel items (form fields / comments / metadata). */
  sideStaged: number;
  commit: (() => void) | null;
  /**
   * Side-channel-only commit — wipes ticked form fields / annotations /
   * metadata via the sanitize worker and hot-swaps `srcBytes` in place.
   * Used by RedactPanel when the user has staged side-channel items but no
   * page-text redactions (page burn would be a no-op in that case).
   */
  sideCommit: (() => Promise<void>) | null;
  /**
   * Flush any pending debounced side-channel sanitize (cancel the timer
   * and await any in-flight worker call). Export calls this before its
   * own commit so a fast Export within the debounce window doesn't race
   * replaceFile with a mid-flight sanitize.
   */
  flushSide: (() => Promise<void>) | null;
};
const stagedRedactBridge: { current: StagedRedactBridge } = {
  current: { selected: 0, total: 0, sideStaged: 0, commit: null, sideCommit: null, flushSide: null },
};
const stagedRedactListeners = new Set<() => void>();
function publishStagedRedact(next: StagedRedactBridge) {
  const cur = stagedRedactBridge.current;
  if (
    cur.selected === next.selected &&
    cur.total === next.total &&
    cur.sideStaged === next.sideStaged &&
    cur.commit === next.commit &&
    cur.sideCommit === next.sideCommit &&
    cur.flushSide === next.flushSide
  ) return;
  stagedRedactBridge.current = next;
  for (const l of stagedRedactListeners) l();
}
function subscribeStagedRedact(cb: () => void) {
  stagedRedactListeners.add(cb);
  return () => { stagedRedactListeners.delete(cb); };
}
function useStagedRedact(): StagedRedactBridge {
  return useSyncExternalStore(
    subscribeStagedRedact,
    () => stagedRedactBridge.current,
    () => stagedRedactBridge.current,
  );
}


/**
 * Pro capabilities that live INSIDE the (free) Redact tool. Manual redact
 * stays free for everyone; AI sensitive-data detection and pattern/bulk
 * redaction require a Pro subscription. For non-Pro users the buttons show
 * a lock badge and open the Upgrade modal. For Pro users, "AI detect" mounts
 * the AutoDetectSection inline so findings + select/redact happen in-panel.
 */
function ProRedactSection({ ctx }: { ctx: ToolPanelCtx }) {
  const isPro = useIsPro();
  const requirePro = useRequirePro();
  return (
    <>
      <Section title="Find redactions automatically" icon={<Shield className="h-3 w-3" />}>
        <div className="flex flex-col gap-1.5">
          {isPro ? (
            <AutoDetectSensitive ctx={ctx} />
          ) : (
            <ProGatedButton
              isPro={isPro}
              locked={!isPro}
              onClick={() => requirePro("AI detect sensitive info")}
              label="AI detect sensitive info"
              hint="Names, emails, SSNs, phones, dates, cards/accounts — proposed as draft boxes you review before redacting."
            />
          )}
        </div>
      </Section>
      <Section title="Pattern / bulk redact" icon={<Shield className="h-3 w-3" />}>
        {isPro ? (
          <PatternRedact ctx={ctx} />
        ) : (
          <ProGatedButton
            isPro={isPro}
            locked
            onClick={() => requirePro("Pattern / bulk redaction")}
            label="Redact every match"
            hint='Find every match of a term or regex (e.g. "Acme, Inc." or a phone-number pattern) across all pages, review locations, then burn them all at once.'
          />
        )}
      </Section>
    </>
  );
}

/**
 * PatternRedact — Pro-only. User enters a term (optionally a regex), we
 * scan every page's text layer for occurrences, list them by page, and
 * stage them as redact annotations with `sources` populated so the existing
 * true-deletion burn (text-rewrite.ts → exportEditedPdf → verifyRedactionRemoval)
 * removes them from the content stream — not just covers them.
 */
function PatternRedact({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, editorDispatch, editorState } = ctx;
  type KM = import("@/lib/pdf/detect-pii").KeywordMatch;
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [matches, setMatches] = useState<KM[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const existingKeys = useMemo(() => {
    const s = new Set<string>();
    for (const a of editorState?.doc?.annotations ?? []) {
      if (a.kind !== "redact") continue;
      s.add(`${a.page}|${Math.round(a.x)}|${Math.round(a.y)}|${Math.round(a.w)}|${Math.round(a.h)}`);
    }
    return s;
  }, [editorState?.doc?.annotations]);

  const runFind = useCallback(async (overrideTerm?: string) => {
    const q = (overrideTerm ?? query).trim();
    if (!file || !q) return;
    if (overrideTerm !== undefined) setQuery(overrideTerm);
    setBusy(true);
    setError(null);
    setMatches(null);
    setSelected(new Set());
    setProgress("Scanning text layer…");
    try {
      const mod = await importChunk(() => import("@/lib/pdf/detect-pii"));
      // Yield to the main thread between pages so a 50+ page doc doesn't
      // freeze the UI. pdf.js text extraction itself is already async.
      const found = await mod.findKeywordInPdf(
        file,
        q,
        {
          matchCase,
          wholeWord: regex ? false : wholeWord,
          regex,
          scope: "word",
          onProgress: (p) =>
            setProgress(`${p.stage === "ocr" ? "OCR" : "Reading"} page ${p.page}/${p.totalPages}`),
        },
      );
      setMatches(found);
      setSelected(new Set(found.map((m) => m.id)));
      if (found.length === 0) {
        toast.info("No matches found");
      } else {
        toast.success(`${found.length} match${found.length === 1 ? "" : "es"} across the document`);
      }
    } catch (err) {
      console.error("[pattern-redact] scan failed", err);
      setError((err as Error).message);
      toast.error("Pattern scan failed", { description: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress("");
    }
  }, [file, query, matchCase, wholeWord, regex]);

  // Agent hand-off: the assistant's "Redact all matches" button dispatches
  // `agent:redact-pattern` with a term. Pre-fill the field AND auto-run the
  // scan so the user lands here with review-ready boxes, not an empty form.
  useEffect(() => {
    const onPattern = (e: Event) => {
      const ce = e as CustomEvent<{ term?: string }>;
      const term = ce.detail?.term?.trim();
      if (!term) return;
      void runFind(term);
    };
    window.addEventListener("agent:redact-pattern", onPattern as EventListener);
    return () => window.removeEventListener("agent:redact-pattern", onPattern as EventListener);
  }, [runFind]);

  const stageSelected = useCallback(() => {
    if (!matches || selected.size === 0) return;
    let added = 0;
    let skipped = 0;
    for (const m of matches) {
      if (!selected.has(m.id)) continue;
      const rect = m.pdfRect ?? { x: m.x / 1.5, y: m.y / 1.5, w: m.w / 1.5, h: m.h / 1.5 };
      const key = `${m.page - 1}|${Math.round(rect.x)}|${Math.round(rect.y)}|${Math.round(rect.w)}|${Math.round(rect.h)}`;
      if (existingKeys.has(key)) { skipped++; continue; }
      editorDispatch({
        type: "ADD_ANNO",
        a: {
          id: `pat-${m.id}-${Date.now().toString(36)}`,
          kind: "redact",
          page: m.page - 1,
          x: rect.x, y: rect.y, w: rect.w, h: rect.h,
          color: { r: 0, g: 0, b: 0 },
          opacity: 1,
          category: "pattern",
          sources: m.source?.originalString
            ? [{
                originalString: m.source.originalString,
                redactText: m.source.redactText,
                matchStart: m.source.matchStart,
                matchLength: m.source.matchLength,
                transform: m.source.transform,
                fontName: m.source.fontName,
                bounds: m.source.bounds,
              }]
            : undefined,
        },
      });
      added++;
    }
    if (added > 0) {
      toast.success(`${added} redaction box${added === 1 ? "" : "es"} staged`, {
        description: 'Click "Redact, export & verify" below to permanently burn them.',
      });
      setSelected(new Set());
    } else if (skipped > 0) {
      toast.info("Already staged", { description: `${skipped} of these matches are already marked.` });
    }
  }, [matches, selected, editorDispatch, existingKeys]);

  const allSelected = !!matches && matches.length > 0 && selected.size === matches.length;
  const groupedByPage = useMemo(() => {
    if (!matches) return null;
    const m = new Map<number, KM[]>();
    for (const r of matches) {
      const arr = m.get(r.page) ?? [];
      arr.push(r);
      m.set(r.page, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [matches]);
  const withoutSource = matches?.filter((m) => !m.source).length ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">Find every match</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-vault">Pro · On-device</span>
      </div>
      <p className="text-[10.5px] leading-snug text-text-muted">
        Enter a term, phrase, or regex. We find every occurrence across all pages,
        you review and confirm, then the existing burn removes them from the content stream.
      </p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) void runFind(); }}
        placeholder={regex ? "e.g. \\b\\d{3}-\\d{2}-\\d{4}\\b" : 'e.g. "Acme, Inc."'}
        spellCheck={false}
        className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:border-vault/50 focus:outline-none"
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-2">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} className="h-3 w-3 accent-vault" />
          Match case
        </label>
        <label className={cn("inline-flex items-center gap-1.5", regex && "opacity-50")}>
          <input type="checkbox" disabled={regex} checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} className="h-3 w-3 accent-vault" />
          Whole word
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} className="h-3 w-3 accent-vault" />
          Regex
        </label>
      </div>
      <button
        type="button"
        onClick={() => void runFind()}
        disabled={!file || !query.trim() || busy}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-vault/40 bg-vault/10 px-2.5 py-1.5 text-[12px] font-medium text-vault hover:bg-vault/15",
          (!file || !query.trim() || busy) && "cursor-not-allowed opacity-60",
        )}
      >
        <Shield className="h-3.5 w-3.5" strokeWidth={2.5} />
        {busy ? progress || "Scanning…" : matches ? "Search again" : "Find all matches"}
      </button>
      {error && (
        <p className="text-[10.5px] text-destructive">{error}</p>
      )}

      {matches && matches.length > 0 && (
        <div className="rounded-md border border-border bg-surface-2/60">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-text-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(matches.map((m) => m.id)) : new Set())
                }
                className="h-3 w-3 accent-vault"
              />
              {selected.size} / {matches.length} selected
            </label>
            <button
              type="button"
              onClick={stageSelected}
              disabled={selected.size === 0}
              className={cn(
                "inline-flex items-center gap-1 rounded-md bg-vault px-2 py-1 text-[11px] font-medium text-vault-foreground hover:opacity-90",
                selected.size === 0 && "cursor-not-allowed opacity-50",
              )}
            >
              <Shield className="h-3 w-3" strokeWidth={2.5} />
              Stage as redactions
            </button>
          </div>
          <ul className="max-h-[260px] overflow-y-auto py-1">
            {groupedByPage?.map(([pageNum, list]) => (
              <li key={pageNum}>
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Page {pageNum} · {list.length}
                </div>
                <ul>
                  {list.map((m) => {
                    const checked = selected.has(m.id);
                    return (
                      <li key={m.id} className="flex items-center gap-2 px-2.5 py-1 hover:bg-surface-3/60">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(m.id); else next.delete(m.id);
                            setSelected(next);
                          }}
                          className="h-3 w-3 accent-vault"
                        />
                        <button
                          type="button"
                          onClick={() => editorDispatch({ type: "SET_PAGE", n: Math.max(0, m.page - 1) })}
                          className="flex-1 truncate text-left text-[11.5px] text-foreground hover:text-vault"
                          title={m.snippet}
                        >
                          {m.snippet}
                        </button>
                        {!m.source && (
                          <span className="text-[9.5px] uppercase tracking-wide text-text-muted" title="OCR-derived — cover-only on export">
                            cover
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {withoutSource > 0 && (
            <p className="border-t border-border px-2.5 py-1.5 text-[10.5px] text-text-muted">
              {withoutSource} match{withoutSource === 1 ? "" : "es"} on scanned pages — painted black, no text-layer to remove.
            </p>
          )}
        </div>
      )}
      {matches && matches.length === 0 && !busy && (
        <p className="text-[11px] text-text-muted">No matches across {editorState?.doc?.pages.length ?? 0} page{(editorState?.doc?.pages.length ?? 0) === 1 ? "" : "s"}.</p>
      )}
    </div>
  );
}

/**
 * Persistent post-commit summary shown in place of the (now-empty) findings
 * list. Aggregates counts + pages by category — NEVER stores sensitive text.
 * Consecutive commits (e.g. debounced side-channel sanitize after a
 * page-vector commit) merge into a single running summary until the user
 * clicks "Start new scan".
 */
interface RedactionSummary {
  timestamp: number;
  pageRedactions: { category: string; label: string; count: number; pages: number[] }[];
  sideChannel: { vector: "form-field" | "annotation" | "metadata"; count: number }[];
  sanitize?: {
    documentInfo: number;
    xmpMetadata: number;
    embeddedFiles: number;
    javascript: number;
    acroForm: number;
    acroFormFields: number;
    annotations: number;
    hiddenLayers: number;
    additionalActions: number;
  };
}

function mergeRedactionSummary(
  prev: RedactionSummary | null,
  partial: Partial<RedactionSummary>,
): RedactionSummary {
  const base: RedactionSummary = prev ?? { timestamp: Date.now(), pageRedactions: [], sideChannel: [] };
  const pageMap = new Map<string, { category: string; label: string; count: number; pages: Set<number> }>(
    base.pageRedactions.map((r) => [r.category, { ...r, pages: new Set(r.pages) }]),
  );
  for (const r of partial.pageRedactions ?? []) {
    const cur = pageMap.get(r.category);
    if (cur) {
      cur.count += r.count;
      for (const p of r.pages) cur.pages.add(p);
      if (r.label && !cur.label) cur.label = r.label;
    } else {
      pageMap.set(r.category, { ...r, pages: new Set(r.pages) });
    }
  }
  const sideMap = new Map<string, { vector: "form-field" | "annotation" | "metadata"; count: number }>(
    base.sideChannel.map((s) => [s.vector, { ...s }]),
  );
  for (const s of partial.sideChannel ?? []) {
    const cur = sideMap.get(s.vector);
    if (cur) cur.count += s.count;
    else sideMap.set(s.vector, { ...s });
  }
  let sanitize = base.sanitize;
  if (partial.sanitize) {
    const keys = [
      "documentInfo", "xmpMetadata", "embeddedFiles", "javascript",
      "acroForm", "acroFormFields", "annotations", "hiddenLayers", "additionalActions",
    ] as const;
    const prevS = sanitize;
    sanitize = keys.reduce((acc, k) => {
      acc[k] = (prevS?.[k] ?? 0) + (partial.sanitize?.[k] ?? 0);
      return acc;
    }, {} as NonNullable<RedactionSummary["sanitize"]>);
  }
  return {
    timestamp: partial.timestamp ?? Date.now(),
    pageRedactions: Array.from(pageMap.values()).map((r) => ({
      category: r.category, label: r.label, count: r.count,
      pages: Array.from(r.pages).sort((a, b) => a - b),
    })),
    sideChannel: Array.from(sideMap.values()),
    sanitize,
  };
}

/**
 * AutoDetectSensitive — Pro-only. Runs detect-pii on the open document,
 * lists every finding grouped by category, lets the user select / jump to
 * each, and pushes selected ones as redact annotations into the editor.
 * The actual destructive burn is the existing "Redact, export & verify"
 * action lower in the panel — we only add boxes here, the user always
 * confirms by triggering export.
 */
function AutoDetectSensitive({ ctx }: { ctx: ToolPanelCtx }) {

  const { docId: ctxDocId, file, replaceFile, editorDispatch, editorState } = ctx;
  type Det = import("@/lib/pdf/detect-pii").Detection;
  type Cat = import("@/lib/pdf/detect-pii").PiiCategory;
  const [findings, setFindings] = useState<Det[] | null>(null);
  const [usedOcr, setUsedOcr] = useState(false);
  const [scannedPages, setScannedPages] = useState<number[]>([]);
  const [lowConfOcrPages, setLowConfOcrPages] = useState<number[]>([]);
  const [underDetectedOcrPages, setUnderDetectedOcrPages] = useState<number[]>([]);
  const [totalPagesScanned, setTotalPagesScanned] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // IDs we've already auto-selected this scan. Lets us progressively add
  // newly-arrived high-confidence findings during a running scan WITHOUT
  // clobbering the user's manual toggles — the old code called
  // setSelected(new Set()) on every scanRecord tick while running, which
  // made "Commit staged" impossible mid-scan (selection kept resetting).
  const autoSelectedRef = useRef<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Explicit chip-based list filter. Empty = show every category. Only
  // mutated by chip clicks (see onChip) — never derived from selection,
  // so unchecking an item never hides its category.
  const [chipFilter, setChipFilter] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<string>("all");
  const [meta, setMeta] = useState<typeof import("@/lib/pdf/detect-pii").CATEGORY_META | null>(null);
  const [capability, setCapability] = useState<DeviceCapability | null>(null);
  const [activeScanMode, setActiveScanMode] = useState<"quick" | "full" | null>(null);
  // Persistent post-commit summary. Survives Export, findings-list reset,
  // and file replaceFile from the sanitize path. Only cleared explicitly by
  // "Start new scan" or when the document changes (see effect below).
  const [lastSummary, setLastSummary] = useState<RedactionSummary | null>(null);
  const mergeSummary = useCallback((partial: Partial<RedactionSummary>) => {
    setLastSummary((prev) => mergeRedactionSummary(prev, partial));
  }, []);
  const pageCount = editorState?.doc?.pages.length ?? 0;
  useEffect(() => {
    let alive = true;
    getDeviceCapability().then((c) => { if (alive) setCapability(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const docId = ctxDocId ?? (file ? `${file.name}:${file.size}` : "");
  const scanRecord = usePiiScanResultsStore((s) => (docId ? s.scans[docId] : undefined));
  const beginScan = usePiiScanResultsStore((s) => s.beginScan);
  const updateScanProgress = usePiiScanResultsStore((s) => s.updateProgress);
  const appendScanFindings = usePiiScanResultsStore((s) => s.appendFindings);
  const completeScan = usePiiScanResultsStore((s) => s.completeScan);
  const failScan = usePiiScanResultsStore((s) => s.failScan);
  const scanning = scanRecord?.status === "queued" || scanRecord?.status === "running";
  const progress = scanRecord?.progress ?? "";

  useEffect(() => {
    if (!docId || !scanRecord) {
      setFindings(null);
      setUsedOcr(false);
      setScannedPages([]);
      setLowConfOcrPages([]);
      setUnderDetectedOcrPages([]);
      setTotalPagesScanned(0);
      setSelected(new Set());
      autoSelectedRef.current = new Set();
      return;
    }
    setFindings(scanRecord.findings);
    setUsedOcr(scanRecord.usedOcr);
    setScannedPages(scanRecord.scannedPages);
    setLowConfOcrPages(scanRecord.lowConfidenceOcrPages);
    setUnderDetectedOcrPages(scanRecord.ocrUnderDetectedPages);
    setTotalPagesScanned(scanRecord.totalPagesScanned);
    // Progressive auto-select: while running OR on completion, add newly-
    // arrived high-confidence findings to the current selection without
    // wiping user toggles. Tracking auto-selected IDs in a ref means an
    // item the user manually unchecks stays unchecked on subsequent ticks.
    if (
      (scanRecord.status === "running" ||
        scanRecord.status === "queued" ||
        scanRecord.status === "completed") &&
      scanRecord.findings
    ) {
      const highConf = scanRecord.findings.filter((d) => d.confidence !== "low");
      setSelected((prev) => {
        const next = new Set(prev);
        for (const d of highConf) {
          if (!autoSelectedRef.current.has(d.id)) {
            next.add(d.id);
            autoSelectedRef.current.add(d.id);
          }
        }
        return next;
      });
    }
  }, [docId, scanRecord]);

  // Agent hand-off: the assistant panel can seed us with findings it
  // already scanned so the user isn't paying for a second detect pass.
  // We only hydrate state — never trigger the destructive burn.
  useEffect(() => {
    const onSeed = async (e: Event) => {
      const ce = e as CustomEvent<{ findings: Det[]; autoSelect?: boolean }>;
      const payload = ce.detail;
      if (!payload || !Array.isArray(payload.findings)) return;
      try {
        const mod = await importChunk(() => import("@/lib/pdf/detect-pii"));
        setMeta(mod.CATEGORY_META);
      } catch { /* ignore */ }
      setFindings(payload.findings);
      if (payload.autoSelect) {
        setSelected(new Set(payload.findings.map((d) => d.id)));
      }
    };
    window.addEventListener("agent:redact-seed", onSeed as EventListener);
    return () => window.removeEventListener("agent:redact-seed", onSeed as EventListener);
  }, []);

  // Skip duplicates against existing redact annotations to avoid re-adding
  // the same box on a second scan.
  const existingRedactKeys = useMemo(() => {
    const set = new Set<string>();
    for (const a of editorState?.doc?.annotations ?? []) {
      if (a.kind !== "redact") continue;
      set.add(`${a.page}|${Math.round(a.x)}|${Math.round(a.y)}|${Math.round(a.w)}|${Math.round(a.h)}`);
    }
    return set;
  }, [editorState?.doc?.annotations]);

  const runScan = useCallback(async (mode: "quick" | "full" = "full") => {
    if (!file || !docId) return;
    const ownerFile = file;
    const ownerDocId = docId;
    setActiveScanMode(mode);
    setFindings(null);
    setUsedOcr(false);
    setScannedPages([]);
    setLowConfOcrPages([]);
    setUnderDetectedOcrPages([]);
    setTotalPagesScanned(0);
    setSelected(new Set());
    autoSelectedRef.current = new Set();
    setLastSummary(null);
    try {
      const mod = await importChunk(() => import("@/lib/pdf/detect-pii"));
      setMeta(mod.CATEGORY_META);
      // The scan pipeline (pdf.js render + Tesseract OCR + Transformers.js NER
      // + regex) runs entirely inside a Web Worker so the main thread stays
      // free to render every OTHER open tab smoothly during a 5000-page scan.
      const { detectPiiInPdfViaWorker, detectPiiInSideChannelsViaWorker } =
        await importChunk(() => import("@/lib/workers/detect-pii-client"));
      const { runAsJob } = await import("@/lib/jobs/registry");
      const streamingDetections: import("@/lib/pdf/detect-pii").Detection[] = [];
      // Live timing: recalibrate estimate every ~500 pages using real per-page
      // ms observed from the current scan so the ETA converges on this device.
      const scanStart = performance.now();
      let lastRecalibPage = 0;
      let currentPass: "regex" | "ner" | "ocr" = "regex";
      const { jobId, promise } = runAsJob(
        { kind: "detect-pii", docId: ownerDocId, docLabel: ownerFile.name },
        async ({ signal, onProgress }) => {
          await Promise.resolve();
          updateScanProgress(ownerDocId, "Reading document text…");
          const result = await detectPiiInPdfViaWorker(
            ownerFile,
            1.5,
            (p) => {
              const total = p.totalPages || 1;
              currentPass = p.pass ?? "regex";
              const step = p.stage === "ocr" ? `OCR ${p.page}/${total}` : `${p.pass ?? "text"} ${p.page}/${total}`;
              onProgress({
                fraction: total ? p.page / total : 0,
                step,
              });
              const found = p.foundSoFar ?? streamingDetections.length;
              // Recalibrate ETA every ~500 pages using observed time.
              let etaSuffix = "";
              if (p.page - lastRecalibPage >= 500 && p.page > 0) {
                lastRecalibPage = p.page;
                const elapsed = performance.now() - scanStart;
                const perPage = elapsed / p.page;
                const remainingMs = perPage * Math.max(0, total - p.page);
                etaSuffix = ` · ETA ${formatEstimate(remainingMs)}`;
              }
              // Narrated phase-by-phase status (plain language).
              const msg =
                p.stage === "ocr"
                  ? `Reading scanned pages with OCR — page ${p.page} of ${total} · ${found} found${etaSuffix}`
                  : p.pass === "ner"
                    ? `Looking for names and organizations — page ${p.page} of ${total} · ${found} recognized${etaSuffix}`
                    : `Checking for SSNs, cards, emails, phone numbers — page ${p.page} of ${total} · ${found} found${etaSuffix}`;
              updateScanProgress(ownerDocId, msg);
            },
            signal,
            (dets) => {
              streamingDetections.push(...dets);
              appendScanFindings(ownerDocId, dets);
            },
            { skipNer: mode === "quick" },
          );
          updateScanProgress(ownerDocId, "Checking form fields, comments, and hidden document info…");
          let sideFindings: import("@/lib/pdf/detect-pii").SideChannelFinding[] = [];
          try {
            sideFindings = (await detectPiiInSideChannelsViaWorker(
              ownerFile,
              signal,
            )) as typeof sideFindings;
            if (sideFindings.length > 0) {
              updateScanProgress(
                ownerDocId,
                `Checking form fields, comments, and hidden document info… (${sideFindings.length} found)`,
              );
            }
          } catch (e) {
            console.warn("[auto-detect] side-channel scan failed", e);
          }
          void currentPass;
          return { ...result, detections: [...result.detections, ...sideFindings] };
        },
      );
      beginScan({ docId: ownerDocId, docLabel: ownerFile.name, jobId });


      const { detections, usedOcr, scannedPages: scanned, totalPages, lowConfidenceOcrPages, ocrUnderDetectedPages } = await promise;
      const merged = detections;
      completeScan(ownerDocId, {
        findings: merged,
        usedOcr,
        scannedPages: scanned,
        lowConfidenceOcrPages,
        ocrUnderDetectedPages: ocrUnderDetectedPages ?? [],
        totalPagesScanned: totalPages,
      });
      // Preserve any mid-scan toggles: only auto-select IDs we haven't
      // already auto-added, so items the user manually unchecked stay
      // unchecked at completion.
      const autoSelect = merged.filter((d) => d.confidence !== "low");
      setSelected((prev) => {
        const next = new Set(prev);
        for (const d of autoSelect) {
          if (!autoSelectedRef.current.has(d.id)) {
            next.add(d.id);
            autoSelectedRef.current.add(d.id);
          }
        }
        return next;
      });
      const hasScanned = scanned.length > 0;
      // OCR "succeeded" on a scanned page when we ran it AND confidence was
      // not flagged low. Only the genuinely-failed pages get the hard
      // "manual redaction required" warning.
      const ocrFailedPages = lowConfidenceOcrPages;
      const ocrSucceededCount = scanned.length - ocrFailedPages.length;
      if (detections.length === 0) {
        if (ocrFailedPages.length > 0) {
          toast.warning("OCR couldn't reliably read this scanned document", {
            description: `Pages ${ocrFailedPages.slice(0, 8).join(", ")}${ocrFailedPages.length > 8 ? "…" : ""}: text was unreadable. Redact manually — don't rely on automatic detection here.`,
            duration: 14000,
          });
        } else if (hasScanned) {
          toast.info("Scanned document — OCR ran, nothing matched", {
            description: `Detection ran on OCR-recognized text from ${ocrSucceededCount} scanned page${ocrSucceededCount === 1 ? "" : "s"}. OCR can miss low-quality or handwritten text — review manually to be sure.`,
            duration: 10000,
          });
        } else {
          toast.info("No patterns matched — review manually", {
            description: "Auto-detect only finds structured patterns. Names and context-dependent secrets still need a manual pass.",
          });
        }
      } else {
        const lowCount = detections.length - autoSelect.length;
        toast.success(`${detections.length} finding${detections.length === 1 ? "" : "s"}`, {
          description: lowCount > 0
            ? `${autoSelect.length} auto-selected · ${lowCount} low-confidence name${lowCount === 1 ? "" : "s"} unchecked — review and opt in.`
            : "Review then click Redact selected.",
        });
        if (ocrFailedPages.length > 0) {
          toast.warning(`OCR failed on ${ocrFailedPages.length} scanned page${ocrFailedPages.length === 1 ? "" : "s"} — redact those manually`, {
            description: `Pages ${ocrFailedPages.slice(0, 8).join(", ")}${ocrFailedPages.length > 8 ? "…" : ""}: text couldn't be read reliably. Don't rely on automatic detection there.`,
            duration: 14000,
          });
        } else if (hasScanned) {
          toast.info(`Scanned document · OCR ran on ${ocrSucceededCount} page${ocrSucceededCount === 1 ? "" : "s"}`, {
            description: "OCR can miss low-quality or handwritten text — give scanned pages a manual review.",
            duration: 10000,
          });
        }
      }

    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      failScan(ownerDocId, err instanceof Error ? err.message : String(err), aborted);
      console.error("[auto-detect] failed", err);
      if (!aborted) toast.error("Scan failed", { description: (err as Error).message });
    }
  }, [file, docId, beginScan, updateScanProgress, appendScanFindings, completeScan, failScan]);

  const jumpToFinding = useCallback(
    (d: Det) => {
      // detect-pii uses 1-based page numbers; editor uses 0-based.
      editorDispatch({ type: "SET_PAGE", n: Math.max(0, d.page - 1) });
    },
    [editorDispatch],
  );

// Map sanitizer phase names to plain, legal-friendly wording for the
// wipe toast. The sanitizer emits internal phase names like "javascript"
// / "acroForm" which read like scary error jargon — translate to what
// the paralegal actually cares about (what's being cleaned from the doc).
function sanitizeStageLabel(stage: string): string {
  switch (stage) {
    case "acroForm":
    case "form-fields":
    case "formFields":
    case "orphan-fields":
      return "form fields";
    case "annotations":
      return "comments and markup";
    case "javascript":
    case "js":
      return "auto-open triggers";
    case "openAction":
    case "additionalActions":
    case "aa":
      return "auto-open triggers";
    case "names":
    case "names-tree":
      return "hidden name entries";
    case "embeddedFiles":
    case "embedded-files":
    case "attachments":
      return "file attachments";
    case "hidden-layers":
      return "hidden layers";
    case "metadata":
    case "xmp":
    case "documentInfo":
      return "document metadata";
    default:
      return "hidden document data";
  }
}


  // Shared sanitize helper used by BOTH the Export commit path (via
  // redactSelected/sideCommit) AND the live-hide-on-check debounced effect
  // below. Extracted so both call sites run the SAME sanitize + reload +
  // findings/selection-cleanup logic — the debounce doesn't duplicate the
  // Export flow's guarantees. Returns the count actually wiped.
  const sideChannelInFlightRef = useRef<Promise<unknown> | null>(null);
  const sideChannelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sanitizeSideChannelDets = useCallback(
    async (dets: Det[], extraAnnos: Anno[] = []): Promise<number> => {
      if (dets.length === 0 || !editorState?.doc?.srcBytes) return 0;
      // Serialize concurrent sanitize passes so a second debounce firing
      // mid-sanitize doesn't race replaceFile with the first.
      const prior = sideChannelInFlightRef.current;
      if (prior) { try { await prior; } catch { /* prior errors surfaced already */ } }
      const tid = "wsx-redact-apply-side";
      const abort = new AbortController();
      toast.loading("Cleaning form fields, comments, and metadata…", {
        id: tid,
        action: { label: "Cancel", onClick: () => abort.abort() },
      });
      const run = (async (): Promise<number> => {
        try {
          const formFieldFindings = dets.filter((d) => d.vector === "form-field");
          // eslint-disable-next-line no-console
          console.info("[redact:form-field] sanitize side-channel dets", {
            count: dets.length,
            formFields: formFieldFindings.map((d) => ({ sourceLabel: d.sourceLabel, fieldName: d.fieldName })),
          });
          const { sanitizeInWorker } = await importChunk(
            () => import("@/lib/workers/sanitize-client"),
          );
          const srcBytes = editorState?.doc?.srcBytes;
          const sourceBytes = srcBytes && srcBytes.byteLength > 0
            ? srcBytes
            : new Uint8Array(await file!.arrayBuffer());
          const sensitiveStrings = Array.from(new Set(
            dets.flatMap((d) => {
              const full = (d.sensitiveText || "").trim();
              const snip = (d.snippet || "").replace(/…$/, "").trim();
              return [full, snip].filter((s) => s.length >= 3);
            }),
          ));
          const targetFieldNames = formFieldFindings
            .map((d) => d.fieldName)
            .filter((n): n is string => typeof n === "string" && n.length > 0);
          const { bytes: cleaned, report, sideLeaks = [] } = await sanitizeInWorker(sourceBytes, {
            signal: abort.signal,
            sideVerifyStrings: sensitiveStrings,
            targetFieldNames,
            onProgress: ({ stage, done, total }) => {
              if (stage === "verify-side-channel") {
                toast.loading(`Verifying hidden-vector wipe… (${done}/${Math.max(1, total)})`, {
                  id: tid, action: { label: "Cancel", onClick: () => abort.abort() },
                });
              } else if (done > 0 && done % 4000 === 0) {
                toast.loading(`Cleaning ${sanitizeStageLabel(stage)}… (checked ${done.toLocaleString()} items)`, {
                  id: tid, action: { label: "Cancel", onClick: () => abort.abort() },
                });
              }
            },
          });
          if (sideLeaks.length > 0) {
            throw new Error(
              `Immediate hidden-vector redaction failed — ${sideLeaks.length} value${sideLeaks.length === 1 ? "" : "s"} still recoverable.`,
            );
          }
          const cleanedSize = cleaned.byteLength;
          const mergedAnnos: Anno[] = [
            ...(editorState?.doc?.annotations ?? []),
            ...extraAnnos,
          ];
          const mergedPages = editorState?.doc?.pages ?? [];
          const mergedOcr = editorState?.doc?.ocrLayer;
          try {
            await saveSidecarNow(file!.name, cleanedSize, {
              fileName: file!.name,
              size: cleanedSize,
              annotations: mergedAnnos,
              pages: mergedPages,
              ocrLayer: mergedOcr,
            });
          } catch (persistErr) {
            console.error("[redact:form-field] sidecar pre-flush failed", persistErr);
            throw new Error(
              "Could not persist staged redactions before wipe — aborting to avoid losing selections.",
            );
          }
          replaceFile(new File([cleaned as BlobPart], file!.name, { type: "application/pdf" }));
          const wipedIds = new Set(dets.map((d) => d.id));
          setFindings((prev) => (prev ? prev.filter((d) => !wipedIds.has(d.id)) : prev));
          setSelected((prev) => {
            const next = new Set(prev);
            for (const d of dets) next.delete(d.id);
            return next;
          });
          // Aggregate into the persistent post-commit summary. Store counts
          // and vector categories only — NEVER sensitiveText or snippet.
          const byVector = new Map<"form-field" | "annotation" | "metadata", number>();
          for (const d of dets) {
            const v = d.vector as "form-field" | "annotation" | "metadata";
            byVector.set(v, (byVector.get(v) ?? 0) + 1);
          }
          mergeSummary({
            timestamp: Date.now(),
            sideChannel: Array.from(byVector, ([vector, count]) => ({ vector, count })),
            sanitize: {
              documentInfo: report.documentInfo,
              xmpMetadata: report.xmpMetadata,
              embeddedFiles: report.embeddedFiles,
              javascript: report.javascript,
              acroForm: report.acroForm,
              acroFormFields: report.acroFormFields,
              annotations: report.annotations,
              hiddenLayers: report.hiddenLayers,
              additionalActions: report.additionalActions,
            },
          });
          toast.success(
            `${dets.length} hidden finding${dets.length === 1 ? "" : "s"} wiped`,
            {
              id: tid,
              description:
                "Form fields, annotations and metadata cleared from the document now.",
            },
          );
          return dets.length;
        } catch (e) {
          const aborted = e instanceof DOMException && e.name === "AbortError";
          if (aborted) {
            toast.info("Wipe cancelled", { id: tid, description: "Document is unchanged." });
          } else {
            toast.error("Failed to wipe hidden findings", {
              id: tid,
              description: e instanceof Error ? e.message : String(e),
            });
          }
          return 0;
        }
      })();
      sideChannelInFlightRef.current = run;
      try {
        return await run;
      } finally {
        if (sideChannelInFlightRef.current === run) sideChannelInFlightRef.current = null;
      }
    },
    [editorState, file, replaceFile, mergeSummary],
  );

  // Flush any pending debounced sanitize before Export runs its own commit.
  // Cancels a not-yet-fired timer AND awaits an in-flight sanitize so
  // Export doesn't race replaceFile with a mid-flight worker call.
  const flushPendingSideChannel = useCallback(async () => {
    if (sideChannelTimerRef.current) {
      clearTimeout(sideChannelTimerRef.current);
      sideChannelTimerRef.current = null;
    }
    const inflight = sideChannelInFlightRef.current;
    if (inflight) { try { await inflight; } catch { /* already surfaced */ } }
  }, []);

  const redactSelected = useCallback(async () => {
    if (!findings || selected.size === 0) return;
    let added = 0;
    let skipped = 0;
    const sideChannelDets: Det[] = [];
    const toAdd: Anno[] = [];
    for (const d of findings) {
      if (!selected.has(d.id)) continue;
      // Side-channel findings (form fields, annotations, metadata) have no
      // page rect. They used to be queued for the export pipeline, which
      // failed silently (form-field/annotation content was leaking around
      // flatten/PDF-A). Now we APPLY the removal IMMEDIATELY: sanitize the
      // live bytes and re-LOAD the editor doc so the values are gone right
      // here in the workspace, not deferred.
      if (d.vector && d.vector !== "page") {
        sideChannelDets.push(d);
        continue;
      }
      const rect =
        d.pdfRect ?? { x: d.x / 1.5, y: d.y / 1.5, w: d.w / 1.5, h: d.h / 1.5 };
      const key = `${d.page - 1}|${Math.round(rect.x)}|${Math.round(rect.y)}|${Math.round(rect.w)}|${Math.round(rect.h)}`;
      if (existingRedactKeys.has(key)) {
        skipped++;
        continue;
      }
      toAdd.push({
        id: `redact-det-${d.id}`,
        kind: "redact",
        page: d.page - 1,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        color: { r: 0, g: 0, b: 0 },
        opacity: 1,
        category: d.category,
        sources: d.source?.originalString
          ? [
              {
                originalString: d.source.originalString,
                redactText: d.source.redactText,
                matchStart: d.source.matchStart,
                matchLength: d.source.matchLength,
                transform: d.source.transform,
                fontName: d.source.fontName,
                bounds: d.source.bounds,
              },
            ]
          : undefined,
      });
      added++;
    }
    if (toAdd.length > 0) {
      if (toAdd.length > 2000) {
        toast.message(`Queuing ${toAdd.length.toLocaleString()} redactions…`);
      }
      startTransition(() => {
        editorDispatch({ type: "ADD_ANNOS", list: toAdd });
      });
    }

    // MEMORY: side-channel sanitize is NOT run at scan/commit time anymore.
    // It runs exactly once at export inside enforceRedactionGate (chunked,
    // worker-based, non-blocking). Running it here too caused a second full
    // PDFDocument.load per session — the extra graph fragmented the heap and
    // produced OOM on the next large export. Correctness is preserved: the
    // gate is the single chokepoint and side-channel dets stay staged in the
    // findings list until the export gate wipes them.
    await flushPendingSideChannel();
    const sideChannelApplied = 0;
    void sideChannelDets;

    if (added > 0) {
      // Build page-vector summary from toAdd (counts + pages only, no
      // sensitive values). Group by category; pages stored as 1-indexed.
      const pageMap = new Map<string, { category: string; label: string; count: number; pages: Set<number> }>();
      for (const a of toAdd) {
        const cat = String((a as { category?: string }).category ?? "other");
        const label = meta?.[cat as Cat]?.label ?? cat;
        const cur = pageMap.get(cat);
        if (cur) { cur.count++; cur.pages.add(a.page + 1); }
        else pageMap.set(cat, { category: cat, label, count: 1, pages: new Set([a.page + 1]) });
      }
      mergeSummary({
        timestamp: Date.now(),
        pageRedactions: Array.from(pageMap.values()).map((r) => ({
          category: r.category, label: r.label, count: r.count,
          pages: Array.from(r.pages).sort((a, b) => a - b),
        })),
      });
      toast.success(`${added.toLocaleString()} redaction box${added === 1 ? "" : "es"} added`, {
        description:
          'Click "Redact, export & verify" below to burn page text into the PDF.',
      });
      setFindings(null);
      setSelected(new Set());
      setExpandedGroups(new Set());
    } else if (sideChannelApplied === 0 && skipped > 0) {
      toast.info("Already added", { description: `${skipped} of these are already marked.` });
    }
  }, [findings, selected, editorDispatch, existingRedactKeys, flushPendingSideChannel, meta, mergeSummary]);


  const pageRedactableFindings = useMemo(
    () => findings?.filter((d) => d.category !== "privilegeContext" && (!d.vector || d.vector === "page")) ?? [],
    [findings],
  );
  const sideChannelFindings = useMemo(
    () => findings?.filter((d) => d.vector && d.vector !== "page") ?? [],
    [findings],
  );
  const redactableFindings = useMemo(
    () => [...pageRedactableFindings, ...sideChannelFindings],
    [pageRedactableFindings, sideChannelFindings],
  );
  const privilegeFindings = useMemo(
    () => findings?.filter((d) => d.category === "privilegeContext" && (!d.vector || d.vector === "page")) ?? [],
    [findings],
  );

  // MEMORY: live-hide-on-check debounce removed. The old debounce ran a
  // full sanitize (PDFDocument.load + save + reload) every 450ms as the
  // user checked boxes, leaking a full-document graph into the heap per
  // pass. Side-channel wipe now runs exactly once inside the export gate.
  // Correctness unchanged; the export gate is the single chokepoint.

  // Publish current staging state to the module-level bridge so RedactPanel's
  // unified ledger can show a "Staged from AI scan" row + one-click commit.
  // On unmount we reset to zero so the row disappears when the panel closes.
  useEffect(() => {
    const sideStaged = sideChannelFindings.reduce(
      (n, d) => n + (selected.has(d.id) ? 1 : 0),
      0,
    );
    publishStagedRedact({
      selected: selected.size,
      total: redactableFindings.length,
      sideStaged,
      commit: redactableFindings.length > 0 ? redactSelected : null,
      sideCommit: sideStaged > 0 ? redactSelected : null,
      flushSide: flushPendingSideChannel,
    });
  }, [selected, redactableFindings, sideChannelFindings, redactSelected, flushPendingSideChannel]);
  useEffect(() => {
    return () => {
      publishStagedRedact({ selected: 0, total: 0, sideStaged: 0, commit: null, sideCommit: null, flushSide: null });
    };
  }, []);

  // STAGE 5 — reversible LIVE staging.
  // Every AI-detect annotation is stamped `redact-det-<detId>`. Checking an
  // item in the list stages it in the ledger immediately; unchecking removes
  // it. No separate commit step — the final destructive burn only happens
  // when the user clicks "Redact & verify".
  //
  // BATCHED: uses ADD_ANNOS / DELETE_ANNOS in a single dispatch each so a
  // 13k-item "select all" doesn't dispatch 13k times. Per-item dispatch was
  // the source of the "Page Unresponsive" freeze on large scans.
  useEffect(() => {
    if (!findings || findings.length === 0) return;
    const annos = editorState?.doc?.annotations ?? [];
    const stagedDetIds = new Set<string>();
    for (const a of annos) {
      if (a.kind !== "redact") continue;
      if (!a.id.startsWith("redact-det-")) continue;
      stagedDetIds.add(a.id.slice("redact-det-".length));
    }
    // Batch removals (unchecked items).
    const toRemove: string[] = [];
    for (const detId of stagedDetIds) {
      if (!selected.has(detId)) toRemove.push(`redact-det-${detId}`);
    }
    // Batch adds (newly checked page-vector items).
    const byId = new Map(findings.map((d) => [d.id, d]));
    const toAdd: Anno[] = [];
    for (const detId of selected) {
      if (stagedDetIds.has(detId)) continue;
      const d = byId.get(detId);
      if (!d) continue;
      if (d.vector && d.vector !== "page") continue;
      const rect =
        d.pdfRect ?? { x: d.x / 1.5, y: d.y / 1.5, w: d.w / 1.5, h: d.h / 1.5 };
      toAdd.push({
        id: `redact-det-${d.id}`,
        kind: "redact",
        page: d.page - 1,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        color: { r: 0, g: 0, b: 0 },
        opacity: 1,
        category: d.category,
        sources: d.source?.originalString
          ? [{
              originalString: d.source.originalString,
              redactText: d.source.redactText,
              matchStart: d.source.matchStart,
              matchLength: d.source.matchLength,
              transform: d.source.transform,
              fontName: d.source.fontName,
              bounds: d.source.bounds,
            }]
          : undefined,
      } as Anno);
    }
    if (toRemove.length > 0) editorDispatch({ type: "DELETE_ANNOS", ids: toRemove });
    if (toAdd.length > 0) editorDispatch({ type: "ADD_ANNOS", list: toAdd });
  }, [selected, findings, editorState?.doc?.annotations, editorDispatch]);

  // Bridge events from the "Staged for redaction" panel so unstaging a single
  // AI item or Clear-all from there also purges the selection set here — else
  // the live-stage effect would immediately re-add them.
  useEffect(() => {
    const onUnstage = (e: Event) => {
      const detId = (e as CustomEvent<{ detId: string }>).detail?.detId;
      if (!detId) return;
      setSelected((prev) => {
        if (!prev.has(detId)) return prev;
        const next = new Set(prev);
        next.delete(detId);
        return next;
      });
    };
    const onClear = () => {
      setSelected(new Set());
      autoSelectedRef.current = new Set();
    };
    window.addEventListener("redact:unstage-det", onUnstage as EventListener);
    window.addEventListener("redact:clear-selection", onClear);
    return () => {
      window.removeEventListener("redact:unstage-det", onUnstage as EventListener);
      window.removeEventListener("redact:clear-selection", onClear);
    };
  }, []);


  const grouped = useMemo(() => {
    if (!pageRedactableFindings.length) return null;
    // Category → snippet-key → detections. Collapsing identical matched-text
    // rows into ONE group keeps the list navigable on large scans (a caption
    // that appears on 5000 pages becomes one row, not 5000). All underlying
    // Detection objects remain in the group so selecting it selects every
    // occurrence for redaction — only the DISPLAY collapses.
    const byCat = new Map<Cat, Map<string, Det[]>>();
    for (const d of pageRedactableFindings) {
      const catMap = byCat.get(d.category) ?? new Map<string, Det[]>();
      const key = (d.snippet ?? "").trim() || `∅::${d.id}`;
      const arr = catMap.get(key) ?? [];
      arr.push(d);
      catMap.set(key, arr);
      byCat.set(d.category, catMap);
    }
    const out: Array<[Cat, Array<{ key: string; text: string; dets: Det[] }>]> = [];
    for (const [cat, catMap] of byCat) {
      const groups = Array.from(catMap.entries())
        .map(([key, dets]) => ({ key, text: dets[0].snippet ?? "", dets }))
        .sort((a, b) => b.dets.length - a.dets.length);
      out.push([cat, groups]);
    }
    // Categories with more total detections first.
    out.sort((a, b) => {
      const sa = a[1].reduce((s, g) => s + g.dets.length, 0);
      const sb = b[1].reduce((s, g) => s + g.dets.length, 0);
      return sb - sa;
    });
    return out;
  }, [pageRedactableFindings]);

  const sideChannelGrouped = useMemo(() => {
    if (!sideChannelFindings.length) return null;
    const m = new Map<string, Det[]>();
    for (const d of sideChannelFindings) {
      const key = d.vector ?? "page";
      const arr = m.get(key) ?? [];
      arr.push(d);
      m.set(key, arr);
    }
    const order = ["form-field", "annotation", "metadata"];
    return Array.from(m.entries()).sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
    );
  }, [sideChannelFindings]);

  // Precompute selection counts per group ONCE per (grouped, selected) change.
  // Without this every checkbox toggle would re-run g.dets.reduce for every
  // group in the tree — O(N*K) per render — which is the source of the lag
  // when a 5000-page doc produces thousands of groups.
  const selectionByGroup = useMemo(() => {
    const map = new Map<string, number>();
    if (!grouped) return map;
    for (const [cat, groups] of grouped) {
      for (const g of groups) {
        const key = `${cat}::${g.key}`;
        let n = 0;
        for (const d of g.dets) if (selected.has(d.id)) n++;
        map.set(key, n);
      }
    }
    return map;
  }, [grouped, selected]);

  const allSelected =
    redactableFindings.length > 0 && selected.size === redactableFindings.length;

  // Per-category id sets (split high-confidence vs low-confidence). Used for
  // the master-checkbox toggles and the "Review to include" subsections. One
  // pass over findings; category-level toggles are O(1) after this.
  type Cat2 = Cat | "form-field" | "annotation" | "metadata";
  const categoryIds = useMemo(() => {
    const hi = new Map<Cat2, string[]>();
    const lo = new Map<Cat2, string[]>();
    if (!findings) return { hi, lo };
    for (const d of findings) {
      if (d.category === "privilegeContext") continue;
      const key: Cat2 =
        d.vector && d.vector !== "page" ? (d.vector as Cat2) : (d.category as Cat2);
      const bucket = d.confidence === "low" ? lo : hi;
      const arr = bucket.get(key) ?? [];
      arr.push(d.id);
      bucket.set(key, arr);
    }
    return { hi, lo };
  }, [findings]);

  // Scan summary — one at-a-glance line "what's in this document".
  const scanSummary = useMemo(() => {
    if (!findings) return null;
    const count = (cat: Cat2) => (categoryIds.hi.get(cat)?.length ?? 0) + (categoryIds.lo.get(cat)?.length ?? 0);
    // Distinct-value count for names & orgs uses the collapsed `grouped` shape.
    const distinctFor = (cat: Cat) => {
      const row = grouped?.find(([c]) => c === cat);
      return row ? row[1].length : 0;
    };
    const nameOrgTotal = count("name") + count("org");
    const nameOrgDistinct = distinctFor("name") + distinctFor("org");
    const parts: string[] = [];
    const push = (n: number, singular: string, plural?: string) => {
      if (n > 0) parts.push(`${n.toLocaleString()} ${n === 1 ? singular : plural ?? singular + "s"}`);
    };
    push(count("ssn"), "SSN");
    push(count("creditCard"), "credit card");
    push(count("email"), "email");
    push(count("phone"), "phone number");
    push(count("iban"), "IBAN");
    push(count("date"), "date");
    if (nameOrgTotal > 0) {
      parts.push(
        `${nameOrgTotal.toLocaleString()} name${nameOrgTotal === 1 ? "" : "s"} & organization${nameOrgTotal === 1 ? "" : "s"}${nameOrgDistinct > 0 ? ` (${nameOrgDistinct.toLocaleString()} distinct)` : ""}`,
      );
    }
    push(count("form-field"), "form field");
    push(count("annotation"), "comment/annotation");
    if (count("metadata") > 0) parts.push("metadata");
    return { parts, total: findings.length };
  }, [findings, categoryIds, grouped]);

  // Category tabs — quick filter so users can zero in on e.g. Form fields.
  type TabEntry = { key: string; label: string; count: number };
  const tabList = useMemo<TabEntry[]>(() => {
    const tabs: TabEntry[] = [];
    if (grouped) {
      for (const [cat, groups] of grouped) {
        const total = groups.reduce((n, g) => n + g.dets.length, 0);
        const loCount = categoryIds.lo.get(cat as Cat2)?.length ?? 0;
        tabs.push({
          key: String(cat),
          label: meta?.[cat]?.label ?? String(cat),
          count: total + loCount,
        });
      }
    }
    if (sideChannelGrouped) {
      for (const [vector, list] of sideChannelGrouped) {
        tabs.push({
          key: vector,
          label:
            vector === "form-field"
              ? "Form fields"
              : vector === "annotation"
              ? "Comments"
              : "Metadata",
          count: list.length,
        });
      }
    }
    return tabs;
  }, [grouped, sideChannelGrouped, categoryIds, meta]);

  // Reset tab if it no longer exists after a re-scan.
  useEffect(() => {
    if (activeTab === "all") return;
    if (!tabList.some((t) => t.key === activeTab)) setActiveTab("all");
  }, [tabList, activeTab]);

  // Category chips are additive: any category whose findings are fully
  // staged is considered "active" and filters the list. Zero active
  // categories → show everything (nothing staged yet, browse freely).
  const activeChipKeys = useMemo(() => {
    const active = new Set<string>();
    for (const t of tabList) {
      const hi = categoryIds.hi.get(t.key as Cat2) ?? [];
      const lo = categoryIds.lo.get(t.key as Cat2) ?? [];
      const ids = [...hi, ...lo];
      if (ids.length === 0) continue;
      let allSelected = true;
      for (const id of ids) if (!selected.has(id)) { allSelected = false; break; }
      if (allSelected) active.add(t.key);
    }
    return active;
  }, [tabList, categoryIds, selected]);

  const showPageCat = (cat: string) => chipFilter.size === 0 || chipFilter.has(cat);
  const showSideVector = (v: string) => chipFilter.size === 0 || chipFilter.has(v);





  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">
          AI detect sensitive info
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-vault">
          Pro · On-device
        </span>
      </div>
      <p className="text-[10.5px] leading-snug text-text-muted">
        Scans for SSNs, emails, phones, dates, cards/accounts, person names and
        organizations (on-device NER). Privilege/confidentiality context words
        are flagged as <em>review signals</em>; any value found nearby
        (e.g. a dollar amount next to "settlement") is surfaced as a
        suggested redaction you can accept with one click. Nothing leaves
        your device. You confirm each finding before redacting.
      </p>


      {scanning ? (
        <div className="rounded-md border border-vault/40 bg-vault/10 px-2.5 py-2 text-[11.5px] text-vault">
          <div className="flex items-center gap-1.5 font-medium">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" strokeWidth={2.5} />
            {progress || "Scanning…"}
          </div>
          {capability && activeScanMode === "full" && capability.tier !== "fast" && (
            <p className="mt-1.5 text-[10.5px] leading-snug text-text-2">
              The names/organizations step runs slower on your device because
              GPU acceleration isn't available in this browser. Everything
              still stays fully private and on-device — nothing is sent to a
              server.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {capability && pageCount > 0 && (
            <p className="text-[10.5px] text-text-muted">
              This document has {pageCount.toLocaleString()} page{pageCount === 1 ? "" : "s"}.
              {" "}Estimated on your device
              {capability.tier !== "fast" ? ` (${tierLabel(capability.tier).toLowerCase()})` : ""}:
              {" "}Quick {formatEstimate(estimateScan(capability, pageCount, "quick"))}
              {" · "}Full {formatEstimate(estimateScan(capability, pageCount, "full"))}.
            </p>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => void runScan("quick")}
              disabled={!file}
              className={cn(
                "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11.5px] font-medium text-text-1 transition-colors hover:bg-surface-2/70",
                !file && "cursor-not-allowed opacity-60",
              )}
              title="Structured data + hidden document info only. Fast."
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
              Quick scan
            </button>
            <button
              type="button"
              onClick={() => void runScan("full")}
              disabled={!file}
              className={cn(
                "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-vault/40 bg-vault/10 px-2 py-1.5 text-[11.5px] font-medium text-vault transition-colors hover:bg-vault/15",
                !file && "cursor-not-allowed opacity-60",
              )}
              title="Also finds unmarked names and organizations. Slower."
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
              Full scan
            </button>
          </div>
          <p className="text-[10px] leading-snug text-text-muted">
            <strong className="text-text-2">Quick</strong> finds SSNs, cards, emails, phones, form fields, and hidden metadata.
            {" "}
            <strong className="text-text-2">Full</strong> adds on-device name/organization recognition.
            {" "}You can keep working while it runs.
          </p>
        </div>
      )}

      {findings && (
        <div className="mt-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          <div className="font-semibold mb-0.5">⚠ Suggestions only — never reported as complete</div>
          Automatic detection can miss names; review the full document and mark
          anything it didn't catch. Structured data (SSNs, accounts, cards,
          emails, phones, IBANs) is found reliably; names in prose, party
          names, addresses, and context-dependent secrets often aren't. There
          is no "all clear" — confirm completeness yourself.
        </div>
      )}

      {/* Scan-summary card — at-a-glance "what's in this document". */}
      {scanSummary && !scanning && (
        <div className="mt-1 rounded-md border border-vault/30 bg-vault/[0.06] px-2.5 py-2 text-[11.5px] leading-relaxed text-text-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-vault mb-1">
            Scan summary
          </div>
          {scanSummary.parts.length === 0 ? (
            <div className="text-text-2">
              Reviewed {totalPagesScanned.toLocaleString()} page{totalPagesScanned === 1 ? "" : "s"}. No built-in patterns matched — still review names and prose secrets manually.
            </div>
          ) : (
            <div>
              Reviewed <strong className="text-foreground">{totalPagesScanned.toLocaleString()} page{totalPagesScanned === 1 ? "" : "s"}</strong>. Found:{" "}
              {scanSummary.parts.map((p, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-text-muted"> · </span>}
                  <span className="text-foreground">{p}</span>
                </span>
              ))}
              .
            </div>
          )}
        </div>
      )}



      {findings && findings.length > 0 && (
        <div className="mt-1 rounded-md border border-border bg-surface-2/60">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-text-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => {
                  // Wrap in startTransition so the checkbox flips instantly
                  // and the (potentially huge) tree re-renders in the
                  // background — otherwise select-all on 100k findings
                  // freezes the panel until React finishes.
                  const checked = e.target.checked;
                  startTransition(() => {
                    if (checked) {
                      setSelected(new Set(redactableFindings.map((d) => d.id)));
                    } else {
                      setSelected(new Set());
                    }
                  });
                }}
                className="h-3 w-3 accent-vault"
              />
              {selected.size} / {redactableFindings.length} selected
            </label>
            <span className="text-[10px] text-text-muted">
              {selected.size > 0
                ? `${selected.size.toLocaleString()} staged — commit below`
                : "Tick a category or item to stage"}
            </span>
          </div>
          {tabList.length > 1 && (() => {
            // Chip click = toggle that category's findings in the current
            // selection (additive multi-select). Click SSN + Phone to stage
            // both together, then Redact once. Clicking "All" selects every
            // finding; clicking it again clears everything. The list view
            // switches to "all" whenever more than one category is staged
            // so the user can see everything they've picked.
            const idsForChip = (key: string): string[] => {
              if (key === "all") return redactableFindings.map((d) => d.id);
              const hi = categoryIds.hi.get(key as Cat2) ?? [];
              const lo = categoryIds.lo.get(key as Cat2) ?? [];
              return [...hi, ...lo];
            };
            // A chip is "active" when every one of its ids is currently
            // selected — that's what tells the user "this category is
            // fully staged" regardless of which tab is being viewed.
            const chipActive = (key: string): boolean => {
              const ids = idsForChip(key);
              if (ids.length === 0) return false;
              for (const id of ids) if (!selected.has(id)) return false;
              return true;
            };
            const onChip = (key: string) => {
              const ids = idsForChip(key);
              const active = chipActive(key);
              startTransition(() => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (active) {
                    for (const id of ids) next.delete(id);
                  } else {
                    for (const id of ids) next.add(id);
                  }
                  return next;
                });
                // List filter is derived from which chips are fully staged
                // (see activeChipKeys) — no activeTab bookkeeping needed.
              });
            };

            const allActive = chipActive("all");
            return (
              <div className="flex items-start gap-1.5 border-b border-border/60 px-2 py-1.5">
                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => onChip("all")}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      allActive
                        ? "bg-vault text-white"
                        : "bg-surface-3 text-text-2 hover:text-foreground"
                    }`}
                    title="Stage every finding across all categories (click again to clear)"
                  >
                    All · {redactableFindings.length.toLocaleString()}
                  </button>
                  {tabList.map((t) => {
                    const active = chipActive(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => onChip(t.key)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                          active
                            ? "bg-vault text-white"
                            : "bg-surface-3 text-text-2 hover:text-foreground"
                        }`}
                        title={`Add all ${t.label} findings to selection (click again to remove)`}
                      >
                        {t.label} · {t.count.toLocaleString()}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <ul className="max-h-[280px] overflow-y-auto py-1">
            {grouped?.filter(([cat]) => showPageCat(String(cat))).map(([cat, allGroups]) => {
              // Split groups into high-conf and low-conf. A group is
              // "low-conf" when *every* detection inside it is low-conf
              // (otherwise it stays with the main list and its low-conf
              // occurrences are simply un-auto-selected). This keeps the
              // group-collapsing behaviour intact while still surfacing
              // "review to include" clearly.
              const hiGroups: typeof allGroups = [];
              const loGroups: typeof allGroups = [];
              for (const g of allGroups) {
                const allLow = g.dets.every((d) => d.confidence === "low");
                (allLow ? loGroups : hiGroups).push(g);
              }
              const catHiIds = categoryIds.hi.get(cat as Cat2) ?? [];
              const catLoIds = categoryIds.lo.get(cat as Cat2) ?? [];
              const catTotal = catHiIds.length + catLoIds.length;
              const catHiSelected = catHiIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0);
              const catAllHiChecked = catHiIds.length > 0 && catHiSelected === catHiIds.length;
              const catSomeHiChecked = catHiSelected > 0 && !catAllHiChecked;
              const distinct = hiGroups.length;
              const toggleCategory = (checked: boolean) => {
                startTransition(() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (checked) for (const id of catHiIds) next.add(id);
                    else for (const id of catHiIds) next.delete(id);
                    return next;
                  });
                });
              };
              return (
                <li key={cat}>
                  <label className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted cursor-pointer hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={catAllHiChecked}
                      ref={(el) => { if (el) el.indeterminate = catSomeHiChecked; }}
                      onChange={(e) => toggleCategory(e.target.checked)}
                      className="h-3 w-3 shrink-0 accent-vault"
                    />
                    <span>
                      {meta?.[cat]?.label ?? cat} · {catTotal.toLocaleString()}
                      {distinct > 0 && distinct !== catHiIds.length && (
                        <span className="ml-1 text-text-2 normal-case tracking-normal">
                          ({distinct.toLocaleString()} distinct)
                        </span>
                      )}
                    </span>
                  </label>
                  <ul>
                    {hiGroups.map((g) => {
                      const groupKey = `${cat}::${g.key}`;
                      const selCount = selectionByGroup.get(`${cat}::${g.key}`) ?? 0;
                      const allChecked = selCount === g.dets.length;
                      const someChecked = selCount > 0 && !allChecked;
                      const isExpanded = expandedGroups.has(groupKey);
                      const first = g.dets[0];
                      const isSingle = g.dets.length === 1;
                      return (
                        <li key={groupKey}>
                          <div className="group flex items-start gap-1.5 px-2.5 py-1 hover:bg-surface-2">
                            <input
                              type="checkbox"
                              checked={allChecked}
                              ref={(el) => { if (el) el.indeterminate = someChecked; }}
                              onChange={(e) => {
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) for (const d of g.dets) next.add(d.id);
                                  else for (const d of g.dets) next.delete(d.id);
                                  return next;
                                });
                              }}
                              className="mt-[3px] h-3 w-3 shrink-0 accent-vault"
                            />
                            <button
                              type="button"
                              onClick={() => jumpToFinding(first)}
                              className="min-w-0 flex-1 text-left"
                              title={isSingle ? "Jump to this finding" : "Jump to first occurrence"}
                            >
                              <div className="font-mono text-[11px] text-foreground truncate">
                                {maskPreview(first)}
                              </div>
                              <div className="text-[10px] text-text-2">
                                {isSingle ? (
                                  <>
                                    Page {first.page}
                                    {!first.source && (
                                      <span className="ml-1 text-amber-400/80">· visual-only (scanned)</span>
                                    )}
                                  </>
                                ) : (
                                  <>{g.dets.length.toLocaleString()} occurrences</>
                                )}
                              </div>
                            </button>
                            {!isSingle && (
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedGroups((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(groupKey)) next.delete(groupKey);
                                    else next.add(groupKey);
                                    return next;
                                  });
                                }}
                                className="mt-[2px] shrink-0 rounded px-1 py-0.5 text-[10px] text-text-2 hover:bg-surface-3 hover:text-foreground"
                                title={isExpanded ? "Collapse pages" : "Show pages"}
                              >
                                {isExpanded ? "Hide" : "Pages"}
                              </button>
                            )}
                          </div>
                          {!isSingle && isExpanded && (() => {
                            const allKey = `${groupKey}::all`;
                            const showAll = expandedGroups.has(allKey);
                            const SAMPLE = 10;
                            // Even "show all" caps at MAX_EXPANDED. Mounting
                            // 5000+ <li>s freezes the panel; users almost never
                            // scroll past the first few hundred and can always
                            // jump to a specific page from the sample.
                            const MAX_EXPANDED = 200;
                            const visible = showAll
                              ? g.dets.slice(0, MAX_EXPANDED)
                              : g.dets.slice(0, SAMPLE);
                            const hidden = g.dets.length - visible.length;
                            const last = g.dets[g.dets.length - 1];
                            return (
                              <ul className="ml-6 border-l border-border/60">
                                {visible.map((d) => {
                                  const checked = selected.has(d.id);
                                  return (
                                    <li key={d.id}>
                                      <div className="group flex items-center gap-1.5 px-2.5 py-0.5 hover:bg-surface-2">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            setSelected((prev) => {
                                              const next = new Set(prev);
                                              if (e.target.checked) next.add(d.id);
                                              else next.delete(d.id);
                                              return next;
                                            });
                                          }}
                                          className="h-3 w-3 shrink-0 accent-vault"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => jumpToFinding(d)}
                                          className="min-w-0 flex-1 text-left text-[10px] text-text-2 hover:text-foreground"
                                        >
                                          Page {d.page}
                                          {!d.source && (
                                            <span className="ml-1 text-amber-400/80">· visual-only</span>
                                          )}
                                        </button>
                                      </div>
                                    </li>
                                  );
                                })}
                                {hidden > 0 && (
                                  <li className="flex items-center gap-2 px-2.5 py-1 text-[10px] text-text-muted">
                                    <span>and {hidden.toLocaleString()} more</span>
                                    <button
                                      type="button"
                                      onClick={() => jumpToFinding(last)}
                                      className="rounded px-1 py-0.5 text-text-2 hover:bg-surface-3 hover:text-foreground"
                                      title="Jump to last occurrence"
                                    >
                                      jump to last
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setExpandedGroups((prev) => {
                                          const next = new Set(prev);
                                          next.add(allKey);
                                          return next;
                                        });
                                      }}
                                      className="rounded px-1 py-0.5 text-text-2 hover:bg-surface-3 hover:text-foreground"
                                    >
                                      show all
                                    </button>
                                  </li>
                                )}
                                {showAll && g.dets.length > SAMPLE && (
                                  <li className="px-2.5 py-1 text-[10px] text-text-muted">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setExpandedGroups((prev) => {
                                          const next = new Set(prev);
                                          next.delete(allKey);
                                          return next;
                                        });
                                      }}
                                      className="rounded px-1 py-0.5 hover:bg-surface-3 hover:text-foreground"
                                    >
                                      show fewer
                                    </button>
                                  </li>
                                )}
                              </ul>
                            );
                          })()}
                        </li>
                      );
                    })}
                  </ul>
                  {loGroups.length > 0 && (() => {
                    const loKey = `${cat}::__low__`;
                    const isOpen = expandedGroups.has(loKey);
                    const loSelected = catLoIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0);
                    const loAllChecked = loSelected === catLoIds.length;
                    const loSomeChecked = loSelected > 0 && !loAllChecked;
                    const toggleLow = (checked: boolean) => {
                      startTransition(() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (checked) for (const id of catLoIds) next.add(id);
                          else for (const id of catLoIds) next.delete(id);
                          return next;
                        });
                      });
                    };
                    return (
                      <div className="mx-2 mb-1 rounded-md border border-amber-500/25 bg-amber-500/[0.06]">
                        <label className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300/90 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={loAllChecked}
                            ref={(el) => { if (el) el.indeterminate = loSomeChecked; }}
                            onChange={(e) => toggleLow(e.target.checked)}
                            className="h-3 w-3 shrink-0 accent-amber-400"
                          />
                          <span className="flex-1">Review to include · {catLoIds.length.toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setExpandedGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(loKey)) next.delete(loKey); else next.add(loKey);
                                return next;
                              });
                            }}
                            className="normal-case tracking-normal text-text-2 hover:text-foreground rounded px-1"
                          >
                            {isOpen ? "hide" : "review"}
                          </button>
                        </label>
                        {!isOpen && (
                          <p className="px-2 pb-1 text-[10px] leading-snug text-text-muted">
                            Low-confidence matches. Unchecked by default — expand to review.
                          </p>
                        )}
                        {isOpen && (
                          <ul className="pb-1">
                            {loGroups.map((g) => {
                              const groupKey = `${cat}::lo::${g.key}`;
                              const selCount = g.dets.reduce((n, d) => n + (selected.has(d.id) ? 1 : 0), 0);
                              const allChecked = selCount === g.dets.length;
                              const someChecked = selCount > 0 && !allChecked;
                              const first = g.dets[0];
                              const isSingle = g.dets.length === 1;
                              return (
                                <li key={groupKey}>
                                  <div className="group flex items-start gap-1.5 px-2 py-0.5 hover:bg-surface-2">
                                    <input
                                      type="checkbox"
                                      checked={allChecked}
                                      ref={(el) => { if (el) el.indeterminate = someChecked; }}
                                      onChange={(e) => {
                                        setSelected((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) for (const d of g.dets) next.add(d.id);
                                          else for (const d of g.dets) next.delete(d.id);
                                          return next;
                                        });
                                      }}
                                      className="mt-[3px] h-3 w-3 shrink-0 accent-amber-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => jumpToFinding(first)}
                                      className="min-w-0 flex-1 text-left"
                                      title={isSingle ? "Jump to this finding" : "Jump to first occurrence"}
                                    >
                                      <div className="font-mono text-[11px] text-foreground truncate">
                                        {maskPreview(first)}
                                      </div>
                                      <div className="text-[10px] text-text-2">
                                        {isSingle ? `Page ${first.page}` : `${g.dets.length.toLocaleString()} occurrences`}
                                      </div>
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>

          {sideChannelGrouped && sideChannelGrouped.length > 0 && (activeTab === "all" || sideChannelGrouped.some(([v]) => v === activeTab)) && (
            <div className="border-t border-border/60">
              <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-vault">
                Hidden in document · {sideChannelFindings.length}
              </div>
              <p className="px-2.5 pb-1.5 text-[10.5px] leading-snug text-text-muted">
                Sensitive data found OUTSIDE the page text — in form fields,
                comments/annotations, and document metadata. Page redaction
                misses these. Check the items below, then click Export to
                wipe them from the document.
              </p>
              <ul className="max-h-[200px] overflow-y-auto pb-1">
                {sideChannelGrouped.filter(([vector]) => showSideVector(vector)).map(([vector, list]) => {
                  const vecIds = list.map((d) => d.id);
                  const vecSelCount = vecIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0);
                  const vecAll = vecIds.length > 0 && vecSelCount === vecIds.length;
                  const vecSome = vecSelCount > 0 && !vecAll;
                  const toggleVec = (checked: boolean) => {
                    startTransition(() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked) for (const id of vecIds) next.add(id);
                        else for (const id of vecIds) next.delete(id);
                        return next;
                      });
                    });
                  };
                  return (
                  <li key={vector}>
                    <label className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted cursor-pointer hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={vecAll}
                        ref={(el) => { if (el) el.indeterminate = vecSome; }}
                        onChange={(e) => toggleVec(e.target.checked)}
                        className="h-3 w-3 shrink-0 accent-vault"
                      />
                      <span>
                        {vector === "form-field"
                          ? "Form fields"
                          : vector === "annotation"
                          ? "Comments / annotations"
                          : "Document metadata"}{" "}
                        · {list.length}
                      </span>
                    </label>
                    <ul>
                      {list.map((d) => {
                        const checked = selected.has(d.id);
                        return (
                          <li key={d.id}>
                            <div className="group flex items-start gap-1.5 px-2.5 py-1 hover:bg-surface-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(d.id);
                                    else next.delete(d.id);
                                    return next;
                                  });
                                }}
                                className="mt-[3px] h-3 w-3 shrink-0 accent-vault"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-[11px] text-foreground">
                                  {maskPreview(d)}
                                </div>
                                <div className="text-[10px] text-text-2">
                                  {d.sourceLabel ?? vector}
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                  );
                })}
              </ul>
            </div>
          )}
          {privilegeFindings.length > 0 && (() => {
            const CTX_KEY = "__privilege_ctx__";
            const CTX_ALL = "__privilege_ctx_all__";
            const isOpen = expandedGroups.has(CTX_KEY);
            const showAll = expandedGroups.has(CTX_ALL);
            const SAMPLE = 10;
            const pageSet = new Set(privilegeFindings.map((d) => d.page));
            const visible = showAll ? privilegeFindings : privilegeFindings.slice(0, SAMPLE);
            const hidden = privilegeFindings.length - visible.length;
            const toggle = (k: string) => setExpandedGroups((prev) => {
              const next = new Set(prev);
              if (next.has(k)) next.delete(k); else next.add(k);
              return next;
            });
            return (
              <div className="border-t border-border/60 px-2.5 py-2">
                <button
                  type="button"
                  onClick={() => toggle(CTX_KEY)}
                  className="flex w-full items-center justify-between gap-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300/90 hover:text-amber-200"
                  title="Not auto-redacted — informational only"
                >
                  <span className="flex items-center gap-1.5">
                    <Info className="h-3 w-3" />
                    Context flags · {privilegeFindings.length.toLocaleString()} on {pageSet.size.toLocaleString()} page{pageSet.size === 1 ? "" : "s"}
                  </span>
                  <span className="normal-case tracking-normal text-text-2">{isOpen ? "hide" : "review"}</span>
                </button>
                {!isOpen && (
                  <p className="mt-1 text-[10px] leading-snug text-text-muted">
                    Not auto-redacted. Review nearby content for privilege before committing.
                  </p>
                )}
                {isOpen && (
                  <ul className="mt-1.5">
                    {visible.map((d) => (
                      <li key={d.id}>
                        <div className="group flex items-start gap-1.5 px-0.5 py-1 hover:bg-surface-2">
                          <Info className="mt-[3px] h-3 w-3 shrink-0 text-amber-300/70" />
                          <button
                            type="button"
                            onClick={() => jumpToFinding(d)}
                            className="min-w-0 flex-1 text-left"
                            title="Jump to this context flag"
                          >
                            <div className="text-[11px] text-foreground">
                              {d.snippet}
                            </div>
                            <div className="text-[10px] text-text-2">
                              Page {d.page}
                              {!d.source && (
                                <span className="ml-1 text-amber-400/80">
                                  · visual-only (scanned)
                                </span>
                              )}
                            </div>
                          </button>
                        </div>
                      </li>
                    ))}
                    {hidden > 0 && (
                      <li className="px-0.5 py-1 text-[10px] text-text-muted">
                        and {hidden.toLocaleString()} more ·{" "}
                        <button
                          type="button"
                          onClick={() => toggle(CTX_ALL)}
                          className="rounded px-1 py-0.5 text-text-2 hover:bg-surface-3 hover:text-foreground"
                        >
                          show all
                        </button>
                      </li>
                    )}
                    {showAll && privilegeFindings.length > SAMPLE && (
                      <li className="px-0.5 py-1 text-[10px] text-text-muted">
                        <button
                          type="button"
                          onClick={() => toggle(CTX_ALL)}
                          className="rounded px-1 py-0.5 hover:bg-surface-3 hover:text-foreground"
                        >
                          show fewer
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {findings && !scanning && lowConfOcrPages.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          <div className="font-semibold mb-0.5">⚠ OCR couldn't reliably read {lowConfOcrPages.length} scanned page{lowConfOcrPages.length === 1 ? "" : "s"}</div>
          Page{lowConfOcrPages.length === 1 ? "" : "s"} {lowConfOcrPages.slice(0, 8).join(", ")}{lowConfOcrPages.length > 8 ? "…" : ""}: text was unreadable.
          <strong> Redact manually on those pages — don't rely on automatic detection.</strong>
        </div>
      )}

      {findings && !scanning && scannedPages.length > 0 && lowConfOcrPages.length < scannedPages.length && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          <div className="font-semibold mb-0.5">Scanned document · OCR ran on {scannedPages.length - lowConfOcrPages.length} page{scannedPages.length - lowConfOcrPages.length === 1 ? "" : "s"}</div>
          Detection ran on OCR-recognized text. OCR can miss low-quality or handwritten text — review scanned pages manually to be sure.
        </div>
      )}

      {findings && !scanning && underDetectedOcrPages.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          <div className="font-semibold mb-0.5">⚠ Possible missed values on scanned page{underDetectedOcrPages.length === 1 ? "" : "s"} {underDetectedOcrPages.slice(0, 8).join(", ")}{underDetectedOcrPages.length > 8 ? "…" : ""}</div>
          The page looks like it contains structured data (numbers, IDs, emails) but automatic detection found few matches. OCR may have misread digits — review manually and draw a box over anything left.
        </div>
      )}

      {findings && findings.length === 0 && !scanning && scannedPages.length === 0 && (
        <p className="text-[11px] text-text-2">
          No built-in patterns matched this document's readable text. This is <strong>not</strong> an
          all-clear — names, party identifiers, and prose-based secrets aren't detected. Review every
          page and add manual redactions as needed.
        </p>
      )}

      {lastSummary && (() => {
        const totalItems =
          lastSummary.pageRedactions.reduce((n, r) => n + r.count, 0) +
          lastSummary.sideChannel.reduce((n, r) => n + r.count, 0);
        const allPages = new Set<number>();
        for (const r of lastSummary.pageRedactions) for (const p of r.pages) allPages.add(p);
        const when = new Date(lastSummary.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const vectorLabel = (v: string) =>
          v === "form-field" ? "form field" : v === "annotation" ? "annotation" : "metadata entry";
        const s = lastSummary.sanitize;
        const sanitizeLines: string[] = [];
        if (s) {
          if (s.documentInfo > 0) sanitizeLines.push(`Document info removed (${s.documentInfo})`);
          if (s.xmpMetadata > 0) sanitizeLines.push("XMP metadata removed");
          if (s.embeddedFiles > 0) sanitizeLines.push(`${s.embeddedFiles} embedded file${s.embeddedFiles === 1 ? "" : "s"} removed`);
          if (s.javascript > 0) sanitizeLines.push(`${s.javascript} JavaScript trigger${s.javascript === 1 ? "" : "s"} removed`);
          if (s.annotations > 0) sanitizeLines.push(`${s.annotations} annotation${s.annotations === 1 ? "" : "s"} removed`);
          if (s.hiddenLayers > 0) sanitizeLines.push(`${s.hiddenLayers} hidden layer${s.hiddenLayers === 1 ? "" : "s"} removed`);
          if (s.additionalActions > 0) sanitizeLines.push("Auto-open triggers removed");
        }
        return (
          <div className="mt-1 rounded-md border border-vault/40 bg-vault/[0.08] px-2.5 py-2 text-[11.5px] leading-relaxed text-text-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-vault">
                Redaction summary
              </div>
              <div className="text-[10px] text-text-muted">{when}</div>
            </div>
            <div className="mt-1 font-medium">
              Redacted {totalItems.toLocaleString()} item{totalItems === 1 ? "" : "s"}
              {allPages.size > 0 ? ` across ${allPages.size} page${allPages.size === 1 ? "" : "s"}` : ""}.
            </div>
            {lastSummary.pageRedactions.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {lastSummary.pageRedactions.map((r) => {
                  const pagesLabel =
                    r.pages.length === 0 ? "" :
                    r.pages.length <= 6 ? ` (pages ${r.pages.join(", ")})` :
                    ` (pages ${r.pages.slice(0, 6).join(", ")}, +${r.pages.length - 6} more)`;
                  return (
                    <li key={r.category} className="text-text-2">
                      <span className="text-text-1">{r.label}</span> · {r.count.toLocaleString()}
                      <span className="text-text-muted">{pagesLabel}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {lastSummary.sideChannel.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {lastSummary.sideChannel.map((r) => (
                  <li key={r.vector} className="text-text-2">
                    {r.count.toLocaleString()} {vectorLabel(r.vector)}{r.count === 1 ? "" : "s"} cleared
                  </li>
                ))}
              </ul>
            )}
            {sanitizeLines.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 border-t border-vault/20 pt-1.5">
                {sanitizeLines.map((line) => (
                  <li key={line} className="text-[10.5px] text-text-muted">{line}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => {
                setLastSummary(null);
                setFindings(null);
                setSelected(new Set());
                setExpandedGroups(new Set());
                void runScan(activeScanMode ?? "full");
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-vault/40 bg-vault/10 px-2 py-1 text-[11px] font-medium text-vault transition-colors hover:bg-vault/15"
            >
              <Sparkles className="h-3 w-3" strokeWidth={2.5} />
              Start new scan
            </button>
          </div>
        );
      })()}

      {usedOcr && scannedPages.length === 0 && (
        <p className="text-[10.5px] leading-snug text-text-muted">
          Some pages were image-only — OCR ran on-device to read them. Findings
          from those pages can be covered visually but the destructive burn
          can only erase glyphs from native text pages.
        </p>
      )}
    </div>
  );
}

/**
 * Mask sensitive snippets in the findings list so the inspector itself doesn't
 * become a leak surface (someone reading over the user's shoulder). Names and
 * dates are left intact — they're context, not credentials.
 */
function maskPreview(d: import("@/lib/pdf/detect-pii").Detection): string {
  const s = d.snippet ?? "";
  switch (d.category) {
    case "ssn":
      return s.replace(/\d(?=\d{4})/g, "•");
    case "creditCard":
      return s.replace(/\d(?=.*\d{4})/g, "•");
    case "phone":
      return s.replace(/\d(?=\d{4})/g, "•");
    case "email": {
      const at = s.indexOf("@");
      if (at <= 1) return s;
      return s[0] + "•".repeat(Math.max(1, at - 1)) + s.slice(at);
    }
    case "iban":
      return s.slice(0, 4) + "•".repeat(Math.max(0, s.length - 8)) + s.slice(-4);
    default:
      return s;
  }
}

function ProGatedButton({
  locked, isPro, onClick, label, hint,
}: {
  locked: boolean;
  isPro: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-left text-[12px] text-foreground transition-colors",
        locked ? "hover:border-vault/40" : "hover:border-vault/40",
      )}
    >
      <span className="flex w-full items-center gap-1.5">
        <span className="flex-1 truncate font-medium">{label}</span>
        {locked && <LockBadge />}
        {!locked && isPro && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-vault">
            Pro
          </span>
        )}
      </span>
      {hint && (
        <span className="text-[10.5px] leading-snug text-text-muted">{hint}</span>
      )}
    </button>
  );
}


function RedactPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, editorState, editorDispatch } = ctx;
  type Verify = import("@/lib/editor/verify-redaction").VerifyResult;
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<Verify | null>(null);
  // MEMORY: store hashes only, never the full exported Uint8Array. Retaining
  // 500MB–1.5GB in React state across the session was the primary cause of
  // "Array buffer allocation failed" on the NEXT export. Certificate build
  // needs the hashes, not the bytes — compute them once during export and
  // release the buffer immediately.
  const [lastHashes, setLastHashes] = useState<{ source: string; redacted: string } | null>(null);
  useEffect(() => {
    logHeap("panel mount", {
      fileName: file?.name ?? null,
      fileSizeMB: file ? Math.round((file.size / 1024 / 1024) * 10) / 10 : null,
      pageCount: editorState?.doc?.pages.length ?? null,
    });
  }, []);
  const [reviewedSignOff, setReviewedSignOff] = useState(false);
  // "always" = rasterize every page that carries a redaction (default, safest).
  // "fallback" = attempt content-stream surgery first, rasterize only pages
  // where text still intersects a redaction rect after verification.
  const [maxSecurity, setMaxSecurity] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem("vault.redact.maxSecurity");
    return v === null ? true : v === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("vault.redact.maxSecurity", maxSecurity ? "1" : "0");
  }, [maxSecurity]);

  const redactAnnos = useMemo(
    () => (editorState?.doc?.annotations ?? []).filter((a) => a.kind === "redact"),
    [editorState?.doc?.annotations],
  );
  const totalBoxes = redactAnnos.length;
  const targets = useMemo(() => {
    const out: { page: number; text?: string; rect: { x: number; y: number; w: number; h: number } }[] = [];
    for (const a of redactAnnos) {
      if (a.kind !== "redact") continue;
      const text = a.sources?.map((s) => (s.redactText || s.originalString || "").trim()).find(Boolean);
      out.push({ page: a.page, text, rect: { x: a.x, y: a.y, w: a.w, h: a.h } });
    }
    return out;
  }, [redactAnnos]);
  

  // Stage 2 unification: read the AI-detect flow's current staging state
  // so the "Marked for removal" section can show BOTH committed boxes and
  // pending (selected but not yet committed) AI findings in one place,
  // with a single "Commit staged" button that calls the SAME code path
  // as the in-list "Redact selected" button (no divergent burn logic).
  const staged = useStagedRedact();



  const exportRedacted = useCallback(async () => {
    if (!file || !editorState?.doc) return;
    // Two-phase commit: marks are drafts up to this point. Confirm before
    // we permanently remove the underlying content.
    const n = totalBoxes;
    const ok = await confirmDialog({
      title: "Apply redactions?",
      description: (
        <>
          This will permanently remove the content under{" "}
          <span className="font-medium text-foreground">
            {n} redaction{n === 1 ? "" : "s"}
          </span>
          . The original text and images beneath each mark will be deleted from
          the document — this cannot be undone.
        </>
      ),
      body: (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--vault,#4C7FB8)]"
            />
            Processed on your device. Nothing uploads.
          </div>
          <div className="text-xs text-muted-foreground">
            A Certificate of Redaction will be generated after verification.
          </div>
        </div>
      ),
      confirmText: "Apply & burn",
      cancelText: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setVerify(null);
    setLastHashes(null);
    const tid = "wsx-redact-export";
    toast.loading("Building redacted PDF…", { id: tid });
    try {
      // Reuse the editor's exporter — it already runs the destructive
      // content-stream rewrite for every redact annotation that captured
      // source strings (see src/lib/editor/text-rewrite.ts). Prefer the
      // live editor bytes because apply-now side-channel redaction mutates
      // them immediately; fall back to File only if the buffer was detached.
      const { exportEditedPdfInWorker } = await importChunk(() => import("@/lib/workers/export-client"));
      const freshBytes = editorState.doc.srcBytes.byteLength > 0
        ? editorState.doc.srcBytes
        : new Uint8Array(await file.arrayBuffer());
      const exportDoc = { ...editorState.doc, srcBytes: freshBytes };
      // MEMORY: hash the SOURCE now, BEFORE export builds the (possibly
      // 500MB+) output buffer. Previously we hashed the source AFTER export
      // via a fresh `file.arrayBuffer()`, which held full source + full
      // output simultaneously and drove the heap to ~3.8GB at export tail.
      // Hashing `freshBytes` in place adds no extra copy — the digest
      // internal buffer is a few KB — and the source can be released as
      // soon as the export worker consumes it.
      logHeap("before source hash (pre-export)", {
        sourceBytesMB: Math.round((freshBytes.byteLength / 1024 / 1024) * 10) / 10,
      });
      let sourceHashPre: string;
      try {
        const h = await crypto.subtle.digest("SHA-256", freshBytes as unknown as ArrayBuffer);
        sourceHashPre = Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (err) {
        logAllocationFailure("source hash (pre-export)", err, {
          sourceBytesMB: Math.round((freshBytes.byteLength / 1024 / 1024) * 10) / 10,
        });
        throw new Error(allocationFailureMessage("source hash (pre-export)", err));
      }
      logHeap("before exportEditedPdfInWorker", {
        sourceBytesMB: Math.round((freshBytes.byteLength / 1024 / 1024) * 10) / 10,
        pages: exportDoc.pages.length,
        annotations: exportDoc.annotations.length,
      });
      let bytes: Uint8Array;
      try {
        bytes = await exportEditedPdfInWorker(exportDoc);
      } catch (err) {
        logAllocationFailure("exportEditedPdfInWorker", err, {
          sourceBytesMB: Math.round((freshBytes.byteLength / 1024 / 1024) * 10) / 10,
        });
        throw new Error(allocationFailureMessage("exportEditedPdfInWorker", err));
      }

      // Region-rasterize redacted pages. Default ("always") rasterizes every
      // page with a redaction — text inside the box is physically replaced
      // by image pixels and cannot be recovered regardless of font/CMap.
      // "fallback" mode keeps text selectable on pages where the content-
      // stream surgery already cleared the region.
      toast.loading("Burning redaction regions…", { id: tid });
      const pageRedactions = new Map<number, { x: number; y: number; w: number; h: number }[]>();
      for (const t of targets) {
        const arr = pageRedactions.get(t.page) ?? [];
        arr.push(t.rect);
        pageRedactions.set(t.page, arr);
      }
      // Wrap rasterize + sanitize + verify + pixel-verify as ONE background
      // redact-export job. Any leak throws → job fails → download never fires.
      const { runAsJob } = await import("@/lib/jobs/registry");
      const jobDocId = `${file.name}:${file.size}`;
      const jobRun = runAsJob(
        { kind: "redact-export", docId: jobDocId, docLabel: file.name },
        async ({ signal, onProgress }) => {
          const { rasterizeRedactedPagesInWorker } = await importChunk(() => import("@/lib/workers/rasterize-client"));
          logHeap("before rasterizeRedactedPagesInWorker", {
            inputBytesMB: Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10,
            redactionPages: pageRedactions.size,
            targets: targets.length,
          });
          const rasterResult = await rasterizeRedactedPagesInWorker(bytes, pageRedactions, {
            mode: maxSecurity ? "always" : "fallback",
            scale: 2.5,
            signal,
            onProgress: (done, total) => {
              onProgress({ fraction: total ? (done / total) * 0.55 : 0, step: `Burning ${done}/${total}` });
              toast.loading(`Burning redactions ${done}/${total}…`, { id: tid });
            },
          });
          // STAGE 3 — single commit path.
          // Sanitize + verify + raster-fallback + re-verify now go through the
          // ONE consolidated `enforceRedactionGate` chokepoint (see
          // src/lib/editor/redaction-gate.ts). No divergent inline copy of the
          // verification pipeline lives here anymore — a leak throws inside
          // the gate and the download never fires.
          const { enforceRedactionGate } = await importChunk(() => import("@/lib/editor/redaction-gate"));
          logHeap("before enforceRedactionGate", {
            inputBytesMB: Math.round((rasterResult.bytes.byteLength / 1024 / 1024) * 10) / 10,
            rasterizedPages: rasterResult.rasterizedPages.length,
            targets: targets.length,
          });
          const gated = await enforceRedactionGate(rasterResult.bytes, targets, {
            rasterizedPages: rasterResult.rasterizedPages,
            signal,
            onProgress: (step) => {
              if (step === "sanitize") {
                onProgress({ fraction: 0.6, step: "Scrubbing side-channels…" });
                toast.loading("Scrubbing form fields, comments, metadata…", { id: tid });
              } else if (step === "verify") {
                onProgress({ fraction: 0.75, step: "Verifying removal…" });
                toast.loading("Verifying removal…", { id: tid });
              } else if (step === "raster-fallback") {
                onProgress({ fraction: 0.82, step: "Re-burning leaked regions…" });
                toast.loading("Re-burning leaked regions…", { id: tid });
              } else if (step === "verify-again") {
                onProgress({ fraction: 0.86, step: "Re-verifying removal…" });
                toast.loading("Re-verifying removal…", { id: tid });
              }
            },
          });
          let outBytes = gated.bytes;
          const gatedRasterizedPages = gated.rasterizedPages;
          const vresult = gated.verify;

          // Pixel-coverage sanity check on burned pages. This is a
          // secondary visual check — it measures near-black pixel coverage
          // inside each redaction rect to catch a rect that was drawn in
          // the wrong location or not drawn at all. It is NOT a text/OCR
          // check; the real leak-prevention (text-extraction + raw-stream
          // + side-channel) already ran inside enforceRedactionGate above
          // and passed, so any anomaly here is a review warning, not a
          // hard block on the export.
          let pixelWarnCount = 0;
          if (gatedRasterizedPages.length > 0) {
            onProgress({ fraction: 0.9, step: "Verifying burn coverage…" });
            toast.loading("Verifying burn coverage…", { id: tid });
            const { verifyPixelRedaction } = await importChunk(() => import("@/lib/editor/verify-pixel-redaction"));
            const pixelTargets = targets.filter((t) => !!t.rect).map((t) => ({ page: t.page, rect: t.rect! }));
            const pixelResult = await verifyPixelRedaction(outBytes, pixelTargets, new Set(gatedRasterizedPages));
            if (!pixelResult.ok) {
              pixelWarnCount = pixelResult.leaks.length;
              console.warn(
                `[redact] pixel-coverage check flagged ${pixelWarnCount} region(s) for review — content already verified unrecoverable by gate`,
                pixelResult.leaks,
              );
            }
          }


          return { bytes: outBytes, rasterizedPages: gatedRasterizedPages, verify: vresult, pixelWarnCount };
        },
      );
      const jobOutput = await jobRun.promise;
      bytes = jobOutput.bytes;
      const rasterResult = { bytes: jobOutput.bytes, rasterizedPages: jobOutput.rasterizedPages };
      const result = jobOutput.verify;
      const pixelWarn = jobOutput.pixelWarnCount ?? 0;

      setVerify(result);
      if (result.ok) {
        // MEMORY: hash the output BEFORE handing bytes to the download +
        // certificate flow, then release the local reference so GC can
        // reclaim the 500MB–1.5GB buffer as soon as the Blob URL is issued.
        const hash = async (data: Uint8Array, label: string): Promise<string> => {
          logHeap(`before certificate hash: ${label}`, {
            bytesMB: Math.round((data.byteLength / 1024 / 1024) * 10) / 10,
          });
          let h: ArrayBuffer;
          try {
            h = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
          } catch (err) {
            logAllocationFailure(`certificate hash: ${label}`, err, {
              bytesMB: Math.round((data.byteLength / 1024 / 1024) * 10) / 10,
            });
            throw new Error(allocationFailureMessage(`certificate hash: ${label}`, err));
          }
          return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
        };
        const redactedHash = await hash(bytes, "redacted output");
        await downloadPdf(bytes, file.name.replace(/\.pdf$/i, "") + "-redacted.pdf");
        // Release the export buffer from the job output and this closure —
        // the download has its own Blob-backed reference now and doesn't
        // need our Uint8Array. Do NOT stash bytes into React state.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (jobOutput as any).bytes = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rasterResult as any).bytes = null;
        bytes = new Uint8Array(0);
        const flatNote = rasterResult.rasterizedPages.length
          ? ` · ${rasterResult.rasterizedPages.length} page${rasterResult.rasterizedPages.length === 1 ? "" : "s"} pixel-burned`
          : "";
        const warnNote = pixelWarn > 0
          ? ` · ${pixelWarn} region${pixelWarn === 1 ? "" : "s"} flagged for visual review (content already verified removed)`
          : "";
        toast.success(`Verified — ${result.removed}/${result.total} regions cleared${flatNote}${warnNote}`, { id: tid });
        try {
          window.dispatchEvent(new CustomEvent("agent:redact-complete", {
            detail: { ok: true, removed: result.removed, total: result.total, leaks: 0 },
          }));
        } catch { /* ignore */ }

        // Offer the formal Redaction Certificate as a free-signup value gate.
        // Only fires when verification PASSED — never claim unverified compliance.
        try {
          const { requestCertificate } = await import("@/components/workspace/certificate-gate");
          const { buildRedactionCertificate } = await import("@/lib/pdf/redaction-certificate");
          // MEMORY: source hash was computed BEFORE export ran (see
          // sourceHashPre above). We deliberately do NOT reload the source
          // via file.arrayBuffer() here — doing so at this point would put
          // full source + full output in the heap simultaneously and drove
          // the previous ~3.8GB tail spike. Reuse the pre-computed digest.
          const sourceHash = sourceHashPre;
          setLastHashes({ source: sourceHash, redacted: redactedHash });
          const categoryCounts: Record<string, number> = {};
          const perPageCounts: Record<number, number> = {};
          for (const a of (editorState?.doc?.annotations ?? [])) {
            if (a.kind !== "redact") continue;
            const cat = (a as { category?: string }).category ?? "manual";
            categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
            const p = a.page + 1;
            perPageCounts[p] = (perPageCounts[p] ?? 0) + 1;
          }
          const totalRedactions = (editorState?.doc?.annotations ?? []).filter((a) => a.kind === "redact").length;
          const pageCount = editorState?.doc?.pages.length ?? 0;
          const payload = {
            sourceName: file.name,
            sourceBytes: file.size,
            pageCount,
            totalRedactions,
            categoryCounts,
            perPageCounts,
            verification: {
              ok: result.ok,
              total: result.total,
              removed: result.removed,
              scannedAt: result.scannedAt,
              leaks: result.leaks.length,
            },
            sourceHashSHA256: sourceHash,
            redactedHashSHA256: redactedHash,
          };
          requestCertificate({
            kind: "redaction",
            actionLabel: "Redaction",
            sourceName: file.name,
            downloadBaseName: file.name.replace(/\.pdf$/i, "") + "-certificate-of-redaction",
            payload,
            build: () => buildRedactionCertificate({
              ...payload,
              verification: payload.verification,
            }),
          });
        } catch (gateErr) {
          console.warn("[redact] cert gate failed", gateErr);
        }
      } else {
        throw new Error(`${result.leaks.length} redaction region${result.leaks.length === 1 ? " still contains" : "s still contain"} extractable text`);
      }
    } catch (err) {
      console.error("[redact] export failed", err);
      toast.error("Redaction export failed", { id: tid, description: (err as Error).message });
      try {
        window.dispatchEvent(new CustomEvent("agent:redact-complete", {
          detail: { ok: false, error: (err as Error).message },
        }));
      } catch { /* ignore */ }
    } finally {
      setBusy(false);
    }
  }, [file, editorState?.doc, targets, totalBoxes, maxSecurity]);


  const downloadCertificate = useCallback(async () => {
    if (!file || !verify || !lastHashes) return;
    try {
      // Route ALL certificate downloads through the auth gate. Signed-out
      // users must create a free account first; "Not now" closes the gate
      // without producing a certificate. No bypass path exists here.
      // MEMORY: we reuse the hashes computed during export — we never
      // re-load the full source file or hold onto the exported bytes.
      const { requestCertificate } = await import("@/components/workspace/certificate-gate");
      const { buildRedactionCertificate } = await importChunk(() => import("@/lib/pdf/redaction-certificate"));
      const sourceHash = lastHashes.source;
      const redactedHash = lastHashes.redacted;
      const categoryCounts: Record<string, number> = {};
      const perPageCounts: Record<number, number> = {};
      for (const a of redactAnnos) {
        if (a.kind !== "redact") continue;
        const cat = (a as { category?: string }).category ?? "manual";
        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
        const p = a.page + 1;
        perPageCounts[p] = (perPageCounts[p] ?? 0) + 1;
      }
      const buildArgs = {
        sourceName: file.name,
        sourceBytes: file.size,
        pageCount: editorState?.doc?.pages.length ?? 0,
        totalRedactions: redactAnnos.length,
        categoryCounts,
        perPageCounts,
        verification: {
          ok: verify.ok,
          total: verify.total,
          removed: verify.removed,
          scannedAt: verify.scannedAt,
          leaks: verify.leaks.length,
        },
        sourceHashSHA256: sourceHash,
        redactedHashSHA256: redactedHash,
      };
      requestCertificate({
        kind: "redaction",
        actionLabel: "Redaction",
        sourceName: file.name,
        downloadBaseName: file.name.replace(/\.pdf$/i, "") + "-certificate-of-redaction",
        payload: buildArgs as unknown as Record<string, unknown>,
        build: () => buildRedactionCertificate(buildArgs),
      });
    } catch (err) {
      console.error("[redact] certificate failed", err);
      toast.error("Couldn't build certificate", { description: (err as Error).message });
    }
  }, [file, verify, lastHashes, redactAnnos, editorState?.doc?.pages.length]);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF to mark redactions.</InspectorEmpty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 text-vault" strokeWidth={2.5} />
          <span className="text-[12px] font-semibold text-foreground">Redact</span>
        </div>
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          <strong className="text-amber-100">Redaction permanently removes content.</strong>{" "}
          Auto-detection finds structured data and names but may miss some — review before committing.
        </div>
      </div>

      <ProRedactSection ctx={ctx} />






      <Section title="Audit ledger" icon={<Shield className="h-3 w-3" />}>
        <RedactionAuditLedger
          sourceName={file.name}
          redactions={redactAnnos.map((a) => ({
            page: a.page,
            x: a.x,
            y: a.y,
            w: a.w,
            h: a.h,
            category: (a as { category?: string }).category,
          }))}
        />
      </Section>


      <Section title="Redaction mode" icon={<Shield className="h-3 w-3" />}>
        <div className="flex flex-col gap-1.5">
          <label className={cn(
            "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[11.5px] transition-colors",
            maxSecurity ? "border-vault/50 bg-accent-soft" : "border-border bg-surface-2 hover:border-vault/30",
          )}>
            <input
              type="radio"
              name="redact-mode"
              checked={maxSecurity}
              onChange={() => setMaxSecurity(true)}
              className="mt-0.5 accent-[var(--vault,#4C7FB8)]"
            />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-foreground">Maximum security (recommended)</span>
              <span className="text-text-2">
                Flatten every redacted page to an image. The redacted text is physically
                unrecoverable — guaranteed regardless of font or encoding. Those pages
                lose text selectability.
              </span>
            </div>
          </label>
          <label className={cn(
            "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[11.5px] transition-colors",
            !maxSecurity ? "border-vault/50 bg-accent-soft" : "border-border bg-surface-2 hover:border-vault/30",
          )}>
            <input
              type="radio"
              name="redact-mode"
              checked={!maxSecurity}
              onChange={() => setMaxSecurity(false)}
              className="mt-0.5 accent-[var(--vault,#4C7FB8)]"
            />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-foreground">Standard — keep text selectable</span>
              <span className="text-text-2">
                Try to delete only the redacted text from the content stream. Pages
                still containing the text after verification are automatically
                flattened as a safety net — a leaky file is never downloaded.
              </span>
            </div>
          </label>
        </div>
      </Section>



      <Section title="Commit" icon={<ShieldCheck className="h-3 w-3" />}>
        {(() => {
          // Total items awaiting commit = manual/AI page annotations + ticked
          // side-channel items (form fields, comments, metadata). Either can
          // drive a commit on its own.
          const totalStaged = totalBoxes + (staged.sideStaged || 0);
          const canCommit = totalStaged > 0;
          const onCommit = async () => {
            // STEP 0 — Flush any pending/in-flight live-hide sanitize so
            // Export never races replaceFile with a mid-flight worker call
            // (fast Export within the 450ms debounce window, or during a
            // slow ongoing sanitize).
            if (staged.flushSide) await staged.flushSide();
            // STEP 1 — Apply-NOW for any still-checked side-channel findings
            // (a user who clicked Export before the debounce fired). These
            // have no page rect, so the page-burn step can't touch them.
            // `sideCommit` is `redactSelected`, which handles the wipe and
            // also re-adds any ticked page items (deduped against existing
            // redact keys).
            if ((staged.sideStaged || 0) > 0 && staged.sideCommit) {
              await staged.sideCommit();
            }
            // STEP 2 — Existing page-vector burn/flatten/verify/download.
            if (totalBoxes > 0) {
              await exportRedacted();
            }
          };

          return (
            <>
              <label className={cn(
                "mb-2 flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[11.5px] transition-colors",
                reviewedSignOff ? "border-vault/50 bg-accent-soft" : "border-border bg-surface-2 hover:border-vault/30",
                !canCommit && "cursor-not-allowed opacity-60",
              )}>
                <input
                  type="checkbox"
                  checked={reviewedSignOff}
                  disabled={!canCommit}
                  onChange={(e) => setReviewedSignOff(e.target.checked)}
                  className="mt-0.5 h-3 w-3 accent-vault"
                />
                <span className="text-foreground">
                  I have reviewed every page of this document and confirm the redaction set is complete.
                  I understand auto-detection only flags structured patterns and that I am responsible
                  for catching names and context-dependent secrets.
                </span>
              </label>
              <button
                type="button"
                onClick={onCommit}
                disabled={busy || !canCommit || !reviewedSignOff}
                className={cn(
                  "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
                  (busy || !canCommit || !reviewedSignOff) && "cursor-not-allowed opacity-60",
                )}
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
                {busy ? "Working…" : `Export${canCommit ? ` (${totalStaged.toLocaleString()} item${totalStaged === 1 ? "" : "s"})` : ""}`}
              </button>
            </>
          );
        })()}
        <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-text-muted">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-vault"
          />
          Processed on your device. Nothing uploads. Exports a redacted PDF, then re-parses it to confirm no extractable text remains.
        </p>
      </Section>


      {verify && (
        <Section
          title={verify.ok ? "Verification — passed" : "Verification — review"}
          icon={<ShieldCheck className="h-3 w-3" />}
        >
          <div
            className={cn(
              "rounded-md border px-3 py-2.5 text-[12px]",
              verify.ok
                ? "border-vault/40 bg-accent-soft text-vault"
                : "border-destructive/40 bg-destructive/10 text-foreground",
            )}
          >
            <div className="font-medium">
              {verify.removed} of {verify.total} redaction region{verify.total === 1 ? "" : "s"} cleared
            </div>
            <div className="mt-0.5 text-[10.5px] opacity-80">
              Scanned {new Date(verify.scannedAt).toLocaleString()}
            </div>
            {!verify.ok && (
              <ul className="mt-2 space-y-1 text-[11px] text-foreground">
                {verify.leaks.slice(0, 6).map((l, i) => (
                  <li key={i} className="font-mono">
                    {l.vector === "page" && l.page !== undefined ? `p.${l.page + 1}` : l.vector}: <span className="text-text-2">{l.text}</span>
                  </li>
                ))}
                {verify.leaks.length > 6 && (
                  <li className="text-[10.5px] text-text-muted">…and {verify.leaks.length - 6} more</li>
                )}
              </ul>
            )}
            {!verify.ok && (
              <p className="mt-2 text-[10.5px] leading-snug text-text-2">
                Extractable text still intersects one or more redaction boxes in the exported file.
                Visual overlay still hides it on screen, but search/copy can recover it.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={downloadCertificate}
            disabled={!lastHashes}
            className={cn(
              "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40",
              !lastHashes && "opacity-50 cursor-not-allowed",
            )}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            Download certificate of redaction

          </button>
        </Section>
      )}

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ================================ Merge ================================= */

type MergeRow = {
  id: string;
  file: File;
  pageCount: number | null;
  range: string; // "" / "all" means all
  rangeOpen: boolean;
  rangeError?: string;
  isActive?: boolean;
};

function MergePanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile } = ctx;
  const [rows, setRows] = useState<MergeRow[]>([]);
  const [filename, setFilename] = useState("merged.pdf");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);

  // Seed/refresh the first row from the active document.
  useEffect(() => {
    setRows((prev) => {
      const others = prev.filter((r) => !r.isActive);
      if (!file) return others;
      const existing = prev.find((r) => r.isActive && r.file === file);
      if (existing) return prev;
      const seed: MergeRow = {
        id: `active-${Date.now()}`,
        file,
        pageCount: null,
        range: "",
        rangeOpen: false,
        isActive: true,
      };
      return [seed, ...others];
    });
  }, [file]);

  // Resolve page counts.
  useEffect(() => {
    const pending = rows.filter((r) => r.pageCount === null);
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const r of pending) {
        try {
          const n = await getPageCount(r.file);
          if (cancelled) return;
          setRows((prev) =>
            prev.map((x) => (x.id === r.id ? { ...x, pageCount: n } : x)),
          );
        } catch {
          if (cancelled) return;
          setRows((prev) =>
            prev.map((x) => (x.id === r.id ? { ...x, pageCount: 0 } : x)),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const onAddFiles = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming: MergeRow[] = [];
    for (const f of Array.from(list)) {
      if (f.type && !/pdf/i.test(f.type)) continue;
      incoming.push({
        id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        pageCount: null,
        range: "",
        rangeOpen: false,
      });
    }
    if (incoming.length === 0) return;
    setRows((prev) => [...prev, ...incoming]);
  }, []);

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const updateRange = (id: string, range: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        let err: string | undefined;
        if (range.trim() && r.pageCount && r.pageCount > 0) {
          const parsed = parseRange(range, r.pageCount);
          if (parsed.length === 0) err = "no pages match";
        }
        return { ...r, range, rangeError: err };
      }),
    );
  };

  const toggleRange = (id: string) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, rangeOpen: !r.rangeOpen } : r)),
    );

  // Drag reorder (HTML5).
  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== dropId) setDropId(id);
  };
  const onDrop = (targetId: string) => {
    setRows((prev) => {
      if (!dragId || dragId === targetId) return prev;
      const from = prev.findIndex((r) => r.id === dragId);
      const to = prev.findIndex((r) => r.id === targetId);
      if (from === -1 || to === -1) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragId(null);
    setDropId(null);
  };
  const onDragEnd = () => {
    setDragId(null);
    setDropId(null);
  };

  const totalPages = useMemo(
    () =>
      rows.reduce((acc, r) => {
        if (!r.pageCount) return acc;
        const n = parseRange(r.range, r.pageCount).length;
        return acc + n;
      }, 0),
    [rows],
  );

  const canCombine = rows.length >= 2 && totalPages > 0 && !busy;

  const combine = useCallback(async () => {
    if (!canCombine) return;
    setBusy(true);
    setProgress({ done: 0, total: rows.length });
    try {
      const items: MergeItem[] = rows.map((r) => ({
        file: r.file,
        range: r.range,
      }));
      const blob = await combinePdfs(items, (done, total) =>
        setProgress({ done, total }),
      );
      const cleanName = filename.trim().replace(/\.pdf$/i, "") || "merged";
      const outName = `${cleanName}.pdf`;
      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outName;
      a.click();
      URL.revokeObjectURL(url);
      // Replace the active document with the merged file.
      const mergedFile = new File([blob], outName, { type: "application/pdf" });
      replaceFile(mergedFile);
      toast.success(`Combined ${rows.length} files`, {
        description: `${totalPages} pages · saved as ${outName}. Nothing was uploaded.`,
      });
    } catch (err) {
      console.error(err);
      toast.error("Combine failed. Check the console for details.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [canCombine, rows, filename, replaceFile, totalPages]);

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Section
        title="Files to combine"
        icon={<FilesIcon className="h-3 w-3" />}
        right={
          <span className="text-text-muted normal-case tracking-normal">
            {rows.length} {rows.length === 1 ? "file" : "files"}
          </span>
        }
      >
        {rows.length === 0 ? (
          <InspectorEmpty>Open a PDF in the workspace to begin, then add more files below.</InspectorEmpty>
        ) : (
          <ul className="space-y-1">
            {rows.map((r, idx) => {
              const isDropTarget = dropId === r.id && dragId && dragId !== r.id;
              return (
                <li
                  key={r.id}
                  draggable
                  onDragStart={() => onDragStart(r.id)}
                  onDragOver={(e) => onDragOver(e, r.id)}
                  onDrop={() => onDrop(r.id)}
                  onDragEnd={onDragEnd}
                  className={cn(
                    "rounded-md border bg-surface-2 transition-colors",
                    isDropTarget ? "border-vault/60" : "border-border",
                    dragId === r.id && "opacity-50",
                  )}
                >
                  <div className="flex items-center gap-1.5 px-1.5 py-1.5">
                    <button
                      type="button"
                      className="cursor-grab text-text-muted hover:text-foreground active:cursor-grabbing"
                      aria-label="Drag to reorder"
                      title="Drag to reorder"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-4 shrink-0 text-center text-[10.5px] tabular-nums text-text-muted">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3 w-3 shrink-0 text-text-muted" />
                        <span
                          className="truncate text-[12px] text-foreground"
                          title={r.file.name}
                        >
                          {r.file.name}
                        </span>
                        {r.isActive && (
                          <span className="rounded-sm bg-accent-soft px-1 py-px text-[9.5px] uppercase tracking-[0.14em] text-vault">
                            active
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-text-muted">
                        <span>
                          {r.pageCount === null
                            ? "…"
                            : `${r.pageCount} ${r.pageCount === 1 ? "page" : "pages"}`}
                        </span>
                        {r.range.trim() && r.pageCount ? (
                          <span className="text-vault/80">
                            using {parseRange(r.range, r.pageCount).length}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleRange(r.id)}
                          className="ml-auto text-text-muted underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {r.rangeOpen ? "Hide range" : "Pages…"}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      aria-label="Remove file"
                      className="rounded-sm p-1 text-text-muted hover:bg-surface-3 hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {r.rangeOpen && (
                    <div className="border-t border-border px-2 py-1.5">
                      <input
                        value={r.range}
                        onChange={(e) => updateRange(r.id, e.target.value)}
                        placeholder="all"
                        className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-[11.5px] font-mono text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
                      />
                      <p className="mt-1 text-[10px] text-text-muted">
                        Default: all. Examples:{" "}
                        <span className="text-foreground">1-3</span>,{" "}
                        <span className="text-foreground">1,4,7-9</span>.
                        {r.rangeError && (
                          <span className="ml-1 text-amber-400">
                            {r.rangeError}
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <input
          ref={pickRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            onAddFiles(e.target.files);
            if (pickRef.current) pickRef.current.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => pickRef.current?.click()}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3"
        >
          <Plus className="h-3.5 w-3.5" />
          Add PDFs
        </button>
      </Section>

      <Section title="Output filename" icon={<FileText className="h-3 w-3" />}>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="merged.pdf"
          className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] font-mono text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
        />
      </Section>

      <div className="mt-1">
        <button
          type="button"
          disabled={!canCombine}
          onClick={combine}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-2 text-[12.5px] font-medium text-vault-foreground hover:opacity-90",
            !canCombine && "cursor-not-allowed opacity-40 hover:opacity-40",
          )}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          {busy
            ? progress
              ? `Combining ${progress.done}/${progress.total}…`
              : "Combining…"
            : rows.length < 2
              ? "Add at least 2 files"
              : `Combine ${rows.length} files · ${totalPages} pages`}
        </button>
        {busy && progress && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-vault transition-all"
              style={{
                width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
              }}
            />
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ============================== Split =============================== */

function SplitPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  type SplitUiMode = "ranges" | "each" | "everyN" | "splitPoints" | "smart";
  const [mode, setMode] = useState<SplitUiMode>("ranges");
  const [ranges, setRanges] = useState("1-");
  const [everyN, setEveryN] = useState(2);
  const [points, setPoints] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [busy, setBusy] = useState(false);

  // Resolve page count whenever the active file changes.
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setPageCount(0);
      return;
    }
    void (async () => {
      try {
        const n = await getSplitPageCount(file);
        if (cancelled) return;
        setPageCount(n);
        setRanges(`1-${n}`);
      } catch {
        if (cancelled) return;
        setPageCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const parsed = useMemo(() => parseRanges(ranges, pageCount), [ranges, pageCount]);
  const parsedPoints = useMemo(
    () => parseSplitPoints(points, pageCount),
    [points, pageCount],
  );

  // Preview for everyN mode.
  const everyNPreview = useMemo(() => {
    if (pageCount === 0 || everyN < 1) return null;
    const count = Math.ceil(pageCount / Math.max(1, Math.floor(everyN)));
    return count;
  }, [pageCount, everyN]);

  const run = useCallback(async () => {
    if (!file) {
      toast.error("Open a PDF first.");
      return;
    }
    setBusy(true);
    try {
      const opts =
        mode === "each"
          ? ({ mode: "each" } as const)
          : mode === "ranges"
            ? ({ mode: "ranges", ranges } as const)
            : mode === "everyN"
              ? ({ mode: "everyN", n: Math.max(1, Math.floor(everyN)) } as const)
              : ({ mode: "splitPoints", points } as const);
      const result = await splitPdf(file, opts);
      await triggerDownload(result.blob, result.filename);
      if (result.kind === "pdf") {
        toast.success(`Saved ${result.pageCount} pages`, {
          description: `${result.filename} · nothing was uploaded.`,
        });
      } else {
        toast.success(`Saved ${result.fileCount} files in zip`, {
          description: `${result.pageCount} pages · ${result.filename} · nothing was uploaded.`,
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Split failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [file, mode, ranges, everyN, points]);

  const canRun =
    !!file &&
    !busy &&
    pageCount > 0 &&
    (mode === "each" ||
      (mode === "ranges" && parsed.groups.length > 0 && !parsed.error) ||
      (mode === "everyN" && Math.floor(everyN) >= 1) ||
      (mode === "splitPoints" && parsedPoints.points.length > 0 && !parsedPoints.error));

  const isPro = useIsPro();
  const requirePro = useRequirePro();

  const modeBtn = (id: SplitUiMode, label: string, opts?: { pro?: boolean }) => (
    <button
      type="button"
      onClick={() => {
        if (opts?.pro && !isPro) {
          if (!requirePro("Smart Document Splitter")) return;
        }
        setMode(id);
      }}
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11.5px] transition-colors",
        mode === id
          ? "border-vault/60 bg-accent-soft text-foreground"
          : "border-border bg-surface-2 text-text-2 hover:text-foreground",
      )}
    >
      <span>{label}</span>
      {opts?.pro && !isPro && <LockBadge title="Pro — Smart Document Splitter" />}
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-3.5">
      {!file ? (
        <InspectorEmpty>Open a PDF in the workspace to split it.</InspectorEmpty>
      ) : (
        <>
          <Section title="Source" icon={<FileText className="h-3 w-3" />}>
            <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
              <div className="truncate text-[12px] text-foreground" title={file.name}>
                {file.name}
              </div>
              <div className="mt-0.5 text-[10.5px] text-text-muted tabular-nums">
                {pageCount > 0
                  ? `${pageCount} page${pageCount === 1 ? "" : "s"}`
                  : "Reading…"}
              </div>
            </div>
          </Section>

          <Section title="Mode" icon={<Scissors className="h-3 w-3" />}>
            <div className="grid grid-cols-2 gap-1.5">
              {modeBtn("ranges", "By ranges")}
              {modeBtn("each", "Every page")}
              {modeBtn("everyN", "Every N pages")}
              {modeBtn("splitPoints", "At split points")}
              {modeBtn("smart", "Smart (detect)", { pro: true })}
            </div>
          </Section>

          {mode === "ranges" && (
            <Section title="Ranges">
              <input
                value={ranges}
                onChange={(e) => setRanges(e.target.value)}
                placeholder="e.g. 1-3, 5, 8-10"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 font-mono text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40"
              />
              <div className="mt-1.5 text-[10.5px] leading-snug text-text-muted">
                {parsed.error ? (
                  <span className="text-destructive">{parsed.error}</span>
                ) : pageCount === 0 ? (
                  "Waiting for page count…"
                ) : parsed.groups.length === 0 ? (
                  "Enter pages like 1-3, 5, 8-10"
                ) : parsed.groups.length === 1 ? (
                  `One file with ${parsed.groups[0].length} page${parsed.groups[0].length === 1 ? "" : "s"}`
                ) : (
                  `${parsed.groups.length} files in a zip (${parsed.groups
                    .map((g) => g.length)
                    .join(" + ")} pages)`
                )}
              </div>
            </Section>
          )}

          {mode === "everyN" && (
            <Section title="Chunk size">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, pageCount)}
                  value={everyN}
                  onChange={(e) =>
                    setEveryN(Math.max(1, parseInt(e.target.value || "1", 10)))
                  }
                  className="w-20 rounded-md border border-border bg-surface-1 px-2 py-1.5 font-mono text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40"
                />
                <span className="text-[11.5px] text-text-2">
                  page{everyN === 1 ? "" : "s"} per file
                </span>
              </div>
              <div className="mt-1.5 text-[10.5px] leading-snug text-text-muted">
                {everyNPreview === null
                  ? "Waiting for page count…"
                  : everyNPreview === 1
                    ? "One file (chunk is the whole document)"
                    : `${everyNPreview} files in a zip`}
              </div>
            </Section>
          )}

          {mode === "splitPoints" && (
            <Section title="Split points">
              <input
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder="e.g. 5, 12, 18"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 font-mono text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40"
              />
              <div className="mt-1.5 text-[10.5px] leading-snug text-text-muted">
                {parsedPoints.error ? (
                  <span className="text-destructive">{parsedPoints.error}</span>
                ) : pageCount === 0 ? (
                  "Waiting for page count…"
                ) : parsedPoints.points.length === 0 ? (
                  `Pages where a new part starts (2–${pageCount})`
                ) : (
                  `${parsedPoints.points.length + 1} files in a zip · cuts before ${parsedPoints.points.join(", ")}`
                )}
              </div>
            </Section>
          )}

          {mode === "each" && (
            <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-[11px] text-text-muted">
              Saves every page as its own PDF inside a zip.
            </p>
          )}

          {mode === "smart" && (
            <SmartSplitSection file={file} pageCount={pageCount} />
          )}

          {mode !== "smart" && (
            <>
              <button
                type="button"
                onClick={run}
                disabled={!canRun}
                className={cn(
                  "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
                  canRun ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
                )}
              >
                {busy ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Splitting…
                  </>
                ) : (
                  <>
                    <Scissors className="h-3.5 w-3.5" /> Split &amp; download
                  </>
                )}
              </button>

              <div className="text-center text-[10px] text-text-muted">
                On-device · nothing leaves your browser
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------- Smart Document Splitter ---------------------- */

function SmartSplitSection({
  file,
  pageCount,
}: {
  file: File;
  pageCount: number;
}) {
  const requirePro = useRequirePro();
  const isPro = useIsPro();
  const [mode, setMode] = useState<DetectionMode>("blank");
  const [everyN, setEveryN] = useState(10);
  const [pattern, setPattern] = useState("");
  const [patternKind, setPatternKind] = useState<PatternKind>("literal");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [progress, setProgress] = useState<{ page: number; total: number; stage: string } | null>(
    null,
  );
  const [detected, setDetected] = useState<DetectedBreak[] | null>(null);
  const [breakSet, setBreakSet] = useState<Set<number>>(new Set());
  const [blankPages, setBlankPages] = useState<number[]>([]);
  const [removeSeparators, setRemoveSeparators] = useState(true);
  const [names, setNames] = useState<Record<number, string | undefined>>({});
  const [reasons, setReasons] = useState<Record<number, string | undefined>>({});
  const [manualPage, setManualPage] = useState<string>("");
  const [splitting, setSplitting] = useState(false);
  const [splitProgress, setSplitProgress] = useState<{ part: number; total: number } | null>(null);

  const baseName = useMemo(() => file.name.replace(/\.pdf$/i, ""), [file.name]);

  const runDetect = useCallback(async () => {
    if (!file) return;
    if (mode === "pattern" && !pattern.trim()) {
      setDetected(null);
      setBreakSet(new Set());
      setBlankPages([]);
      setNames({});
      setReasons({});
      return;
    }
    setDetecting(true);
    setProgress(null);
    try {
      const result = await detectSmartBreaks(file, {
        modes: [mode],
        everyN,
        pattern,
        patternKind,
        patternCaseSensitive: caseSensitive,
        patternAnchorStart: true,
        onProgress: (page, total, stage) => setProgress({ page, total, stage }),
      });
      setDetected(result.breaks);
      setBreakSet(new Set(result.breaks.map((b) => b.page)));
      setBlankPages(mode === "blank" ? result.blankPages : []);
      const n: Record<number, string | undefined> = {};
      const r: Record<number, string | undefined> = {};
      for (const b of result.breaks) {
        n[b.page] = b.suggestedName;
        r[b.page] = b.reason;
      }
      setNames(n);
      setReasons(r);
    } catch (err) {
      console.error(err);
      toast.error("Detection failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDetecting(false);
      setProgress(null);
    }
  }, [file, mode, everyN, pattern, patternKind, caseSensitive]);

  // Auto-run detection when the mode or its parameters change. Debounced so
  // typing in the pattern / N field doesn't fire mid-keystroke.
  useEffect(() => {
    if (!isPro || !file || pageCount === 0) return;
    const t = window.setTimeout(() => {
      void runDetect();
    }, 200);
    return () => window.clearTimeout(t);
  }, [isPro, file, pageCount, mode, everyN, pattern, patternKind, caseSensitive, runDetect]);

  const parts = useMemo<PartPreview[]>(() => {
    if (!pageCount) return [];
    const breakPages = Array.from(breakSet).sort((a, b) => a - b);
    return buildPreview({
      total: pageCount,
      breakPages,
      excludePages: removeSeparators ? blankPages : [],
      names,
      reasons,
      baseName,
    });
  }, [pageCount, breakSet, blankPages, removeSeparators, names, reasons, baseName]);

  const removeBreak = (page: number) => {
    setBreakSet((prev) => {
      const next = new Set(prev);
      next.delete(page);
      return next;
    });
  };

  const addManualBreak = () => {
    const n = parseInt(manualPage.trim(), 10);
    if (!Number.isFinite(n)) {
      toast.error("Enter a page number");
      return;
    }
    if (n < 2 || n > pageCount) {
      toast.error(`Page must be between 2 and ${pageCount}`);
      return;
    }
    setBreakSet((prev) => new Set(prev).add(n));
    setReasons((prev) => ({ ...prev, [n]: prev[n] ?? "manual" }));
    setManualPage("");
  };

  const renamePart = (startPage: number, name: string) => {
    setNames((prev) => ({ ...prev, [startPage]: name }));
  };

  const runSplit = useCallback(async () => {
    if (!requirePro("Smart Document Splitter")) return;
    if (parts.length === 0) return;
    setSplitting(true);
    setSplitProgress(null);
    try {
      // Apply user-edited part filenames back into the preview list.
      const finalParts = parts.map((p) => ({
        ...p,
        name: p.name, // buildPreview already used the current names map
      }));
      const result = await splitByParts(file, finalParts, {
        zipName: `${baseName}-smart-split.zip`,
        onProgress: (p) => setSplitProgress(p),
      });
      await triggerDownload(result.blob, result.filename);
      toast.success(`Saved ${result.fileCount} files in zip`, {
        description: `${result.pageCount} pages · ${result.filename} · nothing was uploaded.`,
      });
    } catch (err) {
      console.error(err);
      toast.error("Split failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSplitting(false);
      setSplitProgress(null);
    }
  }, [file, parts, baseName, requirePro]);

  const modeChip = (m: DetectionMode, label: string) => {
    const active = mode === m;
    return (
      <button
        type="button"
        onClick={() => {
          if (!requirePro("Smart Document Splitter")) return;
          setMode(m);
        }}
        className={cn(
          "rounded-md border px-2 py-1 text-[11px] transition-colors",
          active
            ? "border-vault/60 bg-accent-soft text-foreground"
            : "border-border bg-surface-2 text-text-2 hover:text-foreground",
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <>
      <Section title="Detect breaks by" icon={<Sparkles className="h-3 w-3" />}>
        <div className="flex flex-wrap gap-1.5">
          {modeChip("blank", "Blank pages")}
          {modeChip("everyN", "Every N")}
          {modeChip("outline", "Bookmarks")}
          {modeChip("pattern", "Text pattern")}
        </div>

        {mode === "everyN" && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-text-2">every</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, pageCount)}
              value={everyN}
              onChange={(e) => setEveryN(Math.max(1, parseInt(e.target.value || "1", 10)))}
              className="w-16 rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[11.5px]"
            />
            <span className="text-[11px] text-text-2">pages</span>
          </div>
        )}

        {mode === "pattern" && (
          <div className="mt-2 space-y-1.5">
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={
                patternKind === "regex" ? "^(EXHIBIT|INVOICE)\\b" : "EXHIBIT"
              }
              spellCheck={false}
              className="w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 font-mono text-[11.5px]"
            />
            <div className="flex items-center gap-2 text-[10.5px] text-text-2">
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  checked={patternKind === "literal"}
                  onChange={() => setPatternKind("literal")}
                />
                Literal
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  checked={patternKind === "regex"}
                  onChange={() => setPatternKind("regex")}
                />
                Regex
              </label>
              <label className="ml-auto inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                />
                Case
              </label>
            </div>
            <p className="text-[10px] leading-snug text-text-muted">
              Matches the top of each page (e.g. section titles, Bates prefixes).
            </p>
          </div>
        )}

        {detecting && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-text-2">
            <RefreshCw className="h-3 w-3 animate-spin" />
            {progress ? `${progress.stage} ${progress.page}/${progress.total}` : "Detecting…"}
          </div>
        )}
      </Section>

      {detected !== null && (
        <Section title={`Preview — ${parts.length} document${parts.length === 1 ? "" : "s"}`}>
          {blankPages.length > 0 && (
            <label className="mb-2 flex items-center gap-1.5 text-[10.5px] text-text-2">
              <input
                type="checkbox"
                checked={removeSeparators}
                onChange={(e) => setRemoveSeparators(e.target.checked)}
              />
              Remove {blankPages.length} blank separator page
              {blankPages.length === 1 ? "" : "s"} ({blankPages.join(", ")})
            </label>
          )}
          <div className="max-h-[280px] space-y-1.5 overflow-y-auto pr-1">
            {parts.map((part) => {
              const isBreakDoc = part.index > 0;
              const rangeLabel =
                part.startPage === part.endPage
                  ? `page ${part.startPage}`
                  : `pages ${part.startPage}–${part.endPage}`;
              const suggested = names[part.startPage];
              const suggestedLabel =
                suggested && suggested !== part.name ? suggested : undefined;
              return (
                <div
                  key={part.index}
                  className="rounded-md border border-border bg-surface-2 px-2.5 py-2"
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11.5px] font-medium text-foreground">
                      Document {part.index + 1}
                    </span>
                    <span className="text-[10.5px] text-text-2 tabular-nums">
                      {rangeLabel}
                    </span>
                    <span className="text-[10px] text-text-muted tabular-nums">
                      ({part.pageCount} page{part.pageCount === 1 ? "" : "s"})
                    </span>
                    {isBreakDoc && (
                      <button
                        type="button"
                        onClick={() => removeBreak(part.startPage)}
                        title="Merge with previous document"
                        className="ml-auto rounded p-0.5 text-text-muted hover:text-foreground"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {suggestedLabel && (
                    <div className="mt-0.5 text-[10.5px] text-vault">
                      {suggestedLabel}
                    </div>
                  )}
                  <input
                    value={names[part.startPage] ?? part.name}
                    onChange={(e) => renamePart(part.startPage, e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-surface-1 px-1.5 py-1 font-mono text-[10.5px] text-foreground"
                  />
                  {part.reason && (
                    <div
                      className="mt-0.5 truncate text-[9.5px] text-text-muted"
                      title={part.reason}
                    >
                      {part.reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={manualPage}
              onChange={(e) => setManualPage(e.target.value)}
              placeholder="Add split before page…"
              className="flex-1 rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[11px]"
            />
            <button
              type="button"
              onClick={addManualBreak}
              className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-2 hover:text-foreground"
            >
              Add
            </button>
          </div>
        </Section>
      )}

      <button
        type="button"
        onClick={runSplit}
        disabled={splitting || parts.length === 0 || detected === null}
        className={cn(
          "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
          splitting || parts.length === 0 || detected === null
            ? "cursor-not-allowed opacity-50"
            : "hover:opacity-90",
        )}
      >
        {splitting ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {splitProgress
              ? `Writing ${splitProgress.part}/${splitProgress.total}…`
              : "Splitting…"}
          </>
        ) : (
          <>
            <Scissors className="h-3.5 w-3.5" /> Split into {parts.length || "?"} files
          </>
        )}
      </button>

      <div className="text-center text-[10px] text-text-muted">
        On-device · nothing leaves your browser
      </div>
    </>
  );
}

/* ----------------------------- Generic ------------------------------ */


/* ============================== Rotate ============================== */

function RotatePanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const [angle, setAngle] = useState<RotateAngle>(90);
  const [scope, setScope] = useState<RotateScope>("all");
  const [custom, setCustom] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setPageCount(0);
      return;
    }
    void (async () => {
      try {
        const n = await getRotatePageCount(file);
        if (!cancelled) setPageCount(n);
      } catch {
        if (!cancelled) setPageCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const resolved = useMemo(
    () => resolveRotateScope(scope, custom, pageCount),
    [scope, custom, pageCount],
  );

  const canRun =
    !!file &&
    !busy &&
    pageCount > 0 &&
    !resolved.error &&
    resolved.indices.length > 0;

  const run = useCallback(async () => {
    if (!file) {
      toast.error("Open a PDF first.");
      return;
    }
    setBusy(true);
    try {
      const result = await rotatePdf(file, { angle, scope, custom });
      await triggerDownload(result.blob, result.filename);
      toast.success(
        `Rotated ${result.rotatedCount} page${result.rotatedCount === 1 ? "" : "s"}`,
        { description: `${result.filename} · nothing was uploaded.` },
      );
    } catch (err) {
      console.error(err);
      toast.error("Rotate failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [file, angle, scope, custom]);

  const angleBtn = (a: RotateAngle, label: string, Icon: typeof RotateCw) => (
    <button
      type="button"
      onClick={() => setAngle(a)}
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11.5px] transition-colors",
        angle === a
          ? "border-vault/60 bg-accent-soft text-foreground"
          : "border-border bg-surface-2 text-text-2 hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );

  const scopeBtn = (id: RotateScope, label: string) => (
    <button
      type="button"
      onClick={() => setScope(id)}
      className={cn(
        "rounded-md border px-2 py-1.5 text-[11.5px] transition-colors",
        scope === id
          ? "border-vault/60 bg-accent-soft text-foreground"
          : "border-border bg-surface-2 text-text-2 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-3.5">
      {!file ? (
        <InspectorEmpty>Open a PDF in the workspace to rotate it.</InspectorEmpty>
      ) : (
        <>
          <Section title="Source" icon={<FileText className="h-3 w-3" />}>
            <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
              <div className="truncate text-[12px] text-foreground" title={file.name}>
                {file.name}
              </div>
              <div className="mt-0.5 text-[10.5px] text-text-muted tabular-nums">
                {pageCount > 0
                  ? `${pageCount} page${pageCount === 1 ? "" : "s"}`
                  : "Reading…"}
              </div>
            </div>
          </Section>

          <Section title="Angle" icon={<RotateCw className="h-3 w-3" />}>
            <div className="grid grid-cols-3 gap-1.5">
              {angleBtn(90, "90°", RotateCw)}
              {angleBtn(180, "180°", RotateCw)}
              {angleBtn(270, "270°", RotateCcw)}
            </div>
          </Section>

          <Section title="Pages">
            <div className="grid grid-cols-2 gap-1.5">
              {scopeBtn("all", "All")}
              {scopeBtn("odd", "Odd")}
              {scopeBtn("even", "Even")}
              {scopeBtn("custom", "Custom")}
            </div>
            {scope === "custom" && (
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="e.g. 1-3, 5, 8-10"
                spellCheck={false}
                className="mt-2 w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 font-mono text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40"
              />
            )}
            <div className="mt-1.5 text-[10.5px] leading-snug text-text-muted">
              {resolved.error ? (
                <span className="text-destructive">{resolved.error}</span>
              ) : pageCount === 0 ? (
                "Waiting for page count…"
              ) : (
                `Rotates ${resolved.indices.length} of ${pageCount} page${pageCount === 1 ? "" : "s"} by ${angle}°`
              )}
            </div>
          </Section>

          <button
            type="button"
            onClick={run}
            disabled={!canRun}
            className={cn(
              "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
              canRun ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
            )}
          >
            {busy ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Rotating…
              </>
            ) : (
              <>
                <RotateCw className="h-3.5 w-3.5" /> Rotate &amp; download
              </>
            )}
          </button>

          <div className="text-center text-[10px] text-text-muted">
            On-device · nothing leaves your browser
          </div>
        </>
      )}
    </div>
  );
}

function ComingSoonPanel({ label }: { label: string }) {
  return (
    <InspectorEmpty>
      The native <span className="text-foreground">{label}</span> panel is being mounted here. The full controls land in the next pass — same single inspector, no second column.
    </InspectorEmpty>
  );
}

/* ============================ Make Searchable (OCR) ============================ */

function OcrPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, ocr } = ctx;
  const [languages, setLanguages] = useState<string[]>(() => ocr?.defaults.languages ?? ["eng"]);
  const [highAccuracy, setHighAccuracy] = useState<boolean>(() => ocr?.defaults.highAccuracy ?? false);
  const [langs, setLangs] = useState<{ code: string; label: string; sizeMb: number }[] | null>(null);
  const [estimateMb, setEstimateMb] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    void importChunk(() => import("@/lib/pdf/ocr-languages")).then((m) => {
      if (!alive) return;
      setLangs(m.OCR_LANGUAGES as { code: string; label: string; sizeMb: number }[]);
      setEstimateMb(m.estimateDownloadMb(languages));
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!langs) return;
    void importChunk(() => import("@/lib/pdf/ocr-languages")).then((m) => setEstimateMb(m.estimateDownloadMb(languages)));
    if (ocr) ocr.defaults.languages = languages;
  }, [languages, langs, ocr]);

  useEffect(() => {
    if (ocr) ocr.defaults.highAccuracy = highAccuracy;
  }, [highAccuracy, ocr]);

  const toggleLang = (code: string) =>
    setLanguages((prev) =>
      prev.includes(code)
        ? prev.length === 1
          ? prev
          : prev.filter((c) => c !== code)
        : [...prev, code],
    );

  if (!file) {
    return (
      <InspectorEmpty>Open a document to run on-device OCR.</InspectorEmpty>
    );
  }
  if (!ocr) return null;

  const summary =
    languages.length === 1
      ? langs?.find((l) => l.code === languages[0])?.label ?? languages[0]
      : `${languages.length} languages`;

  const hasResume = ocr.scannedRemainingCount > 0 && (ocr.ocrPagesCount > 0 || ocr.ocrPagesCopiedCount > 0 || ocr.isPartial);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Language" icon={<FileText className="h-3 w-3" />}>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={ocr.running}
              className="inline-flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/50 disabled:opacity-60"
            >
              <span className="truncate">{summary}</span>
              <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0 max-h-72 overflow-y-auto">
            <div className="p-1.5">
              {(langs ?? []).map((l) => {
                const checked = languages.includes(l.code);
                return (
                  <label
                    key={l.code}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-2 cursor-pointer text-[12px]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLang(l.code)}
                      className="h-3 w-3 accent-[var(--vault)]"
                    />
                    <span className="flex-1 truncate">{l.label}</span>
                    <span className="text-[10px] text-text-muted">~{l.sizeMb} MB</span>
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        <p className="mt-1.5 text-[10.5px] leading-snug text-text-muted">
          Pick one for best accuracy. First use downloads ~{estimateMb} MB to your browser, then cached.
        </p>
      </Section>

      <Section title="Quality" icon={<Sparkles className="h-3 w-3" />}>
        <label className="flex items-start gap-2 text-[11.5px] text-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={highAccuracy}
            disabled={ocr.running}
            onChange={(e) => setHighAccuracy(e.target.checked)}
            className="mt-0.5 h-3 w-3 accent-[var(--vault)]"
          />
          <span>
            <span className="font-medium">High accuracy</span>
            <span className="text-text-muted"> — render at 2× instead of 1.5×. Better on small fonts; ~80% slower.</span>
          </span>
        </label>
      </Section>

      <Section title="Status" icon={<Info className="h-3 w-3" />}>
        <ul className="space-y-0.5 text-[11.5px] text-text-2">
          <li>Already searchable: <span className="text-foreground">{ocr.ocrPagesCopiedCount}</span></li>
          <li>OCR added: <span className="text-foreground">{ocr.ocrPagesCount}</span></li>
          <li>Scanned pages waiting: <span className="text-foreground">{ocr.scannedRemainingCount}</span></li>
        </ul>
        {ocr.running && ocr.progressText && (
          <p className="mt-1.5 text-[10.5px] text-text-muted">{ocr.progressText}</p>
        )}
      </Section>

      {ocr.running ? (
        <button
          type="button"
          onClick={ocr.stop}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium hover:bg-surface-3"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={() => ocr.run({ languages, highAccuracy })}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
          {hasResume ? "Resume OCR" : "Run OCR"}
        </button>
      )}

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}



/* ----------------------------- Section ------------------------------ */

function Section({
  title,
  icon,
  right,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-1.5 text-[10.5px] uppercase tracking-[0.16em] text-text-muted">
        <div className="flex items-center gap-1.5">
          {icon}
          {title}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/* ============================== Organize ============================== */

function OrganizePanel({ ctx }: { ctx: ToolPanelCtx }) {
  const cells = useOrganize((s) => s.cells);
  const selected = useOrganize((s) => s.selected);
  const sources = useOrganize((s) => s.sources);
  const selectAll = useOrganize((s) => s.selectAll);
  const clearSelection = useOrganize((s) => s.clearSelection);
  const selectRange = useOrganize((s) => s.selectRange);
  const requestJump = useOrganize((s) => s.requestJump);
  const rotateSelected = useOrganize((s) => s.rotateSelected);
  const deleteSelected = useOrganize((s) => s.deleteSelected);
  const addTrayEntry = useOrganize((s) => s.addTrayEntry);
  const addLocalFiles = useOrganize((s) => s.addLocalFiles);
  const resolveBytes = useOrganize((s) => s.resolveBytes);
  const colorFor = useOrganize((s) => s.colorFor);
  const density = useOrganize((s) => s.density);
  const setDensity = useOrganize((s) => s.setDensity);

  const addPdfsRef = useRef<HTMLInputElement | null>(null);


  const trayEntries = useTray((s) => s.entries);

  const [building, setBuilding] = useState(false);
  const [jumpVal, setJumpVal] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(c.source, (m.get(c.source) ?? 0) + 1);
    return m;
  }, [cells]);

  const buildPdf = useCallback(async () => {
    if (cells.length === 0) return;
    setBuilding(true);
    try {
      const bytes = await buildPdfFromCells(cells, resolveBytes);
      await downloadPdf(bytes, `counselpdf-organized-${Date.now()}.pdf`);
      toast.success(`Built PDF with ${cells.length} page${cells.length === 1 ? "" : "s"}`);
    } catch (err) {
      console.error("[organize] build failed", err);
      toast.error("Failed to build PDF", { description: (err as Error).message });
    } finally {
      setBuilding(false);
    }
  }, [cells, resolveBytes]);

  if (!ctx.file && cells.length === 0) {
    return (
      <InspectorEmpty>
        Open a document to organize its pages. You can also pull pages in from any other open document — they appear in the grid alongside the active document's pages.
      </InspectorEmpty>
    );
  }

  const sourceEntries = Object.entries(sources);

  const total = cells.length;
  const densityPercent = Math.round(density * 100);
  const densityCols = densityToGridColumns(density);
  const doJump = () => {
    const n = parseInt(jumpVal, 10);
    if (!Number.isFinite(n) || total === 0) return;
    const idx = Math.min(total, Math.max(1, n)) - 1;
    requestJump(idx);
  };
  const doSelectRange = (additive: boolean) => {
    const a = parseInt(rangeFrom, 10);
    const b = parseInt(rangeTo, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || total === 0) return;
    selectRange(a - 1, b - 1, additive);
    requestJump(Math.min(a, b) - 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Find page" icon={<Search className="h-3 w-3" />}>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={total || undefined}
            value={jumpVal}
            onChange={(e) => setJumpVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doJump();
            }}
            placeholder={total ? `1–${total}` : "Page #"}
            disabled={total === 0}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11.5px] tabular-nums text-foreground placeholder:text-text-muted focus:border-vault focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={doJump}
            disabled={total === 0 || !jumpVal}
            className="rounded-md bg-vault px-2.5 py-1.5 text-[11.5px] font-medium text-vault-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Go
          </button>
        </div>
      </Section>

      <Section
        title="Grid density"
        icon={<LayoutGrid className="h-3 w-3" />}
        right={<span className="font-mono text-[10px] text-vault">{densityPercent}% · {densityCols} cols</span>}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Big</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={densityPercent}
            onChange={(e) => setDensity(e.currentTarget.valueAsNumber / 100)}
            className="h-1 flex-1 accent-vault"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Small</span>
        </div>
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Drag to fit more or fewer thumbnails per row.
        </p>
      </Section>

      <Section title="Selection" icon={<LayoutGrid className="h-3 w-3" />}>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={selectAll}
            disabled={total === 0}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11.5px] text-foreground hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={selected.size === 0}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11.5px] text-foreground hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={total || undefined}
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
            placeholder="From"
            disabled={total === 0}
            className="w-0 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11.5px] tabular-nums text-foreground placeholder:text-text-muted focus:border-vault focus:outline-none disabled:opacity-50"
          />
          <span className="text-[11px] text-text-muted">to</span>
          <input
            type="number"
            min={1}
            max={total || undefined}
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSelectRange(e.shiftKey);
            }}
            placeholder="To"
            disabled={total === 0}
            className="w-0 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[11.5px] tabular-nums text-foreground placeholder:text-text-muted focus:border-vault focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => doSelectRange(false)}
            disabled={total === 0 || !rangeFrom || !rangeTo}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11.5px] text-foreground hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Select range
          </button>
          <button
            type="button"
            onClick={() => doSelectRange(true)}
            disabled={total === 0 || !rangeFrom || !rangeTo}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11.5px] text-foreground hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add range
          </button>
        </div>
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Shift-click a tile to extend the selection. Drag any tile to reorder.
        </p>
      </Section>


      <Section title="Edit pages" icon={<Wand2 className="h-3 w-3" />}>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={rotateSelected}
            disabled={selected.size === 0}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[11.5px] text-foreground hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCw className="h-3 w-3" /> Rotate 90°
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={selected.size === 0}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-evidence/40 bg-surface-2 px-2 py-1.5 text-[11.5px] text-evidence hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      </Section>

      <Section title="Sources" icon={<FilesIcon className="h-3 w-3" />}>
        <input
          ref={addPdfsRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) {
              void addLocalFiles(files).then(() => {
                toast.success(
                  `Added ${files.length} PDF${files.length === 1 ? "" : "s"}`,
                );
              });
            }
            if (addPdfsRef.current) addPdfsRef.current.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => addPdfsRef.current?.click()}
          className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3"
        >
          <Plus className="h-3.5 w-3.5" /> Add PDFs
        </button>
        <p className="mb-2 text-[10.5px] text-text-muted">
          Pick multiple files, or drag &amp; drop PDFs onto the grid. Pages are appended.
        </p>
        <ul className="flex flex-col gap-1">
          {sourceEntries.map(([key, src]) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-1.5 py-1"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: colorFor(key) }}
              />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground" title={src.fileName}>
                {key === "active" ? "★ " : ""}{src.fileName}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-text-muted">
                {counts.get(key) ?? 0}/{src.pageCount}
              </span>
            </li>
          ))}
        </ul>

        {trayEntries.length > 0 && (
          <>
            <div className="mt-2.5 mb-1 text-[10px] uppercase tracking-[0.14em] text-text-muted">
              Add from other open docs
            </div>
            <ul className="flex flex-col gap-1">
              {trayEntries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-1.5 py-1"
                >
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground" title={e.name}>
                    {e.name}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-text-muted">
                    {e.pageCount}p
                  </span>
                  <button
                    type="button"
                    onClick={() => void addTrayEntry(e.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-3 px-1.5 py-0.5 text-[10.5px] text-foreground hover:border-vault/40 hover:text-vault"
                  >
                    <Plus className="h-2.5 w-2.5" /> Add
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <button
        type="button"
        onClick={buildPdf}
        disabled={building || cells.length === 0}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
          (building || cells.length === 0) && "cursor-not-allowed opacity-60",
        )}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
        {building ? "Building…" : `Build PDF (${cells.length})`}
      </button>

      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ============================== Extract ============================== */

type ExtractMode = "pages" | "data";

function ExtractPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const [mode, setMode] = useState<ExtractMode>("pages");
  const modeBtn = (id: ExtractMode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(id)}
      className={cn(
        "flex-1 rounded-md border px-2 py-1.5 text-[11.5px] transition-colors",
        mode === id
          ? "border-vault/60 bg-accent-soft text-foreground"
          : "border-border bg-surface-2 text-text-2 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-1.5">
        {modeBtn("pages", "Pages → PDF")}
        {modeBtn("data", "Data → Excel")}
      </div>
      <div className="flex-1 min-h-0">
        {mode === "pages" ? (
          <ExtractPagesPanel ctx={ctx} />
        ) : (
          <ExtractDataPanel ctx={ctx} />
        )}
      </div>
    </div>
  );
}

/* ---------- Extract Pages ---------- */

function ExtractPagesPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const [ranges, setRanges] = useState("1-");
  const [pageCount, setPageCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setPageCount(0);
      return;
    }
    void (async () => {
      try {
        const { getPageCount } = await importChunk(() => import("@/lib/pdf/extract-pages"));
        const n = await getPageCount(file);
        if (!cancelled) setPageCount(n);
      } catch {
        if (!cancelled) setPageCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const parsed = useMemo(() => {
    if (!pageCount) return { count: 0, error: undefined as string | undefined };
    try {
      // Lazy-import shape isn't available synchronously; replicate the very
      // small validation locally to drive UI feedback. Real parse runs in
      // extractPages() inside the lib.
      const parts = ranges
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      let count = 0;
      for (const part of parts) {
        const m = part.match(/^(\d+)\s*(?:-\s*(\d*))?$/);
        if (!m) return { count: 0, error: `"${part}" isn't a valid range` };
        const start = parseInt(m[1], 10);
        const endRaw = m[2];
        const end =
          endRaw === undefined
            ? start
            : endRaw === ""
              ? pageCount
              : parseInt(endRaw, 10);
        if (start < 1 || end < 1 || start > pageCount || end > pageCount)
          return { count: 0, error: `"${part}" out of bounds (1–${pageCount})` };
        if (end < start)
          return { count: 0, error: `"${part}" goes backwards` };
        count += end - start + 1;
      }
      return { count, error: undefined };
    } catch {
      return { count: 0, error: "Invalid range" };
    }
  }, [ranges, pageCount]);

  const canRun = !!file && !busy && pageCount > 0 && !parsed.error && parsed.count > 0;

  const run = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { extractPages } = await importChunk(() => import("@/lib/pdf/extract-pages"));
      const result = await extractPages(file, ranges);
      triggerDownload(result.blob, result.filename);
      toast.success(
        `Extracted ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`,
        { description: `${result.filename} · nothing was uploaded.` },
      );
    } catch (err) {
      console.error(err);
      toast.error("Extract failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [file, ranges]);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF in the workspace to extract pages.</InspectorEmpty>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Section title="Source" icon={<FileText className="h-3 w-3" />}>
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div className="truncate text-[12px] text-foreground" title={file.name}>
            {file.name}
          </div>
          <div className="mt-0.5 text-[10.5px] text-text-muted tabular-nums">
            {pageCount > 0
              ? `${pageCount} page${pageCount === 1 ? "" : "s"}`
              : "Reading…"}
          </div>
        </div>
      </Section>

      <Section title="Pages" icon={<Scissors className="h-3 w-3" />}>
        <input
          value={ranges}
          onChange={(e) => setRanges(e.target.value)}
          placeholder="e.g. 1-3, 5, 8-10"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 font-mono text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40"
        />
        <div className="mt-1.5 text-[10.5px] leading-snug text-text-muted">
          {parsed.error ? (
            <span className="text-destructive">{parsed.error}</span>
          ) : pageCount === 0 ? (
            "Waiting for page count…"
          ) : (
            `Extracts ${parsed.count} of ${pageCount} page${pageCount === 1 ? "" : "s"} into a new PDF`
          )}
        </div>
      </Section>

      <button
        type="button"
        onClick={run}
        disabled={!canRun}
        className={cn(
          "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
          canRun ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
        )}
      >
        {busy ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Extracting…
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5" /> Extract &amp; download
          </>
        )}
      </button>

      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ============================== Extract Data ============================== */

type ExtractDataFormat = "xlsx" | "csv" | "json";

function ExtractDataPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const [format, setFormat] = useState<ExtractDataFormat>("xlsx");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setStatus("Reading PDF locally…");
    try {
      const { extractTables, downloadXlsx, rowsToCsv } = await importChunk(() => import(
        "@/lib/pdf/extract-tables"
      ));
      const results = await extractTables(file, 1.5, (p) => {
        setStatus(
          p.stage === "ocr"
            ? `OCR scanning page ${p.page} of ${p.totalPages}…`
            : `Reading page ${p.page} of ${p.totalPages}…`,
        );
      });
      if (results.length === 0) {
        toast.info("No tabular structure found in this PDF.");
        return;
      }
      const baseName = file.name.replace(/\.pdf$/i, "") || "extract";
      if (format === "xlsx") {
        await downloadXlsx(results, `${baseName}.xlsx`);
      } else if (format === "csv") {
        const parts = results.map(
          (t) => `# Page ${t.page}\n${rowsToCsv(t.rows)}`,
        );
        triggerDownload(
          new Blob([parts.join("\n\n")], { type: "text/csv" }),
          `${baseName}.csv`,
        );
      } else {
        const json = JSON.stringify(
          results.map((t) => ({ page: t.page, source: t.source, rows: t.rows })),
          null,
          2,
        );
        triggerDownload(
          new Blob([json], { type: "application/json" }),
          `${baseName}.json`,
        );
      }
      toast.success(
        `Extracted tables from ${results.length} page${results.length === 1 ? "" : "s"}`,
      );
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read that PDF. Is it password-protected?");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [file, format]);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF in the workspace to extract its data.</InspectorEmpty>
    );
  }

  const fmtBtn = (id: ExtractDataFormat, label: string) => (
    <button
      type="button"
      onClick={() => setFormat(id)}
      className={cn(
        "rounded-md border px-2 py-1.5 text-[11.5px] transition-colors",
        format === id
          ? "border-vault/60 bg-accent-soft text-foreground"
          : "border-border bg-surface-2 text-text-2 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Section title="Source" icon={<FileText className="h-3 w-3" />}>
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div className="truncate text-[12px] text-foreground" title={file.name}>
            {file.name}
          </div>
          {status && (
            <div className="mt-0.5 text-[10.5px] text-text-muted">{status}</div>
          )}
        </div>
      </Section>

      <Section title="Format" icon={<TableIcon className="h-3 w-3" />}>
        <div className="grid grid-cols-3 gap-1.5">
          {fmtBtn("xlsx", "Excel")}
          {fmtBtn("csv", "CSV")}
          {fmtBtn("json", "JSON")}
        </div>
      </Section>

      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={cn(
          "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
          busy ? "cursor-not-allowed opacity-50" : "hover:opacity-90",
        )}
      >
        {busy ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Extracting…
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5" /> Extract data
          </>
        )}
      </button>

      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

async function triggerDownload(blob: Blob, filename: string) {
  // Route PDFs through downloadPdf so the user's PDF/A preference applies.
  if (/\.pdf$/i.test(filename) || blob.type === "application/pdf") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await downloadPdf(bytes, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================== Watermark ============================== */

function WatermarkPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const [text, setText] = useState("CONFIDENTIAL");
  const [pos, setPos] = useState<
    import("@/lib/pdf/watermark").WatermarkPos
  >("diagonal");
  const [size, setSize] = useState(72);
  const [opacity, setOpacity] = useState(20);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (!file || !text.trim()) return;
    setBusy(true);
    try {
      const { applyTextWatermark } = await importChunk(() => import("@/lib/pdf/watermark"));
      const result = await applyTextWatermark(file, {
        text,
        opacity,
        size,
        pos,
      });
      triggerDownload(result.blob, result.filename);
      toast.success("Watermark added", {
        description: `${result.filename} · nothing was uploaded.`,
      });
    } catch (err) {
      console.error(err);
      toast.error("Watermark failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [file, text, opacity, size, pos]);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF in the workspace to add a watermark.</InspectorEmpty>
    );
  }

  const posBtn = (
    id: import("@/lib/pdf/watermark").WatermarkPos,
    label: string,
  ) => (
    <button
      type="button"
      onClick={() => setPos(id)}
      className={cn(
        "rounded-md border px-2 py-1.5 text-[11.5px] transition-colors",
        pos === id
          ? "border-vault/60 bg-accent-soft text-foreground"
          : "border-border bg-surface-2 text-text-2 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  const canRun = !!file && !busy && text.trim().length > 0;

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Section title="Source" icon={<FileText className="h-3 w-3" />}>
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div
            className="truncate text-[12px] text-foreground"
            title={file.name}
          >
            {file.name}
          </div>
        </div>
      </Section>

      <Section title="Text">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder="CONFIDENTIAL"
          className="w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40"
        />
      </Section>

      <Section title="Position">
        <div className="grid grid-cols-2 gap-1.5">
          {posBtn("diagonal", "Diagonal")}
          {posBtn("center", "Center")}
          {posBtn("top", "Top")}
          {posBtn("bottom", "Bottom")}
        </div>
      </Section>

      <Section
        title="Font size"
        right={
          <span className="font-mono text-[10.5px] text-foreground">
            {size}pt
          </span>
        }
      >
        <input
          type="range"
          min={12}
          max={160}
          value={size}
          onChange={(e) => setSize(parseInt(e.target.value, 10))}
          className="w-full accent-vault"
        />
      </Section>

      <Section
        title="Opacity"
        right={
          <span className="font-mono text-[10.5px] text-foreground">
            {opacity}%
          </span>
        }
      >
        <input
          type="range"
          min={5}
          max={100}
          value={opacity}
          onChange={(e) => setOpacity(parseInt(e.target.value, 10))}
          className="w-full accent-vault"
        />
      </Section>

      <button
        type="button"
        onClick={run}
        disabled={!canRun}
        className={cn(
          "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
          canRun ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
        )}
      >
        {busy ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Stamping…
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5" /> Add watermark &amp; download
          </>
        )}
      </button>

      <FirmTemplatesMenu
        kind="stamp"
        getConfig={() => ({ text, pos, size, opacity })}
        onApply={(cfg: { text?: string; pos?: typeof pos; size?: number; opacity?: number }) => {
          if (typeof cfg.text === "string") setText(cfg.text);
          if (cfg.pos) setPos(cfg.pos);
          if (typeof cfg.size === "number") setSize(cfg.size);
          if (typeof cfg.opacity === "number") setOpacity(cfg.opacity);
        }}
        sourceName={file?.name ?? null}
      />


      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ============================== Protect ============================== */

function ProtectPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const [userPassword, setUserPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [useOwnerPw, setUseOwnerPw] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [perms, setPerms] = useState(() => {
    return {
      printing: true,
      modifying: false,
      copying: false,
      annotating: true,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: false,
    };
  });
  const [showOwner, setShowOwner] = useState(false);
  const [showPerms, setShowPerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [strength, setStrength] = useState<{
    pct: number;
    label: string;
    color: string;
  }>({ pct: 0, label: "", color: "bg-muted" });

  useEffect(() => {
    let cancelled = false;
    void importChunk(() => import("@/lib/pdf/protect")).then((m) => {
      if (!cancelled) setStrength(m.scorePasswordStrength(userPassword));
    });
    return () => {
      cancelled = true;
    };
  }, [userPassword]);

  const PERM_ROWS: {
    key: keyof typeof perms;
    label: string;
    desc: string;
  }[] = [
    { key: "printing", label: "Allow printing", desc: "Print high-resolution copies" },
    { key: "copying", label: "Allow copying text & images", desc: "Selection and clipboard access" },
    { key: "modifying", label: "Allow editing content", desc: "Change pages, text, or structure" },
    { key: "annotating", label: "Allow comments & markup", desc: "Sticky notes, highlights" },
    { key: "fillingForms", label: "Allow filling forms", desc: "Type into interactive fields" },
    { key: "documentAssembly", label: "Allow page assembly", desc: "Insert, delete, rotate pages" },
    { key: "contentAccessibility", label: "Allow accessibility tools", desc: "Screen readers can read content" },
  ];

  const permSummary = useMemo(() => {
    const vals = Object.values(perms);
    const allTrue = vals.every((v) => v);
    const allFalse = vals.every((v) => !v);
    if (allTrue) return "All allowed";
    if (allFalse) return "All restricted";
    return "Some restricted";
  }, [perms]);

  const togglePerm = (k: keyof typeof perms) =>
    setPerms((p) => ({ ...p, [k]: !p[k] }));

  const run = useCallback(async () => {
    if (!file) return;
    if (userPassword.length < 4) {
      toast.error("Password must be at least 4 characters.");
      return;
    }
    if (userPassword !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }
    if (useOwnerPw && ownerPassword.length < 4) {
      toast.error("Owner password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    try {
      const { protectPdf } = await importChunk(() => import("@/lib/pdf/protect"));
      const result = await protectPdf(file, {
        userPassword,
        ownerPassword: useOwnerPw ? ownerPassword : undefined,
        permissions: perms,
      });
      triggerDownload(result.blob, result.filename);
      toast.success("Encrypted PDF downloaded", {
        description: `${result.filename} · nothing was uploaded.`,
      });
    } catch (err) {
      console.error(err);
      toast.error("Encryption failed", {
        description: err instanceof Error ? err.message : "Try a different PDF.",
      });
    } finally {
      setBusy(false);
    }
  }, [file, userPassword, confirmPassword, ownerPassword, useOwnerPw, perms]);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF in the workspace to encrypt it.</InspectorEmpty>
    );
  }

  const canRun =
    !busy &&
    userPassword.length >= 4 &&
    userPassword === confirmPassword &&
    (!useOwnerPw || ownerPassword.length >= 4);

  const pwInput = "w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40";

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Section title="Source" icon={<FileText className="h-3 w-3" />}>
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div className="truncate text-[12px] text-foreground" title={file.name}>
            {file.name}
          </div>
        </div>
      </Section>

      <Section title="Open password" icon={<KeyRound className="h-3 w-3" />}>
        <div className="space-y-2">
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
              placeholder="Password"
              autoComplete="new-password"
              className={cn(pwInput, "pr-8")}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-foreground"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <input
            type={showPw ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className={pwInput}
          />
          {userPassword && (
            <div className="space-y-1">
              <div className="h-1 w-full rounded-full bg-surface-2 overflow-hidden">
                <div
                  className={cn("h-full transition-all", strength.color)}
                  style={{ width: `${strength.pct}%` }}
                />
              </div>
              <div className="text-[10.5px] text-text-muted">
                {strength.label}
                {confirmPassword && confirmPassword !== userPassword && (
                  <span className="ml-2 text-destructive">Passwords don't match</span>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Owner password"
        right={
          <span className="text-[10.5px] text-text-muted">{useOwnerPw ? "On" : "Off"}</span>
        }
      >
        <div className="space-y-2">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={useOwnerPw}
              onChange={(e) => setUseOwnerPw(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-vault"
            />
            <span className="text-[12px] text-foreground">Set a separate owner password</span>
          </label>
          {useOwnerPw && (
            <>
              <p className="text-[10.5px] text-text-muted">
                Owners can change permissions. Recipients only need the open password.
              </p>
              <input
                type={showPw ? "text" : "password"}
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="Owner password"
                autoComplete="new-password"
                className={pwInput}
              />
            </>
          )}
        </div>
      </Section>

      <Section
        title="Permissions"
        icon={<ShieldCheck className="h-3 w-3" />}
        right={
          <button
            type="button"
            onClick={() => setShowPerms((s) => !s)}
            className="inline-flex items-center gap-1 text-[10.5px] text-text-muted hover:text-foreground"
          >
            {permSummary}
            <ChevronDown className={cn("h-3 w-3 transition-transform", showPerms && "rotate-180")} />
          </button>
        }
      >
        {showPerms && (
          <div className="space-y-1">
            {PERM_ROWS.map((row) => (
              <label
                key={row.key}
                className="flex cursor-pointer select-none items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 hover:bg-surface-1 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={perms[row.key]}
                  onChange={() => togglePerm(row.key)}
                  className="h-3.5 w-3.5 rounded border-border accent-vault"
                />
                <span className="min-w-0 flex-1 text-[12px] text-foreground leading-tight">
                  {row.label}
                </span>
                <span className="shrink-0 text-text-muted" title={row.desc}>
                  <Info className="h-3 w-3" />
                </span>
              </label>
            ))}
          </div>
        )}
      </Section>

      <button
        type="button"
        onClick={run}
        disabled={!canRun}
        className={cn(
          "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
          canRun ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
        )}
      >
        {busy ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Encrypting…
          </>
        ) : (
          <>
            <Lock className="h-3.5 w-3.5" /> Encrypt &amp; download
          </>
        )}
      </button>

      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · your password never leaves this tab
      </div>
    </div>
  );
}

/* ============================ Unlock ============================ */

function UnlockPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile } = ctx;
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!file) {
      setNeedsPassword(null);
      setPassword("");
      return;
    }
    let cancelled = false;
    setChecking(true);
    void importChunk(() => import("@/lib/pdf/unlock"))
      .then((m) => m.isPdfEncrypted(file))
      .then((enc) => {
        if (!cancelled) setNeedsPassword(enc);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const run = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { unlockPdf, WrongPasswordError } = await importChunk(() => import("@/lib/pdf/unlock"));
      try {
        const result = await unlockPdf(file, password || undefined);
        triggerDownload(result.blob, result.filename);
        toast.success(
          result.wasEncrypted ? "Unlocked PDF downloaded" : "Clean copy downloaded",
          { description: `${result.filename} · nothing was uploaded.` },
        );
        // Replace active tab with the decrypted copy so subsequent tools work.
        try {
          const decrypted = new File([result.blob], result.filename, {
            type: "application/pdf",
          });
          replaceFile(decrypted);
        } catch {
          /* ignore */
        }
      } catch (err) {
        if (err instanceof WrongPasswordError) {
          toast.error("Wrong password. Try again.");
        } else {
          throw err;
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Unlock failed", {
        description: err instanceof Error ? err.message : "Try a different PDF.",
      });
    } finally {
      setBusy(false);
    }
  }, [file, password, replaceFile]);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF in the workspace to unlock it.</InspectorEmpty>
    );
  }

  const pwInput =
    "w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40";

  const canRun = !busy && !checking && (!needsPassword || password.length > 0);

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Section title="Source" icon={<FileText className="h-3 w-3" />}>
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div className="truncate text-[12px] text-foreground" title={file.name}>
            {file.name}
          </div>
        </div>
      </Section>

      {checking ? (
        <Section title="Status">
          <div className="flex items-center gap-2 text-[11.5px] text-text-muted">
            <RefreshCw className="h-3 w-3 animate-spin" /> Checking encryption…
          </div>
        </Section>
      ) : needsPassword ? (
        <Section title="Open password" icon={<KeyRound className="h-3 w-3" />}>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter the PDF password"
              autoFocus
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canRun) {
                  e.preventDefault();
                  void run();
                }
              }}
              className={cn(pwInput, "pr-8")}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-foreground"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </Section>
      ) : (
        <Section title="Status">
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[11.5px] text-text-muted">
            <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vault" />
            <div>This PDF isn't password-protected — we'll re-save a clean copy.</div>
          </div>
        </Section>
      )}

      <button
        type="button"
        onClick={run}
        disabled={!canRun}
        className={cn(
          "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
          canRun ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
        )}
      >
        {busy ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Unlocking…
          </>
        ) : (
          <>
            <LockOpen className="h-3.5 w-3.5" /> Unlock &amp; download
          </>
        )}
      </button>

      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · your password never leaves this tab
      </div>

      <div className="text-center text-[10px] uppercase tracking-[0.18em] text-text-muted">
        Only unlock PDFs you have permission to open.
      </div>
    </div>
  );
}

/* ============================== Compare ============================== */

function ComparePanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, otherTabs = [] } = ctx;
  // Lazy-import the store to avoid pulling the canvas module into the panel
  // chunk unnecessarily — it's already shared state.
  
  const bSource = useCompare((s) => s.bSource);
  const setBSource = useCompare((s) => s.setBSource);
  const viewMode = useCompare((s) => s.viewMode);
  const setViewMode = useCompare((s) => s.setViewMode);
  const threshold = useCompare((s) => s.threshold);
  const setThreshold = useCompare((s) => s.setThreshold);
  const diffPixels = useCompare((s) => s.diffPixels);
  const sizeMatch = useCompare((s) => s.sizeMatch);
  const totalPages = useCompare((s) => s.totalPages);
  const page = useCompare((s) => s.page);
  const exporting = useCompare((s) => s.exporting);
  const setExporting = useCompare((s) => s.setExporting);

  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPickTab = (id: string) => {
    const t = otherTabs.find((x) => x.id === id);
    if (!t) return;
    setBSource({ kind: "tab", tabId: t.id, name: t.name, file: t.file });
  };

  const onPickFile = (f: File) => {
    setBSource({ kind: "file", name: f.name, file: f });
  };

  const onExport = useCallback(async () => {
    if (!file || bSource.kind === "none") return;
    setExporting(true);
    setExportProgress({ done: 0, total: 0 });
    try {
      const { exportDiffPdf } = await importChunk(() => import("@/lib/pdf/compare"));
      const result = await exportDiffPdf({
        a: file,
        b: bSource.file,
        threshold,
        onProgress: (done, total) => setExportProgress({ done, total }),
      });
      triggerDownload(result.blob, result.filename);
      toast.success(
        `Diff PDF downloaded — ${result.changedPages} of ${result.pages} pages changed`,
        { description: `${result.filename} · nothing was uploaded.` },
      );
    } catch (err) {
      console.error("[compare] export failed", err);
      toast.error("Couldn't build the diff PDF.", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }, [file, bSource, threshold, setExporting]);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF in the workspace to set it as document A, then pick B here.</InspectorEmpty>
    );
  }

  const inputCls =
    "w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[12px] text-foreground focus:border-vault/60 focus:outline-none focus:ring-1 focus:ring-vault/40";

  const bLabel = bSource.kind === "none" ? "(none)" : bSource.name;
  const canExport = bSource.kind !== "none" && !exporting && totalPages > 0;

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Section title="Document A" icon={<FileText className="h-3 w-3" />}>
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div className="truncate text-[12px] text-foreground" title={file.name}>{file.name}</div>
          <div className="mt-0.5 text-[10.5px] text-text-muted">Active tab</div>
        </div>
      </Section>

      <Section title="Document B" icon={<FileText className="h-3 w-3" />}>
        <div className="space-y-2">
          {otherTabs.length > 0 && (
            <select
              value={bSource.kind === "tab" ? bSource.tabId : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v) onPickTab(v);
              }}
              className={inputCls}
              aria-label="Pick from open tabs"
            >
              <option value="">— Pick from open tabs —</option>
              {otherTabs.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3 inline-flex items-center justify-center gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" /> Choose another file…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
              e.target.value = "";
            }}
          />
          <div className="truncate text-[10.5px] text-text-muted" title={bLabel}>
            B: {bLabel}
          </div>
        </div>
      </Section>

      <Section title="View" icon={<Eye className="h-3 w-3" />}>
        <div className="inline-flex w-full items-center rounded-md border border-border bg-surface-2 p-0.5">
          {(["side", "diff", "overlay"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              aria-pressed={viewMode === m}
              className={cn(
                "flex-1 rounded-[5px] px-2 py-1 text-[11.5px] font-medium transition-colors",
                viewMode === m ? "bg-vault text-vault-foreground" : "text-text-2 hover:text-foreground",
              )}
            >
              {m === "side" ? "Side by side" : m === "diff" ? "Diff only" : "Overlay"}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Sensitivity" icon={<ShieldCheck className="h-3 w-3" />}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.02}
            max={0.4}
            step={0.02}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="flex-1 accent-vault"
            aria-label="Sensitivity"
          />
          <span className="w-10 text-right font-mono text-[11px] text-foreground/80 tabular-nums">
            {threshold.toFixed(2)}
          </span>
        </div>
        <div className="mt-1 text-[10.5px] text-text-muted">
          Lower = stricter (catches more differences).
        </div>
      </Section>

      {bSource.kind !== "none" && (
        <Section title="Result" icon={<GitCompare className="h-3 w-3" />}>
          <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[11.5px]">
            {!sizeMatch ? (
              <div className="text-amber-500">Page {page} sizes differ — visual diff skipped.</div>
            ) : diffPixels === null ? (
              <div className="text-text-muted">Rendering page {page}…</div>
            ) : diffPixels === 0 ? (
              <div className="text-foreground">Page {page}: identical pixel-for-pixel.</div>
            ) : (
              <div className="text-foreground">
                Page {page}: <span className="font-mono">{diffPixels.toLocaleString()}</span> px changed.
              </div>
            )}
            <div className="mt-0.5 text-[10.5px] text-text-muted">
              {totalPages > 0 ? `${totalPages} page${totalPages === 1 ? "" : "s"} total` : ""}
            </div>
          </div>
        </Section>
      )}

      <button
        type="button"
        onClick={onExport}
        disabled={!canExport}
        className={cn(
          "mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
          canExport ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
        )}
      >
        {exporting ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Exporting {exportProgress ? `${exportProgress.done}/${exportProgress.total}` : "…"}
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5" /> Export diff PDF
          </>
        )}
      </button>

      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · both PDFs stay in this tab.
      </div>
    </div>
  );
}

/* ============================ PDF → Word ============================ */

function ToWordPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const [mode, setMode] = useState<"flow" | "page">("flow");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF to convert it to an editable Word document.</InspectorEmpty>
    );
  }

  const run = async () => {
    setBusy(true);
    setProgress(0);
    const tid = "wsx-to-word";
    toast.loading("Converting to Word…", { id: tid });
    try {
      const { convertPdfToWordBlob } = await importChunk(() => import("@/lib/pdf/to-word"));
      const blob = await convertPdfToWordBlob(file, { mode, onProgress: setProgress });
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBytes(new Uint8Array(await blob.arrayBuffer()), `${base}.docx`);
      toast.success("Word document downloaded", { id: tid });
    } catch (err) {
      console.error("[to-word] failed", err);
      toast.error("Conversion failed", { id: tid, description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Layout" icon={<FileText className="h-3 w-3" />}>
        <div className="grid grid-cols-1 gap-1.5">
          <ModeRow
            active={mode === "flow"}
            onClick={() => setMode("flow")}
            label="Continuous flow"
            hint="One body of text, no page markers."
          />
          <ModeRow
            active={mode === "page"}
            onClick={() => setMode("page")}
            label="Page breaks + labels"
            hint="Insert a page break and “Page N” heading per source page."
          />
        </div>
      </Section>

      <Section title="Notes" icon={<Info className="h-3 w-3" />}>
        <p className="text-[10.5px] leading-snug text-text-muted">
          Text-only conversion. Images, tables and complex layouts may not
          survive cleanly — if the PDF is scanned, run{" "}
          <span className="text-foreground">Make Searchable</span> first.
        </p>
      </Section>

      {busy && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div className="h-full bg-vault transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[10.5px] text-text-muted">Reading pages… {progress}%</div>
        </div>
      )}

      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
          busy && "cursor-wait opacity-60",
        )}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
        {busy ? "Converting…" : "Convert & download .docx"}
      </button>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

function ModeRow({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors",
        active
          ? "border-vault/60 bg-vault/10"
          : "border-border bg-surface-2 hover:border-vault/40",
      )}
    >
      <span className="text-[12px] font-medium text-foreground">{label}</span>
      <span className="text-[10.5px] text-text-muted">{hint}</span>
    </button>
  );
}

/* ============================ Word → PDF ============================ */

function WordToPdfPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [pageSize, setPageSize] = useState<"letter" | "a4">("letter");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pickFile = () => inputRef.current?.click();

  const onPicked = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) {
      toast.error("Only .docx files are supported. Convert .doc to .docx first.");
      return;
    }
    setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setProgress("Reading document…");
    const tid = "wsx-word-to-pdf";
    toast.loading("Converting to PDF…", { id: tid });
    try {
      const { convertWordToPdfBlob } = await importChunk(() => import("@/lib/pdf/word-to-pdf"));
      const { blob, pages } = await convertWordToPdfBlob(file, {
        pageSize,
        onProgress: setProgress,
      });
      const base = file.name.replace(/\.docx$/i, "");
      await downloadPdf(new Uint8Array(await blob.arrayBuffer()), `${base}.pdf`);
      toast.success(`Converted ${pages} page${pages === 1 ? "" : "s"}`, { id: tid });
    } catch (err) {
      console.error("[word-to-pdf] failed", err);
      toast.error("Conversion failed", { id: tid, description: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          onPicked(e.target.files?.[0]);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      <Section title="Source document" icon={<FileText className="h-3 w-3" />}>
        {file ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-foreground">{file.name}</div>
              <div className="text-[10.5px] text-text-muted">
                {(file.size / 1024).toFixed(1)} KB
              </div>
            </div>
            <button
              type="button"
              onClick={pickFile}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-2 hover:border-vault/40 hover:text-foreground"
            >
              Replace
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={pickFile}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[12px] text-text-2 hover:border-vault/40 hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" />
            Choose a .docx file…
          </button>
        )}
      </Section>

      <Section title="Page size" icon={<Info className="h-3 w-3" />}>
        <div className="grid grid-cols-1 gap-1.5">
          <ModeRow
            active={pageSize === "letter"}
            onClick={() => setPageSize("letter")}
            label="US Letter"
            hint="8.5 × 11 in"
          />
          <ModeRow
            active={pageSize === "a4"}
            onClick={() => setPageSize("a4")}
            label="A4"
            hint="210 × 297 mm"
          />
        </div>
      </Section>

      <Section title="Notes" icon={<Info className="h-3 w-3" />}>
        <p className="text-[10.5px] leading-snug text-text-muted">
          Headings, lists, tables and images are preserved. Complex Word layouts
          may shift.
        </p>
      </Section>

      {busy && (
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[10.5px] text-text-muted">
          {progress || "Working…"}
        </div>
      )}

      <button
        type="button"
        onClick={run}
        disabled={busy || !file}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
          (busy || !file) && "cursor-not-allowed opacity-60",
        )}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
        {busy ? "Converting…" : "Convert & download .pdf"}
      </button>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}


/* ============================ Unified Convert ============================ */

type ConvertSourceKind = "pdf" | "word" | "images" | null;
type ConvertTarget = "word" | "excel" | "images" | "pdf";

function detectKind(files: File[]): ConvertSourceKind {
  if (!files.length) return null;
  if (files.every((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name))) {
    return "images";
  }
  const f = files[0];
  if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") return "pdf";
  if (/\.docx$/i.test(f.name)) return "word";
  return null;
}

function ConvertPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const [picked, setPicked] = useState<File[]>([]);
  const [usingActive, setUsingActive] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Effective source: picked files override the active tab.
  const sources: File[] = picked.length > 0
    ? picked
    : (usingActive && ctx.file ? [ctx.file] : []);
  const kind = detectKind(sources);

  // Target selection — reset when kind changes.
  const allowedTargets: ConvertTarget[] =
    kind === "pdf" ? ["word", "excel"]
    : kind === "word" ? ["pdf"]
    : [];
  const [target, setTarget] = useState<ConvertTarget | null>(null);
  useEffect(() => {
    if (!allowedTargets.length) { setTarget(null); return; }
    if (!target || !allowedTargets.includes(target)) setTarget(allowedTargets[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Settings per target.
  const [wordMode, setWordMode] = useState<"flow" | "page" | "fidelity">("flow");
  const [wordIncludeImages, setWordIncludeImages] = useState(false);
  const [imgFormat, setImgFormat] = useState<"png" | "jpg">("png");
  const [imgDpi, setImgDpi] = useState<number>(150);
  const [imgQuality, setImgQuality] = useState<number>(0.92);
  const [imgPages, setImgPages] = useState<string>("");
  const [pdfPageSize, setPdfPageSize] = useState<"letter" | "a4">("letter");
  const [imagesPageSize, setImagesPageSize] = useState<"auto" | "letter" | "a4">("auto");
  const [imagesFit, setImagesFit] = useState<"fit" | "fill">("fit");
  const [imagesMargin, setImagesMargin] = useState<number>(24);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const onPick = (files: FileList | null) => {
    if (!files || !files.length) return;
    const arr = Array.from(files);
    const first = arr[0];
    if (/\.pdf$/i.test(first.name) || /\.docx$/i.test(first.name)) {
      setPicked([first]);
    } else {
      toast.error("Drop a PDF or a .docx file. For images, use the Image Convert tool.");
      return;
    }
    setUsingActive(false);
  };

  const clearPicked = () => {
    setPicked([]);
    setUsingActive(true);
  };

  const run = async () => {
    if (!sources.length || !target) return;
    setBusy(true);
    setProgress("Starting…");
    const tid = "wsx-convert";
    toast.loading("Converting…", { id: tid });
    try {
      if (kind === "pdf" && target === "word") {
        const file = sources[0];
        const prepared =
          wordMode === "fidelity" ? file : await ensureSearchablePdf(file, (s) => setProgress(s));
        setProgress("Building .docx…");
        const { convertPdfToWordBlob } = await importChunk(() => import("@/lib/pdf/to-word"));
        const blob = await convertPdfToWordBlob(prepared, {
          mode: wordMode,
          includeImages: wordIncludeImages,
          onProgress: (pct, stage) => setProgress(stage ?? `Reading pages… ${pct}%`),
        });
        const base = file.name.replace(/\.pdf$/i, "");
        downloadBytes(new Uint8Array(await blob.arrayBuffer()), `${base}.docx`);
        toast.success("Word document downloaded", { id: tid });
      } else if (kind === "pdf" && target === "excel") {
        const file = sources[0];
        // extractTables already OCRs page-by-page where needed.
        const { extractTables, downloadXlsx } = await importChunk(() => import("@/lib/pdf/extract-tables"));
        const result = await extractTables(file, 1.5, (p) => {
          setProgress(`Scanning page ${p.page}/${p.totalPages} (${p.stage})`);
        });
        if (result.length === 0) {
          toast.warning("No tables detected in this PDF.", { id: tid });
        } else {
          await downloadXlsx(result, file.name.replace(/\.pdf$/i, "") + ".xlsx");
          toast.success(`Exported ${result.length} table${result.length === 1 ? "" : "s"}`, { id: tid });
        }
      } else if (kind === "pdf" && target === "images") {
        const file = sources[0];
        const { convertPdfToImages } = await importChunk(() => import("@/lib/pdf/to-images"));
        const res = await convertPdfToImages(file, {
          format: imgFormat,
          dpi: imgDpi,
          quality: imgQuality,
          pages: imgPages.trim() || undefined,
          onProgress: (pct) => setProgress(`Rendering pages… ${pct}%`),
        });
        downloadBytes(new Uint8Array(await res.blob.arrayBuffer()), res.filename);
        toast.success(`Exported ${res.pages} page${res.pages === 1 ? "" : "s"}`, { id: tid });
      } else if (kind === "word" && target === "pdf") {
        const file = sources[0];
        const { convertWordToPdfBlob } = await importChunk(() => import("@/lib/pdf/word-to-pdf"));
        const { blob, pages } = await convertWordToPdfBlob(file, {
          pageSize: pdfPageSize,
          onProgress: (s) => setProgress(s),
        });
        const base = file.name.replace(/\.docx$/i, "");
        await downloadPdf(new Uint8Array(await blob.arrayBuffer()), `${base}.pdf`);
        toast.success(`Converted ${pages} page${pages === 1 ? "" : "s"}`, { id: tid });
      } else if (kind === "images" && target === "pdf") {
        const { buildPdfFromImages } = await importChunk(() => import("@/lib/pdf/images-to-pdf"));
        const res = await buildPdfFromImages(sources, {
          pageSize: imagesPageSize,
          fit: imagesFit,
          margin: imagesMargin,
          onProgress: (pct) => setProgress(`Building PDF… ${pct}%`),
        });
        downloadBytes(new Uint8Array(await res.blob.arrayBuffer()), res.filename);
        toast.success(`Built PDF from ${res.pages} image${res.pages === 1 ? "" : "s"}`, { id: tid });
      } else {
        toast.error("Unsupported conversion", { id: tid });
      }
    } catch (err) {
      console.error("[convert] failed", err);
      toast.error("Conversion failed", { id: tid, description: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      <Section title="Source" icon={<FileText className="h-3 w-3" />}>
        {sources.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-foreground">
                  {sources.length === 1
                    ? sources[0].name
                    : `${sources.length} images`}
                </div>
                <div className="text-[10.5px] text-text-muted">
                  {kind === "pdf" && "PDF · active tab"}
                  {kind === "pdf" && picked.length > 0 && " (replaced)"}
                  {kind === "word" && "Word .docx"}
                  {kind === "images" && `${sources.length} file${sources.length === 1 ? "" : "s"}`}
                  {!kind && "Unsupported file type"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-md border border-border px-2 py-1 text-[10.5px] text-text-2 hover:border-vault/40 hover:text-foreground"
                >
                  Replace
                </button>
                {picked.length > 0 && ctx.file && (
                  <button
                    type="button"
                    onClick={clearPicked}
                    className="rounded-md border border-border px-2 py-1 text-[10.5px] text-text-2 hover:border-vault/40 hover:text-foreground"
                  >
                    Use active
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[12px] text-text-2 hover:border-vault/40 hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" />
            Drop a PDF, Word doc, or images…
          </button>
        )}
      </Section>

      {kind === "images" && sources.length > 0 && (
        <Section title={`Order (${sources.length})`} icon={<Info className="h-3 w-3" />}>
          <div className="text-[10.5px] text-text-muted mb-1.5">
            Order = page order in the PDF. Use the arrows to reorder.
          </div>
          <ul className="space-y-1">
            {picked.map((f, i) => (
              <li
                key={`${f.name}-${i}-${f.size}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
                  if (!Number.isFinite(from) || from === i) return;
                  setPicked((prev) => {
                    const next = prev.slice();
                    const [m] = next.splice(from, 1);
                    next.splice(i, 0, m);
                    return next;
                  });
                }}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5"
              >
                <span className="w-5 text-center font-mono text-[10.5px] text-text-muted">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
                  {f.name}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() =>
                      setPicked((prev) => {
                        if (i === 0) return prev;
                        const next = prev.slice();
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        return next;
                      })
                    }
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-2 hover:border-vault/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === picked.length - 1}
                    onClick={() =>
                      setPicked((prev) => {
                        if (i === prev.length - 1) return prev;
                        const next = prev.slice();
                        [next[i + 1], next[i]] = [next[i], next[i + 1]];
                        return next;
                      })
                    }
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-2 hover:border-vault/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() =>
                      setPicked((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="ml-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-2 hover:border-vault/40 hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-2 w-full rounded-md border border-dashed border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-2 hover:border-vault/40 hover:text-foreground"
          >
            + Add more images
          </button>
        </Section>
      )}

      {kind && allowedTargets.length > 0 && (
        <Section title="Convert to" icon={<Info className="h-3 w-3" />}>
          <div className="grid grid-cols-1 gap-1.5">
            {allowedTargets.map((t) => (
              <ModeRow
                key={t}
                active={target === t}
                onClick={() => setTarget(t)}
                label={
                  t === "word" ? "Word document (.docx)"
                  : t === "excel" ? "Excel spreadsheet (.xlsx)"
                  : t === "images" ? "Images (PNG / JPG)"
                  : "PDF document (.pdf)"
                }
                hint={
                  t === "word" ? "Editable text. OCR runs automatically for scanned PDFs."
                  : t === "excel" ? "Detected tables, one sheet per table."
                  : t === "images" ? "One image per page, zipped for multi-page."
                  : kind === "word" ? "Render the .docx to a clean PDF."
                  : "Combine your images into a single PDF."
                }
              />
            ))}
          </div>
        </Section>
      )}

      {kind === "pdf" && target === "word" && (
        <Section title="Layout" icon={<FileText className="h-3 w-3" />}>
          <div className="grid grid-cols-1 gap-1.5">
            <ModeRow active={wordMode === "flow"} onClick={() => setWordMode("flow")}
              label="Continuous flow" hint="Editable text with bold/italic + embedded images." />
            <ModeRow active={wordMode === "page"} onClick={() => setWordMode("page")}
              label="Page breaks + labels" hint="Same as flow, with a page break and “Page N” heading per source page." />
            <ModeRow active={wordMode === "fidelity"} onClick={() => setWordMode("fidelity")}
              label="High fidelity (page images)" hint="Preserves layout exactly by embedding each page as an image. Not editable as text." />
          </div>
          {wordMode !== "fidelity" && (
            <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-[12px] cursor-pointer">
              <span>
                <span className="text-foreground">Include images</span>
                <span className="block text-[11px] text-muted-foreground">
                  On = slower, embeds images. Off (default) = fast text-only.
                </span>
              </span>
              <input
                type="checkbox"
                checked={wordIncludeImages}
                onChange={(e) => setWordIncludeImages(e.target.checked)}
                className="h-4 w-4 accent-vault"
              />
            </label>
          )}
        </Section>
      )}

      {kind === "pdf" && target === "images" && (
        <>
          <Section title="Format" icon={<Info className="h-3 w-3" />}>
            <div className="grid grid-cols-2 gap-1.5">
              <ModeRow active={imgFormat === "png"} onClick={() => setImgFormat("png")} label="PNG" hint="Lossless" />
              <ModeRow active={imgFormat === "jpg"} onClick={() => setImgFormat("jpg")} label="JPG" hint="Smaller files" />
            </div>
          </Section>
          <Section title="Resolution" icon={<Info className="h-3 w-3" />}>
            <div className="grid grid-cols-3 gap-1.5">
              {[72, 150, 300].map((d) => (
                <ModeRow key={d} active={imgDpi === d} onClick={() => setImgDpi(d)}
                  label={`${d} dpi`}
                  hint={d === 72 ? "Screen" : d === 150 ? "Standard" : "Print"} />
              ))}
            </div>
            {imgFormat === "jpg" && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10.5px] text-text-muted mb-1">
                  <span>JPG quality</span>
                  <span className="font-mono text-foreground/80">{Math.round(imgQuality * 100)}%</span>
                </div>
                <input type="range" min={0.4} max={1} step={0.02} value={imgQuality}
                  onChange={(e) => setImgQuality(parseFloat(e.target.value))}
                  className="w-full accent-vault" />
              </div>
            )}
          </Section>
          <Section title="Pages" icon={<Info className="h-3 w-3" />}>
            <input
              type="text"
              inputMode="numeric"
              value={imgPages}
              onChange={(e) => setImgPages(e.target.value)}
              placeholder="All pages — or e.g. 1-3, 7, 10-12"
              className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
            />
            <div className="mt-1.5 text-[10.5px] text-text-muted">
              Leave empty to export every page.
            </div>
          </Section>
        </>
      )}

      {kind === "word" && target === "pdf" && (
        <Section title="Page size" icon={<Info className="h-3 w-3" />}>
          <div className="grid grid-cols-2 gap-1.5">
            <ModeRow active={pdfPageSize === "letter"} onClick={() => setPdfPageSize("letter")}
              label="US Letter" hint="8.5 × 11 in" />
            <ModeRow active={pdfPageSize === "a4"} onClick={() => setPdfPageSize("a4")}
              label="A4" hint="210 × 297 mm" />
          </div>
        </Section>
      )}

      {kind === "images" && target === "pdf" && (
        <>
          <Section title="Page size" icon={<Info className="h-3 w-3" />}>
            <div className="grid grid-cols-3 gap-1.5">
              <ModeRow active={imagesPageSize === "auto"} onClick={() => setImagesPageSize("auto")}
                label="Match" hint="Image size" />
              <ModeRow active={imagesPageSize === "letter"} onClick={() => setImagesPageSize("letter")}
                label="Letter" hint="8.5×11" />
              <ModeRow active={imagesPageSize === "a4"} onClick={() => setImagesPageSize("a4")}
                label="A4" hint="210×297" />
            </div>
          </Section>
          {imagesPageSize !== "auto" && (
            <Section title="Fit" icon={<Info className="h-3 w-3" />}>
              <div className="grid grid-cols-2 gap-1.5">
                <ModeRow active={imagesFit === "fit"} onClick={() => setImagesFit("fit")}
                  label="Fit" hint="Whole image" />
                <ModeRow active={imagesFit === "fill"} onClick={() => setImagesFit("fill")}
                  label="Fill" hint="No borders" />
              </div>
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10.5px] text-text-muted mb-1">
                  <span>Margin</span>
                  <span className="font-mono text-foreground/80">{imagesMargin}pt</span>
                </div>
                <input type="range" min={0} max={72} step={2} value={imagesMargin}
                  onChange={(e) => setImagesMargin(parseInt(e.target.value, 10))}
                  className="w-full accent-vault" />
              </div>
            </Section>
          )}
        </>
      )}

      {busy && (
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[10.5px] text-text-muted">
          {progress || "Working…"}
        </div>
      )}

      <button
        type="button"
        onClick={run}
        disabled={busy || !sources.length || !target || !kind}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
          (busy || !sources.length || !target || !kind) && "cursor-not-allowed opacity-60",
        )}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
        {busy ? "Converting…" : target ? `Convert & download` : "Pick a target"}
      </button>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/**
 * If the PDF has no extractable text on its first few pages, treat it as
 * scanned and run OCR to produce a searchable PDF before converting.
 * Returns the (possibly replaced) File ready to feed to text-based converters.
 */
async function ensureSearchablePdf(
  file: File,
  onStatus: (s: string) => void,
): Promise<File> {
  try {
    const { loadPdfjs } = await importChunk(() => import("@/lib/pdf/worker"));
    const pdfjs = await loadPdfjs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const probePages = Math.min(doc.numPages, 3);
    let totalChars = 0;
    for (let i = 1; i <= probePages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      totalChars += tc.items.reduce((n: number, it: any) => n + (it.str?.length ?? 0), 0);
    }
    // < ~40 chars per probed page → almost certainly scanned.
    if (totalChars >= 40 * probePages) return file;

    onStatus("Scanned PDF detected — running OCR first…");
    const { ocrPdfToSearchable } = await importChunk(() => import("@/lib/pdf/ocr-pdf"));
    const { runAsJob } = await import("@/lib/jobs/registry");
    const { promise } = runAsJob(
      { kind: "ocr", docId: `${file.name}:${file.size}`, docLabel: file.name },
      async ({ signal, onProgress }) => {
        return await ocrPdfToSearchable(file, (p) => {
          onStatus(`OCR · page ${p.page}/${p.totalPages} (${p.stage})`);
          const total = p.totalPages || 1;
          onProgress({ fraction: total ? p.page / total : 0, step: `${p.stage} ${p.page}/${total}` });
        }, signal);
      },
    );
    const out = await promise;
    return new File([out as BlobPart], file.name, { type: "application/pdf" });
  } catch (err) {
    console.warn("[convert] auto-OCR probe failed, continuing with original file", err);
    return file;
  }
}

/* ============================ Image Convert ============================ */
/**
 * Dedicated Image ⇄ PDF tool. Detects input:
 *   • PDF (active tab or picked) → PDF → Images (PNG/JPG, dpi, page range)
 *   • Image file(s) picked       → Images → PDF (page size, fit, margin, order)
 * Reuses the same underlying functions as the unified Convert tool. No new logic.
 */
function ImageConvertPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const [picked, setPicked] = useState<File[]>([]);
  const [usingActive, setUsingActive] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isImage = (f: File) =>
    /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
  const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";

  // Effective source: picked files override the active tab.
  const sources: File[] =
    picked.length > 0 ? picked : usingActive && ctx.file ? [ctx.file] : [];

  const direction: "pdf-to-images" | "images-to-pdf" | null =
    sources.length === 0
      ? null
      : sources.every(isImage)
      ? "images-to-pdf"
      : sources.length === 1 && isPdf(sources[0])
      ? "pdf-to-images"
      : null;

  // PDF → Images settings
  const [imgFormat, setImgFormat] = useState<"png" | "jpg">("png");
  const [imgDpi, setImgDpi] = useState<number>(150);
  const [imgQuality, setImgQuality] = useState<number>(0.92);
  const [imgPages, setImgPages] = useState<string>("");

  // Images → PDF settings
  const [imagesPageSize, setImagesPageSize] = useState<"auto" | "letter" | "a4">("auto");
  const [imagesFit, setImagesFit] = useState<"fit" | "fill">("fit");
  const [imagesMargin, setImagesMargin] = useState<number>(24);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const onPick = (files: FileList | null) => {
    if (!files || !files.length) return;
    const arr = Array.from(files);
    const first = arr[0];
    if (isPdf(first)) {
      setPicked([first]);
    } else {
      const imgs = arr.filter(isImage);
      if (!imgs.length) {
        toast.error("Drop a PDF or one-or-more image files.");
        return;
      }
      setPicked((prev) => {
        const prevAllImages = prev.length > 0 && prev.every(isImage);
        return prevAllImages ? [...prev, ...imgs] : imgs;
      });
    }
    setUsingActive(false);
  };

  const clearPicked = () => {
    setPicked([]);
    setUsingActive(true);
  };

  const run = async () => {
    if (!direction || !sources.length) return;
    setBusy(true);
    setProgress("Starting…");
    const tid = "wsx-image-convert";
    toast.loading("Converting…", { id: tid });
    try {
      if (direction === "pdf-to-images") {
        const file = sources[0];
        const { convertPdfToImages } = await importChunk(() => import("@/lib/pdf/to-images"));
        const res = await convertPdfToImages(file, {
          format: imgFormat,
          dpi: imgDpi,
          quality: imgQuality,
          pages: imgPages.trim() || undefined,
          onProgress: (pct) => setProgress(`Rendering pages… ${pct}%`),
        });
        downloadBytes(new Uint8Array(await res.blob.arrayBuffer()), res.filename);
        toast.success(`Exported ${res.pages} page${res.pages === 1 ? "" : "s"}`, { id: tid });
      } else {
        const { buildPdfFromImages } = await importChunk(() => import("@/lib/pdf/images-to-pdf"));
        const res = await buildPdfFromImages(sources, {
          pageSize: imagesPageSize,
          fit: imagesFit,
          margin: imagesMargin,
          onProgress: (pct) => setProgress(`Building PDF… ${pct}%`),
        });
        downloadBytes(new Uint8Array(await res.blob.arrayBuffer()), res.filename);
        toast.success(`Built PDF from ${res.pages} image${res.pages === 1 ? "" : "s"}`, { id: tid });
      }
    } catch (err) {
      console.error("[image-convert] failed", err);
      toast.error("Conversion failed", { id: tid, description: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      <Section title="Source" icon={<FileText className="h-3 w-3" />}>
        {sources.length > 0 ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-foreground">
                {sources.length === 1 ? sources[0].name : `${sources.length} images`}
              </div>
              <div className="text-[10.5px] text-text-muted">
                {direction === "pdf-to-images" && (picked.length ? "PDF · picked" : "PDF · active tab")}
                {direction === "images-to-pdf" && `${sources.length} image${sources.length === 1 ? "" : "s"}`}
                {!direction && "Mixed input — pick a PDF or images only"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-md border border-border px-2 py-1 text-[10.5px] text-text-2 hover:border-vault/40 hover:text-foreground"
              >
                Replace
              </button>
              {picked.length > 0 && ctx.file && (
                <button
                  type="button"
                  onClick={clearPicked}
                  className="rounded-md border border-border px-2 py-1 text-[10.5px] text-text-2 hover:border-vault/40 hover:text-foreground"
                >
                  Use active
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[12px] text-text-2 hover:border-vault/40 hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" />
            Drop a PDF or images…
          </button>
        )}
      </Section>

      {direction === "images-to-pdf" && (
        <Section title={`Order (${sources.length})`} icon={<Info className="h-3 w-3" />}>
          <div className="text-[10.5px] text-text-muted mb-1.5">
            Order = page order in the PDF.
          </div>
          <ul className="space-y-1">
            {picked.map((f, i) => (
              <li
                key={`${f.name}-${i}-${f.size}`}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5"
              >
                <span className="w-5 text-center font-mono text-[10.5px] text-text-muted">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
                  {f.name}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() =>
                      setPicked((prev) => {
                        if (i === 0) return prev;
                        const next = prev.slice();
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        return next;
                      })
                    }
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-2 hover:border-vault/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === picked.length - 1}
                    onClick={() =>
                      setPicked((prev) => {
                        if (i === prev.length - 1) return prev;
                        const next = prev.slice();
                        [next[i + 1], next[i]] = [next[i], next[i + 1]];
                        return next;
                      })
                    }
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-2 hover:border-vault/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() =>
                      setPicked((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="ml-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-2 hover:border-vault/40 hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-2 w-full rounded-md border border-dashed border-border bg-surface-2 px-2 py-1.5 text-[11px] text-text-2 hover:border-vault/40 hover:text-foreground"
          >
            + Add more images
          </button>
        </Section>
      )}

      {direction === "pdf-to-images" && (
        <>
          <Section title="Format" icon={<Info className="h-3 w-3" />}>
            <div className="grid grid-cols-2 gap-1.5">
              <ModeRow active={imgFormat === "png"} onClick={() => setImgFormat("png")} label="PNG" hint="Lossless" />
              <ModeRow active={imgFormat === "jpg"} onClick={() => setImgFormat("jpg")} label="JPG" hint="Smaller files" />
            </div>
          </Section>
          <Section title="Resolution" icon={<Info className="h-3 w-3" />}>
            <div className="grid grid-cols-3 gap-1.5">
              {[72, 150, 300].map((d) => (
                <ModeRow key={d} active={imgDpi === d} onClick={() => setImgDpi(d)}
                  label={`${d} dpi`}
                  hint={d === 72 ? "Screen" : d === 150 ? "Standard" : "Print"} />
              ))}
            </div>
            {imgFormat === "jpg" && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10.5px] text-text-muted mb-1">
                  <span>JPG quality</span>
                  <span className="font-mono text-foreground/80">{Math.round(imgQuality * 100)}%</span>
                </div>
                <input type="range" min={0.4} max={1} step={0.02} value={imgQuality}
                  onChange={(e) => setImgQuality(parseFloat(e.target.value))}
                  className="w-full accent-vault" />
              </div>
            )}
          </Section>
          <Section title="Pages" icon={<Info className="h-3 w-3" />}>
            <input
              type="text"
              inputMode="numeric"
              value={imgPages}
              onChange={(e) => setImgPages(e.target.value)}
              placeholder="All pages — or e.g. 1-3, 7, 10-12"
              className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
            />
            <div className="mt-1.5 text-[10.5px] text-text-muted">
              Leave empty to export every page.
            </div>
          </Section>
        </>
      )}

      {direction === "images-to-pdf" && (
        <>
          <Section title="Page size" icon={<Info className="h-3 w-3" />}>
            <div className="grid grid-cols-3 gap-1.5">
              <ModeRow active={imagesPageSize === "auto"} onClick={() => setImagesPageSize("auto")}
                label="Match" hint="Image size" />
              <ModeRow active={imagesPageSize === "letter"} onClick={() => setImagesPageSize("letter")}
                label="Letter" hint="8.5×11" />
              <ModeRow active={imagesPageSize === "a4"} onClick={() => setImagesPageSize("a4")}
                label="A4" hint="210×297" />
            </div>
          </Section>
          {imagesPageSize !== "auto" && (
            <Section title="Fit" icon={<Info className="h-3 w-3" />}>
              <div className="grid grid-cols-2 gap-1.5">
                <ModeRow active={imagesFit === "fit"} onClick={() => setImagesFit("fit")}
                  label="Fit" hint="Whole image" />
                <ModeRow active={imagesFit === "fill"} onClick={() => setImagesFit("fill")}
                  label="Fill" hint="No borders" />
              </div>
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10.5px] text-text-muted mb-1">
                  <span>Margin</span>
                  <span className="font-mono text-foreground/80">{imagesMargin}pt</span>
                </div>
                <input type="range" min={0} max={72} step={2} value={imagesMargin}
                  onChange={(e) => setImagesMargin(parseInt(e.target.value, 10))}
                  className="w-full accent-vault" />
              </div>
            </Section>
          )}
        </>
      )}

      {busy && (
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[10.5px] text-text-muted">
          {progress || "Working…"}
        </div>
      )}

      <button
        type="button"
        onClick={run}
        disabled={busy || !direction}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
          (busy || !direction) && "cursor-not-allowed opacity-60",
        )}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
        {busy
          ? "Converting…"
          : direction === "pdf-to-images"
          ? "Export images"
          : direction === "images-to-pdf"
          ? "Build PDF"
          : "Pick a PDF or images"}
      </button>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ============================ Page Numbers ============================ */
/**
 * Stamps page numbers on the active tab's PDF via the existing
 * `addPageNumbers` op. Exposes exactly what `PageNumbersOpts` accepts:
 * anchor, format, startAt, skipFirst, fontSize, margin, prefix.
 */
function PageNumbersPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile } = ctx;

  const [anchor, setAnchor] = useState<
    "top-left" | "top-center" | "top-right" |
    "bottom-left" | "bottom-center" | "bottom-right"
  >("bottom-center");
  const [format, setFormat] = useState<"n" | "page-n" | "n-of-m" | "roman">("page-n");
  const [startAt, setStartAt] = useState<number>(1);
  const [skipFirst, setSkipFirst] = useState<number>(0);
  const [fontSize, setFontSize] = useState<number>(11);
  const [margin, setMargin] = useState<number>(24);
  const [prefix, setPrefix] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (apply: "download" | "replace") => {
    if (!file) return;
    setBusy(true);
    const tid = "wsx-page-numbers";
    toast.loading("Stamping page numbers…", { id: tid });
    try {
      const { addPageNumbers } = await importChunk(() => import("@/lib/batch/ops/page-numbers"));
      const out = await addPageNumbers(new Uint8Array(await file.arrayBuffer()), {
        anchor, format, startAt, skipFirst, fontSize, margin,
        prefix: prefix || undefined,
      });
      if (apply === "download") {
        await downloadPdf(out, file.name.replace(/\.pdf$/i, "") + "-numbered.pdf");
        toast.success("Page numbers added", { id: tid });
      } else {
        replaceFile(new File([out as BlobPart], file.name, { type: "application/pdf" }));
        toast.success("Page numbers applied to active tab", { id: tid });
      }
    } catch (err) {
      console.error("[page-numbers] failed", err);
      toast.error("Failed to add page numbers", { id: tid, description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [file, anchor, format, startAt, skipFirst, fontSize, margin, prefix, replaceFile]);

  if (!file) {
    return (
      <InspectorEmpty>Open a PDF to stamp page numbers.</InspectorEmpty>
    );
  }

  const anchors: Array<typeof anchor> = [
    "top-left", "top-center", "top-right",
    "bottom-left", "bottom-center", "bottom-right",
  ];
  const formats: Array<{ id: typeof format; label: string; hint: string }> = [
    { id: "n", label: "1", hint: "Plain" },
    { id: "page-n", label: "Page 1", hint: "Prefixed" },
    { id: "n-of-m", label: "1 of N", hint: "With total" },
    { id: "roman", label: "i", hint: "Lower roman" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Section title="Position" icon={<Hash className="h-3 w-3" />}>
        <div className="grid grid-cols-3 gap-1.5">
          {anchors.map((a) => (
            <ModeRow
              key={a}
              active={anchor === a}
              onClick={() => setAnchor(a)}
              label={a.startsWith("top") ? "Top" : "Bottom"}
              hint={a.endsWith("left") ? "Left" : a.endsWith("right") ? "Right" : "Center"}
            />
          ))}
        </div>
      </Section>

      <Section title="Format" icon={<Info className="h-3 w-3" />}>
        <div className="grid grid-cols-2 gap-1.5">
          {formats.map((f) => (
            <ModeRow
              key={f.id}
              active={format === f.id}
              onClick={() => setFormat(f.id)}
              label={f.label}
              hint={f.hint}
            />
          ))}
        </div>
      </Section>

      <Section title="Numbering" icon={<Info className="h-3 w-3" />}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Start at" value={startAt} min={1} onChange={setStartAt} />
          <NumberField label="Skip first" value={skipFirst} min={0} onChange={setSkipFirst} />
          <NumberField label="Font size" value={fontSize} min={6} max={48} onChange={setFontSize} />
          <NumberField label="Margin (pt)" value={margin} min={0} max={144} onChange={setMargin} />
        </div>
      </Section>

      <Section title="Prefix" icon={<Info className="h-3 w-3" />}>
        <input
          type="text"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="Optional — e.g. — "
          className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
        />
        <div className="mt-1.5 text-[10.5px] text-text-muted">
          Prepended to every stamped number.
        </div>
      </Section>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => run("download")}
          disabled={busy}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
            busy && "cursor-not-allowed opacity-60",
          )}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          {busy ? "Working…" : "Stamp & download"}
        </button>
        <button
          type="button"
          onClick={() => run("replace")}
          disabled={busy}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40",
            busy && "cursor-not-allowed opacity-60",
          )}
        >
          Apply to active tab
        </button>
      </div>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ======================= Document Settings ============================ */
/**
 * Document-level properties — page numbers and header/footer — accessed
 * from the gear icon in the top bar (NOT the tool palette). These stamp
 * at export-time onto a copy of the PDF; the source bytes are never
 * mutated unless the user picks "Apply to active tab".
 */
function DocumentSettingsPanel({ ctx }: { ctx: ToolPanelCtx }) {
  if (!ctx.file) {
    return (
      <InspectorEmpty>Open a PDF to configure document settings.</InspectorEmpty>
    );
  }
  const [pnOn, setPnOn] = useState(false);
  const [hfOn, setHfOn] = useState(false);
  const [flOn, setFlOn] = useState(false);
  const pnRef = useRef<HTMLDivElement | null>(null);
  const hfRef = useRef<HTMLDivElement | null>(null);
  const flRef = useRef<HTMLDivElement | null>(null);

  // Deep-link from the command bar: "add page numbers" opens Doc Settings
  // scrolled to (and with) the Page Numbers section expanded.
  useEffect(() => {
    const focus = ctx.focusSection;
    if (!focus) return;
    if (focus === "page-numbers") {
      setPnOn(true);
      requestAnimationFrame(() => pnRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else if (focus === "header-footer") {
      setHfOn(true);
      requestAnimationFrame(() => hfRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else if (focus === "flatten") {
      setFlOn(true);
      requestAnimationFrame(() => flRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    ctx.clearFocusSection?.();
  }, [ctx.focusSection]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11.5px] leading-snug text-text-2">
        These settings are saved with the document and applied automatically whenever you export. Nothing is stamped until you export.
      </p>

      <div ref={pnRef} className="flex flex-col gap-2 scroll-mt-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
          # Page Numbers
        </div>
        <DisclosureToggle
          label="Stamp page numbers on export"
          on={pnOn}
          onChange={setPnOn}
        />
      </div>
      {pnOn && (
        <div className="rounded-md border border-border bg-surface-2/40 p-3">
          <PageNumbersPanel ctx={ctx} />
        </div>
      )}


      <div ref={hfRef} className="flex flex-col gap-2 scroll-mt-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
          ⓘ Header &amp; Footer
        </div>
        <DisclosureToggle
          label="Stamp header / footer on export"
          on={hfOn}
          onChange={setHfOn}
        />
      </div>
      {hfOn && (
        <div className="rounded-md border border-border bg-surface-2/40 p-3">
          <HeaderFooterSection ctx={ctx} />
        </div>
      )}

      <div ref={flRef} className="flex flex-col gap-2 scroll-mt-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
          # Flatten
        </div>
        <DisclosureToggle
          label="Flatten on export"
          on={flOn}
          onChange={setFlOn}
        />
        <p className="text-[10.5px] leading-snug text-text-muted">
          Bakes form fields and annotations into the page — makes them permanent and no longer editable.
        </p>
      </div>
      {flOn && (
        <div className="rounded-md border border-border bg-surface-2/40 p-3">
          <FlattenSection ctx={ctx} />
        </div>
      )}

      <div className="mt-1 flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <Info className="h-3 w-3" />
        Saved with this document · stamped on export
      </div>
    </div>
  );
}

/* ============================== Bates ============================== */
/**
 * Dedicated Bates tool — single-document Bates (free) plus an entry point
 * for multi-file Bates (Pro). Lives in the Legal rail group; there is no
 * other Bates UI in the workspace.
 */
function BatesPanel({ ctx }: { ctx: ToolPanelCtx }) {
  if (!ctx.file) {
    return <InspectorEmpty>Open a PDF to stamp Bates numbers, or use multi-file Bates below.</InspectorEmpty>;
  }
  return <BatesSection ctx={ctx} />;
}


/**
 * Bates configuration — prefix/suffix, start number, zero-padding, and
 * stamp position. Settings persist per-document via the shared bates store
 * so the Export dialog reflects the same config the user sees here. The
 * actual stamp happens at export time only (see ExportDialog).
 *
 * "Apply to active tab" and "Stamp & download" buttons also reuse the same
 * `addBates` op so the inspector can do a quick one-off when needed.
 */
function BatesSection({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile } = ctx;
  const [s, update] = useBatesSettings(batesDocKey(file));
  const [busy, setBusy] = useState(false);

  const sample = `${s.prefix}${String(s.startAt).padStart(s.digits, "0")}${s.suffix ?? ""}`;

  const run = useCallback(async (apply: "download" | "replace") => {
    if (!file) return;
    setBusy(true);
    const tid = "wsx-bates";
    const abort = new AbortController();
    toast.loading("Stamping Bates numbers…", {
      id: tid,
      action: { label: "Cancel", onClick: () => abort.abort() },
    });
    try {
      const { stampBatesInWorker } = await importChunk(
        () => import("@/lib/workers/bates-client"),
      );
      const opts = {
        prefix: s.prefix, suffix: s.suffix, startAt: s.startAt, digits: s.digits,
        position: s.position, fontSize: s.fontSize, color: s.color, margin: s.margin,
      };
      const source = new Uint8Array(await file.arrayBuffer());
      const { bytes: out, pageCount } = await stampBatesInWorker(source, opts, {
        signal: abort.signal,
        onProgress: ({ done, total }) => {
          // Throttle toast updates — worker already coalesces every 64 pages.
          toast.loading(
            `Stamping Bates numbers… (${done.toLocaleString()} / ${total.toLocaleString()} pages)`,
            { id: tid, action: { label: "Cancel", onClick: () => abort.abort() } },
          );
        },
      });
      if (apply === "download") {
        await downloadPdf(out, file.name.replace(/\.pdf$/i, "") + "-bates.pdf");
        toast.success("Bates numbers added", { id: tid });
      } else {
        replaceFile(new File([out as BlobPart], file.name, { type: "application/pdf" }));
        toast.success("Bates applied to active tab", { id: tid });
        // Mark this document as already-stamped with the current settings so
        // the export dialog doesn't silently stamp a second row on top.
        update({
          appliedAt: Date.now(),
          appliedFingerprint: computeBatesFingerprint({ ...s, on: s.on }),
        });
      }

      // Offer a Discovery Production Audit Log — pageCount comes from the
      // worker so we don't re-parse the stamped bytes with pdf.js just to
      // read numPages (that second full parse is what hung 5000-page runs).
      try {
        const { requestCertificate } = await import("@/components/workspace/certificate-gate");
        const { buildBatesCertificate } = await import("@/lib/pdf/certificates");
        const fmtNum = (n: number) =>
          `${s.prefix}${String(n).padStart(s.digits, "0")}${s.suffix ?? ""}`;
        const endAt = s.startAt + pageCount - 1;
        const payload = {
          documents: [
            { name: file.name, pageCount, firstNumber: fmtNum(s.startAt), lastNumber: fmtNum(endAt) },
          ],
          prefix: s.prefix, suffix: s.suffix, digits: s.digits,
          startAt: s.startAt, endAt, totalPages: pageCount,
          overlaps: 0, skipped: 0,
        };
        requestCertificate({
          kind: "bates",
          actionLabel: "Discovery Production",
          sourceName: file.name,
          downloadBaseName: file.name.replace(/\.pdf$/i, "") + "-bates-audit-log",
          payload,
          build: () => buildBatesCertificate(payload),
        });
      } catch (gateErr) {
        console.warn("[bates] cert gate failed", gateErr);
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (aborted) {
        toast.message("Bates stamping canceled", { id: tid });
      } else {
        console.error("[bates] failed", err);
        toast.error("Failed to stamp Bates", { id: tid, description: (err as Error).message });
      }
    } finally {
      setBusy(false);
    }
  }, [file, s, replaceFile, update]);

  const positions: Array<{ id: typeof s.position; row: "top" | "bottom"; col: "left" | "center" | "right" }> = [
    { id: "tl", row: "top", col: "left" },
    { id: "tc", row: "top", col: "center" },
    { id: "tr", row: "top", col: "right" },
    { id: "bl", row: "bottom", col: "left" },
    { id: "bc", row: "bottom", col: "center" },
    { id: "br", row: "bottom", col: "right" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Section title="Stamp" icon={<Hash className="h-3 w-3" />}>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Prefix</span>
            <input
              type="text"
              value={s.prefix}
              onChange={(e) => update({ prefix: e.target.value })}
              placeholder="ABC"
              className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] font-mono text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Suffix</span>
            <input
              type="text"
              value={s.suffix ?? ""}
              onChange={(e) => update({ suffix: e.target.value })}
              placeholder="(optional)"
              className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] font-mono text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
            />
          </label>
          <NumberField label="Start at" value={s.startAt} min={0} onChange={(n) => update({ startAt: n })} />
          <NumberField label="Digits" value={s.digits} min={1} max={10} onChange={(n) => update({ digits: n })} />
        </div>
      </Section>

      <Section title="Position" icon={<Info className="h-3 w-3" />}>
        <div className="grid grid-cols-3 gap-1.5">
          {positions.map((p) => (
            <ModeRow
              key={p.id}
              active={s.position === p.id}
              onClick={() => update({ position: p.id })}
              label={p.row === "top" ? "Top" : "Bottom"}
              hint={p.col === "left" ? "Left" : p.col === "right" ? "Right" : "Center"}
            />
          ))}
        </div>
      </Section>

      <Section title="Type" icon={<Info className="h-3 w-3" />}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Font size" value={s.fontSize} min={6} max={32} onChange={(n) => update({ fontSize: n })} />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Color</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(["black", "red", "blue"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update({ color: c })}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] capitalize transition-colors",
                    s.color === c
                      ? "border-vault/50 bg-accent-soft text-vault"
                      : "border-border bg-surface-2 text-text-2 hover:border-vault/30",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </label>
        </div>
      </Section>

      <div className="rounded-md border border-border bg-surface-2/60 px-3 py-2 text-[11.5px]">
        <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Preview</div>
        <div className="mt-1 font-mono text-foreground">{sample}</div>
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => run("download")}
          disabled={busy || !s.prefix}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
            (busy || !s.prefix) && "cursor-not-allowed opacity-60",
          )}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          {busy ? "Working…" : "Stamp & download"}
        </button>
        <button
          type="button"
          onClick={() => run("replace")}
          disabled={busy || !s.prefix}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40",
            (busy || !s.prefix) && "cursor-not-allowed opacity-60",
          )}
        >
          Apply to active tab
        </button>
        <MultiFileBatesButton />
        <FirmTemplatesMenu
          kind="bates"
          getConfig={() => ({
            prefix: s.prefix,
            suffix: s.suffix ?? "",
            startAt: s.startAt,
            digits: s.digits,
            position: s.position,
            fontSize: s.fontSize,
            color: s.color,
            margin: s.margin,
          })}
          onApply={(cfg: Partial<typeof s>) => update(cfg)}
          sourceName={file?.name ?? null}
        />
      </div>


      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <Info className="h-3 w-3" />
        Settings saved with this document · also offered at export
      </div>
    </div>
  );
}

function MultiFileBatesButton() {
  const isPro = useIsPro();
  const requirePro = useRequirePro();
  const [open, setOpen] = useState(false);
  const [Modal, setModal] = useState<
    null | React.ComponentType<{ onClose: () => void }>
  >(null);

  const launch = useCallback(async () => {
    if (!requirePro("Multi-file Bates")) return;
    if (!Modal) {
      const mod = await importChunk(() => import("./multi-file-bates-modal"));
      setModal(() => mod.MultiFileBatesModal);
    }
    setOpen(true);
  }, [requirePro, Modal]);

  return (
    <>
      <button
        type="button"
        onClick={() => void launch()}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40",
        )}
      >
        <span>Apply to multiple files…</span>
        {!isPro && <LockBadge />}
        {isPro && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-vault">Pro</span>
        )}
      </button>
      {open && Modal && <Modal onClose={() => setOpen(false)} />}
    </>
  );
}

/* ============================ Exhibit Binder ============================ */
/**
 * Inspector panel for the Pro Exhibit Binder. The actual builder is a
 * multi-file modal (similar to Multi-file Bates) — the panel explains the
 * feature and launches the modal lazily.
 */
function ExhibitBinderPanel() {
  const requirePro = useRequirePro();
  const [open, setOpen] = useState(false);
  const [Modal, setModal] = useState<
    null | React.ComponentType<{ onClose: () => void }>
  >(null);

  const launch = useCallback(async () => {
    if (!requirePro("Exhibit Binder")) return;
    if (!Modal) {
      const mod = await importChunk(() => import("./exhibit-binder-modal"));
      setModal(() => mod.ExhibitBinderModal);
    }
    setOpen(true);
  }, [requirePro, Modal]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-surface-2 p-3 text-[12px] text-text-2">
        <div className="mb-1 text-foreground">Court-ready exhibit binder</div>
        Combine a brief and multiple exhibits into a single PDF with a
        hyperlinked Table of Contents, labeled slip-sheets
        (<span className="font-mono">Exhibit A</span>,{" "}
        <span className="font-mono">Exhibit B</span>…), and optional
        continuous page or Bates numbering across the bundle.
      </div>

      <ul className="flex flex-col gap-1 text-[11.5px] text-text-2">
        <li>· Drag-and-drop ordering, rename per-exhibit labels</li>
        <li>· Letter (A, B, C…) or numeric (1, 2, 3…) label scheme</li>
        <li>· ToC links jump straight to each exhibit's slip-sheet</li>
        <li>· On-device — nothing uploads</li>
      </ul>

      <button
        type="button"
        onClick={() => void launch()}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90"
      >
        Build exhibit binder…
      </button>
      {open && Modal && <Modal onClose={() => setOpen(false)} />}
    </div>
  );
}


/* Compact on/off row used by Document Settings to gate detailed config. */
function DisclosureToggle({
  label, on, onChange,
}: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md border bg-surface-2 px-3 py-2.5 text-left text-[12.5px] text-foreground transition-colors",
        on ? "border-vault/40" : "border-border hover:border-vault/30",
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded-sm border transition-colors",
          on
            ? "border-vault bg-vault text-vault-foreground"
            : "border-text-muted/40 bg-transparent",
        )}
      >
        {on && (
          <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8.5l3 3 7-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}

/* ============================ Header & Footer ============================ */
/**
 * Header/footer editor. Mirrors the standalone /header-footer route but
 * lives inside the Document Settings inspector. Supports tokens
 * {page}, {pages}, {date}, {filename}, alignment, even/odd/no-first rules.
 */
function HeaderFooterSection({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile } = ctx;
  const [headerText, setHeaderText] = useState<string>("{filename}");
  const [footerText, setFooterText] = useState<string>("Page {page} of {pages}");
  const [align, setAlign] = useState<"left" | "center" | "right">("center");
  const [rule, setRule] = useState<"all" | "even" | "odd" | "no-first">("all");
  const [fontSize, setFontSize] = useState<number>(9);
  const [margin, setMargin] = useState<number>(24);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (apply: "download" | "replace") => {
    if (!file) return;
    setBusy(true);
    const tid = "wsx-header-footer";
    toast.loading("Stamping header/footer…", { id: tid });
    try {
      const { addHeaderFooter } = await importChunk(() => import("@/lib/batch/ops/header-footer"));
      const out = await addHeaderFooter(new Uint8Array(await file.arrayBuffer()), {
        headerText: headerText || undefined,
        footerText: footerText || undefined,
        align, rule, fontSize, margin,
        filename: file.name,
      });
      if (apply === "download") {
        await downloadPdf(out, file.name.replace(/\.pdf$/i, "") + "-headerfooter.pdf");
        toast.success("Header/footer added", { id: tid });
      } else {
        replaceFile(new File([out as BlobPart], file.name, { type: "application/pdf" }));
        toast.success("Header/footer applied to active tab", { id: tid });
      }
    } catch (err) {
      console.error("[header-footer] failed", err);
      toast.error("Failed to stamp header/footer", { id: tid, description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [file, headerText, footerText, align, rule, fontSize, margin, replaceFile]);

  const aligns: Array<typeof align> = ["left", "center", "right"];
  const rules: Array<typeof rule> = ["all", "even", "odd", "no-first"];

  return (
    <div className="flex flex-col gap-4">
      <Section title="Header" icon={<Info className="h-3 w-3" />}>
        <input
          type="text"
          value={headerText}
          onChange={(e) => setHeaderText(e.target.value)}
          placeholder="Leave blank for none"
          className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
        />
      </Section>
      <Section title="Footer" icon={<Info className="h-3 w-3" />}>
        <input
          type="text"
          value={footerText}
          onChange={(e) => setFooterText(e.target.value)}
          placeholder="Leave blank for none"
          className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:border-vault/40 focus:outline-none"
        />
        <div className="mt-1.5 text-[10.5px] text-text-muted">
          Tokens: <code>{"{page}"}</code> <code>{"{pages}"}</code> <code>{"{date}"}</code> <code>{"{filename}"}</code>
        </div>
      </Section>

      <Section title="Alignment" icon={<Info className="h-3 w-3" />}>
        <div className="grid grid-cols-3 gap-1.5">
          {aligns.map((a) => (
            <ModeRow key={a} active={align === a} onClick={() => setAlign(a)} label={a[0].toUpperCase() + a.slice(1)} hint="" />
          ))}
        </div>
      </Section>

      <Section title="Apply to" icon={<Info className="h-3 w-3" />}>
        <div className="grid grid-cols-2 gap-1.5">
          {rules.map((r) => (
            <ModeRow key={r} active={rule === r} onClick={() => setRule(r)} label={r === "no-first" ? "Skip first" : r[0].toUpperCase() + r.slice(1)} hint="" />
          ))}
        </div>
      </Section>

      <Section title="Type" icon={<Info className="h-3 w-3" />}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Font size" value={fontSize} min={6} max={48} onChange={setFontSize} />
          <NumberField label="Margin (pt)" value={margin} min={0} max={144} onChange={setMargin} />
        </div>
      </Section>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => run("download")}
          disabled={busy}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
            busy && "cursor-not-allowed opacity-60",
          )}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          {busy ? "Working…" : "Stamp & download"}
        </button>
        <button
          type="button"
          onClick={() => run("replace")}
          disabled={busy}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40",
            busy && "cursor-not-allowed opacity-60",
          )}
        >
          Apply to active tab
        </button>
        <FirmTemplatesMenu
          kind="header-footer"
          getConfig={() => ({ headerText, footerText, align, rule, fontSize, margin })}
          onApply={(cfg: { headerText?: string; footerText?: string; align?: typeof align; rule?: typeof rule; fontSize?: number; margin?: number }) => {
            if (typeof cfg.headerText === "string") setHeaderText(cfg.headerText);
            if (typeof cfg.footerText === "string") setFooterText(cfg.footerText);
            if (cfg.align) setAlign(cfg.align);
            if (cfg.rule) setRule(cfg.rule);
            if (typeof cfg.fontSize === "number") setFontSize(cfg.fontSize);
            if (typeof cfg.margin === "number") setMargin(cfg.margin);
          }}
          sourceName={file?.name ?? null}
        />
      </div>
    </div>
  );
}


/* ============================ Flatten ============================ */
/**
 * Flatten section — bakes form fields + annotations into static page
 * content at export time. Reuses the existing flatten() op from
 * src/lib/batch/ops/flatten.ts. Pure pdf-lib, on-device.
 */
function FlattenSection({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile } = ctx;
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (apply: "download" | "replace") => {
    if (!file) return;
    setBusy(true);
    const tid = "wsx-flatten";
    toast.loading("Flattening…", { id: tid });
    try {
      const { flatten } = await importChunk(() => import("@/lib/batch/ops/flatten"));
      const out = await flatten(new Uint8Array(await file.arrayBuffer()), {
        forms: true,
        annotations: true,
      });
      if (apply === "download") {
        await downloadPdf(out, file.name.replace(/\.pdf$/i, "") + "-flattened.pdf");
        toast.success("Flattened PDF downloaded", { id: tid });
      } else {
        replaceFile(new File([out as BlobPart], file.name, { type: "application/pdf" }));
        toast.success("Flattened the active tab", { id: tid });
      }
    } catch (err) {
      console.error("[flatten] failed", err);
      toast.error("Failed to flatten", { id: tid, description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [file, replaceFile]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] leading-snug text-text-2">
        Form fields and annotations become baked, static pixels. This is for final delivery — you won&apos;t be able to edit them after.
      </p>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => run("download")}
          disabled={busy}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
            busy && "cursor-not-allowed opacity-60",
          )}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          {busy ? "Working…" : "Flatten & download"}
        </button>
        <button
          type="button"
          onClick={() => run("replace")}
          disabled={busy}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40",
            busy && "cursor-not-allowed opacity-60",
          )}
        >
          Apply to active tab
        </button>
      </div>
    </div>
  );
}


function NumberField({
  label, value, onChange, min, max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-foreground focus:border-vault/40 focus:outline-none"
      />
    </label>
  );
}

/* =========================== Comments inspector =========================== */
/**
 * Native rebuild of the editor Comments panel for the workspace right
 * inspector. Reuses the same Anno/Reply model from src/lib/editor/types,
 * dispatches into the active tab's editor state.
 */
function CommentsInspectorPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { editorState, editorDispatch } = ctx;
  const annos = editorState?.doc?.annotations ?? [];
  const [author, setAuthor] = useState<string>(() => {
    if (typeof window === "undefined") return "Me";
    return window.localStorage.getItem("counselpdf:comment-author") || "Me";
  });
  useEffect(() => {
    try { window.localStorage.setItem("counselpdf:comment-author", author); } catch { /* ignore */ }
  }, [author]);

  const grouped = useMemo(() => {
    const m = new Map<number, Anno[]>();
    for (const a of annos) {
      const arr = m.get(a.page) ?? [];
      arr.push(a);
      m.set(a.page, arr);
    }
    return [...m.entries()].sort(([a], [b]) => a - b);
  }, [annos]);

  return (
    <div className="flex h-full flex-col gap-2 text-[12px]">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-text-2" />
        <span className="text-text-2">Author</span>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className="flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-foreground outline-none focus:border-vault/50"
        />
      </div>
      {annos.length === 0 ? (
        <p className="px-1 py-4 text-[11.5px] italic text-text-muted">
          No annotations yet. Add a highlight, sticky note, or any markup — it will appear here.
        </p>
      ) : (
        <div className="flex-1 space-y-3 overflow-auto">
          {grouped.map(([page, list]) => (
            <div key={page}>
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-text-muted">Page {page + 1}</div>
              <div className="space-y-1.5">
                {list.map((a) => (
                  <CommentInspectorCard
                    key={a.id}
                    a={a}
                    author={author}
                    onJump={() => {
                      editorDispatch({ type: "SET_PAGE", n: a.page });
                      editorDispatch({ type: "SELECT_ANNO", id: a.id });
                    }}
                    onPatch={(p) => editorDispatch({ type: "UPDATE_ANNO", id: a.id, patch: p as never })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentInspectorCard({
  a,
  author,
  onJump,
  onPatch,
}: {
  a: Anno;
  author: string;
  onJump: () => void;
  onPatch: (p: Partial<Anno>) => void;
}) {
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(!a.contents);
  const [draft, setDraft] = useState(a.contents ?? "");

  const addReply = () => {
    const text = reply.trim();
    if (!text) return;
    const next: Reply = { id: Math.random().toString(36).slice(2, 10), author, text, createdAt: Date.now() };
    onPatch({ replies: [...(a.replies ?? []), next] });
    setReply("");
  };

  const save = () => {
    onPatch({
      contents: draft,
      author: a.author ?? author,
      createdAt: a.createdAt ?? Date.now(),
    });
    setEditing(false);
  };

  return (
    <div className={cn("rounded-md border border-border bg-surface-2 p-2", a.resolved && "opacity-60")}>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <button type="button" onClick={onJump} className="truncate text-vault hover:underline">
          {a.kind}
          {"text" in a && (a as { text?: string }).text ? ` · "${(a as { text: string }).text.slice(0, 24)}"` : ""}
        </button>
        <button
          type="button"
          onClick={() => onPatch({ resolved: !a.resolved })}
          title={a.resolved ? "Reopen" : "Resolve"}
          className={cn("rounded p-1 hover:bg-surface-3", a.resolved && "text-emerald-500")}
        >
          <Check className="h-3 w-3" />
        </button>
      </div>
      {editing ? (
        <div className="space-y-1">
          <Textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment…"
            className="text-[12px]"
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-6 px-2 text-[11.5px]" onClick={save}>Save</Button>
            {a.contents && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11.5px]"
                onClick={() => { setDraft(a.contents ?? ""); setEditing(false); }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="block w-full text-left">
          <p className="whitespace-pre-wrap text-[12px]">{a.contents}</p>
          {a.author && (
            <p className="mt-1 text-[10px] text-text-muted">
              {a.author} · {new Date(a.createdAt ?? 0).toLocaleString()}
            </p>
          )}
        </button>
      )}
      {(a.replies?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1 border-l border-border pl-2">
          {a.replies!.map((r) => (
            <div key={r.id} className="text-[11.5px]">
              <div className="text-[10px] text-text-muted">
                {r.author} · {new Date(r.createdAt).toLocaleString()}
              </div>
              <div className="whitespace-pre-wrap">{r.text}</div>
            </div>
          ))}
        </div>
      )}
      {!a.resolved && (
        <div className="mt-2 flex items-start gap-1">
          <CornerDownRight className="mt-1.5 h-3 w-3 text-text-muted" />
          <Textarea
            rows={1}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                addReply();
              }
            }}
            placeholder="Reply… (⌘↵)"
            className="min-h-[28px] flex-1 text-[12px]"
          />
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11.5px]" onClick={addReply}>Reply</Button>
        </div>
      )}
    </div>
  );
}


/* ============================== Outline & Links ============================== */

function OutlinePanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, editorState, editorDispatch } = ctx;
  const [parsed, setParsed] = useState<import("@/lib/outline/types").ParsedDoc | null>(null);
  const [outline, setOutline] = useState<import("@/lib/outline/types").OutlineNode[]>([]);
  const [links, setLinks] = useState<import("@/lib/outline/types").LinkAnnot[]>([]);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const currentPage = editorState?.current ?? 0;
  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";

  useEffect(() => {
    let cancelled = false;
    if (!file) { setParsed(null); setOutline([]); setLinks([]); setBytes(null); return; }
    setLoading(true);
    (async () => {
      try {
        const { parsePdf } = await importChunk(() => import("@/lib/outline/parse"));
        const buf = new Uint8Array(await file.arrayBuffer());
        const { parsed } = await parsePdf(buf);
        if (cancelled) return;
        setBytes(buf);
        setParsed(parsed);
        setOutline(parsed.outline);
        setLinks(parsed.links);
        setSelectedNodeId(null);
      } catch (err) {
        console.error("[outline] parse failed", err);
        toast.error("Couldn't read outline", { description: (err as Error).message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  const findNode = useCallback((id: string, nodes = outline): import("@/lib/outline/types").OutlineNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const f = findNode(id, n.children); if (f) return f;
    }
    return null;
  }, [outline]);

  const updateNode = useCallback((id: string, patch: Partial<import("@/lib/outline/types").OutlineNode>) => {
    setOutline((tree) => {
      const walk = (nodes: import("@/lib/outline/types").OutlineNode[]): import("@/lib/outline/types").OutlineNode[] =>
        nodes.map((n) => (n.id === id ? { ...n, ...patch } : { ...n, children: walk(n.children) }));
      return walk(tree);
    });
  }, []);

  const removeNode = useCallback((id: string) => {
    setOutline((tree) => {
      const walk = (nodes: import("@/lib/outline/types").OutlineNode[]): import("@/lib/outline/types").OutlineNode[] =>
        nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: walk(n.children) }));
      return walk(tree);
    });
    setSelectedNodeId((s) => (s === id ? null : s));
  }, []);

  const moveNode = useCallback((id: string, dir: -1 | 1) => {
    setOutline((tree) => {
      const walk = (nodes: import("@/lib/outline/types").OutlineNode[]): import("@/lib/outline/types").OutlineNode[] => {
        const idx = nodes.findIndex((n) => n.id === id);
        if (idx >= 0) {
          const t = idx + dir;
          if (t < 0 || t >= nodes.length) return nodes;
          const next = nodes.slice();
          const [m] = next.splice(idx, 1);
          next.splice(t, 0, m);
          return next;
        }
        return nodes.map((n) => ({ ...n, children: walk(n.children) }));
      };
      return walk(tree);
    });
  }, []);

  const indentNode = useCallback((id: string) => {
    setOutline((tree) => {
      const walk = (nodes: import("@/lib/outline/types").OutlineNode[]): import("@/lib/outline/types").OutlineNode[] => {
        const idx = nodes.findIndex((n) => n.id === id);
        if (idx > 0) {
          const moved = nodes[idx];
          const prev = nodes[idx - 1];
          const next = nodes.slice();
          next.splice(idx, 1);
          next[idx - 1] = { ...prev, expanded: true, children: [...prev.children, moved] };
          return next;
        }
        return nodes.map((n) => ({ ...n, children: walk(n.children) }));
      };
      return walk(tree);
    });
  }, []);

  const outdentNode = useCallback((id: string) => {
    setOutline((tree) => {
      const walk = (nodes: import("@/lib/outline/types").OutlineNode[], parentIdx: number | null, parentArr: import("@/lib/outline/types").OutlineNode[] | null): import("@/lib/outline/types").OutlineNode[] => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === id && parentArr && parentIdx !== null) {
            const moved = nodes[i];
            const newChildren = nodes.slice(0, i).concat(nodes.slice(i + 1));
            const newParent = { ...parentArr[parentIdx], children: newChildren };
            const out = parentArr.slice();
            out[parentIdx] = newParent;
            out.splice(parentIdx + 1, 0, moved);
            return out;
          }
        }
        return nodes.map((n, i) => ({ ...n, children: walk(n.children, i, nodes) }));
      };
      if (tree.some((n) => n.id === id)) return tree; // already root
      return walk(tree, null, null);
    });
  }, []);

  const addAtRoot = useCallback(() => {
    const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
    const node = {
      id: newId("o"),
      title: "New bookmark",
      dest: { page: currentPage, x: null, y: null, zoom: null },
      style: { bold: false, italic: false },
      color: null as [number, number, number] | null,
      expanded: true,
      children: [],
    };
    setOutline((tree) => [...tree, node]);
    setSelectedNodeId(node.id);
  }, [currentPage]);

  const runLinkify = useCallback(async () => {
    if (!bytes) return;
    setBusy(true);
    try {
      const { linkifyPage } = await importChunk(() => import("@/lib/outline/linkify"));
      const found = await linkifyPage(bytes, currentPage, links);
      if (found.length === 0) toast.message(`No new URLs on page ${currentPage + 1}`);
      else {
        setLinks((arr) => [...arr, ...found]);
        toast.success(`Linkified ${found.length} URL${found.length === 1 ? "" : "s"} on page ${currentPage + 1}`);
      }
    } catch (err) {
      console.error("[outline] linkify failed", err);
      toast.error("Linkify failed", { description: (err as Error).message });
    } finally { setBusy(false); }
  }, [bytes, currentPage, links]);

  const exportPdf = useCallback(async () => {
    if (!bytes || !file) return;
    setBusy(true);
    try {
      const { exportPdf } = await importChunk(() => import("@/lib/outline/write"));
      const out = await exportPdf(bytes, outline, links);
      const base = file.name.replace(/\.pdf$/i, "");
      await downloadPdf(out, `${base}-outline.pdf`);
      toast.success("Exported PDF with updated outline & links");
    } catch (err) {
      console.error("[outline] export failed", err);
      toast.error("Export failed", { description: (err as Error).message });
    } finally { setBusy(false); }
  }, [bytes, file, outline, links]);

  const selectedNode = selectedNodeId ? findNode(selectedNodeId) : null;
  const pageCount = parsed?.pageCount ?? 1;
  const linksOnCurrent = links.filter((l) => l.page === currentPage);

  if (!file) {
    return <InspectorEmpty>Open a document to edit its outline & links.</InspectorEmpty>;
  }
  if (loading || !parsed) {
    return <p className="text-[11.5px] text-text-muted">Reading outline…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Bookmarks"
        icon={<ChevronDown className="h-3 w-3" />}
        right={
          <button
            type="button"
            onClick={addAtRoot}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-text-2 hover:bg-surface-2 hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        }
      >
        {outline.length === 0 ? (
          <p className="text-[11.5px] text-text-muted">No bookmarks. Add one to get started.</p>
        ) : (
          <OutlineTree
            nodes={outline}
            level={0}
            selectedId={selectedNodeId}
            onSelect={(id) => {
              setSelectedNodeId(id);
              const n = findNode(id);
              if (n?.dest) editorDispatch({ type: "SET_PAGE", n: n.dest.page });
            }}
            onToggle={(id, expanded) => updateNode(id, { expanded })}
          />
        )}
      </Section>

      {selectedNode && (
        <Section title="Edit bookmark" icon={<PenLine className="h-3 w-3" />}>
          <div className="flex flex-col gap-2">
            <input
              value={selectedNode.title}
              onChange={(e) => updateNode(selectedNode.id, { title: e.target.value })}
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-foreground focus:outline-none focus:border-vault/50"
              placeholder="Title"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-text-muted">Page</span>
              <input
                type="number"
                min={1}
                max={pageCount}
                value={(selectedNode.dest?.page ?? 0) + 1}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(pageCount, Number(e.target.value) || 1));
                  updateNode(selectedNode.id, { dest: { page: n - 1, x: null, y: null, zoom: null } });
                }}
                className="w-16 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[12px] text-foreground focus:outline-none focus:border-vault/50"
              />
              <span className="text-[10.5px] text-text-muted">of {pageCount}</span>
              <button
                type="button"
                onClick={() => updateNode(selectedNode.id, { dest: { page: currentPage, x: null, y: null, zoom: null } })}
                className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-text-2 hover:bg-surface-2 hover:text-foreground"
              >
                Use p.{currentPage + 1}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="h-3 w-3 accent-[var(--vault)]"
                  checked={selectedNode.style.bold}
                  onChange={(e) => updateNode(selectedNode.id, { style: { ...selectedNode.style, bold: e.target.checked } })} />
                <span className="font-bold">Bold</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="h-3 w-3 accent-[var(--vault)]"
                  checked={selectedNode.style.italic}
                  onChange={(e) => updateNode(selectedNode.id, { style: { ...selectedNode.style, italic: e.target.checked } })} />
                <span className="italic">Italic</span>
              </label>
              <div className="ml-auto flex items-center gap-0.5">
                <button type="button" onClick={() => moveNode(selectedNode.id, -1)} className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Move up">↑</button>
                <button type="button" onClick={() => moveNode(selectedNode.id, 1)} className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Move down">↓</button>
                <button type="button" onClick={() => outdentNode(selectedNode.id)} className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Outdent">⇤</button>
                <button type="button" onClick={() => indentNode(selectedNode.id)} className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Indent">⇥</button>
                <button type="button" onClick={() => removeNode(selectedNode.id)} className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Delete">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section
        title={`Links · page ${currentPage + 1}`}
        icon={<MessageSquare className="h-3 w-3" />}
        right={
          <button
            type="button"
            onClick={runLinkify}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-vault hover:underline hover:opacity-90 disabled:opacity-50"
          >
            <Wand2 className="h-3 w-3" /> Linkify URLs
          </button>
        }
      >
        {linksOnCurrent.length === 0 ? (
          <p className="text-[11.5px] text-text-muted">No link annotations on this page. Use Linkify to auto-detect URLs.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {linksOnCurrent.map((l) => (
              <li key={l.id} className="rounded-md border border-border bg-surface-2 p-1.5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <select
                    value={l.target.kind}
                    onChange={(e) => {
                      const kind = e.target.value as "url" | "goto";
                      setLinks((arr) => arr.map((x) => x.id === l.id ? {
                        ...x,
                        target: kind === "url"
                          ? { kind: "url", url: l.target.kind === "url" ? l.target.url : "https://" }
                          : { kind: "goto", dest: l.target.kind === "goto" ? l.target.dest : { page: l.page, x: null, y: null, zoom: null } },
                      } : x));
                    }}
                    className="rounded border border-border bg-surface-1 px-1 py-0.5 text-[11px] text-foreground focus:outline-none"
                  >
                    <option value="url">URL</option>
                    <option value="goto">Page</option>
                  </select>
                  {l.target.kind === "url" ? (
                    <input
                      value={l.target.url}
                      onChange={(e) => setLinks((arr) => arr.map((x) => x.id === l.id ? { ...x, target: { kind: "url", url: e.target.value } } : x))}
                      className="min-w-0 flex-1 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[11.5px] text-foreground focus:outline-none focus:border-vault/50"
                    />
                  ) : (
                    <input
                      type="number"
                      min={1}
                      max={pageCount}
                      value={l.target.dest.page + 1}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(pageCount, Number(e.target.value) || 1));
                        setLinks((arr) => arr.map((x) => x.id === l.id ? { ...x, target: { kind: "goto", dest: { page: n - 1, x: null, y: null, zoom: null } } } : x));
                      }}
                      className="w-16 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[11.5px] text-foreground focus:outline-none focus:border-vault/50"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setLinks((arr) => arr.filter((x) => x.id !== l.id))}
                    className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-3 hover:text-foreground"
                    aria-label="Delete link"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="text-[10px] font-mono text-text-muted tabular-nums">
                  rect {l.rect.map((n) => Math.round(n)).join(", ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <button
        type="button"
        onClick={exportPdf}
        disabled={busy || !bytes}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
          (busy || !bytes) && "opacity-60 cursor-wait",
        )}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
        {busy ? "Working…" : "Export PDF"}
      </button>
      <p className="inline-flex items-center gap-1 text-[10.5px] text-text-muted">
        <Lock className="h-2.5 w-2.5" /> Outline edits stay on this device until you export.
      </p>
    </div>
  );
}

function OutlineTree({
  nodes,
  level,
  selectedId,
  onSelect,
  onToggle,
}: {
  nodes: import("@/lib/outline/types").OutlineNode[];
  level: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, expanded: boolean) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((n) => (
        <li key={n.id}>
          <div
            className={cn(
              "flex items-center gap-1 rounded px-1 py-0.5 cursor-pointer text-[12px]",
              selectedId === n.id ? "bg-vault/15 text-vault" : "hover:bg-surface-2",
            )}
            style={{ paddingLeft: 4 + level * 10 }}
            onClick={() => onSelect(n.id)}
          >
            {n.children.length > 0 ? (
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(n.id, !n.expanded); }}
                className="grid h-4 w-4 place-items-center text-text-muted hover:text-foreground"
                aria-label={n.expanded ? "Collapse" : "Expand"}
              >
                {n.expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronDown className="h-3 w-3 -rotate-90" />}
              </button>
            ) : (
              <span className="inline-block h-4 w-4" />
            )}
            <span
              className={cn("truncate flex-1", n.style.bold && "font-semibold", n.style.italic && "italic")}
            >
              {n.title || "Untitled"}
            </span>
            {n.dest && (
              <span className="text-[10px] font-mono text-text-muted tabular-nums">p.{n.dest.page + 1}</span>
            )}
          </div>
          {n.expanded && n.children.length > 0 && (
            <OutlineTree nodes={n.children} level={level + 1} selectedId={selectedId} onSelect={onSelect} onToggle={onToggle} />
          )}
        </li>
      ))}
    </ul>
  );
}

/* ============================== Repair ============================== */

function RepairPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile } = ctx;
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | {
        kind: "ok";
        blob: Blob;
        filename: string;
        recovered: number;
        dropped: number;
        expected: number;
        missingContent: number[];
        outcome: "full" | "partial";
        sourceName: string;
      }
    | { kind: "fail"; message: string }
    | null
  >(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Prefer the currently-open file; fall back to a directly picked one
  // (the normal viewer may have refused to open a damaged PDF).
  const source = picked ?? file;

  const run = useCallback(async () => {
    if (!source) return;
    setBusy(true);
    setResult(null);
    try {
      const { repairPdfFile } = await importChunk(() => import("@/lib/pdf/repair"));
      const out = await repairPdfFile(source);
      const outcome: "full" | "partial" =
        out.outcome === "full" ? "full" : "partial";
      setResult({
        kind: "ok",
        blob: out.blob,
        filename: out.filename,
        recovered: out.pagesRecovered,
        dropped: out.pagesDropped,
        expected: out.pagesExpected,
        missingContent: out.pagesWithMissingContent,
        outcome,
        sourceName: source.name,
      });
      if (outcome === "full") {
        toast.success(
          `Fully repaired — ${out.pagesRecovered}/${out.pagesExpected} pages`,
        );
      } else {
        toast.warning(
          `Partially repaired — ${out.pagesRecovered}/${out.pagesExpected} pages` +
            (out.pagesWithMissingContent.length > 0
              ? `, ${out.pagesWithMissingContent.length} with missing content`
              : ""),
        );
      }
    } catch (err) {
      const { friendlyRepairReason } = await importChunk(() => import("@/lib/pdf/repair"));
      const message = friendlyRepairReason(err, { fileSize: source.size });
      setResult({ kind: "fail", message });
      toast.error("Unable to repair this file", { description: message });
    } finally {
      setBusy(false);
    }
  }, [source]);

  const openRepaired = useCallback(() => {
    if (!result || result.kind !== "ok") return;
    try {
      const f = new File([result.blob], result.filename, { type: "application/pdf" });
      replaceFile(f);
      toast.success("Opened repaired copy in this tab");
    } catch {
      /* ignore */
    }
  }, [result, replaceFile]);

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Section title="Source" icon={<FileText className="h-3 w-3" />}>
        {source ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-foreground" title={source.name}>
                {source.name}
              </div>
              <div className="text-[10.5px] text-text-muted">
                {(source.size / 1024).toFixed(1)} KB{picked ? " · picked for repair" : " · current tab"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-md border border-border bg-surface-1 px-2 py-1 text-[11px] text-text-muted hover:text-foreground"
            >
              Change…
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-4 text-[11.5px] text-text-muted hover:text-foreground"
          >
            <Upload className="h-3.5 w-3.5" /> Choose a damaged PDF
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setPicked(f);
              setResult(null);
            }
            e.target.value = "";
          }}
        />
      </Section>

      <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[11px] text-text-muted">
        <Info className="mt-0.5 h-3 w-3 shrink-0 text-vault" />
        <div>
          Attempts to repair damaged PDFs — recovery depends on the type and
          extent of damage. Some severely corrupted files may not be fully
          recoverable.
        </div>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={!source || busy}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-3 py-2 text-[12px] font-medium text-vault-foreground transition-opacity",
          source && !busy ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
        )}
      >
        {busy ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Repairing…
          </>
        ) : (
          <>
            <Wrench className="h-3.5 w-3.5" /> Repair PDF
          </>
        )}
      </button>

      {result?.kind === "ok" ? (
        <Section
          title="Result"
          icon={
            result.outcome === "full" ? (
              <CheckCircle2 className="h-3 w-3 text-vault" />
            ) : (
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            )
          }
        >
          <div className="space-y-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[12px] text-foreground">
              {result.outcome === "full" ? (
                <>
                  <span aria-hidden>✅</span>
                  <span>Status: Fully repaired</span>
                </>
              ) : (
                <>
                  <span aria-hidden>⚠️</span>
                  <span>Status: Partially repaired</span>
                </>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
              <dt>Pages recovered</dt>
              <dd className="text-foreground">
                {result.recovered}/{result.expected}
              </dd>
              {result.outcome === "full" ? (
                <>
                  <dt>Content recovered</dt>
                  <dd className="text-foreground">Yes</dd>
                </>
              ) : (
                <>
                  {result.dropped > 0 ? (
                    <>
                      <dt>Pages dropped</dt>
                      <dd className="text-foreground">{result.dropped}</dd>
                    </>
                  ) : null}
                  <dt>Pages with missing content</dt>
                  <dd className="text-foreground">
                    {result.missingContent.length}
                  </dd>
                  {result.missingContent.length > 0 &&
                  result.missingContent.length <= 20 ? (
                    <>
                      <dt>Which pages</dt>
                      <dd
                        className="text-foreground truncate"
                        title={result.missingContent.join(", ")}
                      >
                        {result.missingContent.join(", ")}
                      </dd>
                    </>
                  ) : null}
                </>
              )}
            </dl>
            <div className="flex gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => triggerDownload(result.blob, result.filename)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[11.5px] text-foreground hover:bg-surface-3"
              >
                <Download className="h-3 w-3" /> Download
              </button>
              <button
                type="button"
                onClick={openRepaired}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[11.5px] text-foreground hover:bg-surface-3"
              >
                <FileText className="h-3 w-3" /> Open here
              </button>
            </div>
          </div>
        </Section>
      ) : result?.kind === "fail" ? (
        <Section title="Result" icon={<AlertTriangle className="h-3 w-3 text-destructive" />}>
          <div className="space-y-1 rounded-md border border-border bg-surface-2 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[12px] text-foreground">
              <span aria-hidden>❌</span>
              <span>Status: Unable to repair</span>
            </div>
            <div className="text-[11px] text-text-muted">{result.message}</div>
          </div>
        </Section>
      ) : null}

      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing is uploaded
      </div>
    </div>
  );
}


/* ============================ Sanitize ============================ */

function SanitizePanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const [busy, setBusy] = useState(false);

  if (!file) {
    return (
      <InspectorEmpty>
        Open a PDF to strip hidden metadata, embedded files, scripts, and form data.
      </InspectorEmpty>
    );
  }

  const run = async () => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { sanitizePdfBytes } = await importChunk(() => import("@/lib/pdf/sanitize"));
      const clean = await sanitizePdfBytes(bytes);
      const base = file.name.replace(/\.pdf$/i, "");
      await downloadPdf(clean, `${base}-sanitized.pdf`);
      toast.success("Sanitized — hidden data removed");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't sanitize this PDF");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-snug text-text-muted">
        Removes metadata, embedded files, JavaScript, form values, and XMP data.
        Visible page content is preserved.
      </p>
      <Button
        onClick={run}
        disabled={busy}
        className="w-full bg-vault text-vault-foreground hover:opacity-90"
      >
        {busy ? "Sanitizing…" : "Sanitize & download"}
      </Button>
      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing is uploaded
      </div>
    </div>
  );
}
