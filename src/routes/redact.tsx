import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Download, FileText, Trash2, X, ShieldCheck, Lock, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  CATEGORY_META,
  type Detection,
  type PiiCategory,
} from "@/lib/pdf/detect-pii";

export const Route = createFileRoute("/redact")({
  head: () => ({
    meta: [
      { title: "Smart Redact — VaultPDF" },
      {
        name: "description",
        content:
          "Permanently remove sensitive content from PDFs. AI PII auto-detection, 100% in your browser.",
      },
      { property: "og:title", content: "Smart Redact — VaultPDF" },
      {
        property: "og:description",
        content:
          "Redact PDFs without uploading them. Auto-detect PII, true content removal — not just a black box.",
      },
    ],
  }),
  component: RedactPage,
});

type Box = { id: string; page: number; x: number; y: number; w: number; h: number; auto?: boolean; category?: PiiCategory };
type RenderedPage = { pageNumber: number; width: number; height: number; dataUrl: string };

function RedactPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [exporting, setExporting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [enabledCats, setEnabledCats] = useState<Set<PiiCategory>>(
    () => new Set(Object.keys(CATEGORY_META) as PiiCategory[]),
  );

  // Render pages with PDF.js whenever a new file lands.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    setPages([]);
    setBoxes([]);
    setDetections([]);
    (async () => {
      try {
        const { getPdfjs } = await import("@/lib/pdf/worker");
        const pdfjs = getPdfjs();
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        const out: RenderedPage[] = [];
        const SCALE = 1.5;
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: SCALE });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Could not get canvas context");
          await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
          out.push({
            pageNumber: i,
            width: canvas.width,
            height: canvas.height,
            dataUrl: canvas.toDataURL("image/png"),
          });
          setPages([...out]);
        }
      } catch (err) {
        console.error(err);
        toast.error("Couldn't read that PDF. Is it password-protected or corrupted?");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const reset = () => {
    setFile(null);
    setPages([]);
    setBoxes([]);
    setDetections([]);
  };

  const [detectStatus, setDetectStatus] = useState<string | null>(null);

  const runAutoDetect = useCallback(async () => {
    if (!file) return;
    setDetecting(true);
    setDetectStatus("Reading text layer…");
    try {
      const { detectPiiInPdf } = await import("@/lib/pdf/detect-pii");
      const { detections: found, usedOcr } = await detectPiiInPdf(file, 1.5, (p) => {
        if (p.stage === "ocr") {
          setDetectStatus(`OCR scanning page ${p.page} of ${p.totalPages}…`);
        } else {
          setDetectStatus(`Reading page ${p.page} of ${p.totalPages}…`);
        }
      });
      setDetections(found);
      if (found.length === 0) {
        toast.info("No obvious PII patterns found.", {
          description: usedOcr
            ? "OCR ran but no SSNs, emails, phones, cards, or dates matched. Mark regions manually."
            : "Mark sensitive regions manually with click-and-drag.",
        });
      } else {
        toast.success(`Found ${found.length} likely PII region${found.length === 1 ? "" : "s"}`, {
          description: usedOcr
            ? "Some pages were scanned — OCR was used. Review categories on the right."
            : "Review and toggle categories on the right, then export.",
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Auto-detect failed");
    } finally {
      setDetecting(false);
      setDetectStatus(null);
    }
  }, [file]);


  const toggleCategory = (cat: PiiCategory) => {
    setEnabledCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Detections filtered by enabled categories, treated as redaction boxes.
  const autoBoxes: Box[] = useMemo(
    () =>
      detections
        .filter((d) => enabledCats.has(d.category))
        .map((d) => ({
          id: d.id,
          page: d.page,
          x: d.x,
          y: d.y,
          w: d.w,
          h: d.h,
          auto: true,
          category: d.category,
        })),
    [detections, enabledCats],
  );

  const allBoxes = useMemo(() => [...autoBoxes, ...boxes], [autoBoxes, boxes]);

  // Counts per category for the toggle UI.
  const catCounts = useMemo(() => {
    const m = new Map<PiiCategory, number>();
    for (const d of detections) m.set(d.category, (m.get(d.category) ?? 0) + 1);
    return m;
  }, [detections]);

  const exportRedacted = useCallback(async () => {
    if (!file || pages.length === 0) return;
    setExporting(true);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const out = await PDFDocument.create();
      // Strip metadata
      out.setTitle("");
      out.setAuthor("");
      out.setSubject("");
      out.setKeywords([]);
      out.setProducer("VaultPDF");
      out.setCreator("VaultPDF");

      for (const p of pages) {
        // Render this page with redaction boxes burned in
        const composite = document.createElement("canvas");
        composite.width = p.width;
        composite.height = p.height;
        const ctx = composite.getContext("2d")!;
        const img = await loadImage(p.dataUrl);
        ctx.drawImage(img, 0, 0);
        ctx.fillStyle = "#000000";
        for (const b of allBoxes.filter((bx) => bx.page === p.pageNumber)) {
          ctx.fillRect(b.x, b.y, b.w, b.h);
        }
        const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
          composite.toBlob(
            (blob) => {
              if (!blob) return reject(new Error("toBlob failed"));
              blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)));
            },
            "image/jpeg",
            0.92,
          );
        });
        const embedded = await out.embedJpg(jpegBytes);
        const page = out.addPage([p.width, p.height]);
        page.drawImage(embedded, { x: 0, y: 0, width: p.width, height: p.height });
      }

      const bytes = await out.save();
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const blob = new Blob([ab], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, "") + "-redacted.pdf";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Redacted PDF saved", {
        description:
          "Content was rasterised + permanently removed. Original text and metadata are gone.",
      });
    } catch (err) {
      console.error(err);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }, [file, pages, allBoxes]);

  const addBox = useCallback((b: Box) => setBoxes((prev) => [...prev, b]), []);
  const removeBox = useCallback((id: string) => {
    // Auto-detection boxes are removed by toggling/dismissing the detection.
    setDetections((prev) => prev.filter((d) => d.id !== id));
    setBoxes((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return (
    <AppShell>
      <div className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-vault mb-3">
                Tool · Smart Redact
              </div>
              <h1 className="font-display text-4xl md:text-5xl leading-tight">
                Permanently remove anything sensitive.
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                Drag rectangles over names, account numbers, signatures — anything. On export,
                the content is rasterised and burned into the PDF as an image with the redaction
                applied. The original text is{" "}
                <span className="text-foreground">gone, not hidden</span>. Metadata is stripped
                too.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground rounded-md border border-border bg-card/50 px-3 py-2">
              <Lock className="h-3.5 w-3.5 text-vault" />
              Processed in your browser
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
        {!file ? (
          <FileDropzone
            onFile={setFile}
            label="Drop a PDF to redact"
            sublabel="or click to browse · no upload, no size limit"
          />
        ) : (
          <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-4 w-4 text-vault shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB · {pages.length} page
                      {pages.length === 1 ? "" : "s"} loaded
                      {loading && pages.length > 0 && " · loading more…"}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={reset}>
                  <X className="h-4 w-4 mr-1" /> Close
                </Button>
              </div>

              {loading && pages.length === 0 && (
                <div className="rounded-lg border border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
                  Reading PDF locally…
                </div>
              )}

              <div className="space-y-6">
                {pages.map((p) => (
                  <PageCanvas
                    key={p.pageNumber}
                    page={p}
                    boxes={allBoxes.filter((b) => b.page === p.pageNumber)}
                    onAddBox={addBox}
                    onRemoveBox={removeBox}
                  />
                ))}
              </div>
            </div>

            <aside className="lg:sticky lg:top-20 space-y-4">
              <div className="rounded-lg border border-border bg-card/50 p-5">
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
                  Redactions
                </div>
                <div className="text-3xl font-display">{allBoxes.length}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  region{allBoxes.length === 1 ? "" : "s"} marked across {pages.length} page
                  {pages.length === 1 ? "" : "s"}
                </div>
                <Button
                  onClick={exportRedacted}
                  disabled={allBoxes.length === 0 || exporting || loading}
                  className="w-full mt-5 bg-vault text-vault-foreground hover:opacity-90"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {exporting ? "Exporting…" : "Export redacted PDF"}
                </Button>
                {(boxes.length > 0 || detections.length > 0) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => {
                      setBoxes([]);
                      setDetections([]);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear all
                  </Button>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card/50 p-5">
                <div className="flex items-center gap-2 text-foreground font-medium mb-1 text-sm">
                  <Wand2 className="h-4 w-4 text-vault" />
                  Auto-detect PII
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Scans the text layer for SSNs, emails, phones, cards, dates, IPs, IBANs. Falls
                  back to on-device OCR for scanned pages (first run downloads ~10MB).
                </p>
                <Button
                  onClick={runAutoDetect}
                  disabled={detecting || loading}
                  variant="outline"
                  className="w-full mt-3"
                >
                  <Wand2 className="h-3.5 w-3.5 mr-2" />
                  {detecting
                    ? "Scanning…"
                    : detections.length > 0
                      ? "Re-scan"
                      : "Scan this PDF"}
                </Button>
                {detectStatus && (
                  <div className="mt-2 text-[11px] text-muted-foreground text-center">
                    {detectStatus}
                  </div>
                )}

                {detections.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {(Object.keys(CATEGORY_META) as PiiCategory[])
                      .filter((c) => (catCounts.get(c) ?? 0) > 0)
                      .map((c) => {
                        const on = enabledCats.has(c);
                        const count = catCounts.get(c) ?? 0;
                        return (
                          <button
                            key={c}
                            onClick={() => toggleCategory(c)}
                            className={`w-full flex items-center justify-between text-xs px-3 py-2 rounded-md border transition ${
                              on
                                ? "border-vault/50 bg-vault/10 text-foreground"
                                : "border-border bg-card/30 text-muted-foreground hover:bg-card"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className={`inline-block h-2 w-2 rounded-full ${
                                  on ? "bg-vault" : "bg-muted-foreground/40"
                                }`}
                              />
                              {CATEGORY_META[c].label}
                            </span>
                            <span className="tabular-nums">{count}</span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>



              <div className="rounded-lg border border-border bg-card/30 p-5 text-xs text-muted-foreground leading-relaxed">
                <div className="flex items-center gap-2 text-foreground font-medium mb-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-vault" />
                  How the export works
                </div>
                Each page is rendered to an image, the redaction rectangles are painted on, and
                the image is embedded as the new page. There is no text layer left underneath —
                the redacted content cannot be selected or extracted.
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function PageCanvas({
  page,
  boxes,
  onAddBox,
  onRemoveBox,
}: {
  page: RenderedPage;
  boxes: Box[];
  onAddBox: (b: Box) => void;
  onRemoveBox: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const toLocal = (clientX: number, clientY: number) => {
    const el = wrapRef.current!;
    const rect = el.getBoundingClientRect();
    const scaleX = page.width / rect.width;
    const scaleY = page.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  return (
    <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/60 text-xs text-muted-foreground">
        <span>Page {page.pageNumber}</span>
        <span>Click and drag to mark areas to redact</span>
      </div>
      <div
        ref={wrapRef}
        className="relative select-none cursor-crosshair"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          const p = toLocal(e.clientX, e.clientY);
          startRef.current = p;
          setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!startRef.current) return;
          const p = toLocal(e.clientX, e.clientY);
          const s = startRef.current;
          setDrawing({
            x: Math.min(s.x, p.x),
            y: Math.min(s.y, p.y),
            w: Math.abs(p.x - s.x),
            h: Math.abs(p.y - s.y),
          });
        }}
        onPointerUp={() => {
          if (drawing && drawing.w > 4 && drawing.h > 4) {
            onAddBox({
              id: `${page.pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              page: page.pageNumber,
              ...drawing,
            });
          }
          startRef.current = null;
          setDrawing(null);
        }}
      >
        <img
          src={page.dataUrl}
          alt={`Page ${page.pageNumber}`}
          className="block w-full h-full pointer-events-none"
          draggable={false}
        />
        {boxes.map((b) => (
          <div
            key={b.id}
            className="absolute bg-black border border-vault/60 group"
            style={{
              left: `${(b.x / page.width) * 100}%`,
              top: `${(b.y / page.height) * 100}%`,
              width: `${(b.w / page.width) * 100}%`,
              height: `${(b.h / page.height) * 100}%`,
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveBox(b.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-vault text-vault-foreground opacity-0 group-hover:opacity-100 transition pointer-events-auto"
              aria-label="Remove redaction"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {drawing && (
          <div
            className="absolute bg-vault/30 border-2 border-vault pointer-events-none"
            style={{
              left: `${(drawing.x / page.width) * 100}%`,
              top: `${(drawing.y / page.height) * 100}%`,
              width: `${(drawing.w / page.width) * 100}%`,
              height: `${(drawing.h / page.height) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
