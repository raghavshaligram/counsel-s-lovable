/**
 * PdfResultPreview — shared "workshop split" result + preview surface.
 *
 * Used by every tool that produces a PDF (compress, rotate, watermark, merge,
 * bates, etc.). Left rail = op summary + actions. Right pane = scrollable
 * PDF preview with thumbnail rail, page nav, zoom, before/after compare.
 *
 * All rendering is via pdf.js in the browser. Nothing is uploaded.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { loadPdfjs } from "@/lib/pdf/worker";
import { cn } from "@/lib/utils";

export type PdfStat = {
  label: string;
  value: string;
  /** Highlight in gold (used for the "saved" / headline metric). */
  accent?: boolean;
};

export type PdfResultPreviewProps = {
  /** Result PDF bytes (what gets downloaded + previewed). */
  bytes: Uint8Array;
  /** File name suggested on download (e.g. "report-compressed.pdf"). */
  filename: string;
  /** Optional original bytes — enables the Before/After compare toggle. */
  compareBytes?: Uint8Array;
  /** Small uppercase eyebrow (e.g. "Task complete · Compress"). */
  eyebrow: string;
  /** Headline (e.g. "Compression success"). */
  title: string;
  /** Optional one-line subtitle below the title. */
  subtitle?: string;
  /** Stat rows shown in the left rail. The last one renders bigger. */
  stats?: PdfStat[];
  /** Extra action nodes rendered under the Download button. */
  actions?: ReactNode;
  /** Settings recap block rendered between actions and trust strip. */
  recap?: ReactNode;
  /** "Re-run" / "back to settings" callback. Adds a link in the rail. */
  onReset?: () => void;
  /** Optional run duration to display in the trust strip. */
  durationMs?: number;
};

export function PdfResultPreview({
  bytes,
  filename,
  compareBytes,
  eyebrow,
  title,
  subtitle,
  stats = [],
  actions,
  recap,
  onReset,
  durationMs,
}: PdfResultPreviewProps) {
  const [view, setView] = useState<"after" | "before">("after");
  const activeBytes = view === "before" && compareBytes ? compareBytes : bytes;

  // Object URL for download / open-in-new-tab.
  const downloadUrl = useMemo(() => {
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    return URL.createObjectURL(blob);
  }, [bytes]);
  useEffect(() => () => URL.revokeObjectURL(downloadUrl), [downloadUrl]);

  return (
    <div className="-mx-5 md:-mx-8 -mt-10 -mb-10 min-h-[calc(100vh-4rem)] bg-[#0d0d0d] text-zinc-200">
      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] min-h-[calc(100vh-4rem)]">
        {/* LEFT RAIL */}
        <aside className="border-b lg:border-b-0 lg:border-r border-[#1a1a1a] bg-[#111111] flex flex-col">
          <div className="p-6 border-b border-[#1a1a1a] space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-vault animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-vault font-display">
                {eyebrow}
              </span>
            </div>
            <h2 className="text-2xl font-bold font-display leading-tight text-zinc-50">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-zinc-500 leading-relaxed">{subtitle}</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-7">
            {stats.length > 0 && (
              <section>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3 block">
                  Statistics
                </label>
                <div className="space-y-3">
                  {stats.map((s, i) => {
                    const last = i === stats.length - 1;
                    return (
                      <div
                        key={s.label + i}
                        className={cn(
                          "flex justify-between items-end",
                          !last && "border-b border-[#1a1a1a] pb-2",
                        )}
                      >
                        <span className="text-sm text-zinc-400">{s.label}</span>
                        <span
                          className={cn(
                            "tabular-nums",
                            last
                              ? "text-xl font-bold font-display"
                              : "text-sm font-medium",
                            s.accent && "text-vault",
                          )}
                        >
                          {s.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="space-y-2">
              <a
                href={downloadUrl}
                download={filename}
                className="w-full bg-vault hover:bg-[hsl(45,67%,75%)] text-[#0d0d0d] font-bold py-3.5 rounded-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] text-sm tracking-wide"
              >
                <Download className="h-4 w-4" />
                <span>DOWNLOAD PDF</span>
              </a>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 border border-[#1a1a1a] hover:bg-[#1a1a1a] text-zinc-300 text-sm font-medium rounded-sm flex items-center justify-center gap-2 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in new tab
              </a>
              {actions}
              {onReset && (
                <button
                  onClick={onReset}
                  className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" />
                  Run again with new settings
                </button>
              )}
            </section>

            {recap && (
              <section>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3 block">
                  Settings recap
                </label>
                <div className="rounded-sm bg-[#0d0d0d] border border-[#1a1a1a] p-3 text-xs text-zinc-400 leading-relaxed">
                  {recap}
                </div>
              </section>
            )}

            {compareBytes && (
              <section>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3 block">
                  View
                </label>
                <div className="p-1 bg-[#1a1a1a] rounded flex">
                  <button
                    onClick={() => setView("after")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors",
                      view === "after"
                        ? "bg-[#2a2a2a] text-white"
                        : "text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    After
                  </button>
                  <button
                    onClick={() => setView("before")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors",
                      view === "before"
                        ? "bg-[#2a2a2a] text-white"
                        : "text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    Before
                  </button>
                </div>
              </section>
            )}
          </div>

          {/* Trust strip */}
          <div className="p-4 border-t border-[#1a1a1a] bg-[#0d0d0d]">
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-medium mb-1">
              <ShieldCheck className="w-3 h-3 text-vault" />
              PROCESSED LOCALLY
            </div>
            <div className="flex justify-between text-[9px] text-zinc-600 font-mono tracking-tighter uppercase">
              <span>{durationMs != null ? `${durationMs}ms` : "in-browser"}</span>
              <span>0 bytes uploaded</span>
            </div>
          </div>
        </aside>

        {/* RIGHT PREVIEW PANE */}
        <PreviewPane bytes={activeBytes} key={view} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview pane                                                                */
/* -------------------------------------------------------------------------- */

type PdfDoc = Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["getDocument"]>["promise"]>;

function PreviewPane({ bytes }: { bytes: Uint8Array }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageIdx, setPageIdx] = useState(0); // 0-based
  const [zoom, setZoom] = useState(1);       // 1 = fit-width
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const renderTokenRef = useRef(0);

  // Load doc
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDoc(null);
    setPageIdx(0);
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const d = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        if (cancelled) return;
        setDoc(d);
        setPageCount(d.numPages);
      } catch (err) {
        console.error("PdfResultPreview: failed to load PDF", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  // Render current page
  useEffect(() => {
    if (!doc) return;
    const token = ++renderTokenRef.current;
    (async () => {
      const page = await doc.getPage(pageIdx + 1);
      if (renderTokenRef.current !== token) return;
      const wrap = canvasWrapRef.current;
      const canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const containerW = Math.max(200, wrap.clientWidth - 96);
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = containerW / baseViewport.width;
      const viewport = page.getViewport({ scale: fitScale * zoom });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(viewport.width * dpr);
      canvas.height = Math.ceil(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    })().catch((err) => console.error(err));
  }, [doc, pageIdx, zoom]);

  // Re-render on resize (debounced via rAF)
  useEffect(() => {
    if (!doc) return;
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setZoom((z) => z)); // trigger render effect
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [doc]);

  const goPrev = useCallback(
    () => setPageIdx((i) => Math.max(0, i - 1)),
    [],
  );
  const goNext = useCallback(
    () => setPageIdx((i) => Math.min(pageCount - 1, i + 1)),
    [pageCount],
  );

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "[") { e.preventDefault(); goPrev(); }
      else if (e.key === "ArrowRight" || e.key === "]") { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  return (
    <main className="flex flex-col bg-[#080808] relative overflow-hidden min-h-[60vh]">
      {/* Toolbar */}
      <nav className="h-14 border-b border-[#1a1a1a] bg-[#0d0d0d] flex items-center justify-between px-4 md:px-6 z-10 shrink-0">
        <div className="flex items-center gap-4 md:gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-500">Page</span>
            <div className="flex items-center border border-[#1a1a1a] rounded px-2 py-1 bg-[#0d0d0d]">
              <input
                type="text"
                value={pageCount === 0 ? "" : pageIdx + 1}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) setPageIdx(Math.max(0, Math.min(pageCount - 1, n - 1)));
                }}
                className="w-8 bg-transparent text-xs text-center border-none focus:outline-none focus:ring-0 text-zinc-200"
              />
              <span className="text-xs text-zinc-600 mx-1">/</span>
              <span className="text-xs text-zinc-400 tabular-nums">{pageCount || "—"}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={goPrev} disabled={pageIdx <= 0} className="p-1.5 hover:bg-[#1a1a1a] rounded text-zinc-400 disabled:opacity-30 disabled:hover:bg-transparent">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button onClick={goNext} disabled={pageIdx >= pageCount - 1} className="p-1.5 hover:bg-[#1a1a1a] rounded text-zinc-400 disabled:opacity-30 disabled:hover:bg-transparent">
                <ArrowLeft className="w-4 h-4 rotate-180" />
              </button>
            </div>
          </div>
          <div className="h-4 w-px bg-[#1a1a1a]" />
          <div className="flex items-center gap-1">
            <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} className="p-1.5 hover:bg-[#1a1a1a] rounded text-zinc-400">
              <Minus className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-zinc-300 min-w-[44px] text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))} className="p-1.5 hover:bg-[#1a1a1a] rounded text-zinc-400">
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={() => setZoom(1)} className="p-1.5 hover:bg-[#1a1a1a] rounded text-zinc-400" title="Fit width">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Canvas area + thumbnails */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <ThumbRail doc={doc} pageIdx={pageIdx} onSelect={setPageIdx} />
        <div
          ref={canvasWrapRef}
          className="flex-1 overflow-auto p-8 md:p-12 flex items-start justify-center bg-[radial-gradient(#1a1a1a_1px,transparent_1px)] bg-[size:32px_32px]"
        >
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-500 text-sm mt-20">
              <Loader2 className="h-4 w-4 animate-spin" />
              Rendering preview…
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className="shadow-[0_30px_60px_-12px_rgba(0,0,0,0.8)] bg-white"
            />
          )}
        </div>
      </div>

      {/* Keyboard hint */}
      <div className="absolute bottom-3 right-4 flex items-center gap-3 text-[10px] text-zinc-500 font-mono tracking-wider bg-[#0d0d0d]/80 backdrop-blur px-3 py-1.5 rounded-full border border-[#1a1a1a]">
        <span><kbd className="bg-[#1a1a1a] px-1 rounded text-zinc-300">←</kbd> <kbd className="bg-[#1a1a1a] px-1 rounded text-zinc-300">→</kbd> Page</span>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Thumbnail rail (lazy)                                                       */
/* -------------------------------------------------------------------------- */

function ThumbRail({
  doc,
  pageIdx,
  onSelect,
}: {
  doc: PdfDoc | null;
  pageIdx: number;
  onSelect: (i: number) => void;
}) {
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const total = doc?.numPages ?? 0;

  useEffect(() => {
    if (!doc) {
      setThumbs([]);
      return;
    }
    setThumbs(new Array(doc.numPages).fill(null));
    let cancelled = false;
    (async () => {
      const cap = Math.min(doc.numPages, 80);
      for (let i = 0; i < cap; i++) {
        if (cancelled) return;
        try {
          const page = await doc.getPage(i + 1);
          const viewport = page.getViewport({ scale: 0.2 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          const url = canvas.toDataURL("image/jpeg", 0.7);
          if (cancelled) return;
          setThumbs((prev) => {
            const next = prev.slice();
            next[i] = url;
            return next;
          });
        } catch (err) {
          console.error(err);
        }
        // yield
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  if (total === 0) return null;

  return (
    <aside className="hidden md:flex w-28 lg:w-32 border-r border-[#1a1a1a] overflow-y-auto p-3 flex-col gap-3 bg-[#0d0d0d]/50 shrink-0">
      {thumbs.map((url, i) => {
        const active = i === pageIdx;
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className={cn(
              "aspect-[3/4] rounded-sm relative transition-all shrink-0 overflow-hidden",
              active
                ? "ring-2 ring-vault shadow-xl"
                : "ring-1 ring-[#1a1a1a] hover:ring-vault/50",
              url ? "bg-white" : "bg-[#1a1a1a]",
            )}
          >
            {url ? (
              <img src={url} alt={`Page ${i + 1}`} className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full grid place-items-center">
                <div className="h-3 w-3 rounded-full border border-vault/40 border-t-vault animate-spin" />
              </div>
            )}
            <span
              className={cn(
                "absolute bottom-1 right-1 text-[9px] px-1 font-bold rounded-sm",
                active ? "bg-vault text-[#0d0d0d]" : "bg-black/60 text-zinc-300",
              )}
            >
              {i + 1}
            </span>
          </button>
        );
      })}
      {total > 80 && (
        <div className="text-[10px] text-zinc-600 text-center font-mono mt-2">
          +{total - 80} more
        </div>
      )}
    </aside>
  );
}
