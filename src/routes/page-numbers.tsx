import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Hash, Download, Layers } from "lucide-react";
import { toast } from "sonner";
import { addPageNumbers, type PageNumberAnchor, type PageNumberFormat, type PageNumbersOpts } from "@/lib/batch/ops/page-numbers";
import { BatchDialog } from "@/components/tray/batch-dialog";
import { useTray } from "@/lib/tray/store";
import { downloadPdf } from "@/lib/pdf/download";
import { ExportFormatRow } from "@/components/workspace/export-format-row";

export const Route = createFileRoute("/page-numbers")({
  head: () => ({
    meta: [
      { title: "Add Page Numbers to PDF — CounselPDF" },
      { name: "description", content: "Stamp page numbers on any PDF — choose position, format, start number, and skip first pages. 100% on-device." },
      { property: "og:title", content: "PDF Page Numbers — in your browser" },
      { property: "og:description", content: "Position, format, start number — no upload." },
    ],
    links: [{ rel: "canonical", href: "/page-numbers" }],
  }),
  component: PageNumbersPage,
});

const ANCHORS: PageNumberAnchor[] = [
  "top-left", "top-center", "top-right",
  "bottom-left", "bottom-center", "bottom-right",
];

const FORMATS: { id: PageNumberFormat; label: string }[] = [
  { id: "n", label: "1" },
  { id: "page-n", label: "Page 1" },
  { id: "n-of-m", label: "1 of N" },
  { id: "roman", label: "i" },
];

function PageNumbersPage() {
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState<PageNumbersOpts>({
    anchor: "bottom-center",
    format: "page-n",
    startAt: 1,
    skipFirst: 0,
    fontSize: 11,
    margin: 24,
    prefix: "",
  });
  const [busy, setBusy] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const trayCount = useTray((s) => s.entries.length);

  async function runSingle() {
    if (!file) return;
    setBusy(true);
    try {
      const out = await addPageNumbers(new Uint8Array(await file.arrayBuffer()), opts);
      await downloadPdf(out, file.name.replace(/\.pdf$/i, "") + "-numbered.pdf");
      toast.success("Page numbers added");
    } catch (err) {
      console.error(err);
      toast.error("Failed to add page numbers");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 md:px-8 py-12 space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-vault/80 font-mono">
            <Hash className="h-3 w-3" /> Page Numbers
          </div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground leading-tight">
            Stamp page numbers — exactly where you want them.
          </h1>
          <p className="text-muted-foreground max-w-xl">
            Choose corner, format, start number, and which pages to skip. Runs entirely in your browser.
          </p>
        </header>

        {!file ? (
          <FileDropzone onFile={setFile} label="Drop a PDF" sublabel="single file or use the tray for batch" />
        ) : (
          <div className="rounded-lg border border-border bg-card/40 p-5 flex items-center justify-between">
            <span className="font-mono text-sm truncate">{file.name}</span>
            <button onClick={() => setFile(null)} className="text-xs uppercase tracking-wider text-muted-foreground hover:text-evidence">Change</button>
          </div>
        )}

        <section className="rounded-lg border border-border bg-card/40 p-6 space-y-6">
          <Field label="Position">
            <div className="grid grid-cols-3 gap-2">
              {ANCHORS.map((a) => (
                <button
                  key={a}
                  onClick={() => setOpts({ ...opts, anchor: a })}
                  className={`rounded-md border px-3 py-2 text-xs font-mono uppercase tracking-wider transition ${opts.anchor === a ? "border-vault text-vault bg-vault/10" : "border-whisper text-muted-foreground hover:border-vault/40"}`}
                >
                  {a.replace("-", " · ")}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Format">
            <div className="grid grid-cols-4 gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setOpts({ ...opts, format: f.id })}
                  className={`rounded-md border px-3 py-2 text-sm font-mono transition ${opts.format === f.id ? "border-vault text-vault bg-vault/10" : "border-whisper text-muted-foreground hover:border-vault/40"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <NumField label="Start at" value={opts.startAt} onChange={(v) => setOpts({ ...opts, startAt: v })} min={1} />
            <NumField label="Skip first" value={opts.skipFirst} onChange={(v) => setOpts({ ...opts, skipFirst: v })} min={0} />
            <NumField label="Font size" value={opts.fontSize} onChange={(v) => setOpts({ ...opts, fontSize: v })} min={6} max={48} />
            <NumField label="Margin (pt)" value={opts.margin} onChange={(v) => setOpts({ ...opts, margin: v })} min={0} max={144} />
          </div>

          <Field label="Prefix (optional)">
            <input
              type="text"
              value={opts.prefix}
              onChange={(e) => setOpts({ ...opts, prefix: e.target.value })}
              placeholder="e.g. — "
              className="w-full rounded-md border border-whisper bg-background px-3 py-2 text-sm focus:border-vault outline-none"
            />
          </Field>
        </section>

        <ExportFormatRow />

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={runSingle}
            disabled={!file || busy}
            className="bg-vault text-vault-foreground hover:opacity-90 flex-1 h-11"
          >
            <Download className="h-4 w-4 mr-2" />
            {busy ? "Working…" : "Number this PDF"}
          </Button>
          <Button
            variant="outline"
            disabled={trayCount === 0}
            onClick={() => setBatchOpen(true)}
            className="flex-1 h-11"
          >
            <Layers className="h-4 w-4 mr-2" />
            Apply to tray ({trayCount})
          </Button>
        </div>
      </div>

      <BatchDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        title="Add page numbers to every tray PDF"
        description="Same settings apply to all files. Failures are isolated."
        op={addPageNumbers}
        opts={opts}
        suffix="numbered"
        zipName="counselpdf-page-numbers.zip"
      />
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="block text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-mono">{label}</span>
      {children}
    </label>
  );
}

function NumField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="block space-y-2">
      <span className="block text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-mono">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full rounded-md border border-whisper bg-background px-3 py-2 text-sm font-mono tabular-nums focus:border-vault outline-none"
      />
    </label>
  );
}
