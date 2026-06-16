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
  splitPdf,
  downloadBlob,
  getPageCount as getSplitPageCount,
} from "@/lib/pdf/split";
import { Scissors } from "lucide-react";

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

/* ----------------------------- Generic ------------------------------ */


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
