import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MousePointer2, Highlighter, Underline as UnderlineIcon, Strikethrough,
  StickyNote, Pen, Square, Circle, Minus, ArrowRight, Type,
  Undo2, Redo2, Trash2, Download, MessageSquare, Search,
  ZoomIn, ZoomOut, ChevronLeft, ChevronRight, X, Image as ImageIcon,
} from "lucide-react";
import { getStroke } from "perfect-freehand";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { loadPdfjs } from "@/lib/pdf/worker";
import {
  PRESET_COLORS, rgbToCss, uid,
  type Annot, type AnnotTool, type RGB, type QuadAnnot, type InkAnnot,
} from "@/lib/annotate/types";
import {
  useAnnotStore, hashFile, loadAnnots, saveAnnots,
} from "@/lib/annotate/store";
import { exportAnnotatedPdf, exportCommentsJson, importNativeAnnots } from "@/lib/annotate/export";

export const Route = createFileRoute("/annotate")({
  head: () => ({
    meta: [
      { title: "Annotate PDF — VaultPDF" },
      { name: "description", content: "Full-featured PDF annotator: highlight, draw, comment, sign. Works entirely in your browser, files never upload." },
      { property: "og:title", content: "Annotate PDF — VaultPDF" },
      { property: "og:description", content: "Highlight, draw, comment, and stamp PDFs locally. Real PDF annotations, Acrobat-compatible." },
    ],
  }),
  component: AnnotatePage,
});

type PageMeta = { width: number; height: number };

function AnnotatePage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  const onFile = useCallback(async (f: File) => {
    setFileName(f.name);
    setBytes(new Uint8Array(await f.arrayBuffer()));
  }, []);

  if (!fileName || !bytes) {
    return (
      <AppShell>
        <div className="p-6 md:p-10 max-w-3xl mx-auto">
          <div className="mb-6">
            <h1 className="font-display text-3xl tracking-tight">Annotate PDF</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Highlight, underline, draw, comment, stamp. Real PDF annotations that open
              correctly in Acrobat, Preview, and any other reader. Files never leave this tab.
            </p>
          </div>
          <FileDropzone
            accept="application/pdf"
            onFile={onFile}
            label="Drop a PDF to start annotating"
            sublabel="or click to browse"
          />
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
            <ShortcutHint k="V">Select</ShortcutHint>
            <ShortcutHint k="H">Highlight</ShortcutHint>
            <ShortcutHint k="U">Underline</ShortcutHint>
            <ShortcutHint k="S">Strikethrough</ShortcutHint>
            <ShortcutHint k="N">Sticky note</ShortcutHint>
            <ShortcutHint k="D">Draw</ShortcutHint>
            <ShortcutHint k="R">Rectangle</ShortcutHint>
            <ShortcutHint k="A">Arrow</ShortcutHint>
            <ShortcutHint k="T">Text box</ShortcutHint>
            <ShortcutHint k="⌘Z">Undo</ShortcutHint>
            <ShortcutHint k="⇧⌘Z">Redo</ShortcutHint>
            <ShortcutHint k="⌘F">Search</ShortcutHint>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <AnnotationWorkspace fileName={fileName} bytes={bytes} />
    </AppShell>
  );
}

export function AnnotationWorkspace({ fileName, bytes, headerSlot }: {
  fileName: string;
  bytes: Uint8Array;
  headerSlot?: React.ReactNode;
}) {
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [pageMetas, setPageMetas] = useState<PageMeta[]>([]);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [showThumbs, setShowThumbs] = useState(true);
  const [showComments, setShowComments] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<{ page: number; rects: { x: number; y: number; w: number; h: number }[] }[]>([]);

  const { annots, tool, color, stroke, fontSize, opacity, selectedId,
    setTool, setColor, setStroke, setFontSize, setOpacity,
    add, update, remove, setAll, undo, redo, select } = useAnnotStore();

  // Load file metadata + restore saved + import existing
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // SHA-1 the bytes directly (we may not have a File object)
      const digest = await crypto.subtle.digest("SHA-1", bytes.slice().buffer as ArrayBuffer);
      const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (cancelled) return;
      setFileHash(hash);

      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const metas: PageMeta[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        metas.push({ width: vp.width, height: vp.height });
      }
      if (cancelled) return;
      setPageMetas(metas);

      const [saved, imported] = await Promise.all([
        loadAnnots(hash),
        importNativeAnnots(bytes),
      ]);
      if (cancelled) return;
      const initial = saved && saved.length ? saved : imported;
      setAll(initial);
    })();
    return () => { cancelled = true; };
  }, [bytes, setAll]);


  // Autosave
  useEffect(() => {
    if (!fileHash) return;
    const t = setTimeout(() => saveAnnots(fileHash, annots), 400);
    return () => clearTimeout(t);
  }, [annots, fileHash]);

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (cmd && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (cmd && e.key.toLowerCase() === "f") { e.preventDefault(); setSearchOpen(true); return; }
      if (e.key === "Escape") { select(null); setSearchOpen(false); setTool("select"); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) { e.preventDefault(); remove(selectedId); }
        return;
      }
      const k = e.key.toLowerCase();
      const map: Record<string, AnnotTool> = {
        v: "select", h: "highlight", u: "underline", s: "strikethrough",
        n: "note", d: "freehand", r: "rect", e: "ellipse",
        l: "line", a: "arrow", t: "text",
      };
      if (map[k]) { setTool(map[k]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, remove, select, setTool, selectedId]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const jumpTo = useCallback((page: number) => {
    setCurrentPage(page);
    pageRefs.current[page]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Track current page on scroll
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.scrollTop;
      let best = 0, bestDist = Infinity;
      pageRefs.current.forEach((p, i) => {
        if (!p) return;
        const dist = Math.abs(p.offsetTop - top);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setCurrentPage(best);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [pageMetas]);

  // Search
  const runSearch = useCallback(async () => {
    if (!bytes || !searchQuery.trim()) { setSearchHits([]); return; }
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const q = searchQuery.toLowerCase();
    const hits: { page: number; rects: { x: number; y: number; w: number; h: number }[] }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      const tc = await p.getTextContent();
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      for (const item of tc.items as any[]) {
        const s = (item.str as string).toLowerCase();
        const idx = s.indexOf(q);
        if (idx === -1) continue;
        const tx = pdfjs.Util.transform(vp.transform, item.transform);
        const x = tx[4] + (item.width * (idx / Math.max(1, s.length))) * 0;
        const y = tx[5] - item.height;
        rects.push({ x, y, w: item.width, h: item.height });
      }
      if (rects.length) hits.push({ page: i - 1, rects });
    }
    setSearchHits(hits);
    if (hits.length) jumpTo(hits[0].page);
  }, [bytes, searchQuery, jumpTo]);

  // Export
  const handleExport = useCallback(async (mode: "flatten" | "native" | "both") => {
    if (!bytes || !file) return;
    try {
      const out = await exportAnnotatedPdf(bytes, annots, { mode });
      const blob = new Blob([out as unknown as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = file.name.replace(/\.pdf$/i, "") + "-annotated.pdf";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported", { description: mode === "flatten" ? "Annotations burned in." : mode === "native" ? "Native PDF annotations." : "Native + flattened." });
    } catch (err) {
      toast.error("Export failed", { description: String(err) });
    }
  }, [bytes, file, annots]);

  const handleExportComments = useCallback(() => {
    if (!file) return;
    const json = exportCommentsJson(annots, file.name);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = file.name.replace(/\.pdf$/i, "") + "-comments.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [annots, file]);

  // ----- empty state -----
  if (!file || !bytes) {
    return (
      <AppShell>
        <div className="p-6 md:p-10 max-w-3xl mx-auto">
          <div className="mb-6">
            <h1 className="font-display text-3xl tracking-tight">Annotate PDF</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Highlight, underline, draw, comment, stamp. Real PDF annotations that open
              correctly in Acrobat, Preview, and any other reader. Files never leave this tab.
            </p>
          </div>
          <FileDropzone
            accept="application/pdf"
            onFile={onFile}
            label="Drop a PDF to start annotating"
            sublabel="or click to browse"
          />
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
            <ShortcutHint k="V">Select</ShortcutHint>
            <ShortcutHint k="H">Highlight</ShortcutHint>
            <ShortcutHint k="U">Underline</ShortcutHint>
            <ShortcutHint k="S">Strikethrough</ShortcutHint>
            <ShortcutHint k="N">Sticky note</ShortcutHint>
            <ShortcutHint k="D">Draw</ShortcutHint>
            <ShortcutHint k="R">Rectangle</ShortcutHint>
            <ShortcutHint k="A">Arrow</ShortcutHint>
            <ShortcutHint k="T">Text box</ShortcutHint>
            <ShortcutHint k="⌘Z">Undo</ShortcutHint>
            <ShortcutHint k="⇧⌘Z">Redo</ShortcutHint>
            <ShortcutHint k="⌘F">Search</ShortcutHint>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TooltipProvider delayDuration={300}>
        <div className="flex flex-col h-svh">
          {/* Toolbar */}
          <div className="flex items-center gap-1 px-3 py-2 border-b bg-card">
            <div className="text-sm font-medium truncate max-w-[200px]" title={file.name}>{file.name}</div>
            <span className="text-xs text-muted-foreground ml-1">{pageMetas.length} pages</span>
            <div className="h-5 w-px bg-border mx-2" />
            <ToolBtn icon={MousePointer2} label="Select (V)" active={tool === "select"} onClick={() => setTool("select")} />
            <div className="h-5 w-px bg-border mx-1" />
            <ToolBtn icon={Highlighter} label="Highlight (H)" active={tool === "highlight"} onClick={() => setTool("highlight")} />
            <ToolBtn icon={UnderlineIcon} label="Underline (U)" active={tool === "underline"} onClick={() => setTool("underline")} />
            <ToolBtn icon={Strikethrough} label="Strikethrough (S)" active={tool === "strikethrough"} onClick={() => setTool("strikethrough")} />
            <div className="h-5 w-px bg-border mx-1" />
            <ToolBtn icon={StickyNote} label="Note (N)" active={tool === "note"} onClick={() => setTool("note")} />
            <ToolBtn icon={Type} label="Text box (T)" active={tool === "text"} onClick={() => setTool("text")} />
            <ToolBtn icon={Pen} label="Draw (D)" active={tool === "freehand"} onClick={() => setTool("freehand")} />
            <div className="h-5 w-px bg-border mx-1" />
            <ToolBtn icon={Square} label="Rectangle (R)" active={tool === "rect"} onClick={() => setTool("rect")} />
            <ToolBtn icon={Circle} label="Ellipse (E)" active={tool === "ellipse"} onClick={() => setTool("ellipse")} />
            <ToolBtn icon={Minus} label="Line (L)" active={tool === "line"} onClick={() => setTool("line")} />
            <ToolBtn icon={ArrowRight} label="Arrow (A)" active={tool === "arrow"} onClick={() => setTool("arrow")} />

            <div className="h-5 w-px bg-border mx-2" />
            {/* Color */}
            <div className="flex items-center gap-1">
              {PRESET_COLORS.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setColor(c)}
                  className={cn("h-5 w-5 rounded-full border-2 transition-transform",
                    rgbApprox(c, color) ? "border-foreground scale-110" : "border-transparent hover:scale-110")}
                  style={{ background: rgbToCss(c, 1) }}
                  aria-label="color"
                />
              ))}
            </div>

            <div className="h-5 w-px bg-border mx-2" />
            {/* Stroke */}
            {(["freehand", "rect", "ellipse", "line", "arrow"].includes(tool)) && (
              <div className="flex items-center gap-2 w-28">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">W</span>
                <Slider value={[stroke]} min={1} max={12} step={1} onValueChange={([v]) => setStroke(v)} />
                <span className="text-xs tabular-nums w-3">{stroke}</span>
              </div>
            )}
            {tool === "text" && (
              <div className="flex items-center gap-2 w-28">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Size</span>
                <Slider value={[fontSize]} min={8} max={48} step={1} onValueChange={([v]) => setFontSize(v)} />
                <span className="text-xs tabular-nums w-5">{fontSize}</span>
              </div>
            )}
            {["highlight", "underline", "strikethrough"].includes(tool) && (
              <div className="flex items-center gap-2 w-28">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Op</span>
                <Slider value={[opacity * 100]} min={20} max={100} step={5} onValueChange={([v]) => setOpacity(v / 100)} />
                <span className="text-xs tabular-nums w-7">{Math.round(opacity * 100)}%</span>
              </div>
            )}

            <div className="ml-auto flex items-center gap-1">
              <ToolBtn icon={Undo2} label="Undo (⌘Z)" onClick={undo} />
              <ToolBtn icon={Redo2} label="Redo (⇧⌘Z)" onClick={redo} />
              <div className="h-5 w-px bg-border mx-1" />
              <ToolBtn icon={Search} label="Search (⌘F)" active={searchOpen} onClick={() => setSearchOpen((s) => !s)} />
              <ToolBtn icon={MessageSquare} label="Comments" active={showComments} onClick={() => setShowComments((s) => !s)} />
              <ToolBtn icon={ImageIcon} label="Thumbnails" active={showThumbs} onClick={() => setShowThumbs((s) => !s)} />
              <div className="h-5 w-px bg-border mx-1" />
              <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}><ZoomOut className="h-4 w-4" /></Button>
              <span className="text-xs tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
              <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}><ZoomIn className="h-4 w-4" /></Button>
              <div className="h-5 w-px bg-border mx-1" />
              <Button size="sm" onClick={() => handleExport("both")}>
                <Download className="h-4 w-4 mr-1.5" /> Export
              </Button>
            </div>
          </div>

          {/* Search bar */}
          {searchOpen && (
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Find in document…"
                className="h-8 max-w-sm"
              />
              <Button size="sm" variant="secondary" onClick={runSearch}>Search</Button>
              <span className="text-xs text-muted-foreground">
                {searchHits.length ? `${searchHits.reduce((n, h) => n + h.rects.length, 0)} matches in ${searchHits.length} pages` : ""}
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setSearchOpen(false); setSearchHits([]); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 flex min-h-0">
            {showThumbs && (
              <Thumbnails
                bytes={bytes}
                metas={pageMetas}
                current={currentPage}
                onJump={jumpTo}
                annots={annots}
              />
            )}

            <div ref={scrollerRef} className="flex-1 overflow-auto bg-muted/40">
              <div className="flex flex-col items-center gap-6 py-6">
                {pageMetas.map((meta, i) => (
                  <div
                    key={i}
                    ref={(el) => { pageRefs.current[i] = el; }}
                    data-page={i}
                  >
                    <PdfPage
                      bytes={bytes}
                      pageIndex={i}
                      meta={meta}
                      zoom={zoom}
                      tool={tool}
                      color={color}
                      stroke={stroke}
                      fontSize={fontSize}
                      opacity={opacity}
                      annots={annots.filter((a) => a.page === i)}
                      selectedId={selectedId}
                      searchHits={searchHits.find((h) => h.page === i)?.rects ?? []}
                      onAdd={add}
                      onUpdate={update}
                      onSelect={select}
                    />
                  </div>
                ))}
              </div>
            </div>

            {showComments && (
              <CommentsSidebar
                annots={annots}
                onJump={(a) => { jumpTo(a.page); select(a.id); }}
                onUpdate={update}
                onDelete={remove}
                onExportComments={handleExportComments}
                selectedId={selectedId}
              />
            )}
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t bg-card text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => jumpTo(Math.max(0, currentPage - 1))}><ChevronLeft className="h-3 w-3" /></Button>
              <span>Page {currentPage + 1} / {pageMetas.length}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => jumpTo(Math.min(pageMetas.length - 1, currentPage + 1))}><ChevronRight className="h-3 w-3" /></Button>
            </div>
            <div className="flex items-center gap-3">
              <span>{annots.length} annotation{annots.length === 1 ? "" : "s"}</span>
              <span className="opacity-70">Autosaved · {fileHash?.slice(0, 8)}</span>
            </div>
          </div>
        </div>
      </TooltipProvider>
    </AppShell>
  );
}

// =====================================================================

function ToolBtn({ icon: Icon, label, active, onClick }: { icon: any; label: string; active?: boolean; onClick: () => void; }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "h-8 w-8 grid place-items-center rounded-md transition-colors",
            active ? "bg-vault/15 text-vault" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ShortcutHint({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-card/50">
      <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border">{k}</kbd>
      <span>{children}</span>
    </div>
  );
}

function rgbApprox(a: RGB, b: RGB) {
  return Math.abs(a.r - b.r) < 0.01 && Math.abs(a.g - b.g) < 0.01 && Math.abs(a.b - b.b) < 0.01;
}

// =====================================================================
// Page renderer with pdf.js + annotation layer
// =====================================================================

function PdfPage(props: {
  bytes: Uint8Array;
  pageIndex: number;
  meta: PageMeta;
  zoom: number;
  tool: AnnotTool;
  color: RGB;
  stroke: number;
  fontSize: number;
  opacity: number;
  annots: Annot[];
  selectedId: string | null;
  searchHits: { x: number; y: number; w: number; h: number }[];
  onAdd: (a: Annot) => void;
  onUpdate: (id: string, p: Partial<Annot>) => void;
  onSelect: (id: string | null) => void;
}) {
  const { bytes, pageIndex, meta, zoom, tool, color, stroke, fontSize, opacity,
    annots, selectedId, searchHits, onAdd, onUpdate, onSelect } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [draftInk, setDraftInk] = useState<{ x: number; y: number }[][]>([]);
  const [dragShape, setDragShape] = useState<{ kind: AnnotTool; x1: number; y1: number; x2: number; y2: number } | null>(null);

  // Render PDF page
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      if (cancelled) return;
      const page = await doc.getPage(pageIndex + 1);
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: zoom * dpr });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = `${vp.width / dpr}px`;
      canvas.style.height = `${vp.height / dpr}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;

      // text layer for selection-based highlighting
      const tl = textLayerRef.current;
      if (tl) {
        tl.innerHTML = "";
        const vp1 = page.getViewport({ scale: zoom });
        tl.style.width = `${vp1.width}px`;
        tl.style.height = `${vp1.height}px`;
        const tc = await page.getTextContent();
        for (const item of tc.items as any[]) {
          if (!item.str) continue;
          const tx = pdfjs.Util.transform(vp1.transform, item.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]);
          const span = document.createElement("span");
          span.textContent = item.str;
          span.style.position = "absolute";
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - fontHeight}px`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.fontFamily = item.fontName || "sans-serif";
          span.style.color = "transparent";
          span.style.whiteSpace = "pre";
          span.style.transformOrigin = "0% 0%";
          // approximate width to match
          const measuredW = item.width || 0;
          if (measuredW > 0) {
            span.style.transform = `scaleX(${measuredW * zoom / (span.getBoundingClientRect().width || measuredW)})`;
          }
          tl.appendChild(span);
        }
      }
      setRendered(true);
    })();
    return () => { cancelled = true; };
  }, [bytes, pageIndex, zoom]);

  const pw = meta.width * zoom;
  const ph = meta.height * zoom;

  // Convert client coords → PDF points (top-left origin, page-local)
  const toPdf = useCallback((clientX: number, clientY: number) => {
    const el = overlayRef.current!;
    const r = el.getBoundingClientRect();
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
  }, [zoom]);

  // ----- handlers per tool -----
  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "select") return; // select handled per-annotation
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toPdf(e.clientX, e.clientY);

    if (tool === "note") {
      onAdd({
        id: uid(), kind: "note", page: pageIndex,
        color, opacity: 1, createdAt: Date.now(),
        x, y, w: 18, h: 18,
        contents: "",
      });
      return;
    }
    if (tool === "text") {
      onAdd({
        id: uid(), kind: "text", page: pageIndex,
        color, opacity: 1, createdAt: Date.now(),
        x, y, w: 180, h: fontSize * 2.5,
        text: "Type here…", fontSize,
      });
      return;
    }
    if (tool === "freehand") {
      setDraftInk([[{ x, y }]]);
      return;
    }
    if (["rect", "ellipse", "line", "arrow"].includes(tool)) {
      setDragShape({ kind: tool, x1: x, y1: y, x2: x, y2: y });
      return;
    }
    // highlight/underline/strikethrough: rely on text selection — see onMouseUp
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (draftInk.length && tool === "freehand") {
      const { x, y } = toPdf(e.clientX, e.clientY);
      setDraftInk((prev) => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), [...last, { x, y }]];
      });
    }
    if (dragShape) {
      const { x, y } = toPdf(e.clientX, e.clientY);
      setDragShape({ ...dragShape, x2: x, y2: y });
    }
  };

  const onPointerUp = (_e: React.PointerEvent) => {
    if (draftInk.length && tool === "freehand") {
      const allPts = draftInk.flat();
      if (allPts.length > 1) {
        const xs = allPts.map((p) => p.x), ys = allPts.map((p) => p.y);
        onAdd({
          id: uid(), kind: "ink", page: pageIndex,
          color, opacity: 1, createdAt: Date.now(),
          strokes: draftInk, stroke,
          bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
        } as InkAnnot);
      }
      setDraftInk([]);
    }
    if (dragShape) {
      const { kind, x1, y1, x2, y2 } = dragShape;
      const x = Math.min(x1, x2), y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      if (kind === "line" || kind === "arrow") {
        if (Math.hypot(x2 - x1, y2 - y1) > 4) {
          onAdd({
            id: uid(), kind, page: pageIndex, color, opacity: 1, createdAt: Date.now(),
            x1, y1, x2, y2, stroke,
          } as Annot);
        }
      } else if (w > 4 && h > 4) {
        onAdd({
          id: uid(), kind, page: pageIndex, color, opacity, createdAt: Date.now(),
          x, y, w, h, stroke, fill: false,
        } as Annot);
      }
      setDragShape(null);
    }
  };

  // Text-aware highlight via selection
  const handleTextSelect = useCallback(() => {
    if (!["highlight", "underline", "strikethrough"].includes(tool)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const tl = textLayerRef.current;
    if (!tl) return;
    const range = sel.getRangeAt(0);
    if (!tl.contains(range.startContainer) || !tl.contains(range.endContainer)) return;
    const rects = Array.from(range.getClientRects());
    const overlayRect = overlayRef.current!.getBoundingClientRect();
    const merged: { x: number; y: number; w: number; h: number }[] = [];
    for (const r of rects) {
      if (r.width < 1 || r.height < 1) continue;
      merged.push({
        x: (r.left - overlayRect.left) / zoom,
        y: (r.top - overlayRect.top) / zoom,
        w: r.width / zoom,
        h: r.height / zoom,
      });
    }
    if (!merged.length) return;
    const text = sel.toString();
    onAdd({
      id: uid(), kind: tool as QuadAnnot["kind"], page: pageIndex,
      color, opacity, createdAt: Date.now(),
      rects: merged, selectedText: text,
    });
    sel.removeAllRanges();
  }, [tool, color, opacity, zoom, pageIndex, onAdd]);

  const cursorClass = tool === "select" ? "cursor-default"
    : tool === "freehand" ? "cursor-crosshair"
    : tool === "note" || tool === "text" ? "cursor-text"
    : ["highlight", "underline", "strikethrough"].includes(tool) ? "cursor-text"
    : "cursor-crosshair";

  // Render perfect-freehand draft as SVG path
  const draftPath = useMemo(() => {
    if (!draftInk.length) return "";
    return draftInk.map((stroke) => {
      const pts = getStroke(stroke.map((p) => [p.x * zoom, p.y * zoom]), {
        size: stroke.length > 0 ? props.stroke * 2 * zoom : 4,
        thinning: 0.5, smoothing: 0.5, streamline: 0.5,
      });
      if (!pts.length) return "";
      const d = pts.reduce((acc, [px, py], i) => acc + (i === 0 ? `M${px},${py}` : `L${px},${py}`), "");
      return d + "Z";
    }).join(" ");
  }, [draftInk, zoom, props.stroke]);

  return (
    <div
      className="bg-white shadow-lg ring-1 ring-black/5 relative"
      style={{ width: pw, height: ph }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div
        ref={textLayerRef}
        className={cn("absolute inset-0 overflow-hidden",
          ["highlight", "underline", "strikethrough"].includes(tool) ? "" : "pointer-events-none select-none")}
        onMouseUp={handleTextSelect}
        style={{ userSelect: ["highlight", "underline", "strikethrough"].includes(tool) ? "text" : "none" }}
      />

      <div
        ref={overlayRef}
        className={cn("absolute inset-0", cursorClass,
          tool === "select" ? "pointer-events-none" : "")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* search hits */}
        {searchHits.map((r, i) => (
          <div key={"s" + i} className="absolute bg-yellow-300/60 ring-1 ring-yellow-500/50 pointer-events-none"
            style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }} />
        ))}

        {/* rendered annotations */}
        {rendered && annots.map((a) => (
          <AnnotView key={a.id} a={a} zoom={zoom} selected={selectedId === a.id}
            onSelect={() => onSelect(a.id)}
            onUpdate={(p) => onUpdate(a.id, p)}
            interactive={tool === "select"}
          />
        ))}

        {/* draft shape */}
        {dragShape && (
          <DraftShape
            kind={dragShape.kind}
            x1={dragShape.x1 * zoom} y1={dragShape.y1 * zoom}
            x2={dragShape.x2 * zoom} y2={dragShape.y2 * zoom}
            color={color} stroke={stroke} opacity={opacity}
          />
        )}

        {/* draft ink */}
        {draftPath && (
          <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
            <path d={draftPath} fill={rgbToCss(color, 1)} />
          </svg>
        )}
      </div>
    </div>
  );
}

function DraftShape({ kind, x1, y1, x2, y2, color, stroke, opacity }:
  { kind: AnnotTool; x1: number; y1: number; x2: number; y2: number; color: RGB; stroke: number; opacity: number; }) {
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  if (kind === "line" || kind === "arrow") {
    return (
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={rgbToCss(color, 1)} strokeWidth={stroke} />
        {kind === "arrow" && (() => {
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const len = 10 + stroke * 2;
          const sp = Math.PI / 7;
          const lx = x2 - len * Math.cos(ang - sp);
          const ly = y2 - len * Math.sin(ang - sp);
          const rx = x2 - len * Math.cos(ang + sp);
          const ry = y2 - len * Math.sin(ang + sp);
          return (
            <>
              <line x1={x2} y1={y2} x2={lx} y2={ly} stroke={rgbToCss(color, 1)} strokeWidth={stroke} />
              <line x1={x2} y1={y2} x2={rx} y2={ry} stroke={rgbToCss(color, 1)} strokeWidth={stroke} />
            </>
          );
        })()}
      </svg>
    );
  }
  return (
    <div className="absolute pointer-events-none"
      style={{
        left: x, top: y, width: w, height: h,
        border: `${stroke}px solid ${rgbToCss(color, 1)}`,
        background: "transparent",
        borderRadius: kind === "ellipse" ? "50%" : 0,
        opacity,
      }} />
  );
}

// =====================================================================
// Annotation views (display + interaction in select mode)
// =====================================================================

function AnnotView({ a, zoom, selected, onSelect, onUpdate, interactive }:
  { a: Annot; zoom: number; selected: boolean; onSelect: () => void; onUpdate: (p: Partial<Annot>) => void; interactive: boolean; }) {

  const wrapCls = cn(
    "absolute",
    interactive ? "pointer-events-auto" : "pointer-events-none",
    selected ? "outline outline-2 outline-vault outline-offset-2" : "",
  );

  // drag-to-move for box-like annotations
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const onDragStart = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect();
    if (!("x" in a)) return;
    const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !("x" in a)) return;
    const parent = (e.currentTarget as HTMLDivElement).parentElement!.getBoundingClientRect();
    const nx = (e.clientX - parent.left - dragRef.current.dx) / zoom;
    const ny = (e.clientY - parent.top - dragRef.current.dy) / zoom;
    onUpdate({ x: nx, y: ny } as Partial<Annot>);
  };
  const onDragEnd = () => { dragRef.current = null; };

  if (a.kind === "highlight" || a.kind === "underline" || a.kind === "strikethrough") {
    return (
      <>
        {a.rects.map((r, i) => (
          <div
            key={i}
            onPointerDown={interactive ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
            className={cn("absolute", interactive ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
              selected ? "outline outline-1 outline-vault" : "")}
            style={{
              left: r.x * zoom,
              top: a.kind === "highlight" ? r.y * zoom
                : a.kind === "underline" ? (r.y + r.h - r.h * 0.1) * zoom
                : (r.y + r.h / 2 - r.h * 0.05) * zoom,
              width: r.w * zoom,
              height: a.kind === "highlight" ? r.h * zoom : Math.max(1, r.h * 0.12) * zoom,
              background: rgbToCss(a.color, a.opacity),
            }}
          />
        ))}
      </>
    );
  }

  if (a.kind === "rect" || a.kind === "ellipse") {
    return (
      <div className={wrapCls}
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        style={{
          left: a.x * zoom, top: a.y * zoom, width: a.w * zoom, height: a.h * zoom,
          border: `${a.stroke}px solid ${rgbToCss(a.color, 1)}`,
          borderRadius: a.kind === "ellipse" ? "50%" : 0,
          background: a.fill ? rgbToCss(a.color, a.opacity) : "transparent",
        }} />
    );
  }

  if (a.kind === "line" || a.kind === "arrow") {
    const minX = Math.min(a.x1, a.x2) - 5, minY = Math.min(a.y1, a.y2) - 5;
    const w = Math.abs(a.x2 - a.x1) + 10, h = Math.abs(a.y2 - a.y1) + 10;
    return (
      <svg className={cn("absolute", interactive ? "pointer-events-auto" : "pointer-events-none")}
        onPointerDown={interactive ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
        style={{ left: minX * zoom, top: minY * zoom, width: w * zoom, height: h * zoom, overflow: "visible" }}>
        <line
          x1={(a.x1 - minX) * zoom} y1={(a.y1 - minY) * zoom}
          x2={(a.x2 - minX) * zoom} y2={(a.y2 - minY) * zoom}
          stroke={rgbToCss(a.color, 1)} strokeWidth={a.stroke * zoom}
        />
        {a.kind === "arrow" && (() => {
          const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
          const len = (10 + a.stroke * 2);
          const sp = Math.PI / 7;
          const tx = (a.x2 - minX) * zoom, ty = (a.y2 - minY) * zoom;
          return (
            <>
              <line x1={tx} y1={ty} x2={tx - len * Math.cos(ang - sp) * zoom} y2={ty - len * Math.sin(ang - sp) * zoom} stroke={rgbToCss(a.color, 1)} strokeWidth={a.stroke * zoom} />
              <line x1={tx} y1={ty} x2={tx - len * Math.cos(ang + sp) * zoom} y2={ty - len * Math.sin(ang + sp) * zoom} stroke={rgbToCss(a.color, 1)} strokeWidth={a.stroke * zoom} />
            </>
          );
        })()}
      </svg>
    );
  }

  if (a.kind === "ink") {
    const path = a.strokes.map((s) => {
      const pts = getStroke(s.map((p) => [p.x * zoom, p.y * zoom]), {
        size: a.stroke * 2 * zoom, thinning: 0.5, smoothing: 0.5, streamline: 0.5,
      });
      if (!pts.length) return "";
      return pts.reduce((acc, [px, py], i) => acc + (i === 0 ? `M${px},${py}` : `L${px},${py}`), "") + "Z";
    }).join(" ");
    return (
      <svg className={cn("absolute inset-0", interactive ? "pointer-events-auto" : "pointer-events-none")}
        onPointerDown={interactive ? (e) => { e.stopPropagation(); onSelect(); } : undefined}>
        <path d={path} fill={rgbToCss(a.color, 1)} style={{ outline: selected ? "1px solid currentColor" : undefined }} />
      </svg>
    );
  }

  if (a.kind === "note") {
    return (
      <div className={wrapCls + " group"}
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        style={{ left: a.x * zoom, top: a.y * zoom, width: 22 * zoom, height: 22 * zoom }}>
        <div className="w-full h-full rounded-sm shadow-md flex items-center justify-center text-[10px]"
          style={{ background: rgbToCss(a.color, 1) }}>
          <StickyNote className="h-3 w-3 text-black/60" />
        </div>
      </div>
    );
  }

  if (a.kind === "text") {
    return (
      <div className={wrapCls}
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        style={{ left: a.x * zoom, top: a.y * zoom, width: a.w * zoom, height: a.h * zoom }}>
        <textarea
          defaultValue={a.text}
          onChange={(e) => onUpdate({ text: e.target.value } as Partial<Annot>)}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full h-full resize-none bg-transparent border border-dashed border-black/20 px-1 outline-none"
          style={{ fontSize: a.fontSize * zoom, color: rgbToCss(a.color, 1), lineHeight: 1.25 }}
        />
      </div>
    );
  }

  return null;
}

// =====================================================================
// Thumbnails sidebar
// =====================================================================

function Thumbnails({ bytes, metas, current, onJump, annots }:
  { bytes: Uint8Array; metas: PageMeta[]; current: number; onJump: (i: number) => void; annots: Annot[]; }) {
  const [thumbs, setThumbs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const out: string[] = [];
      const TARGET = 130;
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = TARGET / vp1.width;
        const vp = page.getViewport({ scale });
        const c = document.createElement("canvas");
        c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
        out.push(c.toDataURL("image/jpeg", 0.7));
        setThumbs([...out]);
      }
    })();
    return () => { cancelled = true; };
  }, [bytes]);

  return (
    <div className="w-44 shrink-0 border-r bg-card overflow-y-auto p-2 space-y-2">
      {metas.map((_, i) => {
        const count = annots.filter((a) => a.page === i).length;
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            className={cn("block w-full p-1 rounded border-2 transition-colors text-left",
              current === i ? "border-vault" : "border-transparent hover:border-border")}
          >
            {thumbs[i] ? (
              <img src={thumbs[i]} alt="" className="w-full rounded shadow-sm" />
            ) : (
              <div className="w-full aspect-[1/1.4] bg-muted animate-pulse rounded" />
            )}
            <div className="flex items-center justify-between mt-1 px-0.5">
              <span className="text-[10px] text-muted-foreground">Page {i + 1}</span>
              {count > 0 && (
                <span className="text-[10px] px-1.5 rounded-full bg-vault/15 text-vault">{count}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================
// Comments sidebar
// =====================================================================

function CommentsSidebar({ annots, onJump, onUpdate, onDelete, onExportComments, selectedId }:
  { annots: Annot[]; onJump: (a: Annot) => void; onUpdate: (id: string, p: Partial<Annot>) => void;
    onDelete: (id: string) => void; onExportComments: () => void; selectedId: string | null; }) {
  return (
    <div className="w-80 shrink-0 border-l bg-card flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="font-medium text-sm">Comments</div>
        <Button size="sm" variant="ghost" onClick={onExportComments} disabled={!annots.length}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {annots.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-50" />
            No annotations yet. Pick a tool from the toolbar to begin.
          </div>
        ) : (
          <ul className="divide-y">
            {annots.map((a) => (
              <li key={a.id}
                className={cn("p-3 hover:bg-accent/40 cursor-pointer", selectedId === a.id && "bg-vault/5")}
                onClick={() => onJump(a)}>
                <div className="flex items-start gap-2">
                  <div className="h-3 w-3 rounded-sm mt-1 shrink-0" style={{ background: rgbToCss(a.color, 1) }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium capitalize">{a.kind} · p.{a.page + 1}</div>
                    {"selectedText" in a && a.selectedText && (
                      <div className="text-xs text-muted-foreground italic line-clamp-2 mt-0.5">"{a.selectedText}"</div>
                    )}
                    {"text" in a && a.text && a.kind === "text" && (
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{a.text}</div>
                    )}
                    <Textarea
                      placeholder="Add a comment…"
                      defaultValue={a.contents ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => onUpdate(a.id, { contents: e.target.value } as Partial<Annot>)}
                      className="mt-1.5 text-xs min-h-[40px]"
                    />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(a.id); }}
                    className="text-muted-foreground hover:text-destructive p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
