import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, FileText, GitCompare, RefreshCw, Upload, X } from "lucide-react";
import { ToolHeader } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";
import { loadPdfjs } from "@/lib/pdf/worker";
import { importChunk } from "@/lib/chunk-import";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "Compare PDFs — Visual Diff — VaultPDF" },
      {
        name: "description",
        content:
          "Compare two PDFs side-by-side and highlight every visual change. Perfect for contract review — runs entirely in your browser.",
      },
      { property: "og:title", content: "Compare PDFs — VaultPDF" },
      {
        property: "og:description",
        content: "Side-by-side visual diff for two PDF versions. Local, private.",
      },
      { property: "og:url", content: "/compare" },
    ],
    links: [{ rel: "canonical", href: "/compare" }],
  }),
  component: ComparePage,
});

type RenderedDoc = {
  file: File;
  pageCount: number;
};

function ComparePage() {
  const [docA, setDocA] = useState<RenderedDoc | null>(null);
  const [docB, setDocB] = useState<RenderedDoc | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(0.1);
  const [diffCount, setDiffCount] = useState<number | null>(null);
  const [scale, setScale] = useState(1.4);

  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const canvasDiffRef = useRef<HTMLCanvasElement>(null);

  const loadFile = async (f: File, which: "a" | "b") => {
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      const rec: RenderedDoc = { file: f, pageCount: doc.numPages };
      if (which === "a") setDocA(rec);
      else setDocB(rec);
      setPage(1);
      setDiffCount(null);
    } catch {
      toast.error("Couldn't open that PDF.");
    }
  };

  const totalPages = Math.max(docA?.pageCount ?? 0, docB?.pageCount ?? 0);

  const renderPair = useCallback(async () => {
    if (!docA || !docB) return;
    setBusy(true);
    setDiffCount(null);
    try {
      const pdfjs = await loadPdfjs();
      const [pa, pb] = await Promise.all([
        pdfjs.getDocument({ data: await docA.file.arrayBuffer() }).promise,
        pdfjs.getDocument({ data: await docB.file.arrayBuffer() }).promise,
      ]);

      const renderTo = async (
        doc: any,
        pageIdx: number,
        canvas: HTMLCanvasElement,
        targetWidth?: number,
      ) => {
        if (pageIdx < 1 || pageIdx > doc.numPages) {
          canvas.width = targetWidth ?? 600;
          canvas.height = Math.round((targetWidth ?? 600) * 1.4);
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#f5f5f5";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#9ca3af";
          ctx.font = "16px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("(no page)", canvas.width / 2, canvas.height / 2);
          return null;
        }
        const page = await doc.getPage(pageIdx);
        const baseViewport = page.getViewport({ scale: 1 });
        const useScale = targetWidth
          ? targetWidth / baseViewport.width
          : scale;
        const viewport = page.getViewport({ scale: useScale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        return { width: canvas.width, height: canvas.height };
      };

      const ca = canvasARef.current!;
      const cb = canvasBRef.current!;
      const cd = canvasDiffRef.current!;

      const aDim = await renderTo(pa, page, ca);
      // Match B and diff canvas to A's pixel dimensions for accurate compare.
      const bDim = await renderTo(pb, page, cb, aDim?.width);

      if (aDim && bDim && aDim.width === bDim.width && aDim.height === bDim.height) {
        const ctxA = ca.getContext("2d")!;
        const ctxB = cb.getContext("2d")!;
        const ctxD = cd.getContext("2d")!;
        cd.width = aDim.width;
        cd.height = aDim.height;
        const imgA = ctxA.getImageData(0, 0, aDim.width, aDim.height);
        const imgB = ctxB.getImageData(0, 0, bDim.width, bDim.height);
        const out = ctxD.createImageData(aDim.width, aDim.height);
        const pixelmatch = (await importChunk(() => import("pixelmatch"))).default;
        const count = pixelmatch(imgA.data, imgB.data, out.data, aDim.width, aDim.height, {
          threshold,
          includeAA: false,
          alpha: 0.4,
          diffColor: [232, 50, 90],
          diffColorAlt: [50, 180, 100],
        });
        ctxD.putImageData(out, 0, 0);
        setDiffCount(count);
      } else {
        // Different dims — draw blank diff
        const ctxD = cd.getContext("2d")!;
        cd.width = aDim?.width ?? 600;
        cd.height = aDim?.height ?? 800;
        ctxD.fillStyle = "#fff7ed";
        ctxD.fillRect(0, 0, cd.width, cd.height);
        ctxD.fillStyle = "#9a3412";
        ctxD.font = "16px sans-serif";
        ctxD.textAlign = "center";
        ctxD.fillText("Page size differs — visual diff skipped", cd.width / 2, cd.height / 2);
        setDiffCount(null);
      }
    } catch (err) {
      console.error(err);
      toast.error("Couldn't render that page.");
    } finally {
      setBusy(false);
    }
  }, [docA, docB, page, threshold, scale]);

  useEffect(() => {
    if (docA && docB) void renderPair();
  }, [renderPair, docA, docB]);

  const reset = () => {
    setDocA(null);
    setDocB(null);
    setPage(1);
    setDiffCount(null);
  };

  useHotkey("ArrowLeft", () => setPage((p) => Math.max(1, p - 1)), !!docA && !!docB && !busy);
  useHotkey("ArrowRight", () => setPage((p) => Math.min(totalPages, p + 1)), !!docA && !!docB && !busy);

  return (
    <AppShell>
      <ToolHeader
        tag="Compare"
        title="Spot every change between two PDFs."
        sub="Side-by-side visual diff. Built for contract review, redlines, and revision checking — entirely local."
        collapsed={!!docA || !!docB}
      />
      <div className="mx-auto px-5 md:px-8 py-8 max-w-[1400px]">
        {!docA || !docB ? (
          <div className="grid md:grid-cols-2 gap-4">
            <SlotDropzone
              label="Original (A)"
              file={docA?.file ?? null}
              onFile={(f) => loadFile(f, "a")}
              onClear={() => setDocA(null)}
            />
            <SlotDropzone
              label="Revised (B)"
              file={docB?.file ?? null}
              onFile={(f) => loadFile(f, "b")}
              onClear={() => setDocB(null)}
            />
            <div className="md:col-span-2 text-center text-xs text-muted-foreground">
              Drop two PDFs to start comparing. Tip: pages compared visually at the same resolution — encrypted PDFs not supported.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-vault/10 text-vault">A</span>
                  <span className="truncate max-w-[180px]" title={docA.file.name}>{docA.file.name}</span>
                </div>
                <span className="text-muted-foreground">vs</span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-vault/10 text-vault">B</span>
                  <span className="truncate max-w-[180px]" title={docB.file.name}>{docB.file.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Swap files
                </Button>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || busy}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-sm font-mono tabular-nums">
                  Page {page} <span className="text-muted-foreground">of {totalPages}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || busy}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Sensitivity</span>
                  <input
                    type="range"
                    min={0.02}
                    max={0.4}
                    step={0.02}
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value))}
                    className="w-28 accent-vault"
                  />
                  <span className="font-mono text-foreground/80 w-10">{threshold.toFixed(2)}</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Zoom</span>
                  <input
                    type="range"
                    min={0.8}
                    max={2.4}
                    step={0.1}
                    value={scale}
                    onChange={(e) => setScale(parseFloat(e.target.value))}
                    className="w-28 accent-vault"
                  />
                  <span className="font-mono text-foreground/80 w-10">{scale.toFixed(1)}x</span>
                </label>
                <div className="text-xs">
                  {busy ? (
                    <span className="text-muted-foreground">Comparing…</span>
                  ) : diffCount === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : diffCount === 0 ? (
                    <span className="text-vault font-medium">No visible changes</span>
                  ) : (
                    <span className="text-rose-500 font-medium">
                      {diffCount.toLocaleString()} pixel{diffCount === 1 ? "" : "s"} changed
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Panes */}
            <div className="grid md:grid-cols-3 gap-3">
              <Pane title="A · Original" canvasRef={canvasARef} />
              <Pane title="B · Revised" canvasRef={canvasBRef} />
              <Pane title="Diff" canvasRef={canvasDiffRef} accent />
            </div>

            <div className="text-center text-[11px] text-muted-foreground">
              <GitCompare className="inline h-3 w-3 mr-1 -mt-0.5" />
              Pink = pixels that differ. Both PDFs are rendered and compared locally — nothing uploaded.
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Pane({
  title,
  canvasRef,
  accent,
}: {
  title: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border ${
        accent ? "border-vault/40 bg-vault/[0.04]" : "border-border bg-card/40"
      } overflow-hidden`}
    >
      <div className="px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border">
        {title}
      </div>
      <div className="overflow-auto max-h-[72vh] bg-[repeating-conic-gradient(#0000_0%_25%,rgba(0,0,0,0.03)_0%_50%)] bg-[length:16px_16px] p-2">
        <canvas ref={canvasRef} className="block max-w-full h-auto shadow-sm bg-white" />
      </div>
    </div>
  );
}

function SlotDropzone({
  label,
  file,
  onFile,
  onClear,
}: {
  label: string;
  file: File | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (file) {
    return (
      <div className="rounded-lg border border-vault/40 bg-vault/5 p-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-vault/15 text-vault shrink-0">
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-vault">{label}</div>
          <div className="text-sm font-medium truncate">{file.name}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`block cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-all ${
        drag ? "border-vault bg-vault/10" : "border-border hover:border-vault/60 hover:bg-accent/40"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-vault/10 text-vault">
        <Upload className="h-5 w-5" />
      </div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-vault mb-1">{label}</div>
      <div className="text-base font-medium">Drop a PDF here</div>
      <div className="mt-1 text-xs text-muted-foreground">or click to choose</div>
    </label>
  );
}
