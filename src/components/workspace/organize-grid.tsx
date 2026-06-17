/**
 * Organize canvas surface — virtualized page-thumbnail grid with
 * drag-reorder. Built for 400+ page documents: only rows in/near the
 * viewport mount, thumbnails render lazily per-cell, and the inspector
 * can scroll-to-index via the organize-store `requestJump` signal.
 *
 * Reuses the extracted renderPageThumb (src/lib/pdf/organize.ts). The
 * right inspector (OrganizePanel) drives all actions; this surface
 * only handles select / drag / click / scroll.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GripVertical, FilePlus2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { densityToGridColumns, useOrganize } from "@/lib/workspace/organize-store";
import { openPdfjsDoc, renderPageThumb } from "@/lib/pdf/organize";
import type { PageCell } from "@/lib/pdf/organize";

const HOVER_DELAY_MS = 200;
const PREVIEW_W = 520;
const PREVIEW_CACHE_MAX = 24;
const PREVIEW_OFFSET = 20;

type HoverState = {
  cellId: string;
  source: string;
  pageIndex: number;
  rotation: number;
  fileName: string;
  rect: { left: number; right: number; top: number; bottom: number };
};

type PdfDoc = Awaited<ReturnType<typeof openPdfjsDoc>>;

const GAP = 12; // gap-3
const PAD_X = 20; // px-5
const PAD_Y = 24; // py-6
const LABEL_H = 26; // footer row inside each tile
const HEADER_H = 28; // top counts row

/** Density maps directly to column count: 0 = big/few, 1 = small/many.
 *  Thumbnail width = (available width − gaps) / cols, so fewer cols
 *  = larger thumbnails. No fixed cap — tiles always fill the row. */

export function OrganizeGrid({
  activeTabId,
  activeFile,
  onOpenFile,
}: {
  activeTabId: string;
  activeFile: File | null;
  onOpenFile?: () => void;
}) {
  const cells = useOrganize((s) => s.cells);
  const selected = useOrganize((s) => s.selected);
  const dragId = useOrganize((s) => s.dragId);
  const seededFor = useOrganize((s) => s.seededFor);
  const sources = useOrganize((s) => s.sources);
  const jumpIdx = useOrganize((s) => s.jumpIdx);
  const jumpTick = useOrganize((s) => s.jumpTick);

  const seedFromActiveFile = useOrganize((s) => s.seedFromActiveFile);
  const reset = useOrganize((s) => s.reset);
  const toggleSelect = useOrganize((s) => s.toggleSelect);
  const setDragId = useOrganize((s) => s.setDragId);
  const moveTo = useOrganize((s) => s.moveTo);
  const setThumb = useOrganize((s) => s.setThumb);
  const colorFor = useOrganize((s) => s.colorFor);
  const addLocalFiles = useOrganize((s) => s.addLocalFiles);

  const [fileDropHot, setFileDropHot] = useState(false);

  const [seeding, setSeeding] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ cellId: string; side: "before" | "after" } | null>(null);

  // Seed from the active tab's file when it changes.
  const fileKey = activeFile ? `${activeFile.name}:${activeFile.size}:${activeFile.lastModified}` : "";
  const seededKey = useRef<string>("");
  useEffect(() => {
    const key = `${activeTabId}::${fileKey}`;
    if (!activeFile) {
      if (seededFor !== null) reset();
      seededKey.current = "";
      return;
    }
    if (seededKey.current === key) return;
    seededKey.current = key;
    setSeeding(true);
    void seedFromActiveFile(activeTabId, activeFile).finally(() => setSeeding(false));
  }, [activeTabId, activeFile, fileKey, seedFromActiveFile, reset, seededFor]);

  // Per-source pdfjs doc cache. Cleared when sources identity changes
  // (e.g. seed / reset). Promises so concurrent cells share one open.
  const docCacheRef = useRef<Map<string, Promise<PdfDoc>>>(new Map());
  useEffect(() => {
    docCacheRef.current = new Map();
  }, [sources]);

  // --- Virtualized grid layout -------------------------------------------
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.floor(el.getBoundingClientRect().width || el.clientWidth || 0);
      setContainerW((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);

  const density = useOrganize((s) => s.density);
  const cols = useMemo(() => densityToGridColumns(density), [density]);
  const tileW = useMemo(() => {
    const usable = Math.max(0, containerW - PAD_X * 2 - GAP * (cols - 1));
    return Math.max(48, Math.floor(usable / cols));
  }, [containerW, cols]);
  // tile height = thumb area (3:4 aspect of width) + label + outer/label borders
  const TILE_BORDERS = 4;
  const tileH = Math.ceil(tileW * (4 / 3)) + LABEL_H + TILE_BORDERS;
  const rowH = tileH + GAP;
  const rowCount = Math.ceil(cells.length / cols);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 4,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Re-measure when row height changes (column count change etc.)
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowH, rowVirtualizer]);

  // Imperative jump-to-index from inspector.
  useEffect(() => {
    if (jumpIdx == null) return;
    if (rowCount === 0) return;
    const row = Math.min(rowCount - 1, Math.max(0, Math.floor(jumpIdx / cols)));
    rowVirtualizer.scrollToIndex(row, { align: "start" });
  }, [jumpTick, jumpIdx, cols, rowCount, rowVirtualizer]);

  // ---- Hover preview (magnifier) --------------------------------------
  const canHover = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches,
    [],
  );
  const [hover, setHover] = useState<HoverState | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const previewCacheRef = useRef<Map<string, string>>(new Map());
  const hoverTimerRef = useRef<number | null>(null);

  // Clear preview cache when sources change (file replaced / reset).
  useEffect(() => {
    previewCacheRef.current = new Map();
  }, [sources]);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const startHover = useCallback(
    (cell: PageCell, rect: DOMRect) => {
      if (!canHover) return;
      clearHoverTimer();
      const snap = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
      hoverTimerRef.current = window.setTimeout(() => {
        setHover({
          cellId: cell.cellId,
          source: cell.source,
          pageIndex: cell.pageIndex,
          rotation: cell.rotation,
          fileName: cell.fileName,
          rect: snap,
        });
      }, HOVER_DELAY_MS);
    },
    [canHover],
  );
  const endHover = useCallback(() => {
    clearHoverTimer();
    setHover(null);
    setPreviewSrc(null);
  }, []);
  // Cancel preview entirely on drag.
  useEffect(() => {
    if (dragId) endHover();
  }, [dragId, endHover]);
  useEffect(() => () => clearHoverTimer(), []);

  // Render the larger preview on-demand when hover target changes.
  const hoverKey = hover ? `${hover.source}::${hover.pageIndex}` : null;
  useEffect(() => {
    if (!hover || !hoverKey) {
      setPreviewSrc(null);
      return;
    }
    const cached = previewCacheRef.current.get(hoverKey);
    if (cached) {
      setPreviewSrc(cached);
      return;
    }
    setPreviewSrc(null);
    const bytes = sources[hover.source]?.bytes;
    if (!bytes) return;
    let cancelled = false;
    (async () => {
      try {
        let docPromise = docCacheRef.current.get(hover.source);
        if (!docPromise) {
          docPromise = openPdfjsDoc(bytes);
          docCacheRef.current.set(hover.source, docPromise);
        }
        const doc = await docPromise;
        if (cancelled) return;
        const page = await doc.getPage(hover.pageIndex + 1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, PREVIEW_W / (base.width || PREVIEW_W));
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, canvas } as never).promise;
        if (cancelled) return;
        const url = canvas.toDataURL("image/jpeg", 0.85);
        previewCacheRef.current.set(hoverKey, url);
        if (previewCacheRef.current.size > PREVIEW_CACHE_MAX) {
          const firstKey = previewCacheRef.current.keys().next().value;
          if (firstKey) previewCacheRef.current.delete(firstKey);
        }
        setPreviewSrc(url);
      } catch (err) {
        console.error("[organize-grid] hover preview failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hoverKey, hover, sources]);

  // Anchor popup to the hovered tile rect, inside the scroll-container's
  // bounds (so it never slides under the inspector / off-screen).
  const popupPos = useMemo(() => {
    if (!hover) return null;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const parent = parentRef.current?.getBoundingClientRect();
    const boundLeft = Math.max(8, parent?.left ?? 8);
    const boundRight = Math.min(vw - 8, parent?.right ?? vw - 8);
    const w = PREVIEW_W;
    const h = Math.min(Math.round(PREVIEW_W * (11 / 8.5)), vh - 32);

    const spaceRight = boundRight - hover.rect.right - PREVIEW_OFFSET;
    const spaceLeft = hover.rect.left - boundLeft - PREVIEW_OFFSET;
    let left: number;
    // Prefer whichever side fits; if neither fits, pick the larger side and clamp.
    if (spaceRight >= w) left = hover.rect.right + PREVIEW_OFFSET;
    else if (spaceLeft >= w) left = hover.rect.left - PREVIEW_OFFSET - w;
    else if (spaceRight >= spaceLeft) left = Math.max(boundLeft, boundRight - w);
    else left = boundLeft;

    const tileMidY = (hover.rect.top + hover.rect.bottom) / 2;
    let top = tileMidY - h / 2;
    if (top + h + 8 > vh) top = vh - h - 8;
    if (top < 8) top = 8;
    return { left, top, h };
  }, [hover]);

  if (!activeFile && cells.length === 0) {
    return (
      <div className="grid h-full place-items-center p-10">
        <div className="max-w-md space-y-4 text-center">
          <FilePlus2 className="mx-auto h-8 w-8 text-text-muted" />
          <div className="font-display text-xl text-foreground">Open a document to organize.</div>
          <p className="text-[12.5px] leading-snug text-text-2">
            Or pull in pages from another open document using the inspector on the right.
          </p>
          {onOpenFile && (
            <button
              type="button"
              onClick={onOpenFile}
              className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90"
            >
              <FilePlus2 className="h-3.5 w-3.5" /> Open PDF…
            </button>
          )}
        </div>
      </div>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={cn(
        "relative h-full overflow-auto transition-colors",
        fileDropHot && "bg-vault/5 ring-2 ring-inset ring-vault/50",
      )}
      style={{ contain: "strict" }}
      onDragEnter={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
          setFileDropHot(true);
        }
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFileDropHot(false);
        }
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        // Intercept BEFORE the workspace-shell global drop handler can
        // replace the active tab's file — Organize must APPEND, not replace.
        e.preventDefault();
        e.stopPropagation();
        setFileDropHot(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0) void addLocalFiles(files);
      }}
    >
      <div
        className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-border/40 bg-canvas/95 px-5 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted backdrop-blur"
        style={{ height: HEADER_H }}
      >
        <span>{cells.length} page{cells.length === 1 ? "" : "s"}</span>
        <span className="text-text-muted">·</span>
        <span className={selected.size > 0 ? "text-vault" : ""}>{selected.size} selected</span>
        <span className="text-text-muted">·</span>
        <span>{cols} cols</span>
        {seeding && <span className="ml-2 text-vault/70">rendering…</span>}
      </div>

      <div
        style={{
          position: "relative",
          height: rowVirtualizer.getTotalSize() + PAD_Y * 2,
          width: "100%",
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropTarget(null);
          }
        }}
      >
        {virtualRows.map((vRow) => {
          const start = vRow.index * cols;
          const rowCells = cells.slice(start, start + cols);
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vRow.start + PAD_Y}px)`,
                paddingLeft: PAD_X,
                paddingRight: PAD_X,
                paddingBottom: GAP,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                columnGap: GAP,
              }}
            >
              {rowCells.map((c, j) => (
                <CellTile
                  key={c.cellId}
                  cell={c}
                  indexInGrid={start + j}
                  isDragged={dragId === c.cellId}
                  isSelected={selected.has(c.cellId)}
                  dropSide={
                    dropTarget?.cellId === c.cellId ? dropTarget.side : null
                  }
                  color={colorFor(c.source)}
                  bytes={sources[c.source]?.bytes}
                  docCache={docCacheRef.current}
                  setThumb={setThumb}
                  onClick={(e) => toggleSelect(c.cellId, e.shiftKey)}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/x-vaultpdf-cell", c.cellId);
                    setDragId(c.cellId);
                  }}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    const side: "before" | "after" =
                      e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                    if (
                      !dropTarget ||
                      dropTarget.cellId !== c.cellId ||
                      dropTarget.side !== side
                    ) {
                      setDropTarget({ cellId: c.cellId, side });
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dropTarget) moveTo(dropTarget.cellId, dropTarget.side);
                    setDropTarget(null);
                    setDragId(null);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropTarget(null);
                  }}
                  onHoverStart={canHover ? (rect) => startHover(c, rect) : undefined}
                  onHoverEnd={canHover ? endHover : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>

      {hover && popupPos && (
        <div
          className="pointer-events-none fixed z-50 animate-fade-in"
          style={{ left: popupPos.left, top: popupPos.top, width: PREVIEW_W }}
          aria-hidden
        >
          <div className="overflow-hidden rounded-lg border border-border bg-surface-2 shadow-2xl ring-1 ring-black/10">
            <div
              className="grid w-full place-items-center bg-canvas/60"
              style={{ minHeight: Math.round(PREVIEW_W * 1.1) }}
            >
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt=""
                  style={{ transform: `rotate(${hover.rotation}deg)` }}
                  className="block h-auto w-full object-contain"
                />
              ) : (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-vault/40 border-t-vault" />
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 font-mono text-[10.5px] text-text-muted">
              <span className="truncate">{hover.fileName}</span>
              <span className="tabular-nums">Page {hover.pageIndex + 1}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function CellTile({
  cell,
  indexInGrid,
  isDragged,
  isSelected,
  dropSide,
  color,
  bytes,
  docCache,
  setThumb,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onHoverStart,
  onHoverEnd,
}: {
  cell: PageCell;
  indexInGrid: number;
  isDragged: boolean;
  isSelected: boolean;
  dropSide: "before" | "after" | null;
  color: string;
  bytes: Uint8Array | undefined;
  docCache: Map<string, Promise<PdfDoc>>;
  setThumb: (id: string, t: string) => void;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
}) {
  // Lazy thumb render — runs once per cell when mounted, only if missing.
  useEffect(() => {
    if (cell.thumb || !bytes) return;
    let cancelled = false;
    (async () => {
      try {
        let docPromise = docCache.get(cell.source);
        if (!docPromise) {
          docPromise = openPdfjsDoc(bytes);
          docCache.set(cell.source, docPromise);
        }
        const doc = await docPromise;
        if (cancelled) return;
        const thumb = await renderPageThumb(doc, cell.pageIndex);
        if (!cancelled && thumb) setThumb(cell.cellId, thumb);
      } catch (err) {
        console.error("[organize-grid] thumb render failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.cellId, cell.thumb, bytes]);

  return (
    <div className="relative min-w-0">

      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -left-1.5 top-0 bottom-0 w-[3px] rounded-full bg-vault transition-opacity",
          dropSide === "before" ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-1.5 top-0 bottom-0 w-[3px] rounded-full bg-vault transition-opacity",
          dropSide === "after" ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        draggable
        onDragStart={(e) => {
          onHoverEnd?.();
          onDragStart(e);
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={onClick}
        onMouseEnter={onHoverStart ? (e) => onHoverStart(e.currentTarget.getBoundingClientRect()) : undefined}
        onMouseLeave={onHoverEnd}
        className={cn(
          "group/cell relative cursor-pointer overflow-hidden rounded-md border bg-surface-2 transition-all",
          isSelected
            ? "border-vault ring-2 ring-vault/50"
            : "border-border hover:border-vault/40",
          isDragged && "opacity-40",
        )}
      >
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: color }}
        />
        <div className="grid aspect-[3/4] w-full place-items-center overflow-hidden bg-canvas/60">
          {cell.thumb ? (
            <img
              src={cell.thumb}
              alt={`Page ${cell.pageIndex + 1} of ${cell.fileName}`}
              style={{ transform: `rotate(${cell.rotation}deg)` }}
              className="h-full w-full object-contain transition-transform"
            />
          ) : (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-vault/40 border-t-vault" />
          )}
        </div>
        <div
          className="flex items-center justify-center border-t border-border/60 px-2 py-1.5 font-mono text-[10.5px]"
          style={{ height: LABEL_H }}
          title={`${cell.fileName} · page ${cell.pageIndex + 1} · position ${indexInGrid + 1}`}
        >
          <span className="tabular-nums text-text-muted">Page {indexInGrid + 1}</span>
        </div>

        <span className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/cell:opacity-100">
          <GripVertical className="h-3.5 w-3.5 text-text-muted" />
        </span>
      </div>
    </div>
  );
}
