import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Workspace primitives — the locked layout grammar for v2.
 * ToolRail · ThumbStrip · DocumentCanvas · Inspector(320px)
 *
 * These are the ONLY layout primitives. Every tool mode renders this same
 * shell; only Inspector contents change.
 */

export function WorkspaceShell({
  rail,
  thumbs,
  canvas,
  inspector,
  status,
  fileLabel,
}: {
  rail: ReactNode;
  thumbs: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  status?: ReactNode;
  fileLabel?: ReactNode;
}) {
  return (
    <div className="grid h-svh w-full grid-rows-[40px_1fr] bg-canvas text-ink">
      <header className="flex items-center justify-between border-b border-whisper px-3 text-[12px]">
        <div className="flex items-center gap-2 font-mono text-ink/70">{fileLabel}</div>
        <div className="text-ink/50">{status}</div>
      </header>
      <div className="grid min-h-0 grid-cols-[48px_72px_minmax(0,1fr)_320px]">
        <aside className="border-r border-whisper">{rail}</aside>
        <aside className="overflow-y-auto border-r border-whisper no-scrollbar">{thumbs}</aside>
        <main className="relative min-h-0 overflow-hidden">{canvas}</main>
        <aside className="border-l border-whisper bg-background/40">{inspector}</aside>
      </div>
    </div>
  );
}

export function ToolRail({
  items,
  activeId,
  onSelect,
}: {
  items: { id: string; label: string; icon: ReactNode }[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="flex flex-col items-center gap-1 py-2">
      {items.map((it) => (
        <button
          key={it.id}
          title={it.label}
          onClick={() => onSelect(it.id)}
          className={cn(
            "grid h-10 w-10 place-items-center rounded-md transition-colors",
            "text-ink/60 hover:bg-whisper hover:text-ink",
            activeId === it.id && "bg-vault/15 text-vault hover:bg-vault/20"
          )}
        >
          <span className="[&_svg]:h-[14px] [&_svg]:w-[14px]">{it.icon}</span>
        </button>
      ))}
    </nav>
  );
}

export function ThumbStrip({
  pages,
  current,
  onSelect,
}: {
  pages: number;
  current: number;
  onSelect: (i: number) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the active thumbnail visible.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-thumb="${current}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const handleKey = (e: ReactKeyboardEvent, i: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.min(pages - 1, i + 1);
      onSelect(next);
      listRef.current?.querySelector<HTMLButtonElement>(`[data-thumb="${next}"]`)?.focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = Math.max(0, i - 1);
      onSelect(prev);
      listRef.current?.querySelector<HTMLButtonElement>(`[data-thumb="${prev}"]`)?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(i);
    }
  };

  return (
    <ol ref={listRef} className="flex flex-col gap-2 p-2">
      {Array.from({ length: pages }, (_, i) => (
        <li key={i}>
          <button
            data-thumb={i}
            tabIndex={current === i ? 0 : -1}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => handleKey(e, i)}
            className={cn(
              "block aspect-[3/4] w-full rounded border bg-paper/5 text-[10px] font-mono",
              "border-whisper text-ink/40 hover:border-ink/30 focus:outline-none focus:ring-2 focus:ring-vault/60",
              current === i && "border-vault text-vault"
            )}
          >
            {i + 1}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Inspector with B6.1 split — two independent scroll regions when chat is open.
 * Tool panel default 60%, chat default 40%, snap stops at 30/50/70.
 */
export function Inspector({
  tool,
  chat,
}: {
  tool: ReactNode;
  chat?: ReactNode;
}) {
  const [split, setSplit] = useState(60);
  const dragRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !dragRef.current) return;
      const rect = dragRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      // snap stops
      const snaps = [30, 50, 70];
      const closest = snaps.find((s) => Math.abs(pct - s) < 4);
      setSplit(Math.max(20, Math.min(80, closest ?? pct)));
    };
    const onUp = () => (dragging.current = false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  if (!chat) {
    return <div className="h-full overflow-y-auto">{tool}</div>;
  }

  return (
    <div ref={dragRef} className="grid h-full" style={{ gridTemplateRows: `${split}% 1px ${100 - split}%` }}>
      <div className="overflow-y-auto min-h-0">{tool}</div>
      <div
        onMouseDown={() => (dragging.current = true)}
        className="cursor-row-resize bg-whisper hover:bg-vault/50"
        role="separator"
        aria-orientation="horizontal"
      />
      <div className="overflow-y-auto min-h-0">{chat}</div>
    </div>
  );
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pt-4 pb-2 text-[11px] uppercase tracking-[0.18em] text-ink/50 font-sans">
      {children}
    </div>
  );
}

export function Pill({ count, label, tone = "ink" }: { count: number; label: string; tone?: "ink" | "evidence" | "vault" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
        tone === "ink" && "border-whisper text-ink/80",
        tone === "evidence" && "border-evidence/40 text-evidence",
        tone === "vault" && "border-vault/40 text-vault"
      )}
    >
      <span className="font-mono tabular-nums">{count}</span>
      <span className="text-ink/60">{label}</span>
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center opacity-60">
      <div className="font-display text-xl">{title}</div>
      {body && <p className="max-w-[28ch] text-sm text-ink/60">{body}</p>}
      {action}
    </div>
  );
}
