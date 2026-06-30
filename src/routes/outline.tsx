import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Download,

  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Link2,
  Wand2,
  FilePlus2,
  Upload,
  ChevronLeft,
} from "lucide-react";
import { useTray, type TrayEntry } from "@/lib/tray/store";
import { getBytes } from "@/lib/tray/blobs";
import { loadPdfjs } from "@/lib/pdf/worker";
import { downloadPdf } from "@/lib/pdf/download";
import { ExportFormatRow } from "@/components/workspace/export-format-row";
import { parsePdf } from "@/lib/outline/parse";
import { exportPdf } from "@/lib/outline/write";
import { linkifyPage } from "@/lib/outline/linkify";
import type { Dest, LinkAnnot, OutlineNode, ParsedDoc } from "@/lib/outline/types";
import { newId } from "@/lib/outline/types";
import { cn } from "@/lib/utils";
import { ToolHeader } from "@/routes/split";


export const Route = createFileRoute("/outline")({
  head: () => ({
    meta: [
      { title: "Edit PDF Outline & Links — Bookmarks Tree · CounselPDF" },
      {
        name: "description",
        content:
          "Edit a PDF's bookmark tree and link annotations in your browser. Add, rename, nest, and drop bookmarks. Linkify URLs on a page in one click. 100% on-device.",
      },
      { property: "og:title", content: "Edit PDF Outline & Links — CounselPDF" },
      {
        property: "og:description",
        content: "Tree on the left, page in the middle, inspector on the right. Keyboard-driven.",
      },
    ],
    links: [{ rel: "canonical", href: "/outline" }],
  }),
  component: OutlinePage,
});

type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "link"; id: string };

function OutlinePage() {
  const entries = useTray((s) => s.entries);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [sourceName, setSourceName] = useState<string>("document.pdf");
  const [parsed, setParsed] = useState<ParsedDoc | null>(null);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [links, setLinks] = useState<LinkAnnot[]>([]);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load a document into the editor.
  const loadFromBytes = useCallback(async (bytes: Uint8Array, name: string) => {
    setLoading(true);
    try {
      const { parsed } = await parsePdf(bytes);
      setSourceBytes(bytes);
      setSourceName(name);
      setParsed(parsed);
      setOutline(parsed.outline);
      setLinks(parsed.links);
      setPage(0);
      setSelection({ kind: "none" });
    } catch (err) {
      console.error(err);
      toast.error("Could not read that PDF");
    } finally {
      setLoading(false);
    }
  }, []);

  const pickFromTray = useCallback(
    async (entry: TrayEntry) => {
      const bytes = await getBytes(entry.sha256);
      if (!bytes) {
        toast.error("Tray bytes missing");
        return;
      }
      await loadFromBytes(bytes, entry.name);
    },
    [loadFromBytes],
  );

  const onFile = (file: File | undefined) => {
    if (!file) return;
    file.arrayBuffer().then((buf) => loadFromBytes(new Uint8Array(buf), file.name));
  };

  // Tree helpers ------------------------------------------------------------
  const findNodeAndParent = useCallback(
    (
      nodes: OutlineNode[],
      id: string,
      parent: OutlineNode[] | null = null,
    ): { node: OutlineNode; siblings: OutlineNode[]; parent: OutlineNode[] | null } | null => {
      for (const n of nodes) {
        if (n.id === id) return { node: n, siblings: nodes, parent };
        const inner = findNodeAndParent(n.children, id, nodes);
        if (inner) return inner;
      }
      return null;
    },
    [],
  );

  const updateNode = useCallback((id: string, patch: Partial<OutlineNode>) => {
    setOutline((tree) => {
      const walk = (nodes: OutlineNode[]): OutlineNode[] =>
        nodes.map((n) => (n.id === id ? { ...n, ...patch } : { ...n, children: walk(n.children) }));
      return walk(tree);
    });
  }, []);

  const removeNode = useCallback((id: string) => {
    setOutline((tree) => {
      const walk = (nodes: OutlineNode[]): OutlineNode[] =>
        nodes
          .filter((n) => n.id !== id)
          .map((n) => ({ ...n, children: walk(n.children) }));
      return walk(tree);
    });
  }, []);

  const addNodeAtRoot = useCallback(() => {
    const node: OutlineNode = {
      id: newId("o"),
      title: "New bookmark",
      dest: { page, x: null, y: null, zoom: null },
      style: { bold: false, italic: false },
      color: null,
      expanded: true,
      children: [],
    };
    setOutline((tree) => [...tree, node]);
    setSelection({ kind: "node", id: node.id });
  }, [page]);

  const indentNode = useCallback(
    (id: string) => {
      setOutline((tree) => {
        const found = findNodeAndParent(tree, id);
        if (!found) return tree;
        const idx = found.siblings.indexOf(found.node);
        if (idx <= 0) return tree;
        const newParent = found.siblings[idx - 1];
        // Mutate immutably: rebuild siblings array minus moved, push into newParent.children
        const cloneAll = (nodes: OutlineNode[]): OutlineNode[] =>
          nodes.map((n) => {
            if (n === found.node) return n; // we'll filter
            return { ...n, children: cloneAll(n.children) };
          });
        const walk = (nodes: OutlineNode[]): OutlineNode[] =>
          nodes
            .filter((n) => n !== found.node)
            .map((n) =>
              n === newParent
                ? { ...n, expanded: true, children: [...cloneAll(n.children), found.node] }
                : { ...n, children: walk(n.children) },
            );
        return walk(tree);
      });
    },
    [findNodeAndParent],
  );

  const outdentNode = useCallback(
    (id: string) => {
      setOutline((tree) => {
        // Find node and its parent node (the one whose .children contains it).
        let parentNode: OutlineNode | null = null;
        const findParent = (nodes: OutlineNode[], parent: OutlineNode | null): void => {
          for (const n of nodes) {
            if (n.id === id) {
              parentNode = parent;
              return;
            }
            findParent(n.children, n);
          }
        };
        findParent(tree, null);
        if (!parentNode) return tree; // already at root
        const grandFinder = (
          nodes: OutlineNode[],
          parent: OutlineNode | null,
        ): OutlineNode | null => {
          for (const n of nodes) {
            if (n === parentNode) return parent;
            const g = grandFinder(n.children, n);
            if (g !== undefined && g !== null) return g;
            if (n === parentNode) return parent;
          }
          return null;
        };
        // unused grand search left as-is; outdent inserts after the parent in its siblings
        void grandFinder;
        const found = findNodeAndParent(tree, id);
        if (!found) return tree;
        const movedNode = found.node;
        const walk = (
          nodes: OutlineNode[],
        ): OutlineNode[] => {
          const out: OutlineNode[] = [];
          for (const n of nodes) {
            if (n === parentNode) {
              const newChildren = n.children.filter((c) => c.id !== id).map((c) => ({ ...c }));
              out.push({ ...n, children: walk(newChildren) });
              out.push(movedNode);
            } else {
              out.push({ ...n, children: walk(n.children) });
            }
          }
          return out;
        };
        return walk(tree);
      });
    },
    [findNodeAndParent],
  );

  const moveNode = useCallback(
    (id: string, dir: -1 | 1) => {
      setOutline((tree) => {
        const walk = (nodes: OutlineNode[]): OutlineNode[] => {
          const idx = nodes.findIndex((n) => n.id === id);
          if (idx >= 0) {
            const target = idx + dir;
            if (target < 0 || target >= nodes.length) return nodes;
            const next = nodes.slice();
            const [m] = next.splice(idx, 1);
            next.splice(target, 0, m);
            return next;
          }
          return nodes.map((n) => ({ ...n, children: walk(n.children) }));
        };
        return walk(tree);
      });
    },
    [],
  );

  // Keyboard ----------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      // Page nav
      if (e.key === "[") {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        if (parsed) setPage((p) => Math.min(parsed.pageCount - 1, p + 1));
        return;
      }
      if (selection.kind === "node") {
        const id = selection.id;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          removeNode(id);
          setSelection({ kind: "none" });
        } else if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          indentNode(id);
        } else if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          outdentNode(id);
        } else if (e.altKey && e.key === "ArrowUp") {
          e.preventDefault();
          moveNode(id, -1);
        } else if (e.altKey && e.key === "ArrowDown") {
          e.preventDefault();
          moveNode(id, 1);
        }
      }
      if (selection.kind === "link" && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        setLinks((arr) => arr.filter((l) => l.id !== selection.id));
        setSelection({ kind: "none" });
      }
      // Linkify URLs on current page
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l" && sourceBytes) {
        e.preventDefault();
        void runLinkify();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, parsed, sourceBytes, removeNode, indentNode, outdentNode, moveNode]);

  async function runLinkify() {
    if (!sourceBytes) return;
    setBusy(true);
    try {
      const found = await linkifyPage(sourceBytes, page, links);
      if (found.length === 0) {
        toast.message("No new URLs on this page");
      } else {
        setLinks((arr) => [...arr, ...found]);
        toast.success(`Linkified ${found.length} URL${found.length === 1 ? "" : "s"} on page ${page + 1}`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Linkify failed");
    } finally {
      setBusy(false);
    }
  }

  // Export ------------------------------------------------------------------
  async function buildAndDownload() {
    if (!sourceBytes) return;
    setBusy(true);
    try {
      const out = await exportPdf(sourceBytes, outline, links);
      const baseName = sourceName.replace(/\.pdf$/i, "");
      await downloadPdf(out, `${baseName}-outline.pdf`);
      toast.success("PDF exported");
    } catch (err) {
      console.error(err);
      toast.error("Export failed");
    } finally {
      setBusy(false);
    }
  }

  // Selected models ---------------------------------------------------------
  const selectedNode = useMemo(() => {
    if (selection.kind !== "node") return null;
    return findNodeAndParent(outline, selection.id)?.node ?? null;
  }, [selection, outline, findNodeAndParent]);

  const selectedLink = useMemo(() => {
    if (selection.kind !== "link") return null;
    return links.find((l) => l.id === selection.id) ?? null;
  }, [selection, links]);

  // Render ------------------------------------------------------------------
  return (
    <AppShell>
      <ToolHeader
        tag="Outline & Links"
        title={sourceBytes ? (sourceName || "Outline & Links") : "Edit bookmarks and links — keyboard first."}
        sub={
          <>
            Tree on the left, page in the middle, inspector on the right.{" "}
            <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-card border border-whisper">Tab</kbd>{" "}
            nests, <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-card border border-whisper">Alt+↑↓</kbd>{" "}
            reorders, <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-card border border-whisper">Ctrl+L</kbd>{" "}
            linkifies URLs.
          </>
        }
        collapsed={!!sourceBytes}
      />
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 py-8 space-y-6">
        <div className="flex items-center justify-end gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-md border border-whisper px-3 py-1.5 text-xs hover:bg-accent/60 cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            <span>Open PDF</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <Button
            onClick={buildAndDownload}
            disabled={!sourceBytes || busy}
            className="bg-vault text-vault-foreground hover:opacity-90"
            size="sm"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export PDF
          </Button>
          <ExportFormatRow className="ml-auto" />
        </div>


        {/* Tray pick row */}
        {entries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground">
            <span>Tray:</span>
            {entries.map((e) => (
              <button
                key={e.id}
                onClick={() => pickFromTray(e)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-whisper bg-card px-2 py-1 normal-case tracking-normal hover:border-vault hover:text-vault transition-colors",
                  sourceName === e.name && "border-vault text-vault",
                )}
                title={e.name}
              >
                <span className="font-medium truncate max-w-[22ch]">{e.name}</span>
                <span className="text-muted-foreground">· {e.pageCount}p</span>
              </button>
            ))}
          </div>
        )}

        {!sourceBytes ? (
          <EmptyState onPickFile={(f) => onFile(f)} hasTray={entries.length > 0} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_320px] gap-4 min-h-[640px]">
            {/* Tree */}
            <aside className="rounded-lg border border-whisper bg-card/40 p-3 overflow-y-auto max-h-[80vh]">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground">
                  Bookmarks
                </div>
                <button
                  className="inline-flex items-center gap-1 text-xs text-vault hover:underline"
                  onClick={addNodeAtRoot}
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
              {outline.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center">
                  No bookmarks. Add one or load a PDF that already has an outline.
                </div>
              ) : (
                <Tree
                  nodes={outline}
                  level={0}
                  selectedId={selection.kind === "node" ? selection.id : null}
                  onSelect={(id) => {
                    setSelection({ kind: "node", id });
                    const found = findNodeAndParent(outline, id);
                    if (found?.node.dest) setPage(found.node.dest.page);
                  }}
                  onToggle={(id, expanded) => updateNode(id, { expanded })}
                />
              )}
            </aside>

            {/* Viewer */}
            <main className="rounded-lg border border-whisper bg-canvas/40 p-3 flex flex-col">
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    p. {page + 1} / {parsed?.pageCount ?? 0}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!parsed || page >= parsed.pageCount - 1}
                    onClick={() =>
                      parsed && setPage((p) => Math.min(parsed.pageCount - 1, p + 1))
                    }
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={runLinkify} disabled={busy}>
                    <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                    Linkify URLs
                  </Button>
                </div>
              </div>
              <PageViewer
                bytes={sourceBytes}
                page={page}
                links={links.filter((l) => l.page === page)}
                selectedLinkId={selection.kind === "link" ? selection.id : null}
                onSelectLink={(id) => setSelection({ kind: "link", id })}
                onDrawLink={(rect) => {
                  const link: LinkAnnot = {
                    id: newId("l"),
                    page,
                    rect,
                    target: { kind: "url", url: "https://" },
                  };
                  setLinks((arr) => [...arr, link]);
                  setSelection({ kind: "link", id: link.id });
                }}
              />
            </main>

            {/* Inspector */}
            <aside className="rounded-lg border border-whisper bg-card/40 p-3 overflow-y-auto max-h-[80vh]">
              <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted-foreground mb-3">
                Inspector
              </div>
              {selectedNode ? (
                <NodeInspector
                  node={selectedNode}
                  pageCount={parsed?.pageCount ?? 1}
                  currentPage={page}
                  onChange={(patch) => updateNode(selectedNode.id, patch)}
                  onUseCurrentPage={() =>
                    updateNode(selectedNode.id, {
                      dest: { page, x: null, y: null, zoom: null },
                    })
                  }
                  onDelete={() => {
                    removeNode(selectedNode.id);
                    setSelection({ kind: "none" });
                  }}
                />
              ) : selectedLink ? (
                <LinkInspector
                  link={selectedLink}
                  pageCount={parsed?.pageCount ?? 1}
                  onChange={(patch) =>
                    setLinks((arr) =>
                      arr.map((l) => (l.id === selectedLink.id ? { ...l, ...patch } : l)),
                    )
                  }
                  onDelete={() => {
                    setLinks((arr) => arr.filter((l) => l.id !== selectedLink.id));
                    setSelection({ kind: "none" });
                  }}
                />
              ) : (
                <div className="text-xs text-muted-foreground">
                  Select a bookmark or a link rectangle on the page to edit it.
                </div>
              )}
            </aside>
          </div>
        )}

        {loading && (
          <div className="text-xs text-muted-foreground">Parsing PDF…</div>
        )}
      </div>
    </AppShell>
  );
}

// ============================================================================
// Tree
// ============================================================================

function Tree({
  nodes,
  level,
  selectedId,
  onSelect,
  onToggle,
}: {
  nodes: OutlineNode[];
  level: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, expanded: boolean) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => (
        <li key={n.id}>
          <div
            className={cn(
              "group/row flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer text-sm",
              selectedId === n.id ? "bg-vault/15 text-vault" : "hover:bg-accent/50",
            )}
            style={{ paddingLeft: 6 + level * 12 }}
            onClick={() => onSelect(n.id)}
          >
            {n.children.length > 0 ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(n.id, !n.expanded);
                }}
                className="h-4 w-4 grid place-items-center text-muted-foreground hover:text-foreground"
              >
                {n.expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>
            ) : (
              <span className="h-4 w-4" />
            )}
            <span
              className={cn(
                "truncate flex-1",
                n.style.bold && "font-semibold",
                n.style.italic && "italic",
              )}
              style={n.color ? { color: rgbToCss(n.color) } : undefined}
            >
              {n.title || "Untitled"}
            </span>
            {n.dest && (
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                p.{n.dest.page + 1}
              </span>
            )}
          </div>
          {n.expanded && n.children.length > 0 && (
            <Tree
              nodes={n.children}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function rgbToCss(c: [number, number, number]) {
  const [r, g, b] = c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

// ============================================================================
// Viewer with rect-draw overlay
// ============================================================================

function PageViewer({
  bytes,
  page,
  links,
  selectedLinkId,
  onSelectLink,
  onDrawLink,
}: {
  bytes: Uint8Array;
  page: number;
  links: LinkAnnot[];
  selectedLinkId: string | null;
  onSelectLink: (id: string) => void;
  onDrawLink: (rect: [number, number, number, number]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState<{ w: number; h: number; pdfW: number; pdfH: number } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );

  // Re-render whenever bytes or page changes.
  useEffect(() => {
    let cancelled = false;
    let doc: any = null;
    async function run() {
      try {
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        const pg = await doc.getPage(page + 1);
        const containerWidth = wrapRef.current?.clientWidth ?? 600;
        const baseViewport = pg.getViewport({ scale: 1 });
        const scale = Math.min(1.8, (containerWidth - 8) / baseViewport.width);
        const viewport = pg.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;
        setPageSize({
          w: viewport.width,
          h: viewport.height,
          pdfW: baseViewport.width,
          pdfH: baseViewport.height,
        });
      } catch (err) {
        console.error(err);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (doc?.destroy) {
        try {
          doc.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, [bytes, page]);

  function pxToPdf(x: number, y: number): { px: number; py: number } {
    if (!pageSize) return { px: 0, py: 0 };
    const sx = pageSize.pdfW / pageSize.w;
    const sy = pageSize.pdfH / pageSize.h;
    return { px: x * sx, py: (pageSize.h - y) * sy };
  }

  function pdfToPx(
    rect: [number, number, number, number],
  ): { left: number; top: number; width: number; height: number } | null {
    if (!pageSize) return null;
    const sx = pageSize.w / pageSize.pdfW;
    const sy = pageSize.h / pageSize.pdfH;
    const left = rect[0] * sx;
    const right = rect[2] * sx;
    const top = pageSize.h - rect[3] * sy;
    const bottom = pageSize.h - rect[1] * sy;
    return { left, top, width: right - left, height: bottom - top };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.dataset.linkRect) return; // clicking an existing rect → select it instead
    const r = wrapRef.current!.getBoundingClientRect();
    setDrag({ x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top });
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!drag) return;
    const r = wrapRef.current!.getBoundingClientRect();
    setDrag({ ...drag, x1: e.clientX - r.left, y1: e.clientY - r.top });
  }
  function onMouseUp() {
    if (!drag || !pageSize) {
      setDrag(null);
      return;
    }
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    if (w > 6 && h > 6) {
      const x0 = Math.min(drag.x0, drag.x1);
      const x1 = Math.max(drag.x0, drag.x1);
      const y0 = Math.min(drag.y0, drag.y1);
      const y1 = Math.max(drag.y0, drag.y1);
      const a = pxToPdf(x0, y1); // bottom-left in PDF
      const b = pxToPdf(x1, y0); // top-right in PDF
      onDrawLink([a.px, a.py, b.px, b.py]);
    }
    setDrag(null);
  }

  return (
    <div
      ref={wrapRef}
      className="relative flex-1 overflow-auto bg-canvas/60 rounded grid place-items-start justify-center select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div className="relative">
        <canvas ref={canvasRef} className="shadow-md" />
        {pageSize &&
          links.map((l) => {
            const r = pdfToPx(l.rect);
            if (!r) return null;
            const isSel = l.id === selectedLinkId;
            return (
              <button
                key={l.id}
                data-link-rect="1"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectLink(l.id);
                }}
                style={{
                  position: "absolute",
                  left: r.left,
                  top: r.top,
                  width: r.width,
                  height: r.height,
                }}
                className={cn(
                  "border-2 cursor-pointer transition-colors",
                  isSel
                    ? "border-vault bg-vault/20"
                    : "border-vault/50 bg-vault/10 hover:bg-vault/20",
                )}
                title={l.target.kind === "url" ? l.target.url : `Go to page ${l.target.dest.page + 1}`}
              />
            );
          })}
        {drag && (
          <div
            style={{
              position: "absolute",
              left: Math.min(drag.x0, drag.x1),
              top: Math.min(drag.y0, drag.y1),
              width: Math.abs(drag.x1 - drag.x0),
              height: Math.abs(drag.y1 - drag.y0),
            }}
            className="border-2 border-dashed border-vault bg-vault/10 pointer-events-none"
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Inspectors
// ============================================================================

function NodeInspector({
  node,
  pageCount,
  currentPage,
  onChange,
  onUseCurrentPage,
  onDelete,
}: {
  node: OutlineNode;
  pageCount: number;
  currentPage: number;
  onChange: (patch: Partial<OutlineNode>) => void;
  onUseCurrentPage: () => void;
  onDelete: () => void;
}) {
  const dest = node.dest ?? { page: 0, x: null, y: null, zoom: null };
  return (
    <div className="space-y-4 text-sm">
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-vault">Bookmark</div>
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={node.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="page">Destination page</Label>
        <div className="flex items-center gap-2">
          <Input
            id="page"
            type="number"
            min={1}
            max={pageCount}
            value={dest.page + 1}
            onChange={(e) => {
              const n = Math.max(1, Math.min(pageCount, Number(e.target.value) || 1));
              onChange({ dest: { ...dest, page: n - 1 } });
            }}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">of {pageCount}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={onUseCurrentPage}
            title="Use the page currently in the viewer"
          >
            Use p.{currentPage + 1}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={node.style.bold}
            onChange={(e) => onChange({ style: { ...node.style, bold: e.target.checked } })}
          />
          <span className="font-bold">Bold</span>
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={node.style.italic}
            onChange={(e) => onChange({ style: { ...node.style, italic: e.target.checked } })}
          />
          <span className="italic">Italic</span>
        </label>
      </div>
      <div className="space-y-1.5">
        <Label>Color</Label>
        <input
          type="color"
          value={node.color ? rgbToHex(node.color) : "#000000"}
          onChange={(e) => onChange({ color: hexToRgb(e.target.value) })}
          className="h-7 w-14 rounded border border-whisper bg-transparent cursor-pointer"
        />
        {node.color && (
          <button
            className="ml-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange({ color: null })}
          >
            Reset
          </button>
        )}
      </div>
      <div className="pt-2 border-t border-whisper">
        <Button
          variant="outline"
          size="sm"
          className="text-evidence hover:text-evidence border-evidence/40 hover:border-evidence"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete bookmark
        </Button>
      </div>
    </div>
  );
}

function LinkInspector({
  link,
  pageCount,
  onChange,
  onDelete,
}: {
  link: LinkAnnot;
  pageCount: number;
  onChange: (patch: Partial<LinkAnnot>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-vault inline-flex items-center gap-1.5">
        <Link2 className="h-3 w-3" /> Link
      </div>
      <div className="text-xs text-muted-foreground">
        Page {link.page + 1} · rect {link.rect.map((n) => Math.round(n)).join(", ")}
      </div>
      <div className="space-y-1.5">
        <Label>Kind</Label>
        <div className="flex gap-2">
          <button
            className={cn(
              "flex-1 rounded border px-2 py-1.5 text-xs",
              link.target.kind === "url"
                ? "border-vault bg-vault/10 text-vault"
                : "border-whisper",
            )}
            onClick={() => onChange({ target: { kind: "url", url: link.target.kind === "url" ? link.target.url : "https://" } })}
          >
            URL
          </button>
          <button
            className={cn(
              "flex-1 rounded border px-2 py-1.5 text-xs",
              link.target.kind === "goto"
                ? "border-vault bg-vault/10 text-vault"
                : "border-whisper",
            )}
            onClick={() =>
              onChange({
                target:
                  link.target.kind === "goto"
                    ? link.target
                    : { kind: "goto", dest: { page: link.page, x: null, y: null, zoom: null } },
              })
            }
          >
            In-doc
          </button>
        </div>
      </div>
      {link.target.kind === "url" ? (
        <div className="space-y-1.5">
          <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            value={link.target.url}
            onChange={(e) => onChange({ target: { kind: "url", url: e.target.value } })}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="lpage">Target page</Label>
          <Input
            id="lpage"
            type="number"
            min={1}
            max={pageCount}
            value={link.target.dest.page + 1}
            onChange={(e) => {
              const n = Math.max(1, Math.min(pageCount, Number(e.target.value) || 1));
              const dest: Dest = { ...link.target.kind === "goto" ? link.target.dest : { page: 0, x: null, y: null, zoom: null }, page: n - 1 };
              onChange({ target: { kind: "goto", dest } });
            }}
            className="w-24"
          />
        </div>
      )}
      <div className="pt-2 border-t border-whisper">
        <Button
          variant="outline"
          size="sm"
          className="text-evidence hover:text-evidence border-evidence/40 hover:border-evidence"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete link
        </Button>
      </div>
    </div>
  );
}

function rgbToHex(c: [number, number, number]) {
  return (
    "#" +
    c
      .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

// ============================================================================
// Empty state
// ============================================================================

function EmptyState({
  onPickFile,
  hasTray,
}: {
  onPickFile: (f: File | undefined) => void;
  hasTray: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed border-whisper bg-card/30 p-10 text-center space-y-3">
      <FilePlus2 className="h-8 w-8 mx-auto text-muted-foreground" />
      <div className="font-display text-xl">Load a PDF to edit its outline.</div>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        {hasTray
          ? "Pick one from your tray above, or drop a fresh PDF below. The bookmark tree and existing link annotations will load automatically."
          : "Drop a PDF below — the bookmark tree and existing link annotations will load automatically."}
      </p>
      <label className="inline-flex items-center gap-1.5 mt-2 rounded-md border border-vault/40 bg-vault/10 text-vault px-4 py-2 text-sm cursor-pointer hover:bg-vault/20">
        <Upload className="h-4 w-4" />
        <span>Choose PDF</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />
      </label>
    </div>
  );
}
