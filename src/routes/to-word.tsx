import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText, Info } from "lucide-react";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";
import { loadPdfjs } from "@/lib/pdf/worker";
import { convertPdfToWordBlob } from "@/lib/pdf/to-word";

export const Route = createFileRoute("/to-word")({
  head: () => ({
    meta: [
      { title: "PDF to Word (DOCX) — CounselPDF" },
      {
        name: "description",
        content:
          "Convert PDFs to editable Word documents. Text + layout preserved, runs entirely in your browser — your files never upload.",
      },
      { property: "og:title", content: "PDF to Word — CounselPDF" },
      {
        property: "og:description",
        content: "Editable .docx from your PDF, generated locally. No upload.",
      },
      { property: "og:url", content: "/to-word" },
    ],
    links: [{ rel: "canonical", href: "/to-word" }],
  }),
  component: ToWordPage,
});

type Mode = "flow" | "page";

function ToWordPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<Mode>("flow");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      setPageCount(doc.numPages);
    } catch {
      toast.error("Couldn't open that PDF.");
      setFile(null);
    }
  }, []);

  const reset = () => {
    setFile(null);
    setPageCount(0);
    setProgress(0);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    try {
      const blob = await convertPdfToWordBlob(file, { mode, onProgress: (pct) => setProgress(pct) });
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBlob(blob, `${base}.docx`);
      toast.success("Word document downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Conversion failed");
    } finally {
      setBusy(false);
    }
  };


  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);
  return (
    <AppShell>
      <ToolHeader
        tag="PDF → Word"
        title="Turn your PDF into an editable Word doc."
        sub="Text and paragraph structure are reconstructed locally. Best for text PDFs — scanned pages need OCR first."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to convert" sublabel="no upload" />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} info={`${pageCount} page${pageCount === 1 ? "" : "s"}`} onClose={reset} onReplace={onFile} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Layout</div>
                <div className="grid grid-cols-2 gap-2">
                  <ModeBtn active={mode === "flow"} onClick={() => setMode("flow")}>
                    Continuous flow
                  </ModeBtn>
                  <ModeBtn active={mode === "page"} onClick={() => setMode("page")}>
                    Page breaks + labels
                  </ModeBtn>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-border bg-background/40 px-3 py-2.5 text-[12px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  Text-only conversion. Images, tables, and complex layouts may not survive cleanly —
                  if your PDF is scanned, run <span className="text-foreground">Make Searchable</span> first.
                </div>
              </div>

              {busy && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-vault transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">Reading pages… {progress}%</div>
                </div>
              )}

              <Button onClick={run} disabled={busy} className="bg-vault text-vault-foreground hover:opacity-90 w-full h-11">
                <FileText className="h-4 w-4 mr-2" />
                {busy ? "Converting…" : "Convert & download .docx"}
              </Button>
              <div className="text-center text-[11px] text-muted-foreground">
                🔒 Converted in your browser. Nothing uploaded.
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

