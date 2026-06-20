/**
 * Tool panels — per-tool inspector bodies. Exactly ONE renders inside the
 * single Inspector container at any time. No outer card/wrapper here: the
 * Inspector already provides the header, border, and scroll area.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  GripVertical,
  X,
  Files as FilesIcon,
  KeyRound,
  Eye,
  EyeOff,

} from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { cn } from "@/lib/utils";
import { SignatureCreator } from "./signature-creators";
import type { Action as EditorAction } from "@/lib/editor/state";
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

export type ToolPanelCtx = {
  /** The active tab's PDF file (or null when none open). */
  file: File | null;
  /** Replace the active tab's file in place (used by Fill → apply). */
  replaceFile: (f: File) => void;
  /** Dispatch into the active tab's editor state. */
  editorDispatch: (a: EditorAction) => void;
};

type PanelProps = { toolId: string; ctx: ToolPanelCtx };

export function ToolPanel({ toolId, ctx }: PanelProps) {
  switch (toolId) {
    case "redact":
      return <RedactPanel />;
    case "sign":
      return <SignFillPanel ctx={ctx} />;
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
    default:
      return <ComingSoonPanel label={toolId} />;
  }
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
      <p className="text-[11.5px] leading-snug text-text-2">
        Open a document to start signing or filling form fields.
      </p>
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


/* ------------------------------ Redact ------------------------------ */

function RedactPanel() {
  const [query, setQuery] = useState("");
  const [exemption, setExemption] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Section title="Get started">
        <p className="text-[11.5px] leading-snug text-text-2">
          Drag a box over the page to redact, or use the tools below. Redactions
          are baked in on export — never reversible.
        </p>
      </Section>

      <Section title="Auto-detect PII" icon={<Wand2 className="h-3 w-3" />}>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
          Scan this document
        </button>
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Finds names, emails, phone numbers, SSNs, addresses.
        </p>
      </Section>

      <Section title="Find &amp; redact" icon={<Search className="h-3 w-3" />}>
        <div className="flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Text or /regex/"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
          />
          <button
            type="button"
            disabled={!query.trim()}
            className={cn(
              "rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3",
              !query.trim() && "opacity-40 cursor-not-allowed",
            )}
          >
            Find
          </button>
        </div>
      </Section>

      <Section title="Exemption label" icon={<Tag className="h-3 w-3" />}>
        <input
          value={exemption}
          onChange={(e) => setExemption(e.target.value)}
          placeholder="e.g. FOIA (b)(6)"
          className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
        />
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Stamped on each redaction mark.
        </p>
      </Section>

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
          <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11px] text-text-muted">
            Open a PDF in the workspace to begin, then add more files below.
          </p>
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
  type SplitUiMode = "ranges" | "each" | "everyN" | "splitPoints";
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
      downloadBlob(result.blob, result.filename);
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

  const modeBtn = (id: SplitUiMode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(id)}
      className={cn(
        "rounded-md border px-2 py-1.5 text-[11.5px] transition-colors",
        mode === id
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
        <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] text-text-muted">
          Open a PDF in the workspace to split it.
        </p>
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
    </div>
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
      downloadBlob(result.blob, result.filename);
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
        <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] text-text-muted">
          Open a PDF in the workspace to rotate it.
        </p>
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
    <p className="text-[11.5px] leading-snug text-text-2">
      The native <span className="text-foreground">{label}</span> panel is being
      mounted here. The full controls land in the next pass — same single
      inspector, no second column.
    </p>
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
      downloadBytes(bytes, `vaultpdf-organized-${Date.now()}.pdf`, "application/pdf");
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
      <p className="text-[11.5px] leading-snug text-text-2">
        Open a document to organize its pages. You can also pull pages in from
        any other open document — they appear in the grid alongside the active
        document's pages.
      </p>
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
        const { getPageCount } = await import("@/lib/pdf/extract-pages");
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
      const { extractPages } = await import("@/lib/pdf/extract-pages");
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
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] text-text-muted">
        Open a PDF in the workspace to extract pages.
      </p>
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
      const { extractTables, downloadXlsx, rowsToCsv } = await import(
        "@/lib/pdf/extract-tables"
      );
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
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] text-text-muted">
        Open a PDF in the workspace to extract its data.
      </p>
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

function triggerDownload(blob: Blob, filename: string) {
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
      const { applyTextWatermark } = await import("@/lib/pdf/watermark");
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
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] text-text-muted">
        Open a PDF in the workspace to add a watermark.
      </p>
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
    // Lazy import default to keep top-level import light.
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
  const [busy, setBusy] = useState(false);
  const [strength, setStrength] = useState<{
    pct: number;
    label: string;
    color: string;
  }>({ pct: 0, label: "", color: "bg-muted" });

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/pdf/protect").then((m) => {
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
      const { protectPdf } = await import("@/lib/pdf/protect");
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
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] text-text-muted">
        Open a PDF in the workspace to encrypt it.
      </p>
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

      <Section title="Owner password">
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useOwnerPw}
            onChange={(e) => setUseOwnerPw(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-vault"
          />
          <div>
            <div className="text-[12px] text-foreground leading-tight">
              Set a separate owner password
            </div>
            <div className="text-[10.5px] text-text-muted mt-0.5">
              Owners can change permissions.
            </div>
          </div>
        </label>
        {useOwnerPw && (
          <input
            type={showPw ? "text" : "password"}
            value={ownerPassword}
            onChange={(e) => setOwnerPassword(e.target.value)}
            placeholder="Owner password"
            autoComplete="new-password"
            className={cn(pwInput, "mt-2")}
          />
        )}
      </Section>

      <Section title="Permissions" icon={<ShieldCheck className="h-3 w-3" />}>
        <div className="space-y-1.5">
          {PERM_ROWS.map((row) => (
            <label
              key={row.key}
              className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 cursor-pointer hover:bg-surface-1 transition-colors"
            >
              <input
                type="checkbox"
                checked={perms[row.key]}
                onChange={() => togglePerm(row.key)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-vault"
              />
              <div className="min-w-0">
                <div className="text-[12px] text-foreground leading-tight">{row.label}</div>
                <div className="text-[10.5px] text-text-muted mt-0.5">{row.desc}</div>
              </div>
            </label>
          ))}
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
