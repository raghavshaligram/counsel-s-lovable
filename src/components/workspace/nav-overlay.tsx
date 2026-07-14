/**
 * Navigation + action overlay — single dismissible floating surface over
 * the canvas. Three tabs: Bookmarks (user-managed + PDF outline), Pages
 * (thumbnails), Comments (annotation list with inline add/edit/reply/resolve).
 *
 * Single-click on a bookmark or thumbnail JUMPS but keeps the overlay open.
 * Double-click jumps and closes. Dismiss only via Esc, outside click, or X.
 * Outside-click ignores any element marked [data-nav-toggle] so the toolbar
 * button can toggle the overlay open/closed.
 *
 * IMPORTANT: this overlay reuses the already-parsed `pdfDoc` instance owned
 * by the workspace shell — no second pdfjs.getDocument and no pdf-lib parse.
 * Per-page work (thumbnails) is lazy via IntersectionObserver.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  CornerDownRight,
  Eye,
  EyeOff,
  FileText,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Anno, NoteAnno } from "@/lib/editor/types";
import {
  loadBookmarks,
  saveBookmarksDebounced,
  type UserBookmark,
} from "@/lib/workspace/persistence";

/* ------------------------ Overlay geometry ------------------------ */

type Rect = { right: number; top: number; width: number; height: number | null };
const RECT_KEY = "vault:nav-overlay-rect";
// Default hugs content (height=null → auto). User's manual resize sets an
// explicit height that persists across sessions.
const DEFAULT_RECT: Rect = { right: 24, top: 56, width: 380, height: null };
const MIN_W = 280;
const MIN_H = 220;

function readRect(): Rect {
  if (typeof window === "undefined") return DEFAULT_RECT;
  try {
    const raw = window.localStorage.getItem(RECT_KEY);
    if (!raw) return DEFAULT_RECT;
    const p = JSON.parse(raw) as Partial<Rect>;
    const h = p.height == null ? null : Math.max(MIN_H, Number(p.height));
    return {
      right: Math.max(0, Number(p.right ?? DEFAULT_RECT.right)),
      top: Math.max(0, Number(p.top ?? DEFAULT_RECT.top)),
      width: Math.max(MIN_W, Number(p.width ?? DEFAULT_RECT.width)),
      height: h,
    };
  } catch {
    return DEFAULT_RECT;
  }
}
function writeRect(r: Rect) {
  try { window.localStorage.setItem(RECT_KEY, JSON.stringify(r)); } catch { /* ignore */ }
}


/* ---------------- Outline overrides (rename / hide) --------------- */

type OutlineOverride = { title?: string; hidden?: boolean };
type OutlineOverrides = Record<string, OutlineOverride>;
function overridesKey(name: string | null, size: number | null) {
  if (!name || size == null) return null;
  return `vault:outline-overrides:${name}:${size}`;
}
function loadOverrides(name: string | null, size: number | null): OutlineOverrides {
  const k = overridesKey(name, size);
  if (!k || typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(k) ?? "{}") ?? {}; } catch { return {}; }
}
function saveOverrides(name: string | null, size: number | null, v: OutlineOverrides) {
  const k = overridesKey(name, size);
  if (!k) return;
  try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
}


type Tab = "bookmarks" | "pages" | "comments";

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
  fileSize: number | null;
  pdfDoc: unknown | null;
  pageCount: number;
  annotations: Anno[];
  currentPage: number;
  onJumpPage: (n: number) => void;
  onJumpAnno: (a: Anno) => void;
  onAddComment: (anno: Anno) => void;
  onUpdateAnno: (id: string, patch: Partial<Anno>) => void;
  onDeleteAnno: (id: string) => void;
  onClose: () => void;
};

export function NavOverlay(props: Props) {
  const { open, defaultTab = "bookmarks", onClose } = props;
  const [tab, setTab] = useState<Tab>(defaultTab);
  const ref = useRef<HTMLDivElement>(null);
  const doc = props.pdfDoc as PdfJsDoc | null;

  // Draggable + resizable geometry. Persisted per browser.
  const [rect, setRect] = useState<Rect>(() => (typeof window === "undefined" ? DEFAULT_RECT : readRect()));
  const dragRef = useRef<{ x: number; y: number; right: number; top: number } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  useEffect(() => { writeRect(rect); }, [rect]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-nav-toggle]")) return;
      if (ref.current && !ref.current.contains(t)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  // Drag + resize move handlers (mounted once).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const parent = ref.current?.parentElement;
      const bounds = parent?.getBoundingClientRect();
      if (dragRef.current) {
        const d = dragRef.current;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        setRect((r) => {
          const maxRight = bounds ? Math.max(0, bounds.width - r.width) : 5000;
          const maxTop = bounds ? Math.max(0, bounds.height - 60) : 5000;
          return {
            ...r,
            right: Math.min(maxRight, Math.max(0, d.right - dx)),
            top: Math.min(maxTop, Math.max(0, d.top + dy)),
          };
        });
      } else if (resizeRef.current) {
        const s = resizeRef.current;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        setRect((r) => {
          const maxW = bounds ? Math.max(MIN_W, bounds.width - r.right) : 2000;
          const maxH = bounds ? Math.max(MIN_H, bounds.height - r.top - 10) : 2000;
          return {
            ...r,
            width: Math.min(maxW, Math.max(MIN_W, s.w + dx)),
            height: Math.min(maxH, Math.max(MIN_H, s.h + dy)),
          };
        });
      }
    };
    const onUp = () => { dragRef.current = null; resizeRef.current = null; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, input")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, right: rect.right, top: rect.top };
    document.body.style.userSelect = "none";
    e.preventDefault();
  }, [rect.right, rect.top]);

  const startResize = useCallback((e: React.MouseEvent) => {
    const currentH = rect.height ?? (ref.current?.getBoundingClientRect().height ?? MIN_H);
    resizeRef.current = { x: e.clientX, y: e.clientY, w: rect.width, h: currentH };
    document.body.style.userSelect = "none";
    e.preventDefault();
    e.stopPropagation();
  }, [rect.width, rect.height]);


  if (!open) return null;

  const jumpStay = (n: number) => props.onJumpPage(n);
  const jumpAnnoStay = (a: Anno) => props.onJumpAnno(a);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Document navigation"
      className="absolute z-40 flex flex-col border border-border bg-surface-1"
      style={{
        right: rect.right,
        top: rect.top,
        width: rect.width,
        height: rect.height ?? undefined,
        maxHeight: "calc(100% - 80px)",
        borderRadius: 12,
        boxShadow: "var(--shadow-float)",
      }}

    >
      <header
        onMouseDown={startDrag}
        className="flex shrink-0 cursor-move items-center gap-1 border-b border-border px-1.5 py-1.5 select-none"
      >
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
            doc={doc}
            fileName={props.fileName}
            fileSize={props.fileSize}
            currentPage={props.currentPage}
            onJump={jumpStay}
            onJumpAndClose={(n) => { props.onJumpPage(n); onClose(); }}
          />
        )}
        {tab === "pages" && (
          <PagesTab
            doc={doc}
            pageCount={props.pageCount}
            current={props.currentPage}
            onJump={jumpStay}
            onJumpAndClose={(n) => { props.onJumpPage(n); onClose(); }}
          />
        )}
        {tab === "comments" && (
          <CommentsTab
            annos={props.annotations}
            currentPage={props.currentPage}
            onJump={jumpAnnoStay}
            onAdd={props.onAddComment}
            onUpdate={props.onUpdateAnno}
            onDelete={props.onDeleteAnno}
          />
        )}
      </div>
      {/* Resize handle (bottom-right corner) */}
      <div
        onMouseDown={startResize}
        aria-label="Resize"
        title="Drag to resize"
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 0 45%, hsl(var(--border)) 45% 55%, transparent 55% 70%, hsl(var(--border)) 70% 80%, transparent 80%)",
          borderBottomRightRadius: 12,
        }}
      />
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

type OutlineFlat = {
  id: string;
  title: string;
  bold?: boolean;
  italic?: boolean;
  depth: number;
  pageIndex: number | null;
  children: OutlineFlat[];
};

function BookmarksTab({
  doc,
  fileName,
  fileSize,
  currentPage,
  onJump,
  onJumpAndClose,
}: {
  doc: PdfJsDoc | null;
  fileName: string | null;
  fileSize: number | null;
  currentPage: number;
  onJump: (n: number) => void;
  onJumpAndClose: (n: number) => void;
}) {
  const [outline, setOutline] = useState<OutlineFlat[] | null>(null);
  const [outlineErr, setOutlineErr] = useState<string | null>(null);
  const [userBms, setUserBms] = useState<UserBookmark[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [outlineOverrides, setOutlineOverrides] = useState<OutlineOverrides>({});

  // Load per-document outline overrides.
  useEffect(() => {
    setOutlineOverrides(loadOverrides(fileName, fileSize));
  }, [fileName, fileSize]);

  const patchOverride = useCallback((id: string, patch: OutlineOverride | null) => {
    setOutlineOverrides((cur) => {
      const next = { ...cur };
      if (patch === null) delete next[id];
      else next[id] = { ...next[id], ...patch };
      saveOverrides(fileName, fileSize, next);
      return next;
    });
  }, [fileName, fileSize]);


  // Load user bookmarks for this document.
  useEffect(() => {
    let cancelled = false;
    if (!fileName || fileSize == null) { setUserBms([]); return; }
    loadBookmarks(fileName, fileSize).then((list) => {
      if (!cancelled) setUserBms(list);
    });
    return () => { cancelled = true; };
  }, [fileName, fileSize]);

  // Persist on change.
  useEffect(() => {
    if (!fileName || fileSize == null || userBms === null) return;
    saveBookmarksDebounced(fileName, fileSize, userBms);
  }, [userBms, fileName, fileSize]);

  // Read PDF outline (read-only, from the SAME already-loaded pdfDoc).
  useEffect(() => {
    let cancelled = false;
    if (!doc) { setOutline([]); return; }
    setOutline(null);
    setOutlineErr(null);
    (async () => {
      try {
        const items = await doc.getOutline();
        if (cancelled) return;
        if (!items || items.length === 0) { setOutline([]); return; }
        let counter = 0;
        const resolve = async (list: OutlineItem[], depth: number): Promise<OutlineFlat[]> => {
          const out: OutlineFlat[] = [];
          for (const it of list) {
            let pageIndex: number | null = null;
            try {
              let destArray: unknown[] | null = null;
              if (Array.isArray(it.dest)) destArray = it.dest;
              else if (typeof it.dest === "string") destArray = await doc.getDestination(it.dest);
              if (destArray && destArray.length > 0) pageIndex = await doc.getPageIndex(destArray[0]);
            } catch { pageIndex = null; }
            const children = it.items && it.items.length > 0 ? await resolve(it.items, depth + 1) : [];
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
        if (!cancelled) setOutlineErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [doc]);

  const addBookmark = () => {
    const title = draft.trim() || `Page ${currentPage + 1}`;
    const bm: UserBookmark = {
      id: crypto.randomUUID(),
      title,
      page: currentPage,
      createdAt: Date.now(),
    };
    setUserBms((cur) => [...(cur ?? []), bm]);
    setDraft("");
    setAdding(false);
  };

  const renameBookmark = (id: string, title: string) => {
    setUserBms((cur) => (cur ?? []).map((b) => (b.id === id ? { ...b, title } : b)));
  };
  const deleteBookmark = (id: string) => {
    setUserBms((cur) => (cur ?? []).filter((b) => b.id !== id));
  };

  const onDragStart = (id: string) => setDragId(id);
  const onDropOn = (id: string) => {
    if (!dragId || dragId === id) return;
    setUserBms((cur) => {
      const list = [...(cur ?? [])];
      const from = list.findIndex((b) => b.id === dragId);
      const to = list.findIndex((b) => b.id === id);
      if (from < 0 || to < 0) return list;
      const [m] = list.splice(from, 1);
      list.splice(to, 0, m);
      return list;
    });
    setDragId(null);
  };

  return (
    <div className="space-y-3">
      {/* User bookmarks — editable */}
      <section>
        <div className="mb-1.5 flex items-center justify-between px-1">
          <h3 className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">My bookmarks</h3>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            title={`Bookmark page ${currentPage + 1} (the page you're viewing)`}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-vault hover:bg-surface-2"
          >
            <Plus className="h-3 w-3" />
            Bookmark page {currentPage + 1}
          </button>
        </div>

        {adding && (
          <div className="mb-1.5 flex items-center gap-1 rounded-md border border-border bg-surface-2 p-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addBookmark();
                if (e.key === "Escape") { setDraft(""); setAdding(false); }
              }}
              placeholder={`Bookmark page ${currentPage + 1}…`}
              className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-[12px] text-foreground outline-none placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={addBookmark}
              className="rounded px-1.5 py-0.5 text-[11px] text-vault hover:bg-surface-1"
            >
              Save
            </button>
          </div>
        )}

        {userBms === null ? (
          <Empty label="Loading…" />
        ) : userBms.length === 0 ? (
          <div className="px-2 py-3 text-center text-[11.5px] text-text-muted">
            No bookmarks yet. Click <span className="text-vault">Add</span> to mark page {currentPage + 1}.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {userBms.map((b) => (
              <li
                key={b.id}
                draggable
                onDragStart={() => onDragStart(b.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropOn(b.id)}
                className={cn(
                  "group flex items-center gap-1 rounded-md pl-1.5 hover:bg-surface-2",
                  dragId === b.id && "opacity-50",
                )}
              >
                <Bookmark className="h-3 w-3 shrink-0 text-vault" aria-hidden />
                {editingId === b.id ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => {
                      renameBookmark(b.id, editingTitle.trim() || b.title);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        renameBookmark(b.id, editingTitle.trim() || b.title);
                        setEditingId(null);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="min-w-0 flex-1 bg-transparent px-2 py-1 text-[12.5px] text-foreground outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onJump(b.page)}
                    onDoubleClick={() => onJumpAndClose(b.page)}
                    className="min-w-0 flex-1 truncate px-2 py-1 text-left text-[12.5px] text-foreground"
                    title={`${b.title} · page ${b.page + 1}`}
                  >
                    {b.title}
                  </button>
                )}
                <span className="shrink-0 px-1 text-[11px] tabular-nums text-text-muted">{b.page + 1}</span>
                <button
                  type="button"
                  aria-label="Rename"
                  onClick={() => { setEditingId(b.id); setEditingTitle(b.title); }}
                  className="opacity-0 group-hover:opacity-100 mr-0.5 grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-1 hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={() => deleteBookmark(b.id)}
                  className="opacity-0 group-hover:opacity-100 mr-1 grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-1 hover:text-foreground"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* PDF outline — inline rename / hide overrides persist per document */}
      {outline && outline.length > 0 && (
        <OutlineSection
          outline={outline}
          overrides={outlineOverrides}
          onPatch={patchOverride}
          onJump={onJump}
          onJumpClose={onJumpAndClose}
        />
      )}

      {outlineErr && <Empty label={`Could not read PDF outline — ${outlineErr}`} />}
      {outline === null && <Empty label="Reading PDF outline…" />}
    </div>
  );
}

function countHidden(nodes: OutlineFlat[], overrides: OutlineOverrides): number {
  let n = 0;
  for (const node of nodes) {
    if (overrides[node.id]?.hidden) n++;
    n += countHidden(node.children, overrides);
  }
  return n;
}

function collectAllIds(nodes: OutlineFlat[], out: string[] = []): string[] {
  for (const node of nodes) {
    out.push(node.id);
    collectAllIds(node.children, out);
  }
  return out;
}

function OutlineSection({
  outline,
  overrides,
  onPatch,
  onJump,
  onJumpClose,
}: {
  outline: OutlineFlat[];
  overrides: OutlineOverrides;
  onPatch: (id: string, patch: OutlineOverride | null) => void;
  onJump: (n: number) => void;
  onJumpClose: (n: number) => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const hiddenCount = countHidden(outline, overrides);
  const restoreAll = () => {
    for (const id of collectAllIds(outline)) {
      if (overrides[id]?.hidden) onPatch(id, { hidden: false });
    }
    setShowHidden(false);
  };
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h3 className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
          PDF outline
        </h3>
        {hiddenCount > 0 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-vault hover:bg-surface-2"
            >
              {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
            </button>
            {showHidden && (
              <button
                type="button"
                onClick={restoreAll}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-text-2 hover:bg-surface-2 hover:text-foreground"
                title="Restore all hidden outline entries"
              >
                Restore all
              </button>
            )}
          </div>
        )}
      </div>
      <ul className="space-y-0.5 text-[12.5px]">
        {outline.map((n) => (
          <OutlineRow
            key={n.id}
            node={n}
            overrides={overrides}
            onPatch={onPatch}
            onJump={onJump}
            onJumpClose={onJumpClose}
            showHidden={showHidden}
          />
        ))}
      </ul>
    </section>
  );
}

function OutlineRow({
  node,
  overrides,
  onPatch,
  onJump,
  onJumpClose,
  showHidden,
}: {
  node: OutlineFlat;
  overrides: OutlineOverrides;
  onPatch: (id: string, patch: OutlineOverride | null) => void;
  onJump: (n: number) => void;
  onJumpClose: (n: number) => void;
  showHidden: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const ov = overrides[node.id] ?? {};
  const displayTitle = ov.title ?? node.title;
  const [draft, setDraft] = useState(displayTitle);
  useEffect(() => { setDraft(displayTitle); }, [displayTitle]);
  const isHidden = !!ov.hidden;
  if (isHidden && !showHidden) return null;
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md hover:bg-surface-2",
          isHidden && "opacity-50",
        )}
        style={{ paddingLeft: node.depth * 12 }}
      >
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
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const t = draft.trim();
              onPatch(node.id, t && t !== node.title ? { title: t } : { title: undefined });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const t = draft.trim();
                onPatch(node.id, t && t !== node.title ? { title: t } : { title: undefined });
                setEditing(false);
              }
              if (e.key === "Escape") { setDraft(displayTitle); setEditing(false); }
            }}
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[12.5px] text-foreground outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => node.pageIndex !== null && onJump(node.pageIndex)}
            onDoubleClick={() => node.pageIndex !== null && onJumpClose(node.pageIndex)}
            disabled={node.pageIndex === null}
            className={cn(
              "min-w-0 flex-1 truncate py-1 text-left text-foreground",
              node.pageIndex === null && "text-text-muted",
              node.bold && "font-semibold",
              node.italic && "italic",
              isHidden && "line-through",
            )}
            title={displayTitle}
          >
            {displayTitle}
          </button>
        )}
        {node.pageIndex !== null && (
          <span className="shrink-0 px-1 text-[11px] tabular-nums text-text-muted">{node.pageIndex + 1}</span>
        )}
        {isHidden ? (
          <button
            type="button"
            aria-label="Unhide"
            title="Restore to list"
            onClick={() => onPatch(node.id, { hidden: false })}
            className="mr-1 grid h-6 w-6 place-items-center rounded text-vault hover:bg-surface-1"
          >
            <Eye className="h-3 w-3" />
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label="Rename"
              onClick={() => { setDraft(displayTitle); setEditing(true); }}
              className="opacity-0 group-hover:opacity-100 grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-1 hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label="Hide from list"
              title="Hide from this list (does not modify the PDF)"
              onClick={() => onPatch(node.id, { hidden: true })}
              className="opacity-0 group-hover:opacity-100 mr-1 grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-1 hover:text-foreground"
            >
              <EyeOff className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      {hasChildren && open && (
        <ul className="space-y-0.5">
          {node.children.map((c) => (
            <OutlineRow
              key={c.id}
              node={c}
              overrides={overrides}
              onPatch={onPatch}
              onJump={onJump}
              onJumpClose={onJumpClose}
              showHidden={showHidden}
            />
          ))}
        </ul>
      )}
    </li>
  );
}


/* ----------------------------- Pages ----------------------------- */

function PagesTab({
  doc,
  pageCount,
  current,
  onJump,
  onJumpAndClose,
}: {
  doc: PdfJsDoc | null;
  pageCount: number;
  current: number;
  onJump: (n: number) => void;
  onJumpAndClose: (n: number) => void;
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
          onDoubleClick={() => onJumpAndClose(i)}
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
  doc: PdfJsDoc;
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
  currentPage,
  onJump,
  onAdd,
  onUpdate,
  onDelete,
}: {
  annos: Anno[];
  currentPage: number;
  onJump: (a: Anno) => void;
  onAdd: (a: Anno) => void;
  onUpdate: (id: string, patch: Partial<Anno>) => void;
  onDelete: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "open">("open");
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState("");
  const list = useMemo(() => {
    const commented = annos.filter((a) => a.contents);
    if (filter === "open") return commented.filter((a) => !a.resolved);
    return commented;
  }, [annos, filter]);

  const addComment = () => {
    const text = draft.trim();
    if (!text) { setDrafting(false); return; }
    const note: NoteAnno = {
      id: crypto.randomUUID(),
      kind: "note",
      page: currentPage,
      x: 24,
      y: 24,
      w: 180,
      h: 28,
      color: { r: 1, g: 0.85, b: 0 },
      opacity: 1,
      text: "",
      contents: text,
      createdAt: Date.now(),
    };
    onAdd(note);
    setDraft("");
    setDrafting(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-[11.5px]">
        <FilterChip active={filter === "open"} onClick={() => setFilter("open")} label="Open" />
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" />
        <span className="ml-auto text-text-muted">{list.length}</span>
        <button
          type="button"
          onClick={() => setDrafting((v) => !v)}
          className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-vault hover:bg-surface-2"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>

      {drafting && (
        <div className="rounded-md border border-border bg-surface-2 p-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setDraft(""); setDrafting(false); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addComment();
            }}
            placeholder={`Comment on page ${currentPage + 1}…`}
            className="block w-full resize-none bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-muted"
            rows={3}
          />
          <div className="mt-1 flex items-center justify-end gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => { setDraft(""); setDrafting(false); }}
              className="rounded px-2 py-0.5 text-text-muted hover:bg-surface-1 hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addComment}
              disabled={!draft.trim()}
              className="rounded bg-vault px-2 py-0.5 text-vault-foreground disabled:opacity-50"
            >
              Add comment
            </button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        !drafting ? (
          <div className="px-2 py-6 text-center text-[12px] text-text-muted">
            No comments yet.{" "}
            <button type="button" onClick={() => setDrafting(true)} className="text-vault hover:underline">
              Add the first one
            </button>{" "}
            on page {currentPage + 1}.
          </div>
        ) : null
      ) : (
        <ul className="space-y-1.5">
          {list.map((a) => (
            <CommentItem
              key={a.id}
              anno={a}
              onJump={() => onJump(a)}
              onUpdate={(patch) => onUpdate(a.id, patch)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentItem({
  anno,
  onJump,
  onUpdate,
  onDelete,
}: {
  anno: Anno;
  onJump: () => void;
  onUpdate: (patch: Partial<Anno>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(anno.contents ?? "");
  const [reply, setReply] = useState<string | null>(null);

  const save = () => {
    onUpdate({ contents: text.trim() || anno.contents });
    setEditing(false);
  };

  const addReply = () => {
    const t = (reply ?? "").trim();
    if (!t) { setReply(null); return; }
    const next = [
      ...(anno.replies ?? []),
      { id: crypto.randomUUID(), author: "You", text: t, createdAt: Date.now() },
    ];
    onUpdate({ replies: next });
    setReply(null);
  };

  return (
    <li>
      <div className={cn("rounded-md border border-border bg-surface-2 p-2 text-[12px]", anno.resolved && "opacity-60")}>
        <div className="flex items-baseline justify-between gap-2">
          <button type="button" onClick={onJump} className="text-[11px] text-vault hover:underline">
            Page {anno.page + 1} · {anno.kind}
          </button>
          <div className="flex items-center gap-0.5 text-text-muted">
            <button
              type="button"
              onClick={() => onUpdate({ resolved: !anno.resolved })}
              title={anno.resolved ? "Reopen" : "Resolve"}
              className="grid h-6 w-6 place-items-center rounded hover:bg-surface-1 hover:text-foreground"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => { setEditing((v) => !v); setText(anno.contents ?? ""); }}
              title="Edit"
              className="grid h-6 w-6 place-items-center rounded hover:bg-surface-1 hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              title="Delete"
              className="grid h-6 w-6 place-items-center rounded hover:bg-surface-1 hover:text-foreground"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              }}
              className="block w-full resize-none rounded border border-border bg-surface-1 p-1.5 text-[12px] text-foreground outline-none"
              rows={3}
            />
            <div className="mt-1 flex justify-end gap-1 text-[11px]">
              <button type="button" onClick={() => setEditing(false)} className="rounded px-2 py-0.5 text-text-muted hover:bg-surface-1 hover:text-foreground">Cancel</button>
              <button type="button" onClick={save} className="rounded bg-vault px-2 py-0.5 text-vault-foreground">Save</button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-foreground">{anno.contents}</p>
        )}

        {anno.author && !editing && (
          <p className="mt-1 text-[10.5px] text-text-muted">{anno.author}</p>
        )}

        {anno.replies && anno.replies.length > 0 && (
          <ul className="mt-2 space-y-1 border-l border-border pl-2">
            {anno.replies.map((r) => (
              <li key={r.id} className="text-[11.5px]">
                <span className="text-text-muted">{r.author}: </span>
                <span className="text-foreground whitespace-pre-wrap">{r.text}</span>
              </li>
            ))}
          </ul>
        )}

        {reply !== null ? (
          <div className="mt-2 flex items-center gap-1">
            <CornerDownRight className="h-3 w-3 text-text-muted" />
            <input
              autoFocus
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addReply();
                if (e.key === "Escape") setReply(null);
              }}
              placeholder="Reply…"
              className="min-w-0 flex-1 rounded border border-border bg-surface-1 px-1.5 py-1 text-[11.5px] text-foreground outline-none"
            />
            <button type="button" onClick={addReply} className="rounded px-1.5 py-0.5 text-[11px] text-vault hover:bg-surface-2">Reply</button>
          </div>
        ) : (
          !editing && (
            <button
              type="button"
              onClick={() => setReply("")}
              className="mt-1.5 flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground"
            >
              <CornerDownRight className="h-3 w-3" /> Reply
            </button>
          )
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
