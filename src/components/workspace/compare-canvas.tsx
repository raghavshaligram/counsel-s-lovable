/**
 * Compare canvas — renders A, B, and diff for the active page inside the
 * single workspace canvas area, in one of three view modes. State is driven
 * by useCompare so the right inspector and floating toolbar stay in sync.
 *
 * Entirely on-device — pdf.js + pixelmatch in this browser tab.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, GitCompare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompare, type CompareViewMode } from "@/lib/workspace/compare-store";
import { openComparePdf, renderComparePage, type ComparePdf } from "@/lib/pdf/compare";

const TARGET_WIDTH = 720;

export function CompareCanvas({ activeFile }: { activeFile: File | null }) {
  const bSource = useCompare((s) => s.bSource);
  const page = useCompare((s) => s.page);
  const setPage = useCompare((s) => s.setPage);
  const totalPages = useCompare((s) => s.totalPages);
  const setTotalPages = useCompare((s) => s.setTotalPages);
  const threshold = useCompare((s) => s.threshold);
  const viewMode = useCompare((s) => s.viewMode);
  const setResult = useCompare((s) => s.setResult);
  const setBusy = useCompare((s) => s.setBusy);
  const busy = useCompare((s) => s.busy);

  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const canvasDiffRef = useRef<HTMLCanvasElement>(null);

  const [pdfA, setPdfA] = useState<ComparePdf | null>(null);
  const [pdfB, setPdfB] = useState<ComparePdf | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // Open A whenever activeFile changes.
  useEffect(() => {
    let cancelled = false;
    setPdfA(null);
    setOpenError(null);
    if (!activeFile) return;
    void (async () => {
      try {
        const p = await openComparePdf(activeFile);
        if (cancelled) return;
        setPdfA(p);
      } catch (err) {
        console.error("[compare] failed to open A", err);
        if (!cancelled) setOpenError("Couldn't open this PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFile]);

  // Open B whenever bSource changes.
  useEffect(() => {
    let cancelled = false;
    setPdfB(null);
    if (bSource.kind === "none") return;
    void (async () => {
      try {
        const p = await openComparePdf(bSource.file);
        if (cancelled) return;
        setPdfB(p);
      } catch (err) {
        console.error("[compare] failed to open B", err);
        if (!cancelled) toast.error("Couldn't open the second PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bSource]);

  // Keep total page count in the store.
  useEffect(() => {
    const total = Math.max(pdfA?.pageCount ?? 0, pdfB?.pageCount ?? 0);
    setTotalPages(total);
    if (total > 0 && page > total) setPage(total);
  }, [pdfA, pdfB, page, setPage, setTotalPages]);

  // Render current page whenever inputs change. viewMode is included so a
  // mode switch re-renders into the freshly mounted canvas elements.
  useEffect(() => {
    if (!pdfA || !pdfB) return;
    const cA = canvasARef.current;
    const cB = canvasBRef.current;
    const cD = canvasDiffRef.current;
    if (!cA || !cB || !cD) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const r = await renderComparePage({
          pdfA,
          pdfB,
          pageIndex: page,
          targetWidth: TARGET_WIDTH,
          threshold,
          canvasA: cA,
          canvasB: cB,
          canvasDiff: cD,
        });
        if (cancelled) return;
        setResult({ diffPixels: r.diffPixels, sizeMatch: r.sizeMatch });
      } catch (err) {
        console.error("[compare] render failed", err);
        if (!cancelled) toast.error("Couldn't render that page.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfA, pdfB, page, threshold, viewMode, setResult, setBusy]);

  if (!activeFile) {
    return (
      <EmptyState
        title="No document open"
        body="Open a PDF to use it as document A, then pick document B in the inspector."
      />
    );
  }
  if (openError) {
    return <EmptyState title="Couldn't open A" body={openError} />;
  }
  if (bSource.kind === "none") {
    return (
      <EmptyState
        title="Pick document B"
        body="Choose another open tab or a file from disk in the inspector to start comparing."
      />
    );
  }

  return (
    <div className="flex h-full flex-col items-center gap-3 overflow-auto px-6 py-6">
      {viewMode === "side" && (
        <div className="flex w-full max-w-[1500px] items-start justify-center gap-3">
          <CanvasFrame label={`A — ${activeFile.name}`}>
            <canvas ref={canvasARef} className="block max-w-full h-auto bg-white" />
          </CanvasFrame>
          <CanvasFrame label={`B — ${labelOfB(bSource)}`}>
            <canvas ref={canvasBRef} className="block max-w-full h-auto bg-white" />
          </CanvasFrame>
          {/* Keep diff canvas mounted (hidden) so its ref is always bound. */}
          <canvas ref={canvasDiffRef} className="hidden" aria-hidden />
        </div>
      )}

      {viewMode === "diff" && (
        <div className="flex w-full max-w-[900px] flex-col items-center">
          <CanvasFrame label="Diff — pink = differences">
            <canvas ref={canvasDiffRef} className="block max-w-full h-auto bg-white" />
          </CanvasFrame>
          <canvas ref={canvasARef} className="hidden" aria-hidden />
          <canvas ref={canvasBRef} className="hidden" aria-hidden />
        </div>
      )}

      {viewMode === "overlay" && (
        <div className="relative w-full max-w-[900px]">
          <CanvasFrame label="Overlay — B over A with diff highlight">
            <div className="relative">
              <canvas ref={canvasARef} className="block w-full h-auto bg-white" />
              <canvas
                ref={canvasBRef}
                className="absolute inset-0 w-full h-full opacity-40 mix-blend-difference"
              />
              <canvas
                ref={canvasDiffRef}
                className="absolute inset-0 w-full h-full opacity-70 mix-blend-screen"
              />
            </div>
          </CanvasFrame>
        </div>
      )}

      {busy && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-10 -translate-x-1/2 inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11.5px] text-text-2 shadow-md">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rendering page {page}…
        </div>
      )}
    </div>
  );
}

function labelOfB(b: ReturnType<typeof useCompare.getState>["bSource"]) {
  return b.kind === "none" ? "" : b.name;
}

function CanvasFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <div className="w-full max-w-full overflow-hidden rounded-md border border-border bg-surface-2 p-1.5 shadow-sm">
        {children}
      </div>
      <figcaption className="truncate max-w-full text-[10.5px] uppercase tracking-[0.16em] text-text-muted">
        {label}
      </figcaption>
    </figure>
  );
}

function HiddenRefs({
  keepMounted,
  refA,
  refB,
  refDiff,
}: {
  keepMounted: boolean;
  refA: React.RefObject<HTMLCanvasElement>;
  refB: React.RefObject<HTMLCanvasElement>;
  refDiff: React.RefObject<HTMLCanvasElement>;
}) {
  // In overlay mode the canvases live inside the overlay block already, so
  // we don't render duplicates. In side/diff modes the OTHER canvases are
  // unmounted by CSS hidden — that's fine because the active branch keeps
  // the refs bound. This component is intentionally a no-op for now; left
  // in place so the rendering branches above can rely on stable refs.
  void keepMounted;
  void refA;
  void refB;
  void refDiff;
  return null;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-[360px] text-center">
        <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-md border border-border bg-surface-2 text-vault">
          <GitCompare className="h-4 w-4" />
        </div>
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <p className="mt-1 text-[12px] leading-snug text-text-muted">{body}</p>
      </div>
    </div>
  );
}

/* ----------------------- Compare floating toolbar ---------------------- */

export function CompareFloatingBar() {
  const page = useCompare((s) => s.page);
  const setPage = useCompare((s) => s.setPage);
  const totalPages = useCompare((s) => s.totalPages);
  const threshold = useCompare((s) => s.threshold);
  const setThreshold = useCompare((s) => s.setThreshold);
  const viewMode = useCompare((s) => s.viewMode);
  const setViewMode = useCompare((s) => s.setViewMode);

  const disabled = totalPages === 0;

  return (
    <div
      className="absolute left-1/2 top-2.5 z-30 flex -translate-x-1/2 items-center gap-2 border border-border bg-surface-3 px-2 py-1"
      style={{ borderRadius: 11, boxShadow: "var(--shadow-float)" }}
      role="toolbar"
      aria-label="Compare tools"
    >
      <BarBtn
        label="Previous page"
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={disabled || page <= 1}
      >
        <ChevronLeft className="h-[15px] w-[15px]" />
      </BarBtn>
      <div className="min-w-[78px] text-center font-mono text-[11.5px] tabular-nums text-foreground">
        {disabled ? "— / —" : `${page} / ${totalPages}`}
      </div>
      <BarBtn
        label="Next page"
        onClick={() => setPage(Math.min(totalPages || 1, page + 1))}
        disabled={disabled || page >= totalPages}
      >
        <ChevronRight className="h-[15px] w-[15px]" />
      </BarBtn>

      <span className="mx-1 h-5 w-px bg-border" />

      <ModePill value={viewMode} onChange={setViewMode} />

      <span className="mx-1 h-5 w-px bg-border" />

      <label className="flex items-center gap-1.5 px-1 text-[11px] text-text-2">
        <span>Sensitivity</span>
        <input
          type="range"
          min={0.02}
          max={0.4}
          step={0.02}
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          className="w-24 accent-vault"
          aria-label="Sensitivity"
        />
        <span className="font-mono text-foreground/80 w-9 text-right">
          {threshold.toFixed(2)}
        </span>
      </label>
    </div>
  );
}

function BarBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-md text-text-2 transition-colors",
        "hover:text-foreground hover:bg-surface-2",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-text-2",
      )}
    >
      {children}
    </button>
  );
}

function ModePill({
  value,
  onChange,
}: {
  value: CompareViewMode;
  onChange: (v: CompareViewMode) => void;
}) {
  const opts: Array<{ id: CompareViewMode; label: string }> = [
    { id: "side", label: "Side" },
    { id: "diff", label: "Diff" },
    { id: "overlay", label: "Overlay" },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cn(
            "rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors",
            value === o.id
              ? "bg-vault text-vault-foreground"
              : "text-text-2 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
