import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ToolHeader } from "@/routes/split";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, FileText, Lock, ScanText, X, Loader2, AlertTriangle, Info } from "lucide-react";
import { ocrPdfToSearchable, type OcrProgress } from "@/lib/pdf/ocr-pdf";
import { loadPdfjs } from "@/lib/pdf/worker";
import { softwareAppSchema } from "@/lib/seo/tool-schema";

interface DeviceProfile {
  cores: number;
  memoryGb: number | null;
  tier: "low" | "mid" | "high";
}

function profileDevice(): DeviceProfile {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 4;
  const memoryGb =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null
      : null;
  let tier: DeviceProfile["tier"] = "mid";
  if (cores <= 4 || (memoryGb !== null && memoryGb <= 4)) tier = "low";
  else if (cores >= 8 && (memoryGb === null || memoryGb >= 8)) tier = "high";
  return { cores, memoryGb, tier };
}

interface PreflightWarning {
  level: "info" | "warn" | "block";
  title: string;
  body: string;
  estimateMinutes: [number, number];
}

function buildPreflight(pages: number, sizeMb: number, dev: DeviceProfile): PreflightWarning | null {
  const perPageSec = dev.tier === "high" ? 1.6 : dev.tier === "mid" ? 2.8 : 5.5;
  const lowSec = pages * perPageSec * 0.7;
  const highSec = pages * perPageSec * 1.3;
  const estimateMinutes: [number, number] = [
    Math.max(1, Math.round(lowSec / 60)),
    Math.max(1, Math.round(highSec / 60)),
  ];

  if (pages > 600 || sizeMb > 400) {
    return {
      level: "block",
      title: "This file is too large for in-browser OCR",
      body: `${pages} pages · ${sizeMb.toFixed(0)} MB. Browser OCR is unreliable past ~600 pages or ~400 MB — tabs can run out of memory. Split the PDF into smaller chunks (e.g. 100–200 pages) and OCR each separately.`,
      estimateMinutes,
    };
  }
  if (pages > 150 && dev.tier === "low") {
    return {
      level: "warn",
      title: "This will be slow on your device",
      body: `${pages} pages on a ${dev.cores}-core machine${dev.memoryGb ? ` with ~${dev.memoryGb} GB RAM` : ""}. Estimated ${estimateMinutes[0]}–${estimateMinutes[1]} minutes. Keep this tab in the foreground, or split the PDF first for faster results.`,
      estimateMinutes,
    };
  }
  if (pages > 100) {
    return {
      level: "info",
      title: `Heads up — ${pages} pages`,
      body: `Estimated ${estimateMinutes[0]}–${estimateMinutes[1]} minutes on your device. Browser OCR works best in the foreground. You can cancel at any time.`,
      estimateMinutes,
    };
  }
  return null;
}

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
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [preflight, setPreflight] = useState<PreflightWarning | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [highAccuracy, setHighAccuracy] = useState(false);
  const [device] = useState<DeviceProfile>(() => profileDevice());
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setFile(null);
    setProgress(null);
    setPageCount(null);
    setPreflight(null);
    setAcknowledged(false);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultName(null);
  };

  const onFile = useCallback((f: File) => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultName(null);
    setProgress(null);
    setPageCount(null);
    setPreflight(null);
    setAcknowledged(false);
    setFile(f);
  }, [resultUrl]);

  // Pre-flight inspection: read page count, build a warning if the file is heavy
  // relative to the user's device. No OCR runs here — just metadata.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      setInspecting(true);
      try {
        const pdfjs = await loadPdfjs();
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        if (cancelled) return;
        const pages = doc.numPages;
        const sizeMb = file.size / (1024 * 1024);
        setPageCount(pages);
        setPreflight(buildPreflight(pages, sizeMb, device));
      } catch (err) {
        console.error("Preflight failed", err);
      } finally {
        if (!cancelled) setInspecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, device]);



  const run = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setProgress(null);
    abortRef.current = new AbortController();
    try {
      const bytes = await ocrPdfToSearchable(file, setProgress, abortRef.current.signal, { highAccuracy });
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
  }, [file, highAccuracy]);

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
      <ToolHeader
        tag="Make PDF Searchable"
        title={
          <>
            Turn scans into <span className="text-vault italic">searchable PDFs</span>.
          </>
        }
        sub="Drop a scanned or image-only PDF and get one back with a real text layer — copy, search, redact, extract. Tesseract OCR runs entirely in your browser. Pages never leave the tab."
        collapsed={!!file}
      />

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
                        {(file.size / (1024 * 1024)).toFixed(1)} MB
                        {pageCount !== null && ` · ${pageCount} pages`}
                        {inspecting && " · inspecting…"}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
                    <X className="h-4 w-4 mr-1" /> Reset
                  </Button>
                </div>

                {!busy && !resultUrl && preflight && (
                  <div
                    className={
                      preflight.level === "block"
                        ? "rounded-lg border border-destructive/40 bg-destructive/10 p-5 space-y-2"
                        : preflight.level === "warn"
                          ? "rounded-lg border border-amber-500/40 bg-amber-500/10 p-5 space-y-2"
                          : "rounded-lg border border-vault/30 bg-vault/5 p-5 space-y-2"
                    }
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {preflight.level === "info" ? (
                        <Info className="h-4 w-4 text-vault" />
                      ) : (
                        <AlertTriangle
                          className={
                            preflight.level === "block"
                              ? "h-4 w-4 text-destructive"
                              : "h-4 w-4 text-amber-500"
                          }
                        />
                      )}
                      {preflight.title}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{preflight.body}</p>
                    {(preflight.level === "warn" || preflight.level === "info") && (
                      <label className="flex items-center gap-2 text-xs text-foreground/80 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                          className="h-3.5 w-3.5 accent-vault"
                        />
                        I understand this may take {preflight.estimateMinutes[0]}–
                        {preflight.estimateMinutes[1]} minutes. Proceed anyway.
                      </label>
                    )}
                  </div>
                )}

                {!busy && !resultUrl && (
                  <div className="rounded-lg border border-border bg-card/30 p-6 flex flex-col items-start gap-3">
                    <p className="text-sm text-muted-foreground">
                      OCR is CPU-intensive. A 10-page scan typically takes 30–90 seconds depending
                      on your device. Pages that already contain real text are copied through
                      untouched — no OCR runs on them.
                      {device.tier === "low" && " Your device looks modestly specced — expect slower runs."}
                    </p>
                    <label className="flex items-start gap-2 text-xs text-foreground/80 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={highAccuracy}
                        onChange={(e) => setHighAccuracy(e.target.checked)}
                        className="h-3.5 w-3.5 accent-vault mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-foreground">High accuracy</span>
                        <span className="text-muted-foreground"> — render at 2× instead of 1.5×. Better on small fonts and dense layouts, but ~80% slower per OCR'd page.</span>
                      </span>
                    </label>
                    <Button
                      onClick={run}
                      disabled={
                        inspecting ||
                        preflight?.level === "block" ||
                        ((preflight?.level === "warn" || preflight?.level === "info") && !acknowledged)
                      }
                      className="bg-vault text-vault-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      <ScanText className="h-4 w-4 mr-2" />
                      {preflight?.level === "block" ? "Too large to OCR here" : "Run OCR locally"}
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
