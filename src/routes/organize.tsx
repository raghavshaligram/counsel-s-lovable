import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PDFDocument } from "pdf-lib";
import { Download, Trash2, RotateCw, GripVertical, FilePlus2 } from "lucide-react";
import { useTray, type TrayEntry } from "@/lib/tray/store";
import { getBytes } from "@/lib/tray/blobs";
import { loadPdfjs } from "@/lib/pdf/worker";
import { downloadBytes } from "@/lib/batch/runner";
import { cn } from "@/lib/utils";
import { ToolHeader } from "@/routes/split";


export const Route = createFileRoute("/organize")({
  head: () => ({
    meta: [
      { title: "Organize PDF Pages — Cross-Document Grid · CounselPDF" },
      { name: "description", content: "Drag pages between PDFs in a single grid. Reorder, rotate, delete, and combine into a new document. 100% on-device." },
      { property: "og:title", content: "Organize PDF Pages — in your browser" },
      { property: "og:description", content: "One canvas for all your PDFs — drag, rotate, group." },
    ],
    links: [{ rel: "canonical", href: "/organize" }],
  }),
  component: OrganizePage,
});

type PageCell = {
  /** Unique cell id (entryId + pageIndex + nonce so duplicates are allowed). */
  cellId: string;
  entryId: string;
  sha256: string;
  fileName: string;
  pageIndex: number;       // 0-based within source PDF
  rotation: 0 | 90 | 180 | 270;
  thumb?: string;          // dataURL preview
};

function OrganizePage() {
  const entries = useTray((s) => s.entries);
  const [cells, setCells] = useState<PageCell[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [thumbing, setThumbing] = useState(false);
  const [building, setBuilding] = useState(false);

  // Rebuild cell list whenever the tray set of (entry, pageCount) signatures changes.
  const signature = useMemo(
    () => entries.map((e) => `${e.id}:${e.pageCount}`).join("|"),
    [entries],
  );

  useEffect(() => {
    // Seed cells: one per page per entry, preserving any existing rotations
    // for matching cells.
    const existingByKey = new Map(cells.map((c) => [`${c.entryId}#${c.pageIndex}#${c.cellId.split("@")[1] ?? "0"}`, c]));
    const next: PageCell[] = [];
    let nonce = 0;
    for (const e of entries) {
      for (let i = 0; i < e.pageCount; i++) {
        const key = `${e.id}#${i}#0`;
        const prev = existingByKey.get(key);
        next.push(
          prev ?? {
            cellId: `${e.id}-${i}@${nonce++}`,
            entryId: e.id,
            sha256: e.sha256,
            fileName: e.name,
            pageIndex: i,
            rotation: 0,
          },
        );
      }
    }
    setCells(next);
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Generate thumbnails progressively for cells without one.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const missing = cells.filter((c) => !c.thumb);
      if (missing.length === 0) return;
      setThumbing(true);
      try {
        const pdfjs = await loadPdfjs();
        const byHash = new Map<string, Promise<any>>();
        for (const c of missing) {
          if (cancelled) break;
          if (!byHash.has(c.sha256)) {
            byHash.set(
              c.sha256,
              (async () => {
                const bytes = await getBytes(c.sha256);
                if (!bytes) return null;
                return pdfjs.getDocument({ data: bytes.slice(), enableXfa: true, useSystemFonts: true }).promise;
              })(),
            );
          }
          const doc = await byHash.get(c.sha256);
          if (!doc) continue;
          const page = await doc.getPage(c.pageIndex + 1);
          const viewport = page.getViewport({ scale: 0.3 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          const url = canvas.toDataURL("image/jpeg", 0.72);
          if (cancelled) return;
          setCells((prev) =>
            prev.map((x) => (x.cellId === c.cellId ? { ...x, thumb: url } : x)),
          );
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setThumbing(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [cells.length]); // re-run when set of cells grows/shrinks

  const toggleSelect = (cellId: string, e: React.MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && cells.length) {
        // range select from last selection to clicked
        const idxs = Array.from(next).map((id) => cells.findIndex((c) => c.cellId === id));
        const last = idxs.length ? Math.max(...idxs) : 0;
        const cur = cells.findIndex((c) => c.cellId === cellId);
        const [a, b] = [Math.min(last, cur), Math.max(last, cur)];
        for (let i = a; i <= b; i++) next.add(cells[i].cellId);
        return next;
      }
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      return next;
    });
  };

  const deleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    setCells((prev) => prev.filter((c) => !selected.has(c.cellId)));
    setSelected(new Set());
  }, [selected]);

  const rotateSelected = useCallback(() => {
    if (selected.size === 0) return;
    setCells((prev) =>
      prev.map((c) =>
        selected.has(c.cellId)
          ? { ...c, rotation: (((c.rotation + 90) % 360) as 0 | 90 | 180 | 270) }
          : c,
      ),
    );
  }, [selected]);

  const selectAll = () => setSelected(new Set(cells.map((c) => c.cellId)));
  const clearSelection = () => setSelected(new Set());

  const onDragStart = (cellId: string) => setDragId(cellId);
  const onDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    setCells((prev) => {
      const from = prev.findIndex((c) => c.cellId === dragId);
      const to = prev.findIndex((c) => c.cellId === overId);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const onDragEnd = () => setDragId(null);

  async function buildPdf() {
    if (cells.length === 0) return;
    setBuilding(true);
    try {
      // Cache loaded source documents by hash.
      const sourceDocs = new Map<string, PDFDocument>();
      const out = await PDFDocument.create();
      for (const c of cells) {
        let src = sourceDocs.get(c.sha256);
        if (!src) {
          const bytes = await getBytes(c.sha256);
          if (!bytes) throw new Error(`Missing bytes for ${c.fileName}`);
          src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          sourceDocs.set(c.sha256, src);
        }
        const [copied] = await out.copyPages(src, [c.pageIndex]);
        if (c.rotation) {
          const cur = copied.getRotation().angle;
          copied.setRotation({ type: "degrees", angle: (cur + c.rotation) % 360 } as any);
        }
        out.addPage(copied);
      }
      const bytes = await out.save();
      downloadBytes(bytes, `counselpdf-organized-${Date.now()}.pdf`, "application/pdf");
      toast.success(`Built PDF with ${cells.length} page${cells.length === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to build PDF");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <AppShell>
      <ToolHeader
        tag="Organize"
        title="One canvas for every page in your tray."
        sub="Drag pages to reorder, multi-select to delete or rotate in bulk, then build the result into a single PDF. Nothing leaves your browser."
        collapsed={entries.length > 0}
      />
      <div className="mx-auto max-w-[1400px] px-5 md:px-8 py-10 space-y-6">
        <div className="flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          <span>{entries.length} doc{entries.length === 1 ? "" : "s"}</span>
          <span className="text-whisper">·</span>
          <span>{cells.length} page{cells.length === 1 ? "" : "s"}</span>
          <span className="text-whisper">·</span>
          <span className={selected.size > 0 ? "text-vault" : ""}>{selected.size} selected</span>
          {thumbing && <span className="text-vault/70 ml-2">rendering…</span>}
        </div>


        {/* Toolbar */}
        <div className="sticky top-16 z-20 -mx-2 px-2 py-2 backdrop-blur bg-background/80 border-y border-whisper flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={selectAll} disabled={cells.length === 0}>Select all</Button>
          <Button size="sm" variant="outline" onClick={clearSelection} disabled={selected.size === 0}>Clear</Button>
          <span className="h-5 w-px bg-whisper mx-1" />
          <Button size="sm" variant="outline" onClick={rotateSelected} disabled={selected.size === 0}>
            <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Rotate 90°
          </Button>
          <Button size="sm" variant="outline" onClick={deleteSelected} disabled={selected.size === 0} className="text-evidence hover:text-evidence border-evidence/40 hover:border-evidence">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={buildPdf}
            disabled={building || cells.length === 0}
            className="bg-vault text-vault-foreground hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {building ? "Building…" : `Build PDF (${cells.length})`}
          </Button>
        </div>

        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          <DocLegend entries={entries} cells={cells} />
        )}

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 pb-32">
          {cells.map((c, i) => (
            <PageCard
              key={c.cellId}
              cell={c}
              index={i}
              selected={selected.has(c.cellId)}
              dragging={dragId === c.cellId}
              entryColor={colorForEntry(c.entryId, entries)}
              onClick={(e) => toggleSelect(c.cellId, e)}
              onDragStart={() => onDragStart(c.cellId)}
              onDragOver={(e) => onDragOver(e, c.cellId)}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-whisper bg-card/30 p-10 text-center space-y-3">
      <FilePlus2 className="h-8 w-8 mx-auto text-muted-foreground" />
      <div className="font-display text-xl">Your tray is empty.</div>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Drop PDFs into the tray at the bottom of the screen. Every page becomes
        a tile here — reorder them across documents, then build a new PDF.
      </p>
    </div>
  );
}

function DocLegend({ entries, cells }: { entries: TrayEntry[]; cells: PageCell[] }) {
  if (entries.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of cells) counts.set(c.entryId, (counts.get(c.entryId) ?? 0) + 1);
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground">
      {entries.map((e) => (
        <span key={e.id} className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorForEntry(e.id, entries) }} />
          <span className="text-foreground/80 truncate max-w-[18ch]" title={e.name}>{e.name}</span>
          <span>· {counts.get(e.id) ?? 0}/{e.pageCount}</span>
        </span>
      ))}
    </div>
  );
}

function PageCard({
  cell, index, selected, dragging, entryColor,
  onClick, onDragStart, onDragOver, onDragEnd,
}: {
  cell: PageCell;
  index: number;
  selected: boolean;
  dragging: boolean;
  entryColor: string;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "group/cell relative rounded-md border bg-card/40 overflow-hidden cursor-pointer transition-all",
        selected ? "border-vault ring-2 ring-vault/50" : "border-whisper hover:border-vault/40",
        dragging && "opacity-40",
      )}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: entryColor }}
      />
      <div className="aspect-[3/4] bg-canvas/60 grid place-items-center overflow-hidden">
        {cell.thumb ? (
          <img
            src={cell.thumb}
            alt={`Page ${cell.pageIndex + 1} of ${cell.fileName}`}
            style={{ transform: `rotate(${cell.rotation}deg)` }}
            className="max-h-full max-w-full transition-transform"
          />
        ) : (
          <div className="h-6 w-6 rounded-full border-2 border-vault/40 border-t-vault animate-spin" />
        )}
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-whisper/60 text-[10px] font-mono">
        <span className="text-muted-foreground tabular-nums">#{index + 1}</span>
        <span className="text-muted-foreground tabular-nums">p.{cell.pageIndex + 1}</span>
      </div>
      <span className="absolute top-1 right-1 opacity-0 group-hover/cell:opacity-100 transition-opacity">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    </div>
  );
}

// Stable color per entry using its index in the entries array.
const PALETTE = [
  "hsl(174 70% 45%)",
  "hsl(28 85% 60%)",
  "hsl(280 60% 65%)",
  "hsl(200 75% 55%)",
  "hsl(45 85% 55%)",
  "hsl(340 70% 60%)",
  "hsl(140 50% 50%)",
  "hsl(15 75% 60%)",
];
function colorForEntry(id: string, entries: TrayEntry[]) {
  const i = Math.max(0, entries.findIndex((e) => e.id === id));
  return PALETTE[i % PALETTE.length];
}
