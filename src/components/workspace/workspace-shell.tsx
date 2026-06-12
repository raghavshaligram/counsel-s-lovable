import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Lock,
  Download,
  Files,
  Shield,
  PenLine,
  RefreshCw,
  KeyRound,
  Layout,
  Scale,
  Sparkles,
  X,
  MousePointer2,
  Type,
  TextCursorInput,
  Highlighter,
  Underline as UnderlineIcon,
  Strikethrough,
  MessageSquare,
  Image as ImageIcon,
  Crop,
  Square,
  Pencil,
  Undo2,
  Redo2,
  SlidersHorizontal,
  LayoutGrid,
  Minus,
  Plus,
  Maximize2,
  StretchHorizontal,
  Upload,
  FilePlus2,
  LayoutTemplate,
  Images as PhotoIcon,
  FileType,
  ArrowRight,
  Scissors,
  RotateCw,
  Table2 as TableIcon,
  FileStack,
  ScanText,
  Stamp,
  PackageOpen,
  ListTree,
  Hash,
  Layers,
  ScanSearch,
  Grid3x3,
  Search,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  loadUIState,
  saveUIStateDebounced,
  listRecents,
  addRecent,
  getRecent,
  removeRecent,
  clearRecents,
  type RecentMeta,
} from "@/lib/workspace/persistence";


type ToolId =
  | "pages"
  | "redact"
  | "sign"
  | "convert"
  | "secure"
  | "layout"
  | "legal"
  | "ai";

type ToolGroupLabel =
  | "Pages"
  | "Convert"
  | "Edit"
  | "Redact"
  | "Secure"
  | "Layout"
  | "Legal"
  | "AI";

type Tool = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: ToolId;
  groupLabel: ToolGroupLabel;
};

const TOOLS: Tool[] = [
  // Pages
  { id: "organize", label: "Organize", icon: LayoutGrid, group: "pages", groupLabel: "Pages" },
  { id: "merge", label: "Merge", icon: Files, group: "pages", groupLabel: "Pages" },
  { id: "split", label: "Split", icon: Scissors, group: "pages", groupLabel: "Pages" },
  { id: "rotate", label: "Rotate", icon: RotateCw, group: "pages", groupLabel: "Pages" },
  { id: "extract", label: "Extract", icon: TableIcon, group: "pages", groupLabel: "Pages" },
  { id: "mail-merge", label: "Mail Merge", icon: FileStack, group: "pages", groupLabel: "Pages" },
  { id: "page-crop", label: "Page Crop", icon: Crop, group: "pages", groupLabel: "Pages" },
  // Convert
  { id: "to-word", label: "PDF → Word", icon: FileType, group: "convert", groupLabel: "Convert" },
  { id: "word-to-pdf", label: "Word → PDF", icon: FileType, group: "convert", groupLabel: "Convert" },
  { id: "to-images", label: "PDF → Images", icon: PhotoIcon, group: "convert", groupLabel: "Convert" },
  { id: "images-to-pdf", label: "Images → PDF", icon: PhotoIcon, group: "convert", groupLabel: "Convert" },
  { id: "to-excel", label: "PDF → Excel", icon: TableIcon, group: "convert", groupLabel: "Convert" },
  { id: "ocr", label: "Make Searchable", icon: ScanText, group: "convert", groupLabel: "Convert" },
  // Edit
  { id: "sign", label: "Sign & Fill", icon: PenLine, group: "sign", groupLabel: "Edit" },
  { id: "watermark", label: "Watermark", icon: Stamp, group: "secure", groupLabel: "Edit" },
  { id: "compress", label: "Compress", icon: PackageOpen, group: "secure", groupLabel: "Edit" },
  // Redact
  { id: "redact", label: "Redact", icon: Shield, group: "redact", groupLabel: "Redact" },
  // Secure
  { id: "protect", label: "Protect", icon: KeyRound, group: "secure", groupLabel: "Secure" },
  { id: "unlock", label: "Unlock", icon: KeyRound, group: "secure", groupLabel: "Secure" },
  { id: "compare", label: "Compare", icon: Scale, group: "layout", groupLabel: "Secure" },
  // Layout
  { id: "outline", label: "Outline & Links", icon: ListTree, group: "layout", groupLabel: "Layout" },
  { id: "page-numbers", label: "Page Numbers", icon: Hash, group: "layout", groupLabel: "Layout" },
  { id: "header-footer", label: "Header & Footer", icon: Layout, group: "layout", groupLabel: "Layout" },
  { id: "flatten", label: "Flatten", icon: Layers, group: "layout", groupLabel: "Layout" },
  // Legal
  { id: "bates", label: "Bates", icon: Hash, group: "legal", groupLabel: "Legal" },
  { id: "verifiable-redaction", label: "Verifiable Redaction", icon: Shield, group: "legal", groupLabel: "Legal" },
  { id: "privilege-scan", label: "Privilege Scan", icon: ScanSearch, group: "legal", groupLabel: "Legal" },
  // AI
  { id: "chat", label: "Search Inside PDF", icon: Sparkles, group: "ai", groupLabel: "AI" },
];

const GROUP_ORDER: ToolGroupLabel[] = [
  "Pages", "Convert", "Edit", "Redact", "Secure", "Layout", "Legal", "AI",
];

const DEFAULT_PINS = ["redact", "sign", "merge", "chat"];
const PIN_CAP = 5;
const USAGE_KEY = "vaultpdf:tool-usage";

function loadUsage(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(USAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function computePins(counts: Record<string, number>): string[] {
  // Tools must be used 2+ times to "earn" a pinned slot.
  const earned = Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const result: string[] = [];
  for (const id of earned) {
    if (result.length >= PIN_CAP) break;
    if (TOOLS.some((t) => t.id === id)) result.push(id);
  }
  for (const id of DEFAULT_PINS) {
    if (result.length >= PIN_CAP) break;
    if (!result.includes(id) && TOOLS.some((t) => t.id === id)) result.push(id);
  }
  return result.slice(0, PIN_CAP);
}

function toolById(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}

type EditorTool =
  | "select"
  | "text"
  | "edit-text"
  | "highlight"
  | "underline"
  | "strike"
  | "comment"
  | "image"
  | "crop"
  | "shape"
  | "pen";

type ReadingTheme = "dark" | "sepia" | "soft" | "white";

const THEME_TINT: Record<ReadingTheme, string> = {
  dark: "transparent",
  sepia: "rgba(247, 243, 233, 0.06)",
  soft: "rgba(228, 231, 226, 0.05)",
  white: "rgba(255, 255, 255, 0.04)",
};

export function WorkspaceShell({ initialTool }: { initialTool?: ToolId }) {
  const [file, setFile] = useState<File | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [, setActiveGroup] = useState<ToolId | null>(initialTool ?? null);
  const [activeToolId, setActiveToolId] = useState<string | null>(
    initialTool ? TOOLS.find((t) => t.group === initialTool)?.id ?? null : null,
  );
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(Boolean(initialTool));
  const [editorTool, setEditorToolRaw] = useState<EditorTool>("select");
  const [zoom, setZoom] = useState<number>(100);
  const [viewOpen, setViewOpen] = useState(false);
  const [pageLayout, setPageLayout] = useState<"single" | "double">("single");
  const [continuous, setContinuous] = useState(true);
  const [showGaps, setShowGaps] = useState(true);
  const [theme, setTheme] = useState<ReadingTheme>("dark");
  const [dragOver, setDragOver] = useState(false);
  const [aiText, setAiText] = useState("");
  const [toolModalOpen, setToolModalOpen] = useState(false);
  // Defer localStorage read to the client to avoid SSR hydration mismatch.
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [recents, setRecents] = useState<RecentMeta[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const aiRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate persisted UI state + usage + recents on the client only.
  useEffect(() => {
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(USAGE_KEY);
      if (raw) setUsage(JSON.parse(raw));
    } catch { /* ignore */ }
    (async () => {
      const [ui, recentsList] = await Promise.all([loadUIState(), listRecents()]);
      if (cancelled) return;
      if (ui) {
        if (ui.activeToolId) setActiveToolId(ui.activeToolId);
        if (typeof ui.inspectorOpen === "boolean") setInspectorOpen(ui.inspectorOpen);
        if (ui.pageLayout) setPageLayout(ui.pageLayout);
        if (typeof ui.continuous === "boolean") setContinuous(ui.continuous);
        if (typeof ui.showGaps === "boolean") setShowGaps(ui.showGaps);
        if (ui.theme) setTheme(ui.theme);
        if (typeof ui.zoom === "number") setZoom(ui.zoom);
      }
      setRecents(recentsList);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist UI state (debounced) once hydrated.
  useEffect(() => {
    if (!hydrated) return;
    saveUIStateDebounced({
      activeToolId,
      inspectorOpen,
      pageLayout,
      continuous,
      showGaps,
      theme,
      zoom,
      licenseKey: null,
    });
  }, [hydrated, activeToolId, inspectorOpen, pageLayout, continuous, showGaps, theme, zoom]);


  // Mark the document dirty when the user picks a mutating editor tool.
  const setEditorTool = useCallback((t: EditorTool) => {
    setEditorToolRaw(t);
    if (t !== "select" && t !== "comment") setIsDirty(true);
  }, []);

  const pins = useMemo(() => computePins(usage), [usage]);
  const pinnedTools = useMemo(
    () => pins.map((id) => toolById(id)).filter((t): t is Tool => Boolean(t)),
    [pins],
  );

  const bumpUsage = useCallback((id: string) => {
    setUsage((prev) => {
      const next = { ...prev, [id]: (prev[id] || 0) + 1 };
      try {
        window.localStorage.setItem(USAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const openTool = useCallback(
    (toolId: string, opts?: { bump?: boolean }) => {
      const tool = toolById(toolId);
      if (!tool) return;
      setActiveGroup(tool.group);
      setActiveToolId(tool.id);
      setInspectorOpen(true);
      setToolModalOpen(false);
      if (opts?.bump !== false) bumpUsage(toolId);
    },
    [bumpUsage],
  );

  const openFile = useCallback(() => fileInputRef.current?.click(), []);
  const onFiles = useCallback((files: FileList | null) => {
    const f = files?.[0];
    if (f) {
      setFile(f);
      setIsDirty(false);
    }
  }, []);

  const loadBlank = useCallback(() => {
    setFile(new File([], "Untitled.pdf", { type: "application/pdf" }));
    setIsDirty(false);
  }, []);
  const loadTemplate = useCallback((name: string) => {
    setFile(new File([], `${name}.pdf`, { type: "application/pdf" }));
    setIsDirty(false);
  }, []);

  const clearToStart = useCallback(() => {
    setFile(null);
    setIsDirty(false);
    setEditorToolRaw("select");
    setInspectorOpen(false);
    setActiveToolId(null);
  }, []);

  // Guarded "go to Start". If the doc has unsaved edits, ask first.
  const goHome = useCallback(() => {
    if (file && isDirty) {
      setConfirmClearOpen(true);
      return;
    }
    clearToStart();
  }, [file, isDirty, clearToStart]);

  const handleSaveAndClear = useCallback(() => {
    // Export flow placeholder — real export lives in the feature panels.
    // eslint-disable-next-line no-console
    console.log("[workspace] save before leaving", file?.name);
    setConfirmClearOpen(false);
    clearToStart();
  }, [file, clearToStart]);

  const handleDiscardAndClear = useCallback(() => {
    setConfirmClearOpen(false);
    clearToStart();
  }, [clearToStart]);

  // Warn on page unload too, so a stray refresh doesn't lose edits.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        aiRef.current?.focus();
      } else if (meta && e.key === "\\") {
        e.preventDefault();
        setInspectorOpen((v) => !v);
      } else if (!meta && e.key.toLowerCase() === "o" && document.activeElement === document.body) {
        e.preventDefault();
        openFile();
      } else if (!meta && (e.key === "+" || e.key === "=")) {
        setZoom((z) => Math.min(400, z + 10));
      } else if (!meta && e.key === "-") {
        setZoom((z) => Math.max(25, z - 10));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile]);

  // Drag-drop anywhere
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    onFiles(e.dataTransfer.files);
  }, [onFiles]);

  const submitAi = useCallback(() => {
    if (!aiText.trim()) return;
    // eslint-disable-next-line no-console
    console.log("[workspace] routeCommand", aiText);
    setAiText("");
  }, [aiText]);

  const sizeLabel = useMemo(() => (file ? prettyBytes(file.size) : "—"), [file]);

  return (
    <div
      className="flex h-screen w-full flex-col bg-background text-foreground"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      {/* TOP BAR */}
      <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-border bg-surface-1 px-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={goHome}
            title="Start screen"
            aria-label="Go to Start"
            className="flex items-center gap-2.5 rounded-md px-1 -mx-1 py-0.5 hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className="grid h-6 w-6 place-items-center bg-vault text-vault-foreground"
              style={{ borderRadius: 7 }}
            >
              <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            <span className="font-display text-[15px] leading-none">VaultPDF</span>
          </button>
          <button
            type="button"
            onClick={goHome}
            title="New (return to Start)"
            aria-label="New"
            className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            <FilePlus2 className="h-[15px] w-[15px]" />
          </button>
          <span className="mx-1 h-4 w-px bg-border" />
          <span className="truncate text-[13px] text-text-2">
            {file?.name ?? "Untitled document"}
            {isDirty && file && (
              <span className="ml-1.5 text-vault" aria-label="Unsaved changes" title="Unsaved changes">•</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[11px] font-medium text-vault"
          >
            <Lock className="h-3 w-3" strokeWidth={2.5} />
            100% in your browser
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground hover:opacity-90 transition-opacity"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
            Export
          </button>
        </div>
      </header>

      {/* MAIN ROW */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT RAIL */}
        <nav className="flex w-[52px] shrink-0 flex-col items-center justify-between border-r border-border bg-surface-1 py-3">
          <ul className="flex flex-col items-center gap-1.5">
            {pinnedTools.map((tool) => (
              <li key={tool.id}>
                <RailButton
                  active={activeToolId === tool.id && inspectorOpen}
                  label={tool.label}
                  onClick={() => openTool(tool.id)}
                >
                  <tool.icon className="h-[18px] w-[18px]" />
                </RailButton>
              </li>
            ))}
          </ul>
          <RailButton
            label="All tools"
            active={toolModalOpen}
            onClick={() => setToolModalOpen((v) => !v)}
          >
            <Grid3x3 className="h-[18px] w-[18px]" />
          </RailButton>
        </nav>

        {/* CANVAS + INSPECTOR */}
        <div className="relative flex min-w-0 flex-1">
          {/* CANVAS */}
          <main className="relative flex min-w-0 flex-1 flex-col bg-background">
            {/* Floating toolbar + view popover anchor */}
            {file && (
              <>
                <FloatingToolbar active={editorTool} onChange={setEditorTool} />
                <ContextualBar tool={editorTool} />
              </>
            )}
            <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
              <CanvasIconButton
                label="Thumbnails"
                onClick={() => openTool("organize")}
              >
                <LayoutGrid className="h-[15px] w-[15px]" />
              </CanvasIconButton>
              <CanvasIconButton
                label="Adjust view"
                active={viewOpen}
                onClick={() => setViewOpen((v) => !v)}
              >
                <SlidersHorizontal className="h-[15px] w-[15px]" />
              </CanvasIconButton>
              {viewOpen && (
                <ViewPopover
                  pageLayout={pageLayout}
                  onPageLayout={setPageLayout}
                  continuous={continuous}
                  onContinuous={setContinuous}
                  showGaps={showGaps}
                  onShowGaps={setShowGaps}
                  theme={theme}
                  onTheme={setTheme}
                  onClose={() => setViewOpen(false)}
                />
              )}
            </div>

            {/* Scroll area */}
            <div className="relative flex-1 overflow-auto">
              {/* Theme tint overlay (view-only) */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 transition-colors"
                style={{ backgroundColor: THEME_TINT[theme] }}
              />
              {file ? (
                <PagesPlaceholder
                  file={file}
                  zoom={zoom}
                  layout={pageLayout}
                  gap={showGaps ? 18 : 0}
                  continuous={continuous}
                />
              ) : (
                <EmptyStart
                  onOpen={openFile}
                  onBlank={loadBlank}
                  onTemplate={loadTemplate}
                />
              )}
            </div>

            {/* AI command bar */}
            <div className="flex h-[56px] shrink-0 items-center justify-center px-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitAi();
                }}
                className="flex w-full max-w-[520px] items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2"
                style={{ boxShadow: "var(--shadow-float)" }}
              >
                <Sparkles className="h-4 w-4 text-vault shrink-0" />
                <input
                  ref={aiRef}
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  placeholder='Tell VaultPDF what to do — "redact every phone number"'
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <KeyChip>⌘K</KeyChip>
              </form>
            </div>
          </main>

          {/* INSPECTOR slide-over */}
          <Inspector
            open={inspectorOpen}
            activeTool={activeToolId ? toolById(activeToolId) ?? null : null}
            onClose={() => setInspectorOpen(false)}
          />
        </div>
      </div>

      {/* TOOL MODAL */}
      {toolModalOpen && (
        <ToolModal
          activeToolId={activeToolId}
          onSelect={(id) => openTool(id)}
          onClose={() => setToolModalOpen(false)}
        />
      )}

      {/* BOTTOM BAR */}
      <footer className="flex h-[38px] shrink-0 items-center justify-between border-t border-border bg-surface-1 px-3 text-[11.5px]">
        <div className="font-mono text-text-muted truncate">
          {file ? `${file.name} · — pages · ${sizeLabel}` : "No document loaded"}
        </div>
        <div className="flex items-center gap-1">
          <ZoomButton onClick={() => setZoom((z) => Math.max(25, z - 10))} label="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </ZoomButton>
          <button
            type="button"
            onClick={() => setZoom(100)}
            title="Reset to 100%"
            className="font-mono tabular-nums px-2 text-text-2 hover:text-foreground min-w-[3.5rem] text-center"
          >
            {zoom}%
          </button>
          <ZoomButton onClick={() => setZoom((z) => Math.min(400, z + 10))} label="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </ZoomButton>
          <span className="mx-1 h-3.5 w-px bg-border" />
          <ZoomButton onClick={() => setZoom(100)} label="Fit width">
            <StretchHorizontal className="h-3.5 w-3.5" />
          </ZoomButton>
        </div>
        <div className="flex items-center gap-1.5 text-text-muted">
          <Lock className="h-3 w-3 text-vault" strokeWidth={2.5} />
          processed locally
        </div>
      </footer>

      {/* Drop overlay */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-dashed border-vault/60 bg-surface-2 px-10 py-8 text-center">
            <Upload className="mx-auto h-7 w-7 text-vault" />
            <div className="mt-3 font-display text-xl">Drop to open</div>
            <div className="text-[12px] text-muted-foreground">Stays on this device</div>
          </div>
        </div>
      )}

      {/* Unsaved-changes guard */}
      {confirmClearOpen && (
        <UnsavedChangesDialog
          filename={file?.name}
          onSave={handleSaveAndClear}
          onDiscard={handleDiscardAndClear}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}
    </div>
  );
}

/* -------------------- Unsaved changes dialog ------------------------ */

function UnsavedChangesDialog({
  filename,
  onSave,
  onDiscard,
  onCancel,
}: {
  filename?: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Unsaved changes"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(420px,92vw)] border border-border bg-surface-1 p-5"
        style={{ borderRadius: 14, boxShadow: "var(--shadow-float)" }}
      >
        <div className="font-display text-[18px] leading-tight">Save your changes?</div>
        <p className="mt-1.5 text-[12.5px] text-text-2 leading-snug">
          {filename ? `“${filename}”` : "This document"} has edits that aren't saved.
          Leaving will lose them.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-2 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-2 hover:text-foreground"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Rail ---------------------------------- */

function RailButton({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "group relative grid h-9 w-9 place-items-center text-text-2 transition-colors",
        "hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent-soft text-vault"
      )}
      style={{ borderRadius: 9 }}
    >
      {children}
      <span className="pointer-events-none absolute left-[110%] top-1/2 z-40 -translate-y-1/2 whitespace-nowrap rounded-md bg-surface-3 px-2 py-1 text-[11px] text-foreground opacity-0 shadow-[var(--shadow-card)] group-hover:opacity-100 transition-opacity">
        {label}
      </span>
    </button>
  );
}

/* ------------------------ Floating toolbar --------------------------- */

const EDITOR_GROUPS: Array<Array<{ id: EditorTool; label: string; Icon: React.ComponentType<{ className?: string }> }>> = [
  [{ id: "select", label: "Select", Icon: MousePointer2 }],
  [
    { id: "text", label: "Add text", Icon: Type },
    { id: "edit-text", label: "Edit text", Icon: TextCursorInput },
  ],
  [
    { id: "highlight", label: "Highlight", Icon: Highlighter },
    { id: "underline", label: "Underline", Icon: UnderlineIcon },
    { id: "strike", label: "Strikethrough", Icon: Strikethrough },
  ],
  [{ id: "comment", label: "Comment", Icon: MessageSquare }],
  [
    { id: "image", label: "Insert image", Icon: ImageIcon },
    { id: "crop", label: "Crop page — trim the page area. With an image selected, the contextual bar shows a separate Crop image affordance.", Icon: Crop },
    { id: "shape", label: "Shapes", Icon: Square },
    { id: "pen", label: "Freehand", Icon: Pencil },
  ],
];

function FloatingToolbar({
  active,
  onChange,
}: {
  active: EditorTool;
  onChange: (t: EditorTool) => void;
}) {
  return (
    <div
      className="absolute left-1/2 top-2.5 z-30 flex -translate-x-1/2 items-center gap-1 border border-border bg-surface-3 px-1.5 py-1"
      style={{ borderRadius: 11, boxShadow: "var(--shadow-float)" }}
      role="toolbar"
      aria-label="Editor tools"
    >
      {EDITOR_GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-5 w-px bg-border" />}
          {group.map(({ id, label, Icon }) => (
            <ToolbarBtn
              key={id}
              label={label}
              active={active === id}
              onClick={() => onChange(id)}
            >
              <Icon className="h-[15px] w-[15px]" />
            </ToolbarBtn>
          ))}
        </div>
      ))}
      <span className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn label="Undo" onClick={() => {}}>
        <Undo2 className="h-[15px] w-[15px]" />
      </ToolbarBtn>
      <ToolbarBtn label="Redo" onClick={() => {}}>
        <Redo2 className="h-[15px] w-[15px]" />
      </ToolbarBtn>
    </div>
  );
}

function ToolbarBtn({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-md text-text-2 transition-colors",
        "hover:text-foreground hover:bg-surface-2",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-vault text-vault-foreground hover:bg-vault hover:text-vault-foreground"
      )}
    >
      {children}
    </button>
  );
}

/* --------------------- Contextual properties bar -------------------- */

function ContextualBar({ tool }: { tool: EditorTool }) {
  const props = contextFor(tool);
  if (!props) return null;
  return (
    <div
      className="absolute left-1/2 top-[58px] z-20 flex -translate-x-1/2 items-center gap-2 border border-border bg-surface-3 px-2.5 py-1.5 text-[12px] text-text-2"
      style={{ borderRadius: 11, boxShadow: "var(--shadow-float)" }}
    >
      {props}
    </div>
  );
}

function contextFor(tool: EditorTool): React.ReactNode | null {
  switch (tool) {
    case "text":
    case "edit-text":
      return (
        <>
          <Select label="Inter" />
          <Select label="14" />
          <span className="h-4 w-px bg-border" />
          <PropBtn>B</PropBtn>
          <PropBtn className="italic">I</PropBtn>
          <PropBtn className="underline">U</PropBtn>
          <span className="h-4 w-px bg-border" />
          <ColorSwatch />
          <Select label="Left" />
        </>
      );
    case "highlight":
    case "underline":
    case "strike":
      return (
        <>
          <ColorSwatch />
          <span className="text-text-muted">Color</span>
        </>
      );
    case "shape":
    case "pen":
      return (
        <>
          <ColorSwatch />
          <span className="h-4 w-px bg-border" />
          <Select label="2 px" />
        </>
      );
    case "image":
      return (
        <>
          <PropBtn>Position</PropBtn>
          <PropBtn title="Crop this image only (not the page)">Crop image</PropBtn>
        </>
      );
    case "crop":
      return (
        <>
          <span className="text-text-muted">Drag on the page to set the crop rectangle · trims the page area, not images</span>
        </>
      );
    case "comment":
    case "select":
    default:
      return null;
  }
}

function Select({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="rounded-md bg-surface-2 px-2 py-0.5 text-text-2 hover:text-foreground"
    >
      {label}
    </button>
  );
}

function PropBtn({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        "grid h-6 min-w-[24px] place-items-center rounded-md px-1.5 text-[12px] text-text-2 hover:bg-surface-2 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function ColorSwatch() {
  return (
    <button
      type="button"
      aria-label="Color"
      className="h-4 w-4 rounded-full ring-1 ring-border"
      style={{ background: "var(--vault)" }}
    />
  );
}

function CanvasIconButton({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-md border border-border bg-surface-2 text-text-2",
        "hover:text-foreground transition-colors",
        active && "text-vault bg-accent-soft border-vault/30"
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------- View popover --------------------------- */

function ViewPopover({
  pageLayout,
  onPageLayout,
  continuous,
  onContinuous,
  showGaps,
  onShowGaps,
  theme,
  onTheme,
  onClose,
}: {
  pageLayout: "single" | "double";
  onPageLayout: (v: "single" | "double") => void;
  continuous: boolean;
  onContinuous: (v: boolean) => void;
  showGaps: boolean;
  onShowGaps: (v: boolean) => void;
  theme: ReadingTheme;
  onTheme: (v: ReadingTheme) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute right-0 top-9 z-40 w-[248px] border border-border bg-surface-1 p-3 text-[12.5px]"
      style={{ borderRadius: 14, boxShadow: "var(--shadow-float)" }}
      onMouseLeave={onClose}
    >
      <Section label="Page layout">
        <div className="grid grid-cols-2 gap-2">
          <LayoutCard
            active={pageLayout === "single"}
            onClick={() => onPageLayout("single")}
            label="Single"
          >
            <PageGlyph variant="single" active={pageLayout === "single"} />
          </LayoutCard>
          <LayoutCard
            active={pageLayout === "double"}
            onClick={() => onPageLayout("double")}
            label="Double"
          >
            <PageGlyph variant="double" active={pageLayout === "double"} />
          </LayoutCard>
        </div>
      </Section>

      <Section label="Continuous scroll">
        <Toggle on={continuous} onChange={onContinuous} />
      </Section>

      <Section label="Show page gaps">
        <Toggle on={showGaps} onChange={onShowGaps} />
      </Section>

      <Section label="Reading theme">
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              { id: "dark", color: "#0E1116" },
              { id: "sepia", color: "#F7F3E9" },
              { id: "soft", color: "#E4E7E2" },
              { id: "white", color: "#FFFFFF" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => onTheme(s.id)}
              aria-label={s.id}
              className={cn(
                "h-7 rounded-md border transition-all",
                theme === s.id ? "border-vault" : "border-border"
              )}
              style={{ background: s.color }}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-muted leading-snug">
          Tints your view only — never changes the file.
        </p>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-text-muted">{label}</span>
      </div>
      {children}
    </div>
  );
}

function LayoutCard({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-md border bg-surface-2 px-2 py-2.5 transition-colors",
        active ? "border-vault" : "border-border hover:border-text-muted/40"
      )}
    >
      {children}
      <span className="text-[11px] text-text-2">{label}</span>
    </button>
  );
}

function PageGlyph({ variant, active }: { variant: "single" | "double"; active: boolean }) {
  const stroke = active ? "var(--vault)" : "currentColor";
  const fill = active ? "color-mix(in oklab, var(--vault) 12%, transparent)" : "var(--paper)";
  const op = active ? 1 : 0.55;
  if (variant === "single") {
    return (
      <svg
        viewBox="0 0 24 32"
        width="22"
        height="30"
        className="mx-auto text-text-2"
        style={{ opacity: op }}
        aria-hidden
      >
        <rect x="1.5" y="1.5" width="21" height="29" rx="2" fill={fill} stroke={stroke} strokeWidth="1.2" />
        <line x1="5" y1="8" x2="19" y2="8" stroke={stroke} strokeWidth="1" opacity="0.45" />
        <line x1="5" y1="12" x2="19" y2="12" stroke={stroke} strokeWidth="1" opacity="0.45" />
        <line x1="5" y1="16" x2="15" y2="16" stroke={stroke} strokeWidth="1" opacity="0.45" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 32 32"
      width="30"
      height="30"
      className="mx-auto text-text-2"
      style={{ opacity: op }}
      aria-hidden
    >
      <rect x="1.5" y="2.5" width="13" height="27" rx="1.8" fill={fill} stroke={stroke} strokeWidth="1.2" />
      <rect x="17.5" y="2.5" width="13" height="27" rx="1.8" fill={fill} stroke={stroke} strokeWidth="1.2" />
      <line x1="4" y1="9" x2="12" y2="9" stroke={stroke} strokeWidth="1" opacity="0.45" />
      <line x1="4" y1="13" x2="12" y2="13" stroke={stroke} strokeWidth="1" opacity="0.45" />
      <line x1="20" y1="9" x2="28" y2="9" stroke={stroke} strokeWidth="1" opacity="0.45" />
      <line x1="20" y1="13" x2="28" y2="13" stroke={stroke} strokeWidth="1" opacity="0.45" />
    </svg>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-[18px] w-[30px] items-center rounded-full transition-colors",
        on ? "bg-vault" : "bg-surface-3"
      )}
    >
      <span
        className={cn(
          "inline-block h-[14px] w-[14px] rounded-full bg-background transition-transform",
          on ? "translate-x-[14px]" : "translate-x-[2px]"
        )}
      />
    </button>
  );
}

/* ----------------------------- Pages --------------------------------- */

function PagesPlaceholder({
  file,
  zoom,
  layout,
  gap,
  continuous,
}: {
  file: File | null;
  zoom: number;
  layout: "single" | "double";
  gap: number;
  continuous: boolean;
}) {
  const widthPct = layout === "double" ? 84 : 72;
  const [pageCount, setPageCount] = useState(0);
  const [docState, setDocState] = useState<{
    pages: Array<{ width: number; height: number }>;
    render: (idx: number, canvas: HTMLCanvasElement) => Promise<void>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBlank = file?.size === 0;

  useEffect(() => {
    if (!file || file.size === 0) {
      setDocState(null);
      setPageCount(file?.size === 0 ? 1 : 0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { loadPdfjs } = await import("@/lib/pdf/worker");
        const pdfjs = await loadPdfjs();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        const n = continuous ? doc.numPages : Math.min(1, doc.numPages);
        const sizes: Array<{ width: number; height: number }> = [];
        for (let i = 1; i <= n; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          sizes.push({ width: vp.width, height: vp.height });
        }
        if (cancelled) return;
        setPageCount(n);
        setDocState({
          pages: sizes,
          render: async (idx, canvas) => {
            const page = await doc.getPage(idx + 1);
            const viewport = page.getViewport({ scale: 1.5 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          },
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, continuous]);

  const sheets = Math.max(pageCount, isBlank ? 1 : 0) || (file ? 1 : 0);

  return (
    <div
      className="mx-auto flex flex-col items-center py-8"
      style={{ gap, width: `${widthPct}%` }}
    >
      {loading && (
        <div className="text-[12px] text-text-muted">Loading document…</div>
      )}
      {error && <div className="text-[12px] text-destructive">{error}</div>}
      {Array.from({ length: sheets || 1 }).map((_, i) => {
        const meta = docState?.pages[i];
        const aspect = meta ? `${meta.width} / ${meta.height}` : "1 / 1.414";
        return (
          <div
            key={i}
            className="w-full"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top center",
            }}
          >
            <div
              className="mx-auto w-full overflow-hidden"
              style={{
                aspectRatio: aspect,
                background: "var(--paper)",
                borderRadius: 6,
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
              }}
            >
              {docState && (
                <PageCanvas
                  index={i}
                  render={docState.render}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PageCanvas({
  index,
  render,
}: {
  index: number;
  render: (idx: number, canvas: HTMLCanvasElement) => Promise<void>;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let cancelled = false;
    render(index, c).catch(() => {});
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [index, render]);
  return <canvas ref={ref} className="block h-full w-full object-contain" />;
}

/* -------------------------- Empty start ------------------------------ */

const TEMPLATES = [
  { id: "invoice", label: "Invoice" },
  { id: "resume", label: "Resume" },
  { id: "letter", label: "Letter" },
  { id: "blank", label: "Blank A4" },
];

function EmptyStart({
  onOpen,
  onBlank,
  onTemplate,
}: {
  onOpen: () => void;
  onBlank: () => void;
  onTemplate: (name: string) => void;
}) {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="grid h-full place-items-center px-6 py-12">
      <div className="w-full max-w-[720px] text-center">
        <h1 className="font-display text-[24px] leading-tight">Start something</h1>
        <p className="mt-2 text-[12.5px] text-text-2">
          Nothing is uploaded. Everything stays on your device.
        </p>

        {/* Primary cards */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StartCard
            icon={<Upload className="h-[18px] w-[18px]" />}
            title="Open a PDF"
            sub="drop or browse"
            onClick={onOpen}
            amber
          />
          <StartCard
            icon={<FilePlus2 className="h-[18px] w-[18px]" />}
            title="Blank page"
            sub="start empty"
            onClick={onBlank}
          />
          <StartCard
            icon={<LayoutTemplate className="h-[18px] w-[18px]" />}
            title="Template"
            sub="invoice, resume…"
            onClick={() => setPickerOpen(true)}
          />
        </div>

        {/* Secondary chips */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <ShortcutChip
            icon={<PhotoIcon className="h-[14px] w-[14px]" />}
            label="Images → PDF"
            onClick={() => navigate({ to: "/images-to-pdf" })}
          />
          <ShortcutChip
            icon={<FileType className="h-[14px] w-[14px]" />}
            label="Word → PDF"
            onClick={() => navigate({ to: "/word-to-pdf" })}
          />
        </div>

        <div className="mt-10 flex items-center justify-center gap-2 text-[11px] text-text-muted">
          <KeyChip inline>⌘K</KeyChip> command
          <span className="opacity-40">·</span>
          <KeyChip inline>⌘\</KeyChip> inspector
          <span className="opacity-40">·</span>
          <KeyChip inline>O</KeyChip> open
        </div>
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-background/60 backdrop-blur-sm"
          onClick={() => setPickerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[min(420px,92vw)] border border-border bg-surface-2 p-4"
            style={{ borderRadius: 11, boxShadow: "var(--shadow-float)" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="font-display text-[16px]">Choose a template</div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-3 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onTemplate(t.label);
                    setPickerOpen(false);
                  }}
                  className="flex items-center gap-2 border border-border bg-surface-1 px-3 py-3 text-left text-[13px] text-foreground hover:bg-surface-3 transition-colors"
                  style={{ borderRadius: 9 }}
                >
                  <LayoutTemplate className="h-[15px] w-[15px] text-vault" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StartCard({
  icon,
  title,
  sub,
  onClick,
  amber,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
  amber?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-center justify-center gap-2.5 border border-border/70 bg-surface-2 px-5 py-7 text-center",
        "transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-3",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      style={{
        borderRadius: 11,
        borderWidth: 0.5,
        transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      <span
        className={cn(
          "grid h-10 w-10 place-items-center",
          amber ? "bg-accent-soft text-vault" : "bg-surface-1 text-text-2"
        )}
        style={{ borderRadius: 9 }}
      >
        {icon}
      </span>
      <span className="font-display text-[15px] text-foreground">{title}</span>
      <span className="text-[11.5px] text-text-muted">{sub}</span>
    </button>
  );
}

function ShortcutChip({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex items-center gap-2 border border-border/70 bg-surface-1 px-3 py-2 text-[12px] text-text-2",
        "transition-colors hover:bg-surface-2 hover:text-foreground",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      style={{ borderRadius: 9, borderWidth: 0.5 }}
    >
      <span className="text-vault">{icon}</span>
      {label}
      <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}

/* --------------------------- Inspector ------------------------------- */

function Inspector({
  open,
  activeTool,
  onClose,
}: {
  open: boolean;
  activeTool: Tool | null;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Inspector"
      className={cn(
        "shrink-0 border-l border-border bg-surface-1 overflow-hidden",
        "transition-[width] duration-200",
      )}
      style={{
        width: open && activeTool ? 240 : 0,
        transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {activeTool && (
        <div className="flex h-full w-[240px] flex-col">
          <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-vault">
                <activeTool.icon className="h-[15px] w-[15px]" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium leading-tight">{activeTool.label}</div>
                <div className="truncate text-[11px] text-text-muted">{activeTool.groupLabel}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector"
              className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="flex-1 overflow-auto px-3 py-4">
            <div
              data-mount-slot={activeTool.id}
              className="grid place-items-center rounded-lg border border-dashed border-border bg-surface-2 px-3 py-10 text-center text-[12px] text-text-muted"
            >
              {activeTool.label} controls
              <span className="mt-1 text-[10.5px] text-text-muted/70">
                Mount slot — feature panel loads here
              </span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/* --------------------------- Tool modal ------------------------------ */

function ToolModal({
  onSelect,
  onClose,
  activeToolId,
}: {
  onSelect: (id: string) => void;
  onClose: () => void;
  activeToolId: string | null;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? TOOLS.filter((t) => t.label.toLowerCase().includes(q))
    : TOOLS;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(520px,92vw)] max-h-[80vh] flex flex-col border border-border bg-surface-1 overflow-hidden"
        style={{ borderRadius: 14, boxShadow: "var(--shadow-float)" }}
        role="dialog"
        aria-label="All tools"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools…"
            className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-3 py-3 space-y-4">
          {GROUP_ORDER.map((groupLabel) => {
            const items = filtered.filter((t) => t.groupLabel === groupLabel);
            if (items.length === 0) return null;
            return (
              <div key={groupLabel}>
                <div className="mb-1.5 px-1 text-[10.5px] uppercase tracking-[0.16em] text-text-muted">
                  {groupLabel}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => onSelect(tool.id)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md border border-transparent bg-surface-2 px-2.5 py-2 text-left transition-colors",
                        "hover:bg-surface-3 hover:border-border",
                        activeToolId === tool.id && "border-vault/40 bg-accent-soft",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-7 w-7 place-items-center rounded-md bg-surface-1 text-text-2",
                          activeToolId === tool.id && "bg-vault/15 text-vault",
                        )}
                      >
                        <tool.icon className="h-[15px] w-[15px]" />
                      </span>
                      <span
                        className={cn(
                          "text-[12.5px] text-foreground truncate",
                          activeToolId === tool.id && "text-vault font-medium",
                        )}
                      >
                        {tool.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="grid place-items-center py-8 text-[12px] text-text-muted">
              No tools match "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ----------------------------- Bits ---------------------------------- */

function ZoomButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
    >
      {children}
    </button>
  );
}

function KeyChip({
  children,
  inline,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <kbd
      className={cn(
        "font-mono rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-text-2",
        inline && "align-middle"
      )}
    >
      {children}
    </kbd>
  );
}

function prettyBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
