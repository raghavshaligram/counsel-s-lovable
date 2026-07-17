import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { TextCursorInput, Download, Layers } from "lucide-react";
import { toast } from "sonner";
import { addHeaderFooter, type HeaderFooterOpts, type HFAlign } from "@/lib/batch/ops/header-footer";
import { BatchDialog } from "@/components/tray/batch-dialog";
import { useTray } from "@/lib/tray/store";
import { downloadBytes } from "@/lib/batch/runner";

export const Route = createFileRoute("/header-footer")({
  head: () => ({
    meta: [
      { title: "Add Header & Footer to PDF — PDFMacro" },
      { name: "description", content: "Stamp custom headers and footers on PDFs with tokens like {page}, {date}, {filename}. Even/odd/first-page rules. 100% client-side." },
      { property: "og:title", content: "PDF Header & Footer — in your browser" },
      { property: "og:description", content: "Tokens, alignment, even/odd rules. No upload." },
    ],
    links: [{ rel: "canonical", href: "/header-footer" }],
  }),
  component: HeaderFooterPage,
});

const ALIGNS: HFAlign[] = ["left", "center", "right"];
const RULES: HeaderFooterOpts["rule"][] = ["all", "even", "odd", "no-first"];

function HeaderFooterPage() {
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState<HeaderFooterOpts>({
    headerText: "{filename}",
    footerText: "Page {page} of {pages}",
    align: "center",
    fontSize: 9,
    margin: 24,
    rule: "all",
  });
  const [busy, setBusy] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const trayCount = useTray((s) => s.entries.length);

  async function runSingle() {
    if (!file) return;
    setBusy(true);
    try {
      const out = await addHeaderFooter(new Uint8Array(await file.arrayBuffer()), { ...opts, filename: file.name });
      downloadBytes(out, file.name.replace(/\.pdf$/i, "") + "-headerfooter.pdf", "application/pdf");
      toast.success("Header/footer added");
    } catch (err) {
      console.error(err);
      toast.error("Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 md:px-8 py-12 space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-vault/80 font-mono">
            <TextCursorInput className="h-3 w-3" /> Header &amp; Footer
          </div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground leading-tight">
            Add headers and footers — with smart tokens.
          </h1>
          <p className="text-muted-foreground max-w-xl">
            Use <code className="text-vault">{"{page}"}</code>, <code className="text-vault">{"{pages}"}</code>, <code className="text-vault">{"{date}"}</code>, <code className="text-vault">{"{filename}"}</code> in your text.
          </p>
        </header>

        {!file ? (
          <FileDropzone onFile={setFile} label="Drop a PDF" sublabel="or batch the tray" />
        ) : (
          <div className="rounded-lg border border-border bg-card/40 p-5 flex items-center justify-between">
            <span className="font-mono text-sm truncate">{file.name}</span>
            <button onClick={() => setFile(null)} className="text-xs uppercase tracking-wider text-muted-foreground hover:text-evidence">Change</button>
          </div>
        )}

        <section className="rounded-lg border border-border bg-card/40 p-6 space-y-6">
          <Field label="Header text">
            <input
              type="text"
              value={opts.headerText ?? ""}
              onChange={(e) => setOpts({ ...opts, headerText: e.target.value })}
              placeholder="leave blank for none"
              className="w-full rounded-md border border-whisper bg-background px-3 py-2 text-sm focus:border-vault outline-none"
            />
          </Field>
          <Field label="Footer text">
            <input
              type="text"
              value={opts.footerText ?? ""}
              onChange={(e) => setOpts({ ...opts, footerText: e.target.value })}
              placeholder="leave blank for none"
              className="w-full rounded-md border border-whisper bg-background px-3 py-2 text-sm focus:border-vault outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Alignment">
              <div className="grid grid-cols-3 gap-2">
                {ALIGNS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setOpts({ ...opts, align: a })}
                    className={`rounded-md border px-3 py-2 text-xs font-mono uppercase tracking-wider transition ${opts.align === a ? "border-vault text-vault bg-vault/10" : "border-whisper text-muted-foreground hover:border-vault/40"}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Apply to">
              <div className="grid grid-cols-2 gap-2">
                {RULES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setOpts({ ...opts, rule: r })}
                    className={`rounded-md border px-3 py-2 text-xs font-mono uppercase tracking-wider transition ${opts.rule === r ? "border-vault text-vault bg-vault/10" : "border-whisper text-muted-foreground hover:border-vault/40"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <NumField label="Font size" value={opts.fontSize} onChange={(v) => setOpts({ ...opts, fontSize: v })} min={6} max={48} />
            <NumField label="Margin (pt)" value={opts.margin} onChange={(v) => setOpts({ ...opts, margin: v })} min={0} max={144} />
          </div>
        </section>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={runSingle}
            disabled={!file || busy}
            className="bg-vault text-vault-foreground hover:opacity-90 flex-1 h-11"
          >
            <Download className="h-4 w-4 mr-2" />
            {busy ? "Working…" : "Stamp this PDF"}
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
        title="Add header/footer to every tray PDF"
        description="Same settings apply to all files."
        op={addHeaderFooter}
        opts={opts}
        suffix="headerfooter"
        zipName="pdfmacro-header-footer.zip"
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
