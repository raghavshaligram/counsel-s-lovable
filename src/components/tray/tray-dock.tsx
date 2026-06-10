/**
 * TrayDock — persistent typographic ledger at the bottom of the app shell.
 *
 * Lists every PDF in the tray with name, page count, size. Bytes never enter
 * React state — only metadata. Clicking a chip selects it; X removes it.
 *
 * Design: monospaced row of ledger entries on a dark surface, separated by
 * 1px whisper rules. Hidden when tray is empty.
 */
import { useTray, type TrayEntry } from "@/lib/tray/store";
import { cn } from "@/lib/utils";
import { Plus, X, Layers } from "lucide-react";
import { useRef, useState, useCallback } from "react";

function fmtSize(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

export function TrayDock() {
  const entries = useTray((s) => s.entries);
  const selectedId = useTray((s) => s.selectedId);
  const select = useTray((s) => s.select);
  const remove = useTray((s) => s.remove);
  const add = useTray((s) => s.add);
  const clear = useTray((s) => s.clear);
  const [collapsed, setCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
      for (const f of arr) await add(f);
    },
    [add],
  );

  if (entries.length === 0) {
    // Floating add-to-tray bubble in the bottom-right, doesn't take vertical space.
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="sr-only"
          onChange={(e) => e.target.files && onFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full border border-vault/30 bg-card/80 backdrop-blur px-4 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-vault hover:border-vault/60 transition-colors shadow-[var(--shadow-float)]"
          aria-label="Add files to tray"
        >
          <Layers className="h-3.5 w-3.5" />
          File Tray
          <span className="text-vault/70">·</span>
          <span>empty</span>
        </button>
      </>
    );
  }

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-vault/20 bg-card/90 backdrop-blur-xl transition-all",
        dragOver && "ring-1 ring-inset ring-vault",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="sr-only"
        onChange={(e) => e.target.files && onFiles(e.target.files)}
      />

      {/* Header ledger row */}
      <div className="flex items-center justify-between px-4 md:px-6 h-9 border-b border-whisper/50">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-vault/80 hover:text-vault"
          >
            <Layers className="h-3 w-3" />
            File Tray
            <span className="text-muted-foreground/60">·</span>
            <span className="font-mono text-muted-foreground">{entries.length} doc{entries.length === 1 ? "" : "s"}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="font-mono text-muted-foreground">
              {fmtSize(entries.reduce((a, e) => a + e.size, 0))}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-vault"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
          <span className="h-3 w-px bg-whisper" />
          <button
            type="button"
            onClick={() => void clear()}
            className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-evidence"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Ledger rows */}
      {!collapsed && (
        <div className="overflow-x-auto no-scrollbar">
          <div className="flex items-stretch min-h-[64px] px-3 md:px-5 py-2 gap-2">
            {entries.map((e) => (
              <TrayChip
                key={e.id}
                entry={e}
                active={e.id === selectedId}
                onSelect={() => select(e.id)}
                onRemove={() => void remove(e.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrayChip({
  entry,
  active,
  onSelect,
  onRemove,
}: {
  entry: TrayEntry;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "group/chip relative flex items-stretch shrink-0 rounded-md border transition-all",
        active
          ? "border-vault/60 bg-vault/10 shadow-[var(--shadow-float)]"
          : "border-whisper hover:border-vault/30 bg-canvas/40",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-3 px-3 py-2 min-w-[180px] text-left"
      >
        <span
          className={cn(
            "grid place-items-center h-8 w-8 rounded-sm border font-mono text-[10px]",
            active ? "border-vault/50 text-vault bg-vault/10" : "border-whisper text-muted-foreground bg-canvas/60",
          )}
        >
          PDF
        </span>
        <span className="min-w-0">
          <span
            className={cn(
              "block text-xs leading-tight truncate max-w-[180px]",
              active ? "text-foreground" : "text-foreground/90",
            )}
            title={entry.name}
          >
            {entry.name}
          </span>
          <span className="block font-mono text-[10px] text-muted-foreground tracking-wide mt-0.5">
            {entry.pageCount} pg · {fmtSize(entry.size)}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entry.name}`}
        className="px-2 grid place-items-center text-muted-foreground hover:text-evidence opacity-0 group-hover/chip:opacity-100 transition-opacity"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
