import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ToolHeader } from "@/routes/split";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Download, FileText, Lock, ScanText, X, Loader2, AlertTriangle, Info, Languages, ChevronDown } from "lucide-react";
import { ocrPdfToSearchable, type OcrProgress } from "@/lib/pdf/ocr-pdf";
import { ocrImageToSearchable, type ImageOcrProgress } from "@/lib/pdf/ocr-image";
import { OCR_LANGUAGES, estimateDownloadMb, getLanguageLabel } from "@/lib/pdf/ocr-languages";
import { loadPdfjs } from "@/lib/pdf/worker";

const ACCEPTED_TYPES = "application/pdf,image/jpeg,image/png,image/webp";
const isImage = (f: File) =>
  f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name);
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
  const [languages, setLanguages] = useState<string[]>(["eng"]);
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
  // For images we skip the whole thing — they're always single-page.
  useEffect(() => {
    if (!file) return;
    if (isImage(file)) {
      setPageCount(1);
      setPreflight(null);
      return;
    }
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
      let bytes: Uint8Array;
      let outName: string;
      if (isImage(file)) {
        // Single-image flow → 1-page searchable PDF. We translate the
        // image-OCR progress events onto the same OcrProgress shape the UI
        // already knows how to render.
        const onImgProgress = (p: ImageOcrProgress) => {
          setProgress({
            page: p.stage === "embedding" ? 1 : 0,
            totalPages: 1,
            stage:
              p.stage === "decoding"
                ? "rendering"
                : p.stage === "embedding"
                  ? "embedding"
                  : p.stage,
            message: p.message,
          });
        };
        bytes = await ocrImageToSearchable(
          file,
          onImgProgress,
          abortRef.current.signal,
          { languages },
        );
        outName = file.name.replace(/\.(jpe?g|png|webp)$/i, "") + " (searchable).pdf";
      } else {
        bytes = await ocrPdfToSearchable(file, setProgress, abortRef.current.signal, { highAccuracy, languages });
        outName = file.name.replace(/\.pdf$/i, "") + " (searchable).pdf";
      }
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      setResultName(outName);
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
  }, [file, highAccuracy, languages]);

  const cancel = () => abortRef.current?.abort();

  const pct = progress
    ? progress.stage === "loading-language"
      ? 1
      : Math.round(
          ((progress.page - 1 + (progress.stage === "ocr" ? 0.4 : progress.stage === "embedding" ? 0.85 : 0.05)) /
            progress.totalPages) *
            100,
        )
    : 0;

  const langSummary = useMemo(() => {
    if (languages.length === 0) return "English";
    if (languages.length === 1) return getLanguageLabel(languages[0]);
    if (languages.length <= 2) return languages.map(getLanguageLabel).join(" + ");
    return `${getLanguageLabel(languages[0])} +${languages.length - 1}`;
  }, [languages]);

  const toggleLang = (code: string) => {
    setLanguages((prev) =>
      prev.includes(code)
        ? prev.length === 1
          ? prev // can't remove the last one
          : prev.filter((c) => c !== code)
        : [...prev, code],
    );
  };

  const downloadEstimate = estimateDownloadMb(languages);

  return (
    <AppShell>
      <ToolHeader
        tag="Make PDF Searchable"
        title={
          <>
            Turn scans into <span className="text-vault italic">searchable PDFs</span>.
          </>
        }
        sub="Drop a scanned PDF or an image (JPG, PNG, WebP) and get back a PDF with a real text layer — copy, search, redact, extract. Tesseract OCR runs entirely in your browser. Pages never leave the tab."
        collapsed={!!file}
      />

      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
        <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
          <div className="space-y-4">
            {!file ? (
              <FileDropzone
                onFile={onFile}
                accept={ACCEPTED_TYPES}
                label="Drop a scanned PDF or image"
                sublabel="PDF, JPG, PNG, WebP · processed locally"
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
                        {pageCount !== null && ` · ${pageCount} ${pageCount === 1 ? "page" : "pages"}`}
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

                    <div className="w-full flex flex-col gap-1.5">
                      <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        <Languages className="h-3.5 w-3.5 text-vault" />
                        Document language
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-vault/50 transition-colors w-full sm:w-72"
                          >
                            <span className="truncate">{langSummary}</span>
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72 p-0 max-h-80 overflow-y-auto">
                          <div className="p-2">
                            {OCR_LANGUAGES.map((lang) => {
                              const checked = languages.includes(lang.code);
                              return (
                                <label
                                  key={lang.code}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleLang(lang.code)}
                                    className="h-3.5 w-3.5 accent-vault"
                                  />
                                  <span className="flex-1">{lang.label}</span>
                                  <span className="text-[10px] text-muted-foreground">~{lang.sizeMb} MB</span>
                                </label>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Pick one language for best accuracy. Combining languages (e.g. bilingual docs) costs accuracy and memory. First-time use of a language downloads ~{downloadEstimate} MB to your browser, then cached forever.
                      </p>
                    </div>
                    {file && !isImage(file) && (
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
                    )}
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
