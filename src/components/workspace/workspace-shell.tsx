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
  MoreHorizontal,
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
  Upload,
  FilePlus2,
  LayoutTemplate,
  Images as PhotoIcon,
  FileType,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type ToolId =
  | "pages"
  | "redact"
  | "sign"
  | "convert"
  | "secure"
  | "layout"
  | "legal"
  | "ai";

type RailItem = {
  id: ToolId;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
};

const RAIL: RailItem[] = [
  { id: "pages", label: "Pages", subtitle: "Organize, split, merge, rotate", icon: Files },
  { id: "redact", label: "Redact", subtitle: "Permanently remove sensitive content", icon: Shield },
  { id: "sign", label: "Sign", subtitle: "Sign and request signatures", icon: PenLine },
  { id: "convert", label: "Convert", subtitle: "To/from Word, Excel, images", icon: RefreshCw },
  { id: "secure", label: "Secure", subtitle: "Encrypt, unlock, watermark", icon: KeyRound },
  { id: "layout", label: "Layout", subtitle: "Crop, headers, page numbers", icon: Layout },
  { id: "legal", label: "Legal", subtitle: "Bates, privilege, compare", icon: Scale },
  { id: "ai", label: "AI", subtitle: "Ask, summarize, extract", icon: Sparkles },
];

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
  const [activeGroup, setActiveGroup] = useState<ToolId | null>(initialTool ?? null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(Boolean(initialTool));
  const [editorTool, setEditorTool] = useState<EditorTool>("select");
  const [zoom, setZoom] = useState<number>(100);
  const [viewOpen, setViewOpen] = useState(false);
  const [pageLayout, setPageLayout] = useState<"single" | "double">("single");
  const [continuous, setContinuous] = useState(true);
  const [showGaps, setShowGaps] = useState(true);
  const [theme, setTheme] = useState<ReadingTheme>("dark");
  const [dragOver, setDragOver] = useState(false);
  const [aiText, setAiText] = useState("");
  const aiRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onOpenGroup = useCallback((id: ToolId) => {
    setActiveGroup(id);
    setInspectorOpen(true);
  }, []);

  const openFile = useCallback(() => fileInputRef.current?.click(), []);
  const onFiles = useCallback((files: FileList | null) => {
    const f = files?.[0];
    if (f) setFile(f);
  }, []);

  const loadBlank = useCallback(() => {
    setFile(new File([], "Untitled.pdf", { type: "application/pdf" }));
  }, []);
  const loadTemplate = useCallback((name: string) => {
    setFile(new File([], `${name}.pdf`, { type: "application/pdf" }));
  }, []);

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
          <div
            className="grid h-6 w-6 place-items-center bg-vault text-vault-foreground"
            style={{ borderRadius: 7 }}
            aria-label="VaultPDF"
          >
            <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
          </div>
          <span className="font-display text-[15px] leading-none">VaultPDF</span>
          <span className="mx-1 h-4 w-px bg-border" />
          <span className="truncate text-[13px] text-text-2">
            {file?.name ?? "Untitled document"}
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
            {RAIL.map((item) => (
              <li key={item.id}>
                <RailButton
                  active={activeGroup === item.id && inspectorOpen}
                  label={item.label}
                  onClick={() => onOpenGroup(item.id)}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                </RailButton>
              </li>
            ))}
          </ul>
          <RailButton label="More" onClick={() => {}}>
            <MoreHorizontal className="h-[18px] w-[18px]" />
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
                <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
                  <CanvasIconButton
                    label="Thumbnails"
                    onClick={() => onOpenGroup("pages")}
                  >
                    <LayoutGrid className="h-[15px] w-[15px]" />
                  </CanvasIconButton>
                  <CanvasIconButton
                    label="View options"
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
              </>
            )}

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
            group={activeGroup}
            onClose={() => setInspectorOpen(false)}
          />
        </div>
      </div>

      {/* BOTTOM BAR */}
      <footer className="flex h-[38px] shrink-0 items-center justify-between border-t border-border bg-surface-1 px-3 text-[11.5px]">
        <div className="font-mono text-text-muted truncate">
          {file ? `${file.name} · — pages · ${sizeLabel}` : "No document loaded"}
        </div>
        <div className="flex items-center gap-1">
          <ZoomButton onClick={() => setZoom((z) => Math.max(25, z - 10))}>
            <Minus className="h-3.5 w-3.5" />
          </ZoomButton>
          <span className="font-mono tabular-nums px-2 text-text-2 min-w-[3.5rem] text-center">
            {zoom}%
          </span>
          <ZoomButton onClick={() => setZoom((z) => Math.min(400, z + 10))}>
            <Plus className="h-3.5 w-3.5" />
          </ZoomButton>
          <span className="mx-1 h-3.5 w-px bg-border" />
          <ZoomButton onClick={() => setZoom(100)}>
            <Maximize2 className="h-3.5 w-3.5" />
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
            <div className="mx-auto h-9 w-6 rounded-[3px] bg-surface-3" />
          </LayoutCard>
          <LayoutCard
            active={pageLayout === "double"}
            onClick={() => onPageLayout("double")}
            label="Double"
          >
            <div className="mx-auto flex h-9 gap-1">
              <div className="h-full w-5 rounded-[3px] bg-surface-3" />
              <div className="h-full w-5 rounded-[3px] bg-surface-3" />
            </div>
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
  group,
  onClose,
}: {
  open: boolean;
  group: ToolId | null;
  onClose: () => void;
}) {
  const meta = group ? RAIL.find((r) => r.id === group) : null;
  return (
    <aside
      aria-label="Inspector"
      className={cn(
        "shrink-0 border-l border-border bg-surface-1 overflow-hidden",
        "transition-[width] duration-200",
      )}
      style={{
        width: open && meta ? 224 : 0,
        transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {meta && (
        <div className="flex h-full w-[224px] flex-col">
          <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-vault"
              >
                <meta.icon className="h-[15px] w-[15px]" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium leading-tight">{meta.label}</div>
                <div className="truncate text-[11px] text-text-muted">{meta.subtitle}</div>
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
              data-mount-slot={meta.id}
              className="grid place-items-center rounded-lg border border-dashed border-border bg-surface-2 px-3 py-10 text-center text-[12px] text-text-muted"
            >
              {meta.label} controls
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

/* ----------------------------- Bits ---------------------------------- */

function ZoomButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
