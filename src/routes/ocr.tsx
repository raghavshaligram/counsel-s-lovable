import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, FileText, Lock, ScanText, X, Loader2 } from "lucide-react";
import { ocrPdfToSearchable, type OcrProgress } from "@/lib/pdf/ocr-pdf";
import { softwareAppSchema } from "@/lib/seo/tool-schema";

export const Route = createFileRoute("/ocr")({
  head: () => ({
    meta: [
      { title: "Make PDF Searchable — On-Device OCR · VaultPDF" },
      {
        name: "description",
        content:
          "Add a searchable text layer to scanned PDFs entirely in your browser. Tesseract OCR runs locally — no upload, no API key, no server.",
      },
      { property: "og:title", content: "Make PDF Searchable — 100% in your browser" },
      {
        property: "og:description",
        content:
          "Drop a scanned PDF, get a searchable PDF back. OCR runs on-device with Tesseract.",
      },
      { property: "og:url", content: "/ocr" },
    ],
    links: [{ rel: "canonical", href: "/ocr" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          softwareAppSchema({
            name: "VaultPDF OCR",
            url: "/ocr",
            description:
              "On-device OCR that turns scanned PDFs into searchable, copy-pasteable PDFs. Nothing uploaded.",
          }),
        ),
      },
    ],
  }),
  component: OcrPage,
});

function OcrPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setFile(null);
    setProgress(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultName(null);
  };

  const onFile = useCallback((f: File) => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultName(null);
    setProgress(null);
    setFile(f);
  }, [resultUrl]);

  const run = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setProgress(null);
    abortRef.current = new AbortController();
    try {
      const bytes = await ocrPdfToSearchable(file, setProgress, abortRef.current.signal);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const name = file.name.replace(/\.pdf$/i, "") + " (searchable).pdf";
      setResultUrl(url);
      setResultName(name);
      toast.success("Searchable PDF ready");
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "OCR failed";
      if (msg === "Cancelled") toast.info("OCR cancelled");
      else toast.error(msg);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [file]);

  const cancel = () => abortRef.current?.abort();

  const pct = progress
    ? Math.round(
        ((progress.page - 1 + (progress.stage === "ocr" ? 0.4 : progress.stage === "embedding" ? 0.85 : 0.05)) /
          progress.totalPages) *
          100,
      )
    : 0;

  return (
    <AppShell>
      <div className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-vault mb-3">
                Tool · Make PDF Searchable
              </div>
              <h1 className="font-display text-4xl md:text-5xl leading-tight">
                Turn scans into{" "}
                <span className="text-vault italic">searchable PDFs</span>.
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                Drop a scanned or image-only PDF and get one back with a real text layer — copy,
                search, redact, extract. Tesseract OCR runs entirely in your browser. Pages never
                leave the tab.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground rounded-md border border-border bg-card/50 px-3 py-2">
              <Lock className="h-3.5 w-3.5 text-vault" />
              On-device OCR · No upload
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
        <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
          <div className="space-y-4">
            {!file ? (
              <FileDropzone
                onFile={onFile}
                label="Drop a scanned PDF"
                sublabel="image-only or mixed PDFs · processed locally"
              />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 text-vault shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
                    <X className="h-4 w-4 mr-1" /> Reset
                  </Button>
                </div>

                {!busy && !resultUrl && (
                  <div className="rounded-lg border border-border bg-card/30 p-6 flex flex-col items-start gap-3">
                    <p className="text-sm text-muted-foreground">
                      OCR is CPU-intensive. A 10-page scan typically takes 30–90 seconds depending
                      on your device.
                    </p>
                    <Button
                      onClick={run}
                      className="bg-vault text-vault-foreground hover:opacity-90"
                    >
                      <ScanText className="h-4 w-4 mr-2" />
                      Run OCR locally
                    </Button>
                  </div>
                )}

                {busy && (
                  <div className="rounded-lg border border-vault/30 bg-vault/5 p-6 space-y-3">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-vault" />
                      {progress?.message ?? "Starting OCR…"}
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-vault transition-all"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{progress ? `Page ${progress.page} of ${progress.totalPages}` : ""}</span>
                      <button
                        onClick={cancel}
                        className="text-foreground/70 hover:text-foreground underline-offset-2 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {resultUrl && resultName && (
                  <div className="rounded-lg border border-vault/40 bg-vault/10 p-6 flex flex-col items-start gap-3">
                    <div className="text-sm">
                      Your searchable PDF is ready. Open it in any PDF reader — text is now
                      selectable and searchable.
                    </div>
                    <a
                      href={resultUrl}
                      download={resultName}
                      className="inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
                    >
                      <Download className="h-4 w-4" />
                      Download {resultName}
                    </a>
                  </div>
                )}
              </>
            )}
          </div>

          <aside className="lg:sticky lg:top-20 space-y-4">
            <div className="rounded-lg border border-border bg-card/50 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
                How it works
              </div>
              <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
                <li>Each page is rendered to a canvas at 144&nbsp;dpi.</li>
                <li>Tesseract.js recognises words and their positions.</li>
                <li>
                  A new PDF is built: original page image on top, invisible text layer below for
                  search and copy.
                </li>
              </ol>
            </div>
            <div className="rounded-lg border border-border bg-card/30 p-5 text-xs text-muted-foreground leading-relaxed">
              <div className="text-foreground font-medium mb-2">Privacy</div>
              Tesseract runs in your browser via WebAssembly. Your PDF, the rendered images, and the
              recognised text never touch a server.
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
