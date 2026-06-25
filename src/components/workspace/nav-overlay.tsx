/**
 * Navigation overlay — single dismissible floating surface over the canvas.
 * Three tabs: Bookmarks (outline), Pages (thumbnails), Comments (annotation
 * list). The overlay is where the user both NAVIGATES and ACTS on
 * bookmarks/pages/comments — single-click jumps and KEEPS the overlay open;
 * double-click jumps and closes. Dismiss only on Esc / outside-click / X.
 *
 * Bookmarks panel is editable in-place (add / rename / delete / reorder).
 * Comments panel adds / edits / replies / resolves in-place — no bouncing
 * the user to the inspector.
 *
 * Design tokens only. On-device only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, FileText, MessageSquare, Plus, Trash2, X, ArrowUp, ArrowDown, Check, CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { parsePdf } from "@/lib/outline/parse";
import { loadPdfjs } from "@/lib/pdf/worker";
import { newId, type OutlineNode } from "@/lib/outline/types";
import type { Anno, NoteAnno, Reply } from "@/lib/editor/types";

type Tab = "bookmarks" | "pages" | "comments";

type Props = {
  open: boolean;
  defaultTab?: Tab;
  fileName: string | null;
  bytes: Uint8Array | null;
  pageCount: number;
  pageSize: { w: number; h: number } | null;
  annotations: Anno[];
  outline: OutlineNode[] | undefined;
  currentPage: number;
  onOutlineChange: (outline: OutlineNode[]) => void;
  onJumpPage: (n: number) => void;
  onJumpAnno: (a: Anno) => void;
  onAddComment: (a: Anno) => void;
  onPatchComment: (id: string, patch: Partial<Anno>) => void;
  onDeleteComment: (id: string) => void;
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

  // Single-click handlers JUMP and KEEP the overlay open. Double-click
  // jumps AND closes (for users who navigated where they wanted to be).
  const jumpPage = (n: number) => props.onJumpPage(n);
  const jumpPageAndClose = (n: number) => { props.onJumpPage(n); onClose(); };
  const jumpAnno = (a: Anno) => props.onJumpAnno(a);
  const jumpAnnoAndClose = (a: Anno) => { props.onJumpAnno(a); onClose(); };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Document navigation"
      className="absolute right-3 top-14 z-40 flex w-[340px] flex-col border border-border bg-surface-1"
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
          <BookmarksTab
            bytes={props.bytes}
            outline={props.outline}
            currentPage={props.currentPage}
            onOutlineChange={props.onOutlineChange}
            onJump={jumpPage}
            onJumpClose={jumpPageAndClose}
          />
        )}
        {tab === "pages" && (
          <PagesTab
            bytes={props.bytes}
            pageCount={props.pageCount}
            current={props.currentPage}
            onJump={jumpPage}
            onJumpClose={jumpPageAndClose}
          />
        )}
        {tab === "comments" && (
          <CommentsTab
            annos={props.annotations}
            currentPage={props.currentPage}
            pageSize={props.pageSize}
            onJump={jumpAnno}
            onJumpClose={jumpAnnoAndClose}
            onAdd={props.onAddComment}
            onPatch={props.onPatchComment}
            onDelete={props.onDeleteComment}
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

function flattenOutline(nodes: OutlineNode[]): OutlineNode[] {
  // The editable panel works on a flat list. Imported PDFs with nested
  // outlines are flattened into a single ordered list so add/rename/delete/
  // reorder are predictable. (Nested editing can come later.)
  const out: OutlineNode[] = [];
  const walk = (ns: OutlineNode[]) => {
    for (const n of ns) {
      out.push({ ...n, children: [] });
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function BookmarksTab({
  bytes,
  outline,
  currentPage,
  onOutlineChange,
  onJump,
  onJumpClose,
}: {
  bytes: Uint8Array | null;
  outline: OutlineNode[] | undefined;
  currentPage: number;
  onOutlineChange: (outline: OutlineNode[]) => void;
  onJump: (n: number) => void;
  onJumpClose: (n: number) => void;
}) {
  const [seeding, setSeeding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const dragId = useRef<string | null>(null);

  // Seed editable outline from the PDF the first time we open this doc.
  useEffect(() => {
    let cancelled = false;
    if (!bytes) return;
    if (outline !== undefined) return; // already seeded (possibly to [])
    setSeeding(true);
    setErr(null);
    parsePdf(bytes.slice())
      .then(({ parsed }) => {
        if (cancelled) return;
        onOutlineChange(flattenOutline(parsed.outline));
      })
      .catch((e) => { if (!cancelled) setErr((e as Error).message); })
      .finally(() => { if (!cancelled) setSeeding(false); });
    return () => { cancelled = true; };
    // outline absence is the trigger; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, outline === undefined]);

  const list = outline ?? [];

  const addAtCurrent = () => {
    const node: OutlineNode = {
      id: newId(),
      title: `Page ${currentPage + 1}`,
      dest: { page: currentPage, x: null, y: null, zoom: null },
      style: { bold: false, italic: false },
      color: null,
      expanded: true,
      children: [],
    };
    const next = [...list, node];
    onOutlineChange(next);
    setEditingId(node.id);
    setEditDraft(node.title);
  };

  const rename = (id: string, title: string) => {
    onOutlineChange(list.map((n) => (n.id === id ? { ...n, title } : n)));
  };

  const remove = (id: string) => {
    onOutlineChange(list.filter((n) => n.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = list.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [m] = next.splice(idx, 1);
    next.splice(to, 0, m);
    onOutlineChange(next);
  };

  const onDrop = (overId: string) => {
    const fromId = dragId.current;
    dragId.current = null;
    if (!fromId || fromId === overId) return;
    const from = list.findIndex((n) => n.id === fromId);
    const to = list.findIndex((n) => n.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...list];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onOutlineChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-0.5">
        <button
          type="button"
          onClick={addAtCurrent}
          disabled={!bytes}
          className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11.5px] text-foreground hover:border-vault/50 hover:bg-surface-3 disabled:opacity-50"
          title="Add bookmark for current page"
        >
          <Plus className="h-3 w-3" /> Add bookmark
        </button>
        <span className="ml-auto text-[11px] text-text-muted">{list.length}</span>
      </div>

      {err && <Empty label={`Could not read outline — ${err}`} />}
      {!err && seeding && list.length === 0 && <Empty label="Reading bookmarks…" />}
      {!err && !seeding && list.length === 0 && (
        <Empty label="No bookmarks yet. Use “Add bookmark” to mark the current page." />
      )}

      {list.length > 0 && (
        <ul className="space-y-0.5 text-[12.5px]">
          {list.map((n) => {
            const isEditing = editingId === n.id;
            return (
              <li
                key={n.id}
                draggable={!isEditing}
                onDragStart={() => { dragId.current = n.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onDrop(n.id); }}
                className="group flex items-center gap-1 rounded-md px-1 hover:bg-surface-2"
              >
                {isEditing ? (
                  <input
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onBlur={() => { rename(n.id, editDraft.trim() || n.title); setEditingId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { rename(n.id, editDraft.trim() || n.title); setEditingId(null); }
                      else if (e.key === "Escape") { setEditingId(null); }
                    }}
                    className="min-w-0 flex-1 rounded-sm border border-border bg-surface-3 px-1.5 py-0.5 text-[12.5px] text-foreground focus:border-vault focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => n.dest && onJump(n.dest.page)}
                    onDoubleClick={() => n.dest && onJumpClose(n.dest.page)}
                    disabled={!n.dest}
                    className={cn(
                      "min-w-0 flex-1 truncate py-1 text-left text-foreground",
                      !n.dest && "text-text-muted",
                    )}
                    title={`${n.title} — click to jump, double-click to jump and close`}
                  >
                    {n.title || "(untitled)"}
                  </button>
                )}
                {n.dest && !isEditing && (
                  <span className="shrink-0 px-1 text-[11px] tabular-nums text-text-muted">{n.dest.page + 1}</span>
                )}
                {!isEditing && (
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <IconBtn label="Move up" onClick={() => move(n.id, -1)}><ArrowUp className="h-3 w-3" /></IconBtn>
                    <IconBtn label="Move down" onClick={() => move(n.id, 1)}><ArrowDown className="h-3 w-3" /></IconBtn>
                    <IconBtn label="Rename" onClick={() => { setEditingId(n.id); setEditDraft(n.title); }}>
                      <span className="text-[10px]">✎</span>
                    </IconBtn>
                    <IconBtn label="Delete" onClick={() => remove(n.id)}>
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-3 hover:text-foreground"
    >
      {children}
    </button>
  );
}

/* ----------------------------- Pages ----------------------------- */

type ThumbDoc = { numPages: number; getPage: (n: number) => Promise<unknown> };

function PagesTab({
  bytes,
  pageCount,
  current,
  onJump,
  onJumpClose,
}: {
  bytes: Uint8Array | null;
  pageCount: number;
  current: number;
  onJump: (n: number) => void;
  onJumpClose: (n: number) => void;
}) {
  const [doc, setDoc] = useState<ThumbDoc | null>(null);
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
          onDoubleClick={() => onJumpClose(i)}
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
  onDoubleClick,
}: {
  doc: ThumbDoc;
  queueRef: React.MutableRefObject<Promise<void>>;
  index: number;
  active: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
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
      } catch { /* ignore */ }
    });
    return () => { cancelled = true; };
  }, [inView, doc, index, queueRef]);

  return (
    <li ref={wrapRef}>
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        title="Click to jump · double-click to jump and close"
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

const uid = () => Math.random().toString(36).slice(2, 10);

const kindLabel: Record<Anno["kind"], string> = {
  text: "Text",
  highlight: "Highlight",
  underline: "Underline",
  strikethrough: "Strikethrough",
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  freehand: "Drawing",
  note: "Sticky note",
  image: "Image",
  "text-edit": "Edited text",
  redact: "Redaction",
};

function CommentsTab({
  annos,
  currentPage,
  pageSize,
  onJump,
  onJumpClose,
  onAdd,
  onPatch,
  onDelete,
}: {
  annos: Anno[];
  currentPage: number;
  pageSize: { w: number; h: number } | null;
  onJump: (a: Anno) => void;
  onJumpClose: (a: Anno) => void;
  onAdd: (a: Anno) => void;
  onPatch: (id: string, patch: Partial<Anno>) => void;
  onDelete: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "open">("open");
  const [newDraft, setNewDraft] = useState("");
  const [composing, setComposing] = useState(false);

  const list = useMemo(() => {
    const commented = annos.filter((a) => a.contents);
    return filter === "open" ? commented.filter((a) => !a.resolved) : commented;
  }, [annos, filter]);

  const addNote = () => {
    const text = newDraft.trim();
    if (!text) return;
    const w = 200;
    const h = 80;
    const pw = pageSize?.w ?? 612;
    const ph = pageSize?.h ?? 792;
    const note: NoteAnno = {
      id: uid(),
      kind: "note",
      page: currentPage,
      x: Math.max(0, (pw - w) / 2),
      y: Math.max(0, (ph - h) / 2),
      w,
      h,
      color: { r: 1, g: 0.9, b: 0.3 },
      opacity: 0.95,
      text,
      contents: text,
      author: "You",
      createdAt: Date.now(),
    };
    onAdd(note);
    setNewDraft("");
    setComposing(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-[11.5px]">
        <FilterChip active={filter === "open"} onClick={() => setFilter("open")} label="Open" />
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" />
        <button
          type="button"
          onClick={() => setComposing((v) => !v)}
          className="ml-auto flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-foreground hover:border-vault/50 hover:bg-surface-3"
        >
          <Plus className="h-3 w-3" /> New
        </button>
      </div>

      {composing && (
        <div className="space-y-1 rounded-md border border-border bg-surface-2 p-2">
          <div className="text-[10.5px] text-text-muted">New comment on page {currentPage + 1}</div>
          <textarea
            autoFocus
            rows={3}
            value={newDraft}
            onChange={(e) => setNewDraft(e.target.value)}
            placeholder="Write a comment…"
            className="w-full resize-none rounded-sm border border-border bg-surface-3 px-2 py-1 text-[12px] text-foreground focus:border-vault focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); }
              else if (e.key === "Escape") { setComposing(false); setNewDraft(""); }
            }}
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => { setComposing(false); setNewDraft(""); }}
              className="rounded-md px-2 py-0.5 text-[11.5px] text-text-2 hover:bg-surface-3 hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addNote}
              disabled={!newDraft.trim()}
              className="rounded-md bg-vault px-2 py-0.5 text-[11.5px] text-vault-foreground hover:opacity-90 disabled:opacity-50"
            >
              Add comment
            </button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <Empty label={composing ? "No comments yet." : "No comments yet. Click ‘New’ to add one on the current page."} />
      ) : (
        <ul className="space-y-1.5">
          {list.map((a) => (
            <CommentCard
              key={a.id}
              a={a}
              onJump={() => onJump(a)}
              onJumpClose={() => onJumpClose(a)}
              onPatch={(p) => onPatch(a.id, p)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentCard({
  a,
  onJump,
  onJumpClose,
  onPatch,
  onDelete,
}: {
  a: Anno;
  onJump: () => void;
  onJumpClose: () => void;
  onPatch: (patch: Partial<Anno>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.contents ?? "");
  const [reply, setReply] = useState("");

  const save = () => {
    onPatch({
      contents: draft,
      author: a.author ?? "You",
      createdAt: a.createdAt ?? Date.now(),
    });
    setEditing(false);
  };

  const addReply = () => {
    const text = reply.trim();
    if (!text) return;
    const next: Reply = { id: uid(), author: "You", text, createdAt: Date.now() };
    onPatch({ replies: [...(a.replies ?? []), next] });
    setReply("");
  };

  return (
    <li>
      <div
        className={cn(
          "rounded-md border border-border bg-surface-2 p-2 text-[12px]",
          a.resolved && "opacity-60",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <button
            type="button"
            onClick={onJump}
            onDoubleClick={onJumpClose}
            title="Click to jump · double-click to jump and close"
            className="text-[11px] text-vault hover:underline"
          >
            Page {a.page + 1} · {kindLabel[a.kind]}
          </button>
          <div className="flex items-center gap-0.5">
            <IconBtn
              label={a.resolved ? "Reopen" : "Resolve"}
              onClick={() => onPatch({ resolved: !a.resolved })}
            >
              <Check className={cn("h-3 w-3", a.resolved && "text-emerald-500")} />
            </IconBtn>
            <IconBtn label="Edit" onClick={() => { setDraft(a.contents ?? ""); setEditing((v) => !v); }}>
              <span className="text-[10px]">✎</span>
            </IconBtn>
            <IconBtn label="Delete" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </IconBtn>
          </div>
        </div>

        {editing ? (
          <div className="mt-1 space-y-1">
            <textarea
              autoFocus
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full resize-none rounded-sm border border-border bg-surface-3 px-2 py-1 text-[12px] text-foreground focus:border-vault focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
                else if (e.key === "Escape") { setEditing(false); setDraft(a.contents ?? ""); }
              }}
            />
            <div className="flex items-center justify-end gap-1">
              <button type="button" onClick={() => { setEditing(false); setDraft(a.contents ?? ""); }} className="rounded-md px-2 py-0.5 text-[11px] text-text-2 hover:bg-surface-3 hover:text-foreground">Cancel</button>
              <button type="button" onClick={save} className="rounded-md bg-vault px-2 py-0.5 text-[11px] text-vault-foreground hover:opacity-90">Save</button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-foreground">{a.contents}</p>
        )}

        {a.author && !editing && (
          <p className="mt-1 text-[10.5px] text-text-muted">
            {a.author}
            {a.createdAt ? ` · ${new Date(a.createdAt).toLocaleString()}` : ""}
          </p>
        )}

        {(a.replies?.length ?? 0) > 0 && (
          <div className="mt-1.5 space-y-1 border-l border-border pl-2">
            {a.replies!.map((r) => (
              <div key={r.id} className="text-[11.5px]">
                <div className="text-[10px] text-text-muted">{r.author} · {new Date(r.createdAt).toLocaleString()}</div>
                <div className="whitespace-pre-wrap text-foreground">{r.text}</div>
              </div>
            ))}
          </div>
        )}

        {!a.resolved && (
          <div className="mt-1.5 flex items-start gap-1">
            <CornerDownRight className="mt-1 h-3 w-3 text-text-muted" />
            <textarea
              rows={1}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addReply(); } }}
              placeholder="Reply… (⌘↵)"
              className="min-h-[28px] flex-1 resize-none rounded-sm border border-border bg-surface-3 px-2 py-1 text-[11.5px] text-foreground focus:border-vault focus:outline-none"
            />
            <button
              type="button"
              onClick={addReply}
              disabled={!reply.trim()}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-surface-3 disabled:opacity-50"
            >
              Reply
            </button>
          </div>
        )}
      </div>
    </li>
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
