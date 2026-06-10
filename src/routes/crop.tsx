import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ToolHeader } from "@/routes/split";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Wand2, Crop as CropIcon, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { useTray, type TrayEntry } from "@/lib/tray/store";
import { getBytes } from "@/lib/tray/blobs";
import { loadPdfjs } from "@/lib/pdf/worker";
import { downloadBytes } from "@/lib/batch/runner";
import { applyCrop, rectFromMargins } from "@/lib/crop/apply";
import { detectContentBounds } from "@/lib/crop/detect";
import { CROP_PRESETS, ptFrom, ptTo, type CropRect, type CropScope, type CropUnit } from "@/lib/crop/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/crop")({
  head: () => ({
    meta: [
      { title: "Crop PDF Pages — Artboard with Rulers · VaultPDF" },
      {
        name: "description",
        content:
          "Trim PDF pages with rulers, presets, and an auto-detect content button. Apply to one page, all pages, or odd/even. 100% on-device.",
      },
      { property: "og:title", content: "Crop PDF — drag the artboard, in your browser" },
      {
        property: "og:description",
        content: "Visual cropbox with rulers in pt/in/mm, presets, and auto-detect content bounds.",
      },
    ],
    links: [{ rel: "canonical", href: "/crop" }],
  }),
  component: CropPage,
});

type Selection = number[]; // page indices from rail

function CropPage() {
  const entries = useTray((s) => s.entries);

  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [sourceName, setSourceName] = useState("document.pdf");
  const [pageCount, setPageCount] = useState(0);
  const [pageSizes, setPageSizes] = useState<{ w: number; h: number }[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<Selection>([]);
  const [unit, setUnit] = useState<CropUnit>("pt");

  // Per-page crop rects. Missing entry = full page (no crop yet).
  const [rects, setRects] = useState<Map<number, CropRect>>(new Map());
  // Apply scope.
  const [scopeKind, setScopeKind] = useState<CropScope["kind"]>("current");
  const [mediaBoxToo, setMediaBoxToo] = useState(false);

  const [busy, setBusy] = useState(false);

  const currentPageSize = pageSizes[page];
  const currentRect: CropRect | null = useMemo(() => {
    if (!currentPageSize) return null;
    return rects.get(page) ?? { x: 0, y: 0, w: currentPageSize.w, h: currentPageSize.h };
  }, [rects, page, currentPageSize]);

  // ---- loading ------------------------------------------------------------
  const loadFromBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    setBusy(true);
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const sizes: { w: number; h: number }[] = [];
      const ths: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        sizes.push({ w: vp.width, h: vp.height });
        // small thumb
        const tvp = p.getViewport({ scale: 0.18 });
        const c = document.createElement("canvas");
        c.width = Math.ceil(tvp.width);
        c.height = Math.ceil(tvp.height);
        const cx = c.getContext("2d");
        if (cx) {
          cx.fillStyle = "#fff";
          cx.fillRect(0, 0, c.width, c.height);
          await p.render({ canvasContext: cx, viewport: tvp, canvas: c }).promise;
          ths.push(c.toDataURL("image/jpeg", 0.7));
        } else {
          ths.push("");
        }
      }
      setSourceBytes(bytes);
      setSourceName(name);
      setPageCount(doc.numPages);
      setPageSizes(sizes);
      setThumbs(ths);
      setRects(new Map());
      setPage(0);
      setSelection([0]);
      try { (doc as any).destroy?.(); } catch { /* ignore */ }
    } catch (err) {
      console.error(err);
      toast.error("Could not read that PDF");
    } finally {
      setBusy(false);
    }
  }, []);

  const pickFromTray = useCallback(
    async (entry: TrayEntry) => {
      const bytes = await getBytes(entry.sha256);
      if (!bytes) return toast.error("Tray bytes missing");
      await loadFromBytes(bytes, entry.name);
    },
    [loadFromBytes],
  );

  const onFile = (file: File | undefined) => {
    if (!file) return;
    file.arrayBuffer().then((buf) => loadFromBytes(new Uint8Array(buf), file.name));
  };

  // ---- crop helpers -------------------------------------------------------
  const setRectForPage = useCallback((idx: number, rect: CropRect) => {
    setRects((m) => {
      const next = new Map(m);
      next.set(idx, rect);
      return next;
    });
  }, []);

  const setRectForScope = useCallback(
    (rectFor: (size: { w: number; h: number }) => CropRect) => {
      if (!pageSizes.length) return;
      const idxs = scopeIndices(scopeKind, pageCount, page, selection);
      setRects((m) => {
        const next = new Map(m);
        for (const i of idxs) {
          next.set(i, rectFor(pageSizes[i]));
        }
        return next;
      });
    },
    [pageSizes, pageCount, page, scopeKind, selection],
  );

  const applyPreset = (presetId: string) => {
    const preset = CROP_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setRectForScope((size) => rectFromMargins(size.w, size.h, preset.margins));
    toast.success(`Applied "${preset.label}"`);
  };

  const autoDetect = async () => {
    if (!sourceBytes || !currentPageSize) return;
    setBusy(true);
    try {
      const idxs = scopeIndices(scopeKind, pageCount, page, selection);
      const updates: Array<[number, CropRect]> = [];
      for (const i of idxs) {
        const r = await detectContentBounds(sourceBytes, i);
        if (r) updates.push([i, r]);
      }
      if (updates.length === 0) {
        toast.message("No content detected — pages may be blank or all-image");
        return;
      }
      setRects((m) => {
        const next = new Map(m);
        for (const [i, r] of updates) next.set(i, r);
        return next;
      });
      toast.success(`Auto-detected on ${updates.length} page${updates.length === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast.error("Auto-detect failed");
    } finally {
      setBusy(false);
    }
  };

  const resetCrop = () => {
    const idxs = scopeIndices(scopeKind, pageCount, page, selection);
    setRects((m) => {
      const next = new Map(m);
      for (const i of idxs) next.delete(i);
      return next;
    });
  };

  // ---- export -------------------------------------------------------------
  const runExport = async () => {
    if (!sourceBytes) return;
    setBusy(true);
    try {
      // If a page has no explicit rect, leave it untouched (skip via filter).
      const idxs = scopeIndices(scopeKind, pageCount, page, selection)
        .filter((i) => rects.has(i));
      if (idxs.length === 0) {
        toast.message("Nothing to crop yet — drag the artboard or pick a preset");
        return;
      }
      const out = await applyCrop(
        sourceBytes,
        {
          scope: { kind: "indices", indices: idxs },
          rect: rects,
          mediaBoxToo,
        },
        page,
      );
      const name = sourceName.replace(/\.pdf$/i, "") + "-cropped.pdf";
      downloadBytes(out, name, "application/pdf");
      toast.success(`Cropped ${idxs.length} page${idxs.length === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast.error("Crop failed");
    } finally {
      setBusy(false);
    }
  };

  // ---- render -------------------------------------------------------------
  return (
    <AppShell>
      <ToolHeader
        tag="Crop"
        title={sourceBytes ? sourceName : "Trim PDF pages with rulers and presets."}
        sub={
          <>
            Drag the artboard, pick a preset, or hit{" "}
            <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-card border border-whisper">A</kbd>{" "}
            to auto-detect content bounds. Crops only the cropbox by default — text and images stay intact.
          </>
        }
        collapsed={!!sourceBytes}
      />
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 py-8 space-y-6">
        {entries.length > 0 && !sourceBytes && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground">
            <span>Tray:</span>
            {entries.map((e) => (
              <button
                key={e.id}
                onClick={() => pickFromTray(e)}
                className="inline-flex items-center gap-1.5 rounded-md border border-whisper bg-card px-2 py-1 normal-case tracking-normal hover:border-vault hover:text-vault transition-colors"
                title={e.name}
              >
                <span className="font-medium truncate max-w-[22ch]">{e.name}</span>
                <span className="text-muted-foreground">· {e.pageCount}p</span>
              </button>
            ))}
          </div>
        )}

        {!sourceBytes ? (
          <FileDropzone
            onFile={onFile}
            label="Drop a PDF to crop"
            sublabel="rulers, presets, auto-detect — no upload"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_320px] gap-4 min-h-[640px]">
            {/* Page rail */}
            <aside className="rounded-lg border border-whisper bg-card/40 p-2 overflow-y-auto max-h-[80vh]">
              <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground px-2 py-1.5">
                Pages · {pageCount}
              </div>
              <div className="space-y-2">
                {thumbs.map((src, i) => {
                  const isCurrent = i === page;
                  const inSel = selection.includes(i);
                  const cropped = rects.has(i);
                  return (
                    <button
                      key={i}
                      onClick={(e) => {
                        setPage(i);
                        if (e.shiftKey && selection.length) {
                          const last = selection[selection.length - 1];
                          const [a, b] = [Math.min(last, i), Math.max(last, i)];
                          const range: number[] = [];
                          for (let k = a; k <= b; k++) range.push(k);
                          setSelection(range);
                        } else if (e.metaKey || e.ctrlKey) {
                          setSelection((s) =>
                            s.includes(i) ? s.filter((x) => x !== i) : [...s, i],
                          );
                        } else {
                          setSelection([i]);
                        }
                      }}
                      className={cn(
                        "relative w-full rounded-md border bg-canvas p-1 transition-colors text-left",
                        isCurrent
                          ? "border-vault ring-1 ring-vault/30"
                          : inSel
                            ? "border-vault/40"
                            : "border-whisper hover:border-vault/40",
                      )}
                    >
                      {src ? (
                        <img src={src} alt={`page ${i + 1}`} className="w-full h-auto block rounded-sm" />
                      ) : (
                        <div className="w-full aspect-[3/4] grid place-items-center text-muted-foreground text-xs">…</div>
                      )}
                      <div className="flex items-center justify-between mt-1 px-1">
                        <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                        {cropped && <span className="font-mono text-[9px] uppercase tracking-wider text-vault">cropped</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Viewer */}
            <main className="rounded-lg border border-whisper bg-canvas/40 p-3 flex flex-col min-w-0">
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    p. {page + 1} / {pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-md border border-whisper overflow-hidden">
                    {(["pt", "in", "mm"] as CropUnit[]).map((u) => (
                      <button
                        key={u}
                        onClick={() => setUnit(u)}
                        className={cn(
                          "px-2 py-1 text-[10px] uppercase tracking-wider font-mono",
                          unit === u ? "bg-vault text-vault-foreground" : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={autoDetect} disabled={busy}>
                    <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                    Auto-detect
                  </Button>
                </div>
              </div>

              {sourceBytes && currentPageSize ? (
                <CropArtboard
                  bytes={sourceBytes}
                  pageIndex={page}
                  pageSize={currentPageSize}
                  rect={currentRect!}
                  onRectChange={(r) => setRectForPage(page, r)}
                  unit={unit}
                />
              ) : (
                <div className="grid place-items-center min-h-[400px] text-muted-foreground text-sm">Loading…</div>
              )}
            </main>

            {/* Inspector */}
            <aside className="rounded-lg border border-whisper bg-card/40 p-4 space-y-5 overflow-y-auto max-h-[80vh]">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground mb-2">
                  Apply scope
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {([
                    ["current", "This page"],
                    ["all", "All pages"],
                    ["odd", "Odd pages"],
                    ["even", "Even pages"],
                    ["indices", `Selection · ${selection.length}`],
                  ] as [CropScope["kind"], string][]).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setScopeKind(k)}
                      className={cn(
                        "rounded-md border px-2 py-1.5 transition-colors text-left",
                        scopeKind === k
                          ? "border-vault bg-vault/10 text-vault"
                          : "border-whisper hover:border-vault/40",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground mb-2">Presets</div>
                <div className="space-y-1.5">
                  {CROP_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className="w-full text-left rounded-md border border-whisper hover:border-vault/40 px-3 py-2 transition-colors"
                    >
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-[11px] text-muted-foreground">{p.blurb}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground mb-2">
                  Margins ({unit})
                </div>
                {currentPageSize && currentRect && (
                  <MarginInputs
                    unit={unit}
                    pageSize={currentPageSize}
                    rect={currentRect}
                    onChange={(r) => {
                      const idxs = scopeIndices(scopeKind, pageCount, page, selection);
                      setRects((m) => {
                        const next = new Map(m);
                        for (const i of idxs) next.set(i, r);
                        return next;
                      });
                    }}
                  />
                )}
              </div>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={mediaBoxToo}
                  onChange={(e) => setMediaBoxToo(e.target.checked)}
                  className="accent-vault"
                />
                <span>
                  Also rewrite MediaBox
                  <span className="block text-[10px] text-muted-foreground">Destructive — older viewers honor it but content outside the crop is lost.</span>
                </span>
              </label>

              <div className="flex flex-col gap-2 pt-2 border-t border-whisper">
                <Button onClick={runExport} disabled={busy || !sourceBytes} className="bg-vault text-vault-foreground hover:opacity-90">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Export cropped PDF
                </Button>
                <Button variant="outline" size="sm" onClick={resetCrop}>
                  Reset crop on scope
                </Button>
                <label className="inline-flex items-center justify-center gap-1.5 rounded-md border border-whisper px-3 py-1.5 text-xs hover:bg-accent/60 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Open another PDF</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </label>
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function scopeIndices(kind: CropScope["kind"], total: number, current: number, selection: number[]): number[] {
  switch (kind) {
    case "current":  return [current];
    case "all":      return Array.from({ length: total }, (_, i) => i);
    case "odd":      return Array.from({ length: total }, (_, i) => i).filter((i) => (i + 1) % 2 === 1);
    case "even":     return Array.from({ length: total }, (_, i) => i).filter((i) => (i + 1) % 2 === 0);
    case "indices":  return selection.length ? selection : [current];
  }
}

// ============================================================================
// Artboard — canvas render + draggable crop box with rulers
// ============================================================================

function CropArtboard({
  bytes,
  pageIndex,
  pageSize,
  rect,
  onRectChange,
  unit,
}: {
  bytes: Uint8Array;
  pageIndex: number;
  pageSize: { w: number; h: number };
  rect: CropRect;
  onRectChange: (r: CropRect) => void;
  unit: CropUnit;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Render page to canvas at container width.
  useEffect(() => {
    let cancelled = false;
    async function render() {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const maxW = Math.max(200, wrap.clientWidth - 80); // leave room for left ruler
      const maxH = Math.max(200, (wrap.clientHeight || 600) - 80);
      const fitScale = Math.min(maxW / pageSize.w, maxH / pageSize.h);
      const s = Math.max(0.2, Math.min(3, fitScale));
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      try {
        const page = await doc.getPage(pageIndex + 1);
        const vp = page.getViewport({ scale: s });
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
        if (!cancelled) setScale(s);
      } finally {
        try { (doc as any).destroy?.(); } catch { /* ignore */ }
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [bytes, pageIndex, pageSize.w, pageSize.h]);

  // Convert PDF user-space rect → screen rect (origin top-left).
  const screenRect = {
    left: rect.x * scale,
    top: (pageSize.h - rect.y - rect.h) * scale,
    width: rect.w * scale,
    height: rect.h * scale,
  };
  const pageScreenW = pageSize.w * scale;
  const pageScreenH = pageSize.h * scale;

  // Drag state.
  const dragRef = useRef<{
    kind: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "new";
    startX: number; startY: number;
    startRect: CropRect;
  } | null>(null);

  const onPointerDown = (kind: typeof dragRef.current extends infer T ? (T extends { kind: infer K } ? K : never) : never) =>
    (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startRect: rect };
    };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    let { x, y, w, h } = d.startRect;
    switch (d.kind) {
      case "move":
        x = clamp(x + dx, 0, pageSize.w - w);
        y = clamp(y - dy, 0, pageSize.h - h);
        break;
      case "e":  w = clamp(w + dx, 10, pageSize.w - x); break;
      case "w":  { const nx = clamp(x + dx, 0, x + w - 10); w = w + (x - nx); x = nx; break; }
      case "n":  h = clamp(h - dy, 10, pageSize.h - y); break;
      case "s":  { const ny = clamp(y - dy, 0, y + h - 10); h = h + (y - ny); y = ny; break; }
      case "ne": w = clamp(w + dx, 10, pageSize.w - x); h = clamp(h - dy, 10, pageSize.h - y); break;
      case "nw": { const nx = clamp(x + dx, 0, x + w - 10); w = w + (x - nx); x = nx; h = clamp(h - dy, 10, pageSize.h - y); break; }
      case "se": w = clamp(w + dx, 10, pageSize.w - x); { const ny = clamp(y - dy, 0, y + h - 10); h = h + (y - ny); y = ny; break; }
      case "sw": { const nx = clamp(x + dx, 0, x + w - 10); w = w + (x - nx); x = nx; const ny = clamp(y - dy, 0, y + h - 10); h = h + (y - ny); y = ny; break; }
      case "new": return; // handled on down
    }
    onRectChange({ x, y, w, h });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = null;
  };

  // Drawing a fresh rect on empty area.
  const onPageDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset.cropHandle) return;
    const rectEl = canvasRef.current?.getBoundingClientRect();
    if (!rectEl) return;
    const startSx = e.clientX - rectEl.left;
    const startSy = e.clientY - rectEl.top;
    const x0 = startSx / scale;
    const y0 = pageSize.h - startSy / scale;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "new",
      startX: e.clientX, startY: e.clientY,
      startRect: { x: x0, y: y0, w: 1, h: 1 },
    };
    const move = (ev: PointerEvent) => {
      const sx = ev.clientX - rectEl.left;
      const sy = ev.clientY - rectEl.top;
      const x1 = sx / scale;
      const y1 = pageSize.h - sy / scale;
      const x = clamp(Math.min(x0, x1), 0, pageSize.w);
      const y = clamp(Math.min(y0, y1), 0, pageSize.h);
      const w = clamp(Math.abs(x1 - x0), 10, pageSize.w - x);
      const h = clamp(Math.abs(y1 - y0), 10, pageSize.h - y);
      onRectChange({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={wrapRef} className="relative flex-1 min-h-[500px] overflow-auto bg-card/30 rounded-md p-4">
      <div className="relative inline-block pl-10 pt-6">
        {/* Top ruler */}
        <Ruler axis="x" length={pageScreenW} scale={scale} unit={unit} className="absolute left-10 top-0 h-6" />
        {/* Left ruler */}
        <Ruler axis="y" length={pageScreenH} scale={scale} unit={unit} className="absolute left-0 top-6 w-10" />

        <div
          className="relative shadow-md ring-1 ring-border bg-white"
          style={{ width: pageScreenW, height: pageScreenH }}
          onPointerDown={onPageDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <canvas ref={canvasRef} className="block" style={{ width: pageScreenW, height: pageScreenH }} />

          {/* Dim outside the crop rect using 4 overlay strips */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute bg-background/60" style={{ left: 0, top: 0, width: pageScreenW, height: screenRect.top }} />
            <div className="absolute bg-background/60" style={{ left: 0, top: screenRect.top + screenRect.height, width: pageScreenW, height: pageScreenH - (screenRect.top + screenRect.height) }} />
            <div className="absolute bg-background/60" style={{ left: 0, top: screenRect.top, width: screenRect.left, height: screenRect.height }} />
            <div className="absolute bg-background/60" style={{ left: screenRect.left + screenRect.width, top: screenRect.top, width: pageScreenW - (screenRect.left + screenRect.width), height: screenRect.height }} />
          </div>

          {/* Crop box */}
          <div
            data-crop-handle="box"
            className="absolute border-2 border-vault cursor-move"
            style={{ left: screenRect.left, top: screenRect.top, width: screenRect.width, height: screenRect.height }}
            onPointerDown={onPointerDown("move")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <Handle pos="nw" onDown={onPointerDown("nw")} />
            <Handle pos="n"  onDown={onPointerDown("n")} />
            <Handle pos="ne" onDown={onPointerDown("ne")} />
            <Handle pos="e"  onDown={onPointerDown("e")} />
            <Handle pos="se" onDown={onPointerDown("se")} />
            <Handle pos="s"  onDown={onPointerDown("s")} />
            <Handle pos="sw" onDown={onPointerDown("sw")} />
            <Handle pos="w"  onDown={onPointerDown("w")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Handle({ pos, onDown }: { pos: string; onDown: (e: React.PointerEvent) => void }) {
  const styles: Record<string, string> = {
    nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
    n:  "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
    ne: "right-0 top-0  translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
    e:  "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
    se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
    s:  "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
    sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
    w:  "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  };
  return (
    <div
      data-crop-handle={pos}
      onPointerDown={onDown}
      className={cn("absolute h-3 w-3 bg-vault border border-background rounded-sm", styles[pos])}
    />
  );
}

function Ruler({
  axis,
  length,
  scale,
  unit,
  className,
}: {
  axis: "x" | "y";
  length: number;
  scale: number;
  unit: CropUnit;
  className?: string;
}) {
  // Tick every N units, depending on unit.
  const stepUnits = unit === "pt" ? 36 : unit === "in" ? 0.5 : 10;
  const stepPx = ptFrom(stepUnits, unit) * scale;
  const ticks: number[] = [];
  for (let i = 0; i * stepPx < length; i++) ticks.push(i);
  return (
    <div className={cn("relative bg-background/40 border-border", className)} style={axis === "x" ? { width: length } : { height: length }}>
      {ticks.map((i) => {
        const px = i * stepPx;
        const valuePt = ptFrom(i * stepUnits, unit);
        const label = `${(ptTo(valuePt, unit)).toFixed(unit === "in" ? 1 : 0)}`;
        if (axis === "x") {
          return (
            <div key={i} className="absolute top-0 h-full text-[9px] text-muted-foreground font-mono leading-none" style={{ left: px }}>
              <div className="h-2 w-px bg-border" />
              <div className="pl-0.5">{label}</div>
            </div>
          );
        }
        return (
          <div key={i} className="absolute left-0 w-full text-[9px] text-muted-foreground font-mono leading-none" style={{ top: px }}>
            <div className="flex items-center gap-1">
              <div className="w-2 h-px bg-border" />
              <div>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MarginInputs({
  unit,
  pageSize,
  rect,
  onChange,
}: {
  unit: CropUnit;
  pageSize: { w: number; h: number };
  rect: CropRect;
  onChange: (r: CropRect) => void;
}) {
  // Margins in pt.
  const top = pageSize.h - rect.y - rect.h;
  const right = pageSize.w - rect.x - rect.w;
  const bottom = rect.y;
  const left = rect.x;

  const fmt = (v: number) => ptTo(v, unit).toFixed(unit === "in" ? 2 : 1);
  const update = (which: "top" | "right" | "bottom" | "left", val: string) => {
    const num = parseFloat(val);
    if (Number.isNaN(num)) return;
    const pt = ptFrom(num, unit);
    let t = top, r = right, b = bottom, l = left;
    if (which === "top") t = pt;
    if (which === "right") r = pt;
    if (which === "bottom") b = pt;
    if (which === "left") l = pt;
    const x = Math.max(0, Math.min(l, pageSize.w - 10));
    const y = Math.max(0, Math.min(b, pageSize.h - 10));
    const w = Math.max(10, pageSize.w - x - Math.max(0, r));
    const h = Math.max(10, pageSize.h - y - Math.max(0, t));
    onChange({ x, y, w, h });
  };
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <Field label="Top" value={fmt(top)} onChange={(v) => update("top", v)} />
      <Field label="Right" value={fmt(right)} onChange={(v) => update("right", v)} />
      <Field label="Bottom" value={fmt(bottom)} onChange={(v) => update("bottom", v)} />
      <Field label="Left" value={fmt(left)} onChange={(v) => update("left", v)} />
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs font-mono" />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// silence unused imports in light branches
void CropIcon;
