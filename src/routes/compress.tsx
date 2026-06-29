import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, Download, Loader2, Lock, Minimize2, Layers } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { loadPdfjs } from "@/lib/pdf/worker";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";
import { BatchDialog } from "@/components/tray/batch-dialog";
import { useTray } from "@/lib/tray/store";
import { compress as compressOp } from "@/lib/batch/ops/compress";

export const Route = createFileRoute("/compress")({
  head: () => ({
    meta: [
      { title: "Compress PDF — Shrink Files Locally · CounselPDF" },
      {
        name: "description",
        content:
          "Shrink PDFs by 60–90% in your browser. Pick a quality preset, get a smaller file — no upload, no size limit, no account.",
      },
      { property: "og:title", content: "Compress PDF — 100% in your browser" },
      {
        property: "og:description",
        content:
          "Re-encode PDF pages at your chosen quality. Files stay on your device.",
      },
      { property: "og:url", content: "/compress" },
    ],
    links: [{ rel: "canonical", href: "/compress" }],
  }),
  component: CompressPage,
});

type Preset = "low" | "medium" | "high" | "extreme";

const PRESETS: Record<
  Preset,
  {
    label: string;
    dpi: number;
    quality: number;
    blurb: string;
    /** Rough expected output / input ratio for a typical image-heavy PDF. */
    estimatedRatio: number;
  }
> = {
  low: {
    label: "Light",
    dpi: 200,
    quality: 0.92,
    blurb: "Near-original quality. Good for archival or print.",
    estimatedRatio: 0.65,
  },
  medium: {
    label: "Balanced",
    dpi: 150,
    quality: 0.8,
    blurb: "Good for standard emails.",
    estimatedRatio: 0.35,
  },
  high: {
    label: "Strong",
    dpi: 100,
    quality: 0.65,
    blurb: "Web-optimized.",
    estimatedRatio: 0.2,
  },
  extreme: {
    label: "Maximum",
    dpi: 72,
    quality: 0.5,
    blurb: "Maximum compression for rigid web forms.",
    estimatedRatio: 0.12,
  },
};

type Result = {
  url: string;
  name: string;
  originalSize: number;
  newSize: number;
};

function CompressPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [preset, setPreset] = useState<Preset>("medium");
  const [grayscale, setGrayscale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<Result | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const trayCount = useTray((s) => s.entries.length);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    setResult(null);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), {
        ignoreEncryption: true,
      });
      setPageCount(doc.getPageCount());
    } catch {
      toast.error("Couldn't open that PDF.");
      setFile(null);
    }
  }, []);

  const reset = () => {
    if (result) URL.revokeObjectURL(result.url);
    setFile(null);
    setPageCount(0);
    setResult(null);
    setProgress(null);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setProgress({ done: 0, total: pageCount });
    try {
      const { dpi, quality } = PRESETS[preset];
      // pdf.js renders at scale = dpi / 72
      const scale = dpi / 72;

      const pdfjs = await loadPdfjs();
      const srcBytes = new Uint8Array(await file.arrayBuffer());
      // pdf.js transfers the underlying buffer to its worker (detaching it),
      // so hand each consumer its own copy.
      const srcDoc = await pdfjs.getDocument({ data: srcBytes.slice() }).promise;

      // Get original page dimensions (in pt) from pdf-lib so output PDF matches
      const sizingDoc = await PDFDocument.load(srcBytes.slice(), {
        ignoreEncryption: true,
      });
      const sizes = sizingDoc.getPages().map((p) => ({
        w: p.getWidth(),
        h: p.getHeight(),
      }));

      const out = await PDFDocument.create();

      for (let i = 0; i < srcDoc.numPages; i++) {
        const page = await srcDoc.getPage(i + 1);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D unavailable");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;

        if (grayscale) {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = img.data;
          for (let p = 0; p < d.length; p += 4) {
            const g = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
            d[p] = d[p + 1] = d[p + 2] = g;
          }
          ctx.putImageData(img, 0, 0);
        }

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const jpegBytes = dataUrlToBytes(dataUrl);
        const jpg = await out.embedJpg(jpegBytes);
        const sz = sizes[i] ?? { w: viewport.width / scale, h: viewport.height / scale };
        const p = out.addPage([sz.w, sz.h]);
        p.drawImage(jpg, { x: 0, y: 0, width: sz.w, height: sz.h });

        setProgress({ done: i + 1, total: srcDoc.numPages });
        // Yield so UI updates
        if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0));
      }

      // Strip metadata
      out.setTitle("");
      out.setAuthor("");
      out.setSubject("");
      out.setKeywords([]);
      out.setProducer("CounselPDF");
      out.setCreator("CounselPDF");

      const bytes = await out.save();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const name = file.name.replace(/\.pdf$/i, "") + `-compressed.pdf`;
      setResult({
        url,
        name,
        originalSize: file.size,
        newSize: blob.size,
      });
      toast.success("Compressed PDF ready");
    } catch (err) {
      console.error(err);
      toast.error("Compression failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const pct = useMemo(() => {
    if (!result) return 0;
    return Math.max(0, Math.round((1 - result.newSize / result.originalSize) * 100));
  }, [result]);

  const download = () => {
    if (!result) return;
    downloadBlob(
      new Blob([], { type: "application/pdf" }), // placeholder, not used; we use anchor below
      result.name,
    );
  };
  void download;

  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);
  return (
    <AppShell>
      <ToolHeader
        tag="Compress"
        title="Shrink PDFs without uploading them."
        sub="Re-encode pages at the quality you choose. A 50 MB report becomes a 5 MB email attachment, processed entirely on your device."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {trayCount > 0 && (
          <div className="mb-6 rounded-md border border-vault/30 bg-vault/5 px-4 py-3 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              <span className="font-mono uppercase tracking-[0.2em] text-vault/80">Tray · {trayCount}</span> ready for batch compression at the current preset.
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBatchOpen(true)}
              className="border-vault/40 text-vault hover:bg-vault/10"
            >
              <Layers className="h-3.5 w-3.5 mr-1.5" />
              Compress all
            </Button>
          </div>
        )}
        {!file ? (
          <FileDropzone
            onFile={onFile}
            label="Drop a PDF to compress"
            sublabel="no upload, no page limit"
          />
        ) : (
          <div className="space-y-6">
            <FileBar
              file={file}
              info={`${pageCount} page${pageCount === 1 ? "" : "s"}`}
              onClose={reset}
              onReplace={onFile}
            />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Compression preset
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(PRESETS) as Preset[]).map((k) => (
                    <ModeBtn
                      key={k}
                      active={preset === k}
                      onClick={() => setPreset(k)}
                    >
                      {PRESETS[k].label}
                    </ModeBtn>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {PRESETS[preset].blurb}{" "}
                  <span className="text-foreground/70">
                    {PRESETS[preset].dpi} DPI · JPEG q{Math.round(PRESETS[preset].quality * 100)}
                  </span>
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-md border border-border bg-background/50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={grayscale}
                  onChange={(e) => setGrayscale(e.target.checked)}
                  className="mt-1 accent-vault"
                />
                <span>
                  <span className="text-sm font-medium block">
                    Convert to grayscale
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Drops file size further. Recommended for text-only documents and scans.
                  </span>
                </span>
              </label>

              {!result && (
                <div className="space-y-3">
                  {/* Estimator */}
                  {(() => {
                    const ratio = grayscale
                      ? PRESETS[preset].estimatedRatio * 0.75
                      : PRESETS[preset].estimatedRatio;
                    const estimated = Math.max(
                      50_000,
                      Math.round(file.size * ratio),
                    );
                    const savedPct = Math.max(
                      0,
                      Math.round((1 - estimated / file.size) * 100),
                    );
                    return (
                      <div className="text-xs text-muted-foreground text-center tabular-nums">
                        Current size:{" "}
                        <span className="text-foreground/80">{fmtBytes(file.size)}</span>
                        {" → "}
                        Estimated size:{" "}
                        <span className="text-foreground/80">{fmtBytes(estimated)}</span>
                        {savedPct > 0 && (
                          <span className="text-vault font-medium ml-1.5">
                            (Save ~{savedPct}%)
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  <Button
                    onClick={run}
                    disabled={busy}
                    className="bg-vault text-vault-foreground hover:opacity-90 w-full relative overflow-hidden h-11"
                  >
                    {busy ? (
                      <>
                        <span className="relative z-10 inline-flex items-center">
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {progress
                            ? `Compressing… (Page ${progress.done} of ${progress.total})`
                            : "Compressing…"}
                        </span>
                        {progress && (
                          <span
                            className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-200"
                            style={{
                              width: `${(progress.done / progress.total) * 100}%`,
                            }}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <Minimize2 className="h-4 w-4 mr-2" />
                        Compress PDF
                      </>
                    )}
                  </Button>

                  <div className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1.5">
                    <Lock className="h-3 w-3 text-vault" />
                    Processed securely in your browser memory. 0 bytes uploaded.
                  </div>
                </div>
              )}
            </div>

            {result && (
              <div className="rounded-lg border border-vault/40 bg-vault/10 p-6 space-y-5 animate-fade-in">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-vault/20 text-vault shrink-0">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-display text-xl text-foreground">
                      Success!
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      Reduced from{" "}
                      <span className="text-foreground tabular-nums">
                        {fmtBytes(result.originalSize)}
                      </span>{" "}
                      to{" "}
                      <span className="text-vault font-semibold tabular-nums">
                        {fmtBytes(result.newSize)}
                      </span>
                      {pct > 0 && (
                        <span className="text-vault"> · {pct}% smaller</span>
                      )}
                      .
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-1">
                  <Stat label="Original" value={fmtBytes(result.originalSize)} />
                  <Stat label="Compressed" value={fmtBytes(result.newSize)} />
                  <Stat
                    label="Saved"
                    value={pct > 0 ? `${pct}%` : "—"}
                    accent={pct > 0}
                  />
                </div>

                {pct <= 0 && (
                  <div className="text-xs text-muted-foreground">
                    This PDF was already heavily compressed — try the "Strong" or
                    "Maximum" preset, or enable grayscale.
                  </div>
                )}

                <a
                  href={result.url}
                  download={result.name}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-vault text-vault-foreground px-4 py-3 text-sm font-semibold hover:opacity-90"
                >
                  <Download className="h-4 w-4" />
                  Download compressed PDF
                </a>

                <button
                  onClick={() => {
                    if (result) URL.revokeObjectURL(result.url);
                    setResult(null);
                  }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition"
                >
                  Try a different preset
                </button>
              </div>
            )}
          </div>
        )}

        {!file && (
          <div className="mt-8 rounded-lg border border-border bg-card/30 p-5 text-xs text-muted-foreground leading-relaxed flex items-start gap-3">
            <Lock className="h-4 w-4 text-vault shrink-0 mt-0.5" />
            <div>
              <div className="text-foreground font-medium mb-1">How it works</div>
              Each page is rendered to a canvas at your chosen DPI, re-encoded as JPEG
              at the selected quality, and rebuilt into a new PDF. Everything happens
              on your CPU — the original file never leaves this tab.
            </div>
          </div>
        )}
      </div>
      <BatchDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        title="Compress every tray PDF"
        description="Uses the current preset and grayscale setting."
        op={compressOp}
        opts={{ preset, grayscale }}
        suffix="compressed"
        zipName="counselpdf-compressed.zip"
      />
    </AppShell>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-2xl tabular-nums ${
          accent ? "text-vault" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
