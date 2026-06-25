/**
 * Navigation overlay — single dismissible floating surface over the canvas.
 * Three tabs: Bookmarks (outline), Pages (thumbnails), Comments (annotation
 * list). Pure navigation: clicking jumps to the page (and selects the anno
 * for comments). Editing surfaces stay in the right inspector.
 *
 * No second rail. Opens via the floating-toolbar button or ⌘B. Closes on
 * Esc / outside click / toggle. Design tokens only. On-device only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, FileText, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parsePdf } from "@/lib/outline/parse";
import { loadPdfjs } from "@/lib/pdf/worker";
import type { OutlineNode } from "@/lib/outline/types";
import type { Anno } from "@/lib/editor/types";

type Tab = "bookmarks" | "pages" | "comments";

type Props = {
  open: boolean;
  defaultTab?: Tab;
  fileName: string | null;
  bytes: Uint8Array | null;
  pageCount: number;
  annotations: Anno[];
  currentPage: number;
  onJumpPage: (n: number) => void;
  onJumpAnno: (a: Anno) => void;
  onEditComment: (a: Anno) => void;
  onClose: () => void;
};

export function NavOverlay(props: Props) {
  const { open, defaultTab = "bookmarks", onClose } = props;
  const [tab, setTab] = useState<Tab>(defaultTab);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Document navigation"
      className="absolute right-3 top-14 z-40 flex w-[320px] flex-col border border-border bg-surface-1"
      style={{ borderRadius: 12, boxShadow: "var(--shadow-float)", maxHeight: "calc(100% - 80px)" }}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
        <TabBtn active={tab === "bookmarks"} onClick={() => setTab("bookmarks")} icon={<Bookmark className="h-3.5 w-3.5" />} label="Bookmarks" />
        <TabBtn active={tab === "pages"} onClick={() => setTab("pages")} icon={<FileText className="h-3.5 w-3.5" />} label="Pages" />
        <TabBtn active={tab === "comments"} onClick={() => setTab("comments")} icon={<MessageSquare className="h-3.5 w-3.5" />} label="Comments" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === "bookmarks" && (
          <BookmarksTab bytes={props.bytes} onJump={(n) => { props.onJumpPage(n); onClose(); }} />
        )}
        {tab === "pages" && (
          <PagesTab
            bytes={props.bytes}
            pageCount={props.pageCount}
            current={props.currentPage}
            onJump={(n) => { props.onJumpPage(n); onClose(); }}
          />
        )}
        {tab === "comments" && (
          <CommentsTab
            annos={props.annotations}
            onJump={(a) => { props.onJumpAnno(a); onClose(); }}
            onEdit={(a) => { props.onEditComment(a); onClose(); }}
          />
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-text-2 hover:bg-surface-2 hover:text-foreground",
        active && "bg-vault text-vault-foreground hover:bg-vault hover:text-vault-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* --------------------------- Bookmarks --------------------------- */

function BookmarksTab({ bytes, onJump }: { bytes: Uint8Array | null; onJump: (n: number) => void }) {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!bytes) { setOutline([]); return; }
    setOutline(null);
    setErr(null);
    parsePdf(bytes.slice())
      .then(({ parsed }) => { if (!cancelled) setOutline(parsed.outline); })
      .catch((e) => { if (!cancelled) setErr((e as Error).message); });
    return () => { cancelled = true; };
  }, [bytes]);

  if (err) return <Empty label={`Could not read outline — ${err}`} />;
  if (outline === null) return <Empty label="Reading bookmarks…" />;
  if (outline.length === 0) return <Empty label="No bookmarks. Add bookmarks in the Outline & Links inspector." />;

  return (
    <ul className="space-y-0.5 text-[12.5px]">
      {outline.map((n) => (
        <OutlineRow key={n.id} node={n} depth={0} onJump={onJump} />
      ))}
    </ul>
  );
}

function OutlineRow({ node, depth, onJump }: { node: OutlineNode; depth: number; onJump: (n: number) => void }) {
  const [open, setOpen] = useState(node.expanded ?? true);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div className="flex items-center gap-1 rounded-md hover:bg-surface-2" style={{ paddingLeft: depth * 12 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid h-5 w-5 place-items-center text-text-muted hover:text-foreground"
            aria-label={open ? "Collapse" : "Expand"}
          >
            <span className="text-[10px]">{open ? "▾" : "▸"}</span>
          </button>
        ) : (
          <span className="inline-block h-5 w-5" />
        )}
        <button
          type="button"
          onClick={() => node.dest && onJump(node.dest.page)}
          disabled={!node.dest}
          className={cn(
            "min-w-0 flex-1 truncate py-1 text-left text-foreground",
            !node.dest && "text-text-muted",
            node.style?.bold && "font-semibold",
            node.style?.italic && "italic",
          )}
          title={node.title}
        >
          {node.title || "(untitled)"}
        </button>
        {node.dest && (
          <span className="shrink-0 px-1 text-[11px] tabular-nums text-text-muted">{node.dest.page + 1}</span>
        )}
      </div>
      {hasChildren && open && (
        <ul className="space-y-0.5">
          {node.children.map((c) => (
            <OutlineRow key={c.id} node={c} depth={depth + 1} onJump={onJump} />
          ))}
        </ul>
      )}
    </li>
  );
}

/* ----------------------------- Pages ----------------------------- */
/**
 * Thumbnails. Parse the PDF ONCE per overlay open and share the doc across
 * all thumbnails. Render each thumbnail only when it scrolls into view, and
 * funnel renders through a single-slot queue so a 400-page doc doesn't fire
 * 400 concurrent pdf.js render jobs (which is what caused the main thread
 * to lock up and trigger "Page Unresponsive").
 */

type ThumbDoc = { numPages: number; getPage: (n: number) => Promise<unknown> };

function PagesTab({
  bytes,
  pageCount,
  current,
  onJump,
}: {
  bytes: Uint8Array | null;
  pageCount: number;
  current: number;
  onJump: (n: number) => void;
}) {
  const [doc, setDoc] = useState<ThumbDoc | null>(null);
  // Serialise thumbnail renders. pdf.js runs in its own worker, but every
  // render still posts work onto the main thread to paint into a canvas.
  // One-at-a-time keeps the UI responsive even on 1000-page documents.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!bytes) { setDoc(null); return; }
    let cancelled = false;
    let pdfDoc: { destroy?: () => Promise<void> } | null = null;
    (async () => {
      const pdfjs = await loadPdfjs();
      const d = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      if (cancelled) { try { (d as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ } return; }
      pdfDoc = d as unknown as { destroy?: () => Promise<void> };
      setDoc({ numPages: d.numPages, getPage: (n) => d.getPage(n) });
    })().catch(() => { /* ignore */ });
    return () => {
      cancelled = true;
      try { pdfDoc?.destroy?.(); } catch { /* ignore */ }
    };
  }, [bytes]);

  if (!bytes || pageCount === 0) return <Empty label="No document loaded." />;
  if (!doc) return <Empty label="Loading thumbnails…" />;

  return (
    <ul className="grid grid-cols-2 gap-2">
      {Array.from({ length: pageCount }, (_, i) => (
        <PageThumb
          key={i}
          doc={doc}
          queueRef={queueRef}
          index={i}
          active={i === current}
          onClick={() => onJump(i)}
        />
      ))}
    </ul>
  );
}

function PageThumb({
  doc,
  queueRef,
  index,
  active,
  onClick,
}: {
  doc: ThumbDoc;
  queueRef: React.MutableRefObject<Promise<void>>;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const wrapRef = useRef<HTMLLIElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);

  // Render only when scrolled into view.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || inView) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setInView(true); io.disconnect(); break; }
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    // Append to the shared single-slot queue.
    queueRef.current = queueRef.current.then(async () => {
      if (cancelled) return;
      try {
        const page = await doc.getPage(index + 1) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
        };
        if (cancelled) return;
        const vp1 = page.getViewport({ scale: 1 });
        const targetW = 130;
        const scale = targetW / vp1.width;
        const v2 = page.getViewport({ scale });
        const c = canvasRef.current;
        if (!c || cancelled) return;
        c.width = v2.width;
        c.height = v2.height;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas: c, canvasContext: ctx, viewport: v2 }).promise;
        if (!cancelled) setReady(true);
      } catch { /* ignore — overlay may have closed */ }
    });
    return () => { cancelled = true; };
  }, [inView, doc, index, queueRef]);

  return (
    <li ref={wrapRef}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-md border p-1 text-[11px] text-text-2 hover:border-vault/50 hover:bg-surface-2",
          active ? "border-vault text-vault" : "border-border",
        )}
      >
        <div className="relative w-full overflow-hidden rounded-sm bg-surface-3" style={{ aspectRatio: "0.77 / 1" }}>
          <canvas ref={canvasRef} className={cn("h-full w-full object-contain", !ready && "opacity-0")} />
        </div>
        <span className="tabular-nums">{index + 1}</span>
      </button>
    </li>
  );
}

/* --------------------------- Comments --------------------------- */

function CommentsTab({
  annos,
  onJump,
  onEdit,
}: {
  annos: Anno[];
  onJump: (a: Anno) => void;
  onEdit: (a: Anno) => void;
}) {
  const [filter, setFilter] = useState<"all" | "open">("open");
  const list = useMemo(() => {
    const commented = annos.filter((a) => a.contents);
    if (filter === "open") return commented.filter((a) => !a.resolved);
    return commented;
  }, [annos, filter]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-[11.5px]">
        <FilterChip active={filter === "open"} onClick={() => setFilter("open")} label="Open" />
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" />
        <span className="ml-auto text-text-muted">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <Empty label="No comments yet. Add one from the Comments inspector." />
      ) : (
        <ul className="space-y-1.5">
          {list.map((a) => (
            <li key={a.id}>
              <div
                className={cn(
                  "rounded-md border border-border bg-surface-2 p-2 text-[12px]",
                  a.resolved && "opacity-60",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <button type="button" onClick={() => onJump(a)} className="text-[11px] text-vault hover:underline">
                    Page {a.page + 1} · {a.kind}
                  </button>
                  <button type="button" onClick={() => onEdit(a)} className="text-[11px] text-text-muted hover:text-foreground">
                    Edit
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-foreground">{a.contents}</p>
                {a.author && (
                  <p className="mt-1 text-[10.5px] text-text-muted">{a.author}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-0.5 text-text-2 hover:bg-surface-2 hover:text-foreground",
        active && "bg-vault text-vault-foreground hover:bg-vault hover:text-vault-foreground",
      )}
    >
      {label}
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-2 py-6 text-center text-[12px] text-text-muted">{label}</div>;
}
