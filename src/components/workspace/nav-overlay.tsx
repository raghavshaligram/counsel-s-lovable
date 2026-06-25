/**
 * Navigation overlay — single dismissible floating surface over the canvas.
 * Three tabs: Bookmarks (outline), Pages (thumbnails), Comments (annotation
 * list). Pure navigation: clicking jumps to the page (and selects the anno
 * for comments). Editing surfaces stay in the right inspector.
 *
 * IMPORTANT: this overlay reuses the already-parsed `pdfDoc` instance owned
 * by the workspace shell. It must NOT call `pdf-lib`'s `parsePdf` and must
 * NOT call `pdfjs.getDocument` a second time — a second parse on a 400-page
 * document freezes the main thread ("Page Unresponsive").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, FileText, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Anno } from "@/lib/editor/types";

type Tab = "bookmarks" | "pages" | "comments";

// Minimal structural type for the pdf.js document we receive from the shell.
// We intentionally type only what we touch to avoid pulling pdfjs types here.
type PdfJsDoc = {
  numPages: number;
  getOutline: () => Promise<OutlineItem[] | null>;
  getPageIndex: (ref: unknown) => Promise<number>;
  getDestination: (name: string) => Promise<unknown[] | null>;
  getPage: (n: number) => Promise<unknown>;
};

type OutlineItem = {
  title: string;
  bold?: boolean;
  italic?: boolean;
  dest?: string | unknown[] | null;
  items?: OutlineItem[];
};

type Props = {
  open: boolean;
  defaultTab?: Tab;
  fileName: string | null;
  pdfDoc: unknown | null;
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
  const doc = props.pdfDoc as PdfJsDoc | null;

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
          <BookmarksTab doc={doc} onJump={(n) => { props.onJumpPage(n); onClose(); }} />
        )}
        {tab === "pages" && (
          <PagesTab
            doc={doc}
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

type FlatNode = {
  id: string;
  title: string;
  bold?: boolean;
  italic?: boolean;
  depth: number;
  pageIndex: number | null; // resolved 0-based page index, or null if unresolved
  children: FlatNode[];
};

function BookmarksTab({ doc, onJump }: { doc: PdfJsDoc | null; onJump: (n: number) => void }) {
  const [outline, setOutline] = useState<FlatNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!doc) { setOutline([]); return; }
    setOutline(null);
    setErr(null);

    (async () => {
      try {
        const items = await doc.getOutline();
        if (cancelled) return;
        if (!items || items.length === 0) { setOutline([]); return; }

        // Resolve destinations to page indices, reusing the SAME pdfDoc.
        // No second parse, no bytes.slice().
        let counter = 0;
        const resolve = async (list: OutlineItem[], depth: number): Promise<FlatNode[]> => {
          const out: FlatNode[] = [];
          for (const it of list) {
            let pageIndex: number | null = null;
            try {
              let destArray: unknown[] | null = null;
              if (Array.isArray(it.dest)) {
                destArray = it.dest;
              } else if (typeof it.dest === "string") {
                destArray = await doc.getDestination(it.dest);
              }
              if (destArray && destArray.length > 0) {
                pageIndex = await doc.getPageIndex(destArray[0]);
              }
            } catch {
              pageIndex = null;
            }
            const children = it.items && it.items.length > 0
              ? await resolve(it.items, depth + 1)
              : [];
            out.push({
              id: `o-${counter++}`,
              title: it.title || "(untitled)",
              bold: it.bold,
              italic: it.italic,
              depth,
              pageIndex,
              children,
            });
          }
          return out;
        };

        const resolved = await resolve(items, 0);
        if (!cancelled) setOutline(resolved);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();

    return () => { cancelled = true; };
  }, [doc]);

  if (!doc) return <Empty label="No document loaded." />;
  if (err) return <Empty label={`Could not read outline — ${err}`} />;
  if (outline === null) return <Empty label="Reading bookmarks…" />;
  if (outline.length === 0) return <Empty label="No bookmarks in this document." />;

  return (
    <ul className="space-y-0.5 text-[12.5px]">
      {outline.map((n) => (
        <OutlineRow key={n.id} node={n} onJump={onJump} />
      ))}
    </ul>
  );
}

function OutlineRow({ node, onJump }: { node: FlatNode; onJump: (n: number) => void }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div className="flex items-center gap-1 rounded-md hover:bg-surface-2" style={{ paddingLeft: node.depth * 12 }}>
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
          onClick={() => node.pageIndex !== null && onJump(node.pageIndex)}
          disabled={node.pageIndex === null}
          className={cn(
            "min-w-0 flex-1 truncate py-1 text-left text-foreground",
            node.pageIndex === null && "text-text-muted",
            node.bold && "font-semibold",
            node.italic && "italic",
          )}
          title={node.title}
        >
          {node.title}
        </button>
        {node.pageIndex !== null && (
          <span className="shrink-0 px-1 text-[11px] tabular-nums text-text-muted">{node.pageIndex + 1}</span>
        )}
      </div>
      {hasChildren && open && (
        <ul className="space-y-0.5">
          {node.children.map((c) => (
            <OutlineRow key={c.id} node={c} onJump={onJump} />
          ))}
        </ul>
      )}
    </li>
  );
}

/* ----------------------------- Pages ----------------------------- */
/**
 * Thumbnails reuse the already-parsed pdfDoc — no second getDocument call.
 * Each thumbnail renders only when scrolled into view, and all renders are
 * funnelled through a single-slot queue so a 400-page doc never fires 400
 * concurrent pdf.js render jobs.
 */

function PagesTab({
  doc,
  pageCount,
  current,
  onJump,
}: {
  doc: PdfJsDoc | null;
  pageCount: number;
  current: number;
  onJump: (n: number) => void;
}) {
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  if (!doc || pageCount === 0) return <Empty label="No document loaded." />;

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
  doc: PdfJsDoc;
  queueRef: React.MutableRefObject<Promise<void>>;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const wrapRef = useRef<HTMLLIElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);

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
