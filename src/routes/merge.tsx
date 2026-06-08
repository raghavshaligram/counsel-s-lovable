import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Download,
  FileStack,
  FileText,
  Lock,
  Sheet as SheetIcon,
  X,
  Wand2,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/merge")({
  head: () => ({
    meta: [
      { title: "Batch Mail Merge — VaultPDF" },
      {
        name: "description",
        content:
          "Generate hundreds of filled PDFs from a CSV — 100% in your browser. No uploads, no per-document fees.",
      },
      { property: "og:title", content: "Batch Mail Merge — VaultPDF" },
      {
        property: "og:description",
        content:
          "Upload a fillable PDF template and a CSV. Download a zip of filled PDFs. Nothing leaves your browser.",
      },
    ],
  }),
  component: MergePage,
});

type CsvRow = Record<string, string>;
type Mapping = Record<string, string>; // pdfFieldName -> csvColumn (or special)

const SPECIAL_BLANK = "__blank__";

function MergePage() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [filenamePattern, setFilenamePattern] = useState<string>(
    "{__row__}-output.pdf",
  );
  const [flatten, setFlatten] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Load PDF & detect AcroForm fields
  const onPdfFile = useCallback(async (file: File) => {
    setPdfFile(file);
    setFields([]);
    setMapping({});
    setPdfError(null);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const buf = await file.arrayBuffer();
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const form = doc.getForm();
      const names = form.getFields().map((f) => f.getName());
      if (names.length === 0) {
        setPdfError(
          "No fillable form fields detected. Mail merge currently requires a PDF with AcroForm fields. Drag-and-drop field placement on plain PDFs is coming next.",
        );
        return;
      }
      setFields(names);
    } catch (err) {
      console.error(err);
      setPdfError("Couldn't read that PDF. Is it password-protected or corrupted?");
    }
  }, []);

  // Load CSV
  const onCsvFile = useCallback(async (file: File) => {
    setCsvFile(file);
    setColumns([]);
    setRows([]);
    try {
      const Papa = (await import("papaparse")).default;
      const text = await file.text();
      const parsed = Papa.parse<CsvRow>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      });
      if (parsed.errors.length > 0) {
        console.warn("CSV parse warnings", parsed.errors);
      }
      const cols = parsed.meta.fields ?? [];
      setColumns(cols);
      setRows(parsed.data.filter((r) => Object.values(r).some((v) => v && v !== "")));
    } catch (err) {
      console.error(err);
      toast.error("Couldn't parse that file. Expected CSV with a header row.");
    }
  }, []);

  // Auto-map fields by fuzzy name match
  const autoMap = useCallback(() => {
    if (fields.length === 0 || columns.length === 0) return;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const next: Mapping = {};
    for (const f of fields) {
      const nf = norm(f);
      const hit = columns.find((c) => norm(c) === nf);
      next[f] = hit ?? "";
    }
    setMapping(next);
    const matched = Object.values(next).filter(Boolean).length;
    toast.success(`Auto-mapped ${matched} of ${fields.length} field${fields.length === 1 ? "" : "s"}`);
  }, [fields, columns]);

  const mappedCount = useMemo(
    () => Object.values(mapping).filter((v) => v && v !== SPECIAL_BLANK).length,
    [mapping],
  );

  const generate = useCallback(async () => {
    if (!pdfFile || rows.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: rows.length });
    try {
      const { PDFDocument } = await import("pdf-lib");
      const JSZip = (await import("jszip")).default;
      const templateBuf = await pdfFile.arrayBuffer();
      const zip = new JSZip();
      const usedNames = new Map<string, number>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const doc = await PDFDocument.load(templateBuf, { ignoreEncryption: true });
        const form = doc.getForm();

        for (const fieldName of fields) {
          const src = mapping[fieldName];
          if (!src || src === SPECIAL_BLANK) continue;
          const value = (row[src] ?? "").toString();
          try {
            const field = form.getField(fieldName);
            const t = field.constructor.name;
            if (t === "PDFTextField") {
              (field as unknown as { setText: (v: string) => void }).setText(value);
            } else if (t === "PDFCheckBox") {
              const truthy = /^(1|true|yes|y|x|checked|on)$/i.test(value.trim());
              const cb = field as unknown as { check: () => void; uncheck: () => void };
              truthy ? cb.check() : cb.uncheck();
            } else if (t === "PDFDropdown" || t === "PDFOptionList") {
              (field as unknown as { select: (v: string) => void }).select(value);
            } else if (t === "PDFRadioGroup") {
              (field as unknown as { select: (v: string) => void }).select(value);
            } else {
              // Fallback: try setText.
              (field as unknown as { setText?: (v: string) => void }).setText?.(value);
            }
          } catch (err) {
            console.warn(`Field "${fieldName}" failed on row ${i + 1}`, err);
          }
        }

        if (flatten) form.flatten();
        doc.setProducer("VaultPDF");
        doc.setCreator("VaultPDF");
        const bytes = await doc.save();

        const filename = uniqueName(
          buildFilename(filenamePattern, row, i + 1),
          usedNames,
        );
        zip.file(filename, bytes);
        setProgress({ done: i + 1, total: rows.length });
        // Yield to UI thread every ~10 docs
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (pdfFile.name.replace(/\.pdf$/i, "") || "merge") + `-${rows.length}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Generated ${rows.length} PDFs`, {
        description: "Saved to your Downloads as a zip. Nothing was uploaded.",
      });
    } catch (err) {
      console.error(err);
      toast.error("Generation failed. Check the console for details.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [pdfFile, rows, fields, mapping, flatten, filenamePattern]);

  const ready = pdfFile && fields.length > 0 && rows.length > 0 && mappedCount > 0;

  return (
    <AppShell>
      <div className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-vault mb-3">
                Tool · Batch Mail Merge
              </div>
              <h1 className="font-display text-4xl md:text-5xl leading-tight">
                One template + one CSV = hundreds of filled PDFs.
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                Drop a fillable PDF template and a CSV. Map columns to fields. Generate as
                many filled, named, ready-to-send PDFs as you need — all in your browser, no
                per-document fees, no upload.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground rounded-md border border-border bg-card/50 px-3 py-2">
              <Lock className="h-3.5 w-3.5 text-vault" />
              Processed in your browser
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10 space-y-8">
        {/* STEP 1 — files */}
        <section className="grid md:grid-cols-2 gap-5">
          <StepCard
            n={1}
            title="PDF template (with form fields)"
            done={!!pdfFile && fields.length > 0}
          >
            {!pdfFile ? (
              <FileDropzone
                onFile={onPdfFile}
                accept="application/pdf"
                label="Drop your fillable PDF"
                sublabel="must contain AcroForm fields"
              />
            ) : (
              <FilePill
                icon={FileText}
                name={pdfFile.name}
                meta={
                  pdfError
                    ? "no fields detected"
                    : `${fields.length} field${fields.length === 1 ? "" : "s"} detected`
                }
                onClear={() => {
                  setPdfFile(null);
                  setFields([]);
                  setMapping({});
                  setPdfError(null);
                }}
              />
            )}
            {pdfError && (
              <div className="mt-3 flex items-start gap-2 text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{pdfError}</span>
              </div>
            )}
          </StepCard>

          <StepCard n={2} title="CSV data" done={rows.length > 0}>
            {!csvFile ? (
              <FileDropzone
                onFile={onCsvFile}
                accept=".csv,text/csv,application/vnd.ms-excel"
                label="Drop your CSV"
                sublabel="first row must be column headers"
              />
            ) : (
              <FilePill
                icon={SheetIcon}
                name={csvFile.name}
                meta={`${rows.length} row${rows.length === 1 ? "" : "s"} · ${columns.length} column${columns.length === 1 ? "" : "s"}`}
                onClear={() => {
                  setCsvFile(null);
                  setRows([]);
                  setColumns([]);
                  setMapping({});
                }}
              />
            )}
          </StepCard>
        </section>

        {/* STEP 3 — mapping */}
        {fields.length > 0 && columns.length > 0 && (
          <section className="rounded-xl border border-border bg-card/30 p-5 md:p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-vault mb-2">
                  Step 3
                </div>
                <h2 className="font-display text-2xl">Map fields to columns</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {mappedCount} of {fields.length} field
                  {fields.length === 1 ? "" : "s"} mapped.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={autoMap}>
                <Wand2 className="h-3.5 w-3.5 mr-2" /> Auto-map by name
              </Button>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_1fr] text-[11px] uppercase tracking-[0.18em] text-muted-foreground bg-card/60 px-4 py-2 border-b border-border">
                <div>PDF field</div>
                <div>CSV column</div>
                <div>Preview (row 1)</div>
              </div>
              <div className="divide-y divide-border">
                {fields.map((f) => {
                  const sel = mapping[f] ?? "";
                  const preview =
                    sel && sel !== SPECIAL_BLANK ? rows[0]?.[sel] ?? "" : "";
                  return (
                    <div
                      key={f}
                      className="grid grid-cols-[1fr_1fr_1fr] items-center px-4 py-2.5 gap-3 hover:bg-accent/30"
                    >
                      <div className="text-sm font-mono truncate" title={f}>
                        {f}
                      </div>
                      <select
                        value={sel}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [f]: e.target.value }))
                        }
                        className="bg-background border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-vault"
                      >
                        <option value="">— leave unmapped —</option>
                        <option value={SPECIAL_BLANK}>(blank)</option>
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <div className="text-xs text-muted-foreground truncate" title={preview}>
                        {preview || (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* STEP 4 — options + generate */}
        {ready && (
          <section className="rounded-xl border border-border bg-card/30 p-5 md:p-6">
            <div className="text-[11px] uppercase tracking-[0.22em] text-vault mb-2">
              Step 4
            </div>
            <h2 className="font-display text-2xl mb-5">Generate</h2>

            <div className="grid md:grid-cols-2 gap-5">
              <label className="block">
                <div className="text-xs text-muted-foreground mb-1.5">
                  Filename pattern
                </div>
                <input
                  value={filenamePattern}
                  onChange={(e) => setFilenamePattern(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-vault"
                  placeholder="{LastName}_{LoanID}.pdf"
                />
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Use <code className="text-vault">{"{Column}"}</code> tokens. Special:{" "}
                  <code className="text-vault">{"{__row__}"}</code>. Example preview:{" "}
                  <span className="text-foreground">
                    {buildFilename(filenamePattern, rows[0], 1)}
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-md border border-border bg-background/50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={flatten}
                  onChange={(e) => setFlatten(e.target.checked)}
                  className="mt-1 accent-vault"
                />
                <span>
                  <span className="text-sm font-medium block">Flatten output</span>
                  <span className="text-xs text-muted-foreground">
                    Lock the fields so recipients can't edit. Recommended for sending.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-6 flex items-center gap-4 flex-wrap">
              <Button
                onClick={generate}
                disabled={busy}
                className="bg-vault text-vault-foreground hover:opacity-90"
              >
                <Download className="h-4 w-4 mr-2" />
                {busy
                  ? progress
                    ? `Generating ${progress.done}/${progress.total}…`
                    : "Generating…"
                  : `Generate ${rows.length} PDF${rows.length === 1 ? "" : "s"} (zip)`}
              </Button>
              {busy && progress && (
                <div className="flex-1 min-w-[200px] max-w-md">
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-vault transition-all"
                      style={{
                        width: `${(progress.done / progress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Idle hint */}
        {!pdfFile && !csvFile && (
          <div className="rounded-xl border border-border bg-card/20 p-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground font-medium mb-2">
              <FileStack className="h-4 w-4 text-vault" />
              Don't have a fillable PDF handy?
            </div>
            <p>
              Adobe Acrobat, LibreOffice, and most form-builder tools can save a PDF with
              AcroForm fields. We're shipping drag-and-drop field placement on plain PDFs
              next.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StepCard({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/30 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
            done ? "bg-vault text-vault-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {n}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      {children}
    </div>
  );
}

function FilePill({
  icon: Icon,
  name,
  meta,
  onClear,
}: {
  icon: typeof FileText;
  name: string;
  meta: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <Icon className="h-4 w-4 text-vault shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{name}</div>
          <div className="text-xs text-muted-foreground">{meta}</div>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onClear}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function buildFilename(pattern: string, row: CsvRow | undefined, index: number) {
  const safe = (s: string) => s.replace(/[\/\\:*?"<>|]+/g, "_").trim();
  let out = pattern.replace(/\{__row__\}/g, String(index));
  out = out.replace(/\{([^}]+)\}/g, (_, key) => safe((row?.[key] ?? "").toString()) || "_");
  if (!/\.pdf$/i.test(out)) out += ".pdf";
  return out;
}

function uniqueName(name: string, used: Map<string, number>) {
  const count = used.get(name) ?? 0;
  used.set(name, count + 1);
  if (count === 0) return name;
  return name.replace(/\.pdf$/i, `-${count + 1}.pdf`);
}
