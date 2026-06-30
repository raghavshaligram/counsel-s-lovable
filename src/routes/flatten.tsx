import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Layers, Download, Lock } from "lucide-react";
import { toast } from "sonner";
import { flatten, type FlattenOpts } from "@/lib/batch/ops/flatten";
import { BatchDialog } from "@/components/tray/batch-dialog";
import { useTray } from "@/lib/tray/store";
import { downloadPdf } from "@/lib/pdf/download";
import { ExportFormatRow } from "@/components/workspace/export-format-row";

export const Route = createFileRoute("/flatten")({
  head: () => ({
    meta: [
      { title: "Flatten PDF Forms & Annotations — CounselPDF" },
      { name: "description", content: "Bake form fields and annotations into static PDF content — preventing further edits. 100% client-side." },
      { property: "og:title", content: "Flatten PDF — bake forms and annotations" },
      { property: "og:description", content: "Make forms and markup uneditable. In your browser." },
    ],
    links: [{ rel: "canonical", href: "/flatten" }],
  }),
  component: FlattenPage,
});

function FlattenPage() {
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState<FlattenOpts>({ forms: true, annotations: false });
  const [busy, setBusy] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const trayCount = useTray((s) => s.entries.length);

  async function runSingle() {
    if (!file) return;
    setBusy(true);
    try {
      const out = await flatten(new Uint8Array(await file.arrayBuffer()), opts);
      await downloadPdf(out, file.name.replace(/\.pdf$/i, "") + "-flattened.pdf");
      toast.success("PDF flattened");
    } catch (err) {
      console.error(err);
      toast.error("Failed to flatten");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 md:px-8 py-12 space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-vault/80 font-mono">
            <Lock className="h-3 w-3" /> Flatten
          </div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground leading-tight">
            Bake forms and annotations into the page.
          </h1>
          <p className="text-muted-foreground max-w-xl">
            Convert fillable fields and markup into static content so they can&apos;t be edited or stripped.
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

        <section className="rounded-lg border border-border bg-card/40 p-6 space-y-4">
          <Toggle
            label="Flatten form fields"
            desc="Text, checkboxes, dropdowns — current values become permanent."
            checked={opts.forms}
            onChange={(v) => setOpts({ ...opts, forms: v })}
          />
          <Toggle
            label="Strip annotations"
            desc="Removes highlights, comments, sticky notes, and link annotations."
            checked={opts.annotations}
            onChange={(v) => setOpts({ ...opts, annotations: v })}
          />
        </section>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={runSingle}
            disabled={!file || busy}
            className="bg-vault text-vault-foreground hover:opacity-90 flex-1 h-11"
          >
            <Download className="h-4 w-4 mr-2" />
            {busy ? "Working…" : "Flatten this PDF"}
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
        title="Flatten every tray PDF"
        op={flatten}
        opts={opts}
        suffix="flattened"
        zipName="counselpdf-flattened.zip"
      />
    </AppShell>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-border bg-background/40 p-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-vault" />
      <span>
        <span className="text-sm font-medium block">{label}</span>
        <span className="text-xs text-muted-foreground">{desc}</span>
      </span>
    </label>
  );
}
