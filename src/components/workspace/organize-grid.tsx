/**
 * Organize canvas surface — page-thumbnail grid with drag-reorder.
 *
 * Renders inside the workspace's CANVAS zone when the active tool is
 * "organize". Reads/writes the shared organize-store. Calls the
 * extracted renderPageThumb (src/lib/pdf/organize.ts) — does NOT
 * duplicate that logic.
 *
 * The right inspector (OrganizePanel) drives all actions; this surface
 * only handles select/drag/click. No second toolbar, no extra rail.
 */
import { useEffect, useRef, useState } from "react";
import { GripVertical, FilePlus2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrganize } from "@/lib/workspace/organize-store";
import { openPdfjsDoc, renderPageThumb } from "@/lib/pdf/organize";

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

  const seedFromActiveFile = useOrganize((s) => s.seedFromActiveFile);
  const reset = useOrganize((s) => s.reset);
  const toggleSelect = useOrganize((s) => s.toggleSelect);
  const setDragId = useOrganize((s) => s.setDragId);
  const moveTo = useOrganize((s) => s.moveTo);
  const setThumb = useOrganize((s) => s.setThumb);
  const colorFor = useOrganize((s) => s.colorFor);

  const [seeding, setSeeding] = useState(false);
  const [thumbing, setThumbing] = useState(false);
  // Live insertion indicator: { cellId, side } means "drop here, on this
  // side of the target". Cleared on dragend / drop / leaving the grid.
  const [dropTarget, setDropTarget] = useState<{ cellId: string; side: "before" | "after" } | null>(null);

  // Auto-seed from the active tab's file whenever organize becomes active
  // for a new tab (or the file identity changes). Cross-doc additions are
  // appended manually via the inspector and survive reseeds for the same tab.
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

  // Progressive thumbnails — same approach as the legacy route, but
  // delegated to renderPageThumb() in the lib.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = cells.filter((c) => !c.thumb);
      if (missing.length === 0) return;
      setThumbing(true);
      try {
        const docs = new Map<string, Promise<Awaited<ReturnType<typeof openPdfjsDoc>>>>();
        for (const c of missing) {
          if (cancelled) break;
          const src = sources[c.source];
          if (!src) continue;
          if (!docs.has(c.source)) docs.set(c.source, openPdfjsDoc(src.bytes));
          const doc = await docs.get(c.source)!;
          if (cancelled) break;
          const thumb = await renderPageThumb(doc, c.pageIndex);
          if (cancelled) return;
          if (thumb) setThumb(c.cellId, thumb);
        }
      } catch (err) {
        console.error("[organize-grid] thumb render failed", err);
      } finally {
        if (!cancelled) setThumbing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cells, sources, setThumb]);

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

  return (
    <div className="h-full overflow-auto px-5 py-6">
      <div className="mb-3 flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
        <span>{cells.length} page{cells.length === 1 ? "" : "s"}</span>
        <span className="text-text-muted">·</span>
        <span className={selected.size > 0 ? "text-vault" : ""}>{selected.size} selected</span>
        {(seeding || thumbing) && <span className="ml-2 text-vault/70">rendering…</span>}
      </div>

      <div
        className="grid grid-cols-2 gap-3 pb-16 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        onDragLeave={(e) => {
          // Only clear when the pointer actually leaves the grid, not when
          // moving between child tiles.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropTarget(null);
          }
        }}
      >
        {cells.map((c, i) => {
          const isDragged = dragId === c.cellId;
          const showBefore = dropTarget?.cellId === c.cellId && dropTarget.side === "before";
          const showAfter = dropTarget?.cellId === c.cellId && dropTarget.side === "after";
          return (
            <div key={c.cellId} className="relative">
              {/* Insertion indicator — vertical accent bar on the chosen edge. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -left-1.5 top-0 bottom-0 w-[3px] rounded-full bg-vault transition-opacity",
                  showBefore ? "opacity-100" : "opacity-0",
                )}
              />
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -right-1.5 top-0 bottom-0 w-[3px] rounded-full bg-vault transition-opacity",
                  showAfter ? "opacity-100" : "opacity-0",
                )}
              />
              <div
                draggable
                onDragStart={(e) => {
                  // Internal payload only — keeps "Files" out of
                  // dataTransfer.types so the shell's file-drop overlay
                  // stays dormant during reorder.
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
                onClick={(e) => toggleSelect(c.cellId, e.shiftKey)}
                className={cn(
                  "group/cell relative cursor-pointer overflow-hidden rounded-md border bg-surface-2 transition-all",
                  selected.has(c.cellId)
                    ? "border-vault ring-2 ring-vault/50"
                    : "border-border hover:border-vault/40",
                  isDragged && "opacity-40",
                )}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-[3px]"
                  style={{ background: colorFor(c.source) }}
                />
                <div className="grid aspect-[3/4] place-items-center overflow-hidden bg-canvas/60">
                  {c.thumb ? (
                    <img
                      src={c.thumb}
                      alt={`Page ${c.pageIndex + 1} of ${c.fileName}`}
                      style={{ transform: `rotate(${c.rotation}deg)` }}
                      className="max-h-full max-w-full transition-transform"
                    />
                  ) : (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-vault/40 border-t-vault" />
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border/60 px-2 py-1.5 font-mono text-[10px]">
                  <span className="tabular-nums text-text-muted">#{i + 1}</span>
                  <span className="truncate text-text-muted" title={c.fileName}>
                    {c.fileName}
                  </span>
                  <span className="tabular-nums text-text-muted">p.{c.pageIndex + 1}</span>
                </div>
                <span className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/cell:opacity-100">
                  <GripVertical className="h-3.5 w-3.5 text-text-muted" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
