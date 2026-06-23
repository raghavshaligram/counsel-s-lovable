import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  Pin,
  PinOff,
  FileCheck2,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { PDFDocument } from "pdf-lib";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ToolPanel } from "./tool-panels";
import { EditorCanvas } from "./editor-canvas";
import { OrganizeGrid } from "./organize-grid";
import { CompareCanvas, CompareFloatingBar } from "./compare-canvas";
import { TabStrip } from "./tab-strip";
import {
  loadUIState,
  saveUIStateDebounced,
  listRecents,
  addRecent,
  getRecent,
  removeRecent,
  clearRecents,
  loadOpenTabs,
  saveOpenTabs,
  clearOpenTabs,
  loadSidecar,
  saveSidecarDebounced,
  flushSidecars,
  deleteSidecar,
  type RecentMeta,
  type OpenTabMeta,
} from "@/lib/workspace/persistence";

import { reducer, initialState, PALETTE, type Action as EditorAction } from "@/lib/editor/state";
import type { Tool, RGB, EditorDoc, PageOp } from "@/lib/editor/types";
import { exportEditedPdf } from "@/lib/editor/export";
import { injectFontFaces, FONT_META, type FontKey } from "@/lib/editor/fonts";
import { TAB_CAP, makeBlankTab, type TabState } from "@/lib/workspace/tabs";


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

type RailTool = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: ToolId;
  groupLabel: ToolGroupLabel;
};

const TOOLS: RailTool[] = [
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
// Hard cap on the left rail. Manual pins are sticky; the remainder is
// auto-filled by most-used tools. Never exceed this, period.
const PIN_CAP_TOTAL = 10;
const USAGE_KEY = "vaultpdf:tool-usage";
const PINS_KEY = "vaultpdf:tool-pins";

// Optional keyboard shortcuts shown in tooltips. Only list tools whose
// shortcut is actually wired elsewhere — never advertise a binding that
// doesn't work.
const SHORTCUTS: Record<string, string> = {};

function loadUsage(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(USAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function loadManualPins(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(PINS_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Resolve the final rail (max PIN_CAP_TOTAL slots):
//   1. Manual pins, in user-defined order, always come first.
//   2. Remaining slots fill from earned (used ≥2) most-used tools.
//   3. Then default pins, to bootstrap a brand-new user.
function computePins(
  counts: Record<string, number>,
  manualPins: string[],
): string[] {
  const valid = new Set(TOOLS.map((t) => t.id));
  const result: string[] = [];
  for (const id of manualPins) {
    if (result.length >= PIN_CAP_TOTAL) break;
    if (valid.has(id) && !result.includes(id)) result.push(id);
  }
  if (result.length < PIN_CAP_TOTAL) {
    const earned = Object.entries(counts)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    for (const id of earned) {
      if (result.length >= PIN_CAP_TOTAL) break;
      if (valid.has(id) && !result.includes(id)) result.push(id);
    }
  }
  if (result.length < PIN_CAP_TOTAL) {
    for (const id of DEFAULT_PINS) {
      if (result.length >= PIN_CAP_TOTAL) break;
      if (valid.has(id) && !result.includes(id)) result.push(id);
    }
  }
  return result.slice(0, PIN_CAP_TOTAL);
}

function toolById(id: string): RailTool | undefined {
  return TOOLS.find((t) => t.id === id);
}

// Editor tools = the shared editor Tool union (state.tool). The floating
// toolbar dispatches SET_TOOL with these ids; renderers in editor-canvas
// react accordingly. No second taxonomy.
type EditorTool = Tool;

type ReadingTheme = "dark" | "sepia" | "soft" | "white";

const THEME_TINT: Record<ReadingTheme, string> = {
  dark: "transparent",
  sepia: "rgba(247, 243, 233, 0.06)",
  soft: "rgba(228, 231, 226, 0.05)",
  white: "rgba(255, 255, 255, 0.04)",
};

export function WorkspaceShell({ initialTool }: { initialTool?: ToolId }) {
  // ----------------- Tabs: array of open documents -------------------
  // Each tab owns its OWN file, editor state, active tool, view settings,
  // undo history, and dirty flag. The canvas/inspector/toolbar/command bar
  // always read from the ACTIVE tab; switching tabs swaps which doc is live.
  const [tabs, setTabs] = useState<TabState[]>(() => [
    makeBlankTab({
      activeToolId: initialTool ? TOOLS.find((t) => t.group === initialTool)?.id ?? null : null,
      inspectorOpen: Boolean(initialTool),
    }),
  ]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);
  const active = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? tabs[0],
    [tabs, activeId],
  );
  // Stable ref for callbacks that need the current active id without
  // re-binding every render.
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Flush any debounced sidecar writes before the tab is hidden / unloaded so
  // pending edits actually commit to IndexedDB.
  useEffect(() => {
    const flush = () => {
      void flushSidecars();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Pending close (for the unsaved-changes guard).
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [pendingHomeClose, setPendingHomeClose] = useState(false); // legacy guard

  // ----------------- Patch helpers ------------------------------------
  const patchTab = useCallback((id: string, patch: Partial<TabState>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);
  const patchActive = useCallback(
    (patch: Partial<TabState>) => patchTab(activeIdRef.current, patch),
    [patchTab],
  );
  const dispatchEditorFor = useCallback((id: string, action: EditorAction) => {
    setTabs((ts) =>
      ts.map((t) => (t.id === id ? { ...t, editor: reducer(t.editor, action) } : t)),
    );
  }, []);
  const editorDispatch = useCallback(
    (action: EditorAction) => dispatchEditorFor(activeIdRef.current, action),
    [dispatchEditorFor],
  );

  // Convenience aliases — every render reads from `active`.
  const file = active.file;
  const isDirty = active.isDirty;
  const editorState = active.editor;
  const editorTool = editorState.tool;
  const activeToolId = active.activeToolId;
  const inspectorOpen = active.inspectorOpen;
  const zoom = active.zoom;
  const zoomMode = active.zoomMode;
  const pageLayout = active.pageLayout;
  const continuous = active.continuous;
  const showGaps = active.showGaps;
  const theme = active.theme;

  // ----------------- Global UI state ---------------------------------
  const [viewOpen, setViewOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [aiText, setAiText] = useState("");
  // Bumped to request an auto-fit recalc (Fit-width button, tab switch).
  const [fitNonce, setFitNonce] = useState(0);
  // Auto-fit zoom for the active tab; cheap because EditorPages computes it.
  const autoFit = useCallback((next: number) => {
    patchTab(activeIdRef.current, { zoom: next });
  }, [patchTab]);
  // Refit whenever the active tab changes.
  useEffect(() => { setFitNonce((n) => n + 1); }, [activeId]);

  const [toolModalOpen, setToolModalOpen] = useState(false);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [manualPins, setManualPins] = useState<string[]>([]);
  const manualPinSet = useMemo(() => new Set(manualPins), [manualPins]);
  const [recents, setRecents] = useState<RecentMeta[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [pendingResume, setPendingResume] = useState<OpenTabMeta[]>([]);
  const aiRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // After a LOAD on a given tab, switch its editor tool to this value. Used
  // by OCR pause: the file swap triggers LOAD (which resets tool to "select"),
  // so we re-apply "edit-text" immediately after so the user lands on the
  // text-editing tool, not Select.
  const postLoadToolRef = useRef<Map<string, EditorTool>>(new Map());


  // Hydrate persisted UI, usage, recents, and the previously-open tab set.
  useEffect(() => {
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(USAGE_KEY);
      if (raw) setUsage(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setManualPins(loadManualPins());
    (async () => {
      const [ui, recentsList, openTabs] = await Promise.all([
        loadUIState(),
        listRecents(),
        loadOpenTabs(),
      ]);
      if (cancelled) return;
      if (ui) {
        // Apply last-session view defaults to the initial tab.
        patchTab(activeIdRef.current, {
          activeToolId: ui.activeToolId ?? null,
          inspectorOpen: typeof ui.inspectorOpen === "boolean" ? ui.inspectorOpen : false,
          pageLayout: ui.pageLayout ?? "single",
          continuous: typeof ui.continuous === "boolean" ? ui.continuous : true,
          showGaps: typeof ui.showGaps === "boolean" ? ui.showGaps : true,
          theme: ui.theme ?? "dark",
          zoom: typeof ui.zoom === "number" ? ui.zoom : 100,
          zoomMode: ui.zoomMode ?? "actual",
        });
      }
      setRecents(recentsList);
      // Only offer resume for tabs whose bytes still exist in recents.
      const restorable = openTabs.filter((m) =>
        recentsList.some((r) => r.name === m.name && r.size === m.size),
      );
      setPendingResume(restorable);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist active tab's UI state (debounced).
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
      zoomMode,
      licenseKey: null,
    });
  }, [hydrated, activeToolId, inspectorOpen, pageLayout, continuous, showGaps, theme, zoom, zoomMode]);

  // Persist the open-tabs metadata so we can offer Resume on refresh.
  useEffect(() => {
    if (!hydrated) return;
    const meta: OpenTabMeta[] = tabs
      .filter((t) => t.file && t.file.size > 0)
      .map((t) => ({ name: t.file!.name, size: t.file!.size }));
    void saveOpenTabs(meta);
  }, [hydrated, tabs]);

  // Persist manual pins whenever they change post-hydration. Belt + braces:
  // togglePin already writes inline, but a dedicated effect guarantees the
  // latest array is mirrored to localStorage even across StrictMode replays.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(PINS_KEY, JSON.stringify(manualPins));
    } catch {
      /* ignore */
    }
  }, [hydrated, manualPins]);

  // ----------------- Tool selection (per-active-tab) ------------------
  // When the active rail tool flips to "redact" on this tab, default its
  // editor canvas mode to redact. Leaving redact reverts to select.
  useEffect(() => {
    const id = active.id;
    if (active.activeToolId === "redact" && active.editor.tool !== "redact") {
      dispatchEditorFor(id, { type: "SET_TOOL", t: "redact" });
    } else if (active.activeToolId === "page-crop" && active.editor.tool !== "page-crop") {
      dispatchEditorFor(id, { type: "SET_TOOL", t: "page-crop" });
    } else if (
      active.activeToolId !== "redact" &&
      active.activeToolId !== "page-crop" &&
      (active.editor.tool === "redact" || active.editor.tool === "page-crop")
    ) {
      dispatchEditorFor(id, { type: "SET_TOOL", t: "select" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id, active.activeToolId]);

  const setEditorTool = useCallback(
    (t: EditorTool) => {
      editorDispatch({ type: "SET_TOOL", t });
      if (t !== "select" && t !== "note") patchActive({ isDirty: true });
    },
    [editorDispatch, patchActive],
  );

  const pins = useMemo(() => computePins(usage, manualPins), [usage, manualPins]);
  const pinnedTools = useMemo(
    () => pins.map((id) => toolById(id)).filter((t): t is RailTool => Boolean(t)),
    [pins],
  );

  // Pin / unpin a tool manually. Hard cap is PIN_CAP_TOTAL — block the 11th
  // with a clear toast so the user knows nothing got silently dropped.
  const togglePin = useCallback((id: string) => {
    if (!TOOLS.some((t) => t.id === id)) return;
    setManualPins((prev) => {
      let next: string[];
      if (prev.includes(id)) {
        next = prev.filter((x) => x !== id);
      } else {
        if (prev.length >= PIN_CAP_TOTAL) {
          toast.error(`Rail is full (${PIN_CAP_TOTAL} max). Unpin a tool first.`);
          return prev;
        }
        next = [...prev, id];
      }
      try {
        window.localStorage.setItem(PINS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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
      patchActive({ activeToolId: tool.id, inspectorOpen: true });
      setToolModalOpen(false);
      if (opts?.bump !== false) bumpUsage(toolId);
    },
    [bumpUsage, patchActive],
  );

  // ----------------- Tab operations -----------------------------------
  const openNewStartTab = useCallback(() => {
    setTabs((ts) => {
      if (ts.length >= TAB_CAP) {
        toast.error(`Tab limit reached (${TAB_CAP}). Close one to open another.`);
        return ts;
      }
      const next = makeBlankTab();
      setActiveId(next.id);
      return [...ts, next];
    });
  }, []);

  const closeTab = useCallback(
    (id: string, opts?: { force?: boolean }) => {
      const target = tabs.find((t) => t.id === id);
      if (!target) return;
      if (!opts?.force && target.isDirty && target.file) {
        setPendingCloseId(id);
        return;
      }
      setTabs((ts) => {
        const next = ts.filter((t) => t.id !== id);
        if (next.length === 0) {
          // Always keep at least one tab open.
          const blank = makeBlankTab();
          setActiveId(blank.id);
          return [blank];
        }
        if (activeIdRef.current === id) {
          const idx = ts.findIndex((t) => t.id === id);
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          setActiveId(fallback.id);
        }
        return next;
      });
      setPendingCloseId(null);
    },
    [tabs],
  );

  // ----------------- File open (into the ACTIVE tab) ------------------
  const openFile = useCallback(() => fileInputRef.current?.click(), []);
  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      patchActive({ file: f, isDirty: false });
      void (async () => {
        const meta = await addRecent(f);
        if (meta) {
          const list = await listRecents();
          setRecents(list);
        }
      })();
    },
    [patchActive],
  );

  const resumeRecent = useCallback(
    async (id: string) => {
      const rec = await getRecent(id);
      if (!rec) return;
      const blob = new Blob([new Uint8Array(rec.bytes)], { type: "application/pdf" });
      const f = new File([blob], rec.name, { type: "application/pdf" });
      patchActive({
        file: f,
        isDirty: false,
        ocrPages: rec.ocrPages,
        ocrPagesCopied: rec.ocrPagesCopied,
        ocrIsPartial: rec.ocrIsPartial,
      });
      await addRecent(f, {
        ocrPages: rec.ocrPages,
        ocrPagesCopied: rec.ocrPagesCopied,
        ocrIsPartial: rec.ocrIsPartial,
      });
      setRecents(await listRecents());
    },
    [patchActive],
  );


  const dismissRecent = useCallback(async (id: string) => {
    const rec = await getRecent(id);
    await removeRecent(id);
    if (rec) await deleteSidecar(rec.name, rec.size);
    setRecents(await listRecents());
  }, []);


  const clearAllRecents = useCallback(async () => {
    await clearRecents();
    setRecents([]);
  }, []);

  // Restore previously-open documents into tabs.
  const restoreOpenTabs = useCallback(async () => {
    const list = pendingResume;
    setPendingResume([]);
    if (list.length === 0) return;
    const recentsNow = await listRecents();
    const restored: TabState[] = [];
    for (const m of list) {
      if (restored.length >= TAB_CAP) break;
      const meta = recentsNow.find((r) => r.name === m.name && r.size === m.size);
      if (!meta) continue;
      const rec = await getRecent(meta.id);
      if (!rec) continue;
      const blob = new Blob([new Uint8Array(rec.bytes)], { type: "application/pdf" });
      const f = new File([blob], rec.name, { type: "application/pdf" });
      restored.push(
        makeBlankTab({
          file: f,
          ocrPages: rec.ocrPages,
          ocrPagesCopied: rec.ocrPagesCopied,
          ocrIsPartial: rec.ocrIsPartial,
        }),
      );
    }

    if (restored.length === 0) {
      toast.error("Couldn't restore — the previous files are no longer in local storage.");
      return;
    }
    setTabs((ts) => {
      // Replace the first blank tab if present; otherwise append.
      const firstIsBlank = ts.length === 1 && !ts[0].file;
      const base = firstIsBlank ? [] : ts;
      const combined = [...base, ...restored].slice(0, TAB_CAP);
      setActiveId(combined[base.length].id);
      return combined;
    });
  }, [pendingResume]);

  const dismissResume = useCallback(() => {
    setPendingResume([]);
    void clearOpenTabs();
  }, []);

  const loadBlank = useCallback(() => {
    patchActive({ file: new File([], "Untitled.pdf", { type: "application/pdf" }), isDirty: false });
  }, [patchActive]);
  const loadTemplate = useCallback(
    (name: string) => {
      patchActive({
        file: new File([], `${name}.pdf`, { type: "application/pdf" }),
        isDirty: false,
      });
    },
    [patchActive],
  );

  // Home / New = open a fresh Start tab. Existing work stays in its tabs;
  // nothing is closed, so no dirty guard is needed.
  const goHome = useCallback(() => {
    openNewStartTab();
  }, [openNewStartTab]);

  // Unsaved-changes guard used only when CLOSING a dirty tab.
  const handleSaveAndClose = useCallback(() => {
    // Export hook placeholder — real export lives in feature panels.
    // eslint-disable-next-line no-console
    console.log("[workspace] save before close", pendingCloseId);
    if (pendingCloseId) closeTab(pendingCloseId, { force: true });
  }, [pendingCloseId, closeTab]);

  const handleDiscardAndClose = useCallback(() => {
    if (pendingCloseId) closeTab(pendingCloseId, { force: true });
  }, [pendingCloseId, closeTab]);

  // Warn on actual page unload if any tab is dirty.
  useEffect(() => {
    const anyDirty = tabs.some((t) => t.isDirty);
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [tabs]);

  // Shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        aiRef.current?.focus();
      } else if (meta && e.key === "\\") {
        e.preventDefault();
        patchActive({ inspectorOpen: !inspectorOpen });
      } else if (meta && e.key.toLowerCase() === "t") {
        e.preventDefault();
        openNewStartTab();
      } else if (
        !meta &&
        e.key.toLowerCase() === "o" &&
        document.activeElement === document.body
      ) {
        e.preventDefault();
        openFile();
      } else if (!meta && (e.key === "+" || e.key === "=")) {
        patchActive({ zoom: Math.min(400, zoom + 10), zoomMode: "custom" });
      } else if (!meta && e.key === "-") {
        patchActive({ zoom: Math.max(25, zoom - 10), zoomMode: "custom" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, openNewStartTab, patchActive, inspectorOpen, zoom]);

  // Drag-drop anywhere → open into active tab. Ignore non-file drags
  // (e.g. dragging a page tile inside the Organize grid) so the global
  // dropzone overlay doesn't flicker and we don't try to parse cell
  // payloads as PDF bytes.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      setDragOver(false);
      onFiles(e.dataTransfer.files);
    },
    [onFiles],
  );

  const submitAi = useCallback(() => {
    if (!aiText.trim()) return;
    // eslint-disable-next-line no-console
    console.log("[workspace] routeCommand", aiText);
    setAiText("");
  }, [aiText]);

  const sizeLabel = useMemo(() => (file ? prettyBytes(file.size) : "—"), [file]);

  // Inject font @font-face rules once (used by edit-text overlays).
  useEffect(() => {
    injectFontFaces();
  }, []);

  // Build an EditorDoc for the ACTIVE tab whenever its file changes.
  // Skips when the editor already holds that document (so tab-switching
  // doesn't re-parse).
  useEffect(() => {
    const tabId = active.id;
    const f = active.file;
    if (!f || f.size === 0) return;
    const already =
      active.editor.doc &&
      active.editor.doc.fileName === f.name &&
      active.editor.doc.pages.length > 0;
    if (already) return;
    let cancelled = false;
    (async () => {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const lib = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages: PageOp[] = lib.getPages().map((p, i) => {
          const { width, height } = p.getSize();
          return { srcPage: i, rotation: 0, width, height };
        });
        if (cancelled) return;
        dispatchEditorFor(tabId, {
          type: "LOAD",
          doc: { fileName: f.name, srcBytes: bytes, pages, annotations: [] },
        });
        // Replay the on-device sidecar (annotations + page-ops + ocrLayer)
        // for this file identity, if any.
        const side = await loadSidecar(f.name, f.size);
        if (!cancelled && side) {
          dispatchEditorFor(tabId, {
            type: "LOAD_SIDECAR",
            annotations: side.annotations,
            pages: side.pages,
            ocrLayer: side.ocrLayer,
          });
        }
        const pendingTool = postLoadToolRef.current.get(tabId);
        if (pendingTool) {
          postLoadToolRef.current.delete(tabId);
          dispatchEditorFor(tabId, { type: "SET_TOOL", t: pendingTool });
        }

      } catch (err) {
        console.error("[workspace] PDFDocument.load failed", err);
        toast.error("Could not open this PDF", { description: (err as Error).message });
      }

    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id, active.file]);

  // Auto-save the sidecar (annotations + page-ops + ocrLayer) whenever the
  // active editor doc changes. On-device IndexedDB only — never uploaded.
  // Debounced inside saveSidecarDebounced.
  useEffect(() => {
    const f = active.file;
    const d = active.editor.doc;
    if (!f || !d) return;
    if (d.fileName !== f.name) return;
    saveSidecarDebounced(f.name, f.size, {
      fileName: d.fileName,
      size: f.size,
      annotations: d.annotations,
      pages: d.pages,
      ocrLayer: d.ocrLayer,
    });
  }, [
    active.file,
    active.editor.doc?.annotations,
    active.editor.doc?.pages,
    active.editor.doc?.ocrLayer,
    active.editor.doc?.fileName,
  ]);


  const onExport = useCallback(async () => {
    if (!editorState.doc || editorState.doc.pages.length === 0) {
      toast.error("Nothing to export yet");
      return;
    }
    try {
      toast.loading("Building PDF…", { id: "wsx" });
      const bytes = await exportEditedPdf(editorState.doc);
      toast.success("Saved", { id: "wsx" });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = editorState.doc.fileName.replace(/\.pdf$/i, "") + "-edited.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed", { id: "wsx", description: (err as Error).message });
    }
  }, [editorState.doc]);

  // ---------- Scanned-PDF → OCR (in-place make-searchable) ----------
  // Runs the existing on-device OCR pipeline on the active tab's file and
  // swaps the file in place so the edit-text tool can immediately work on
  // the new text layer. Filename is bumped with " (OCR)" so the editor's
  // load effect (which dedupes by fileName) re-parses.
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgressText, setOcrProgressText] = useState<string>("");
  const ocrAbortRef = useRef<AbortController | null>(null);

  // Per-tab OCR memory (page indices, 0-based). Read from the active tab so
  // resume + banner + tag all see the same truth across tab switches.
  const ocrPagesArr = active.ocrPages ?? [];
  const ocrPagesCopiedArr = active.ocrPagesCopied ?? [];
  const ocrPagesSet = useMemo(() => new Set<number>(ocrPagesArr), [ocrPagesArr]);
  const ocrPagesCopiedSet = useMemo(
    () => new Set<number>(ocrPagesCopiedArr),
    [ocrPagesCopiedArr],
  );

  const onRequestOcr = useCallback(async () => {
    const f = active.file;
    if (!f || f.size === 0) {
      toast.error("No document to OCR");
      return;
    }
    if (ocrRunning) return;
    const tabId = activeIdRef.current;
    const ctrl = new AbortController();
    ocrAbortRef.current = ctrl;
    setOcrRunning(true);
    setOcrProgressText("Preparing OCR…");
    const toastId = "wsx-ocr";
    toast.loading("Preparing OCR…", { id: toastId });
    const skipPrev = new Set<number>([...(active.ocrPages ?? []), ...(active.ocrPagesCopied ?? [])]);
    const newlyOcr = new Set<number>();
    const newlyCopied = new Set<number>();
    try {
      const { ocrPdfToTokens } = await import("@/lib/pdf/ocr-pdf").catch((err) => {
        // Stale dynamic-chunk reference (e.g. after a new deploy). Reload once
        // so the browser fetches the fresh chunk hash, then surface the error.
        if (/dynamically imported module|Failed to fetch/i.test(String(err?.message ?? err))
            && !sessionStorage.getItem("ocr-chunk-reloaded")) {
          sessionStorage.setItem("ocr-chunk-reloaded", "1");
          window.location.reload();
        }
        throw err;
      });
      // Sidecar OCR: returns per-source-page tokens — never modifies the
      // base PDF bytes. Tokens are composited live in the canvas and baked
      // as invisible text on export.
      const { pages } = await ocrPdfToTokens(
        f,
        (p) => {
          const pct = p.totalPages > 0 ? Math.round((p.page / p.totalPages) * 100) : 0;
          const text = `OCR: ${p.message}${p.totalPages > 0 ? ` (${pct}%)` : ""}`;
          setOcrProgressText(text);
          toast.loading(text, { id: toastId });
          if (typeof p.sourcePage === "number") {
            const idx = p.sourcePage - 1;
            if (!skipPrev.has(idx)) {
              if (p.stage === "ocr") newlyOcr.add(idx);
              else if (p.stage === "copied" || p.stage === "skipped") newlyCopied.add(idx);
            }
          }
        },
        ctrl.signal,
        {
          returnPartialOnAbort: true,
          skipPageIndices: [...skipPrev],
        },
      );
      const aborted = ctrl.signal.aborted;

      // Push tokens into the editor sidecar. Base PDF stays pristine.
      if (pages.length > 0) {
        dispatchEditorFor(tabId, { type: "SET_OCR_LAYER", pages });
      }

      // Per-tab OCR memory (drives banner suppression, page tag, resume).
      const mergedOcr = new Set<number>([...(active.ocrPages ?? []), ...newlyOcr]);
      const mergedCopied = new Set<number>([...(active.ocrPagesCopied ?? []), ...newlyCopied]);
      const mergedOcrArr = [...mergedOcr].sort((a, b) => a - b);
      const mergedCopiedArr = [...mergedCopied].sort((a, b) => a - b);

      patchActive({
        isDirty: true,
        ocrPages: mergedOcrArr,
        ocrPagesCopied: mergedCopiedArr,
        ocrIsPartial: aborted,
      });

      // Persist OCR metadata on the recent entry so reopen restores tags.
      // The sidecar (annotations + ocrLayer) is saved separately via the
      // doc-change effect.
      void (async () => {
        await addRecent(f, {
          ocrPages: mergedOcrArr,
          ocrPagesCopied: mergedCopiedArr,
          ocrIsPartial: aborted,
        });
        setRecents(await listRecents());
      })();

      const fmtRanges = (s: Set<number>) => formatPageRanges([...s].map((i) => i + 1));
      if (aborted) {
        toast.success(
          newlyOcr.size > 0
            ? `Stopped — OCR added on ${fmtRanges(newlyOcr)}`
            : "Stopped — no new pages finished yet",
          { id: toastId },
        );
      } else if (newlyOcr.size === 0 && newlyCopied.size === 0) {
        toast.success("Nothing new to OCR — all pages already searchable", { id: toastId });
      } else if (newlyOcr.size === 0) {
        toast.success("All pages were already searchable", { id: toastId });
      } else {
        toast.success(`OCR added on ${fmtRanges(newlyOcr)} — you can edit them now`, {
          id: toastId,
        });
      }
    } catch (err) {
      console.error("[workspace] OCR failed", err);
      toast.error("OCR failed", {
        id: toastId,
        description: (err as Error).message,
      });
    } finally {
      setOcrRunning(false);
      setOcrProgressText("");
      ocrAbortRef.current = null;
    }
  }, [active.file, active.ocrPages, active.ocrPagesCopied, ocrRunning, patchActive, dispatchEditorFor]);


  const onStopOcr = useCallback(() => {
    // Sidecar OCR: no file swap, so just abort + switch to Edit immediately.
    ocrAbortRef.current?.abort();
    openTool("edit-text");
  }, [openTool]);



  // Track scanned pages reported by EditorCanvas instances. Cleared when the
  // file identity changes (different name+size).
  const [scannedPages, setScannedPages] = useState<Set<number>>(() => new Set());
  const [ocrBannerDismissed, setOcrBannerDismissed] = useState(false);
  const activeFileKey = active.file ? `${active.file.name}:${active.file.size}` : null;
  useEffect(() => {
    setScannedPages(new Set());
    setOcrBannerDismissed(false);
  }, [activeFileKey]);
  const onScannedChange = useCallback((pageIndex: number, isScanned: boolean) => {
    setScannedPages((prev) => {
      const has = prev.has(pageIndex);
      if (isScanned && !has) {
        const next = new Set(prev);
        next.add(pageIndex);
        return next;
      }
      if (!isScanned && has) {
        const next = new Set(prev);
        next.delete(pageIndex);
        return next;
      }
      return prev;
    });
  }, []);
  // Pages still needing OCR = scanned-looking pages we haven't already
  // handled in a previous run.
  const unprocessedScannedSet = useMemo(() => {
    const out = new Set<number>();
    scannedPages.forEach((i) => {
      if (!ocrPagesSet.has(i) && !ocrPagesCopiedSet.has(i)) out.add(i);
    });
    return out;
  }, [scannedPages, ocrPagesSet, ocrPagesCopiedSet]);
  const hasResumePoint = ocrPagesArr.length > 0 || ocrPagesCopiedArr.length > 0;
  const showOcrBanner =
    !!file && editorTool === "edit-text" && (ocrRunning || (unprocessedScannedSet.size > 0 && !ocrBannerDismissed));




  // Unused placeholder to keep TS happy if referenced elsewhere
  void pendingHomeClose;

  return (
    <div
      className="flex h-screen w-full flex-col bg-background text-foreground"
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        setDragOver(false);
      }}
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
            title="New tab (Start screen)"
            aria-label="New tab"
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
            title="New tab"
            aria-label="New tab"
            className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            <FilePlus2 className="h-[15px] w-[15px]" />
          </button>
          <span className="mx-1 h-4 w-px bg-border" />
          <span className="truncate text-[13px] text-text-2">
            {file?.name ?? "Untitled document"}
            {isDirty && file && (
              <span
                className="ml-1.5 text-vault"
                aria-label="Unsaved changes"
                title="Unsaved changes"
              >
                •
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[11px] font-medium text-vault">
            <Lock className="h-3 w-3" strokeWidth={2.5} />
            100% in your browser
          </span>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground hover:opacity-90 transition-opacity"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
            Export
          </button>
        </div>
      </header>

      {/* TAB STRIP */}
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        onActivate={setActiveId}
        onClose={(id) => closeTab(id)}
        onNew={openNewStartTab}
      />

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
                  kbd={SHORTCUTS[tool.id]}
                  pinned={manualPinSet.has(tool.id)}
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
            alwaysShow
          >
            <Grid3x3 className="h-[18px] w-[18px]" />
          </RailButton>
        </nav>

        {/* CANVAS + INSPECTOR */}
        <div className="relative flex min-w-0 flex-1">
          {/* CANVAS */}
          <main className="relative flex min-w-0 flex-1 flex-col bg-background">
            {activeToolId === "compare" ? (
              <CompareFloatingBar />
            ) : file && activeToolId !== "organize" ? (
              <>
                <FloatingToolbar
                  activeToolId={activeToolId}
                  active={editorTool}
                  onChange={setEditorTool}
                  onUndo={() => editorDispatch({ type: "UNDO" })}
                  onRedo={() => editorDispatch({ type: "REDO" })}
                />
                <ContextualBar tool={editorTool} state={editorState} dispatch={editorDispatch} />
              </>
            ) : null}

            {/* OCR offer — single chip pinned below the floating toolbar so
                it never hides behind it. Appears only when Edit text is the
                active tool AND at least one visible page has no text layer. */}
            {showOcrBanner && (
              <div
                className="pointer-events-none absolute left-1/2 top-[102px] z-40 -translate-x-1/2"
                role="status"
              >
                <div className="pointer-events-auto flex max-w-[480px] items-start gap-3 rounded-lg border border-vault/40 bg-surface-1/95 px-3.5 py-2.5 shadow-[0_10px_28px_rgba(0,0,0,0.45)] backdrop-blur-md">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-vault",
                      ocrRunning && "animate-pulse",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    {ocrRunning ? (
                      <>
                        <div className="text-[12.5px] leading-snug text-foreground">
                          Recognising text on-device…
                        </div>
                        <div className="mt-0.5 truncate text-[11px] leading-snug text-text-muted">
                          {ocrProgressText || "Starting…"}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={onStopOcr}
                            className="rounded-md border border-vault/40 bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-surface-3"
                          >
                            Stop &amp; try editing
                          </button>
                          <span className="text-[10.5px] text-text-muted">
                            Loads whatever finished so far.
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-[12.5px] leading-snug text-foreground">
                          {hasResumePoint ? (
                            <>
                              {unprocessedScannedSet.size === 1
                                ? `Page ${[...unprocessedScannedSet][0] + 1} still looks scanned.`
                                : `${unprocessedScannedSet.size} more pages still look scanned (${formatPageRanges([...unprocessedScannedSet].map((i) => i + 1))}).`}
                            </>
                          ) : (
                            <>This looks like a scanned document — there's no editable text layer.</>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-text-muted">
                          {hasResumePoint
                            ? "Resume OCR on just the remaining pages — already-processed pages are skipped."
                            : "Run OCR (on-device) to recognise the text. Accuracy depends on scan quality; edited text is reconstructed."}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={onRequestOcr}
                            className="rounded-md bg-vault px-2.5 py-1 text-[11.5px] font-medium text-vault-foreground hover:opacity-90"
                          >
                            {hasResumePoint
                              ? `Resume OCR (${formatPageRanges([...unprocessedScannedSet].map((i) => i + 1))})`
                              : "Run OCR"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOcrBannerDismissed(true)}
                            className="rounded-md px-2.5 py-1 text-[11.5px] text-text-2 hover:bg-surface-3 hover:text-foreground"
                          >
                            Not now
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="absolute right-10 top-3 z-30 flex items-center gap-1.5">
              <CanvasIconButton label="Thumbnails" onClick={() => openTool("organize")}>
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
                  onPageLayout={(v) => patchActive({ pageLayout: v })}
                  continuous={continuous}
                  onContinuous={(v) => patchActive({ continuous: v })}
                  showGaps={showGaps}
                  onShowGaps={(v) => patchActive({ showGaps: v })}
                  theme={theme}
                  onTheme={(v) => patchActive({ theme: v })}
                  onClose={() => setViewOpen(false)}
                />
              )}
            </div>

            {/* Scroll area */}
            <div className="relative flex-1 overflow-auto">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 transition-colors"
                style={{ backgroundColor: THEME_TINT[theme] }}
              />
              {activeToolId === "compare" ? (
                <CompareCanvas activeFile={file} />
              ) : activeToolId === "organize" ? (
                <OrganizeGrid activeTabId={active.id} activeFile={file} onOpenFile={openFile} />
              ) : file ? (
                editorState.doc && editorState.doc.pages.length > 0 ? (
                  <EditorPages
                    state={editorState}
                    dispatch={editorDispatch}
                    zoom={zoom}
                    gap={showGaps ? 18 : 0}
                    onRequestOcr={onRequestOcr}
                    ocrRunning={ocrRunning}
                    onScannedChange={onScannedChange}
                    ocrPages={ocrPagesSet}
                    ocrPagesCopied={ocrPagesCopiedSet}
                    showOcrTags={editorTool === "edit-text"}
                    pageLayout={pageLayout}
                    onAutoFit={autoFit}
                    fitNonce={fitNonce}
                    zoomMode={zoomMode}
                  />



                ) : (
                  <div className="grid h-full place-items-center text-[12.5px] text-text-muted">
                    {file.size === 0 ? "Empty document" : "Loading document…"}
                  </div>
                )
              ) : (
                <div className="relative h-full">
                  {pendingResume.length > 0 && (
                    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-vault/40 bg-accent-soft px-3 py-1.5 text-[12px] text-vault">
                      <span>Resume your {pendingResume.length} previously open document{pendingResume.length === 1 ? "" : "s"}?</span>
                      <button
                        type="button"
                        onClick={restoreOpenTabs}
                        className="rounded-md bg-vault px-2 py-0.5 text-[11.5px] font-medium text-vault-foreground hover:opacity-90"
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={dismissResume}
                        className="rounded-md px-1.5 py-0.5 text-[11.5px] text-vault/80 hover:bg-vault/10"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                  <EmptyStart
                    onOpen={openFile}
                    onBlank={loadBlank}
                    onTemplate={loadTemplate}
                    recents={recents}
                    onResume={resumeRecent}
                    onDismissRecent={dismissRecent}
                    onClearRecents={clearAllRecents}
                  />
                </div>
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
            onClose={() => patchActive({ inspectorOpen: false })}
            file={active.file}
            replaceFile={(f) => patchActive({ file: f, isDirty: true })}
            editorDispatch={editorDispatch}
            otherTabs={tabs
              .filter((t) => t.id !== active.id && t.file)
              .map((t) => ({ id: t.id, name: t.file!.name, file: t.file! }))}
          />
        </div>
      </div>

      {/* TOOL MODAL */}
      {toolModalOpen && (
        <ToolModal
          activeToolId={activeToolId}
          onSelect={(id) => openTool(id)}
          onClose={() => setToolModalOpen(false)}
          manualPinSet={manualPinSet}
          onTogglePin={togglePin}
          railCount={pinnedTools.length}
          manualPinCount={manualPins.length}
        />

      )}

      {/* BOTTOM BAR */}
      <footer className="flex h-[38px] shrink-0 items-center justify-between border-t border-border bg-surface-1 px-3 text-[11.5px]">
        <div className="font-mono text-text-muted truncate">
          {file ? `${file.name} · — pages · ${sizeLabel}` : "No document loaded"}
        </div>
        <div className="flex items-center gap-1">
          <ZoomButton
            onClick={() => patchActive({ zoom: Math.max(25, zoom - 10), zoomMode: "custom" })}
            label="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" />
          </ZoomButton>
          <button
            type="button"
            onClick={() => patchActive({ zoom: 100, zoomMode: "actual" })}
            title="Reset to 100%"
            className="font-mono tabular-nums px-2 text-text-2 hover:text-foreground min-w-[3.5rem] text-center"
          >
            {zoom}%
          </button>
          <ZoomButton
            onClick={() => patchActive({ zoom: Math.min(400, zoom + 10), zoomMode: "custom" })}
            label="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" />
          </ZoomButton>
          <span className="mx-1 h-3.5 w-px bg-border" />
          <ZoomModeSelect
            mode={zoomMode}
            onChange={(m) => {
              patchActive({ zoomMode: m });
              setFitNonce((n) => n + 1);
            }}
          />
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

      {/* Unsaved-changes guard — used only when closing a dirty tab */}
      {pendingCloseId && (
        <UnsavedChangesDialog
          filename={tabs.find((t) => t.id === pendingCloseId)?.file?.name}
          onSave={handleSaveAndClose}
          onDiscard={handleDiscardAndClose}
          onCancel={() => setPendingCloseId(null)}
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

/* ----------------------- Floating tooltip ---------------------------- */

// Lightweight hover tooltip. Quick (75ms fade), absolutely positioned so it
// never sits on top of its trigger, and hidden on touch / no-hover devices
// where a hover tooltip makes no sense.
function Tip({
  label,
  kbd,
  placement = "right",
  children,
  className,
  alwaysShow,
}: {
  label: string;
  kbd?: string;
  placement?: "right" | "left" | "top" | "bottom" | "bottom-end";
  children: React.ReactNode;
  className?: string;
  alwaysShow?: boolean;
}) {
  const pos =
    placement === "right"
      ? "left-[calc(100%+6px)] top-1/2 -translate-y-1/2"
      : placement === "left"
        ? "right-[calc(100%+6px)] top-1/2 -translate-y-1/2"
        : placement === "top"
          ? "bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2"
          : placement === "bottom-end"
            ? "top-[calc(100%+6px)] right-0"
            : "top-[calc(100%+6px)] left-1/2 -translate-x-1/2";
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 inline-flex items-center whitespace-nowrap rounded-full bg-surface-3 px-2.5 py-1 text-[11px] font-medium leading-none text-foreground shadow-[0_4px_14px_rgba(0,0,0,0.45)]",
          alwaysShow ? "opacity-100" : "opacity-0 transition-opacity duration-100 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          "[@media(hover:none)]:hidden",
          pos,
        )}
      >
        {label}
        {kbd && (
          <span className="ml-1.5 rounded bg-surface-1 px-1 py-[1px] font-mono text-[10px] text-text-muted">
            {kbd}
          </span>
        )}
      </span>
    </span>
  );
}

/* ----------------------------- Rail ---------------------------------- */

function RailButton({
  children,
  label,
  kbd,
  active,
  pinned,
  onClick,
  alwaysShow,
}: {
  children: React.ReactNode;
  label: string;
  kbd?: string;
  active?: boolean;
  pinned?: boolean;
  onClick: () => void;
  alwaysShow?: boolean;
}) {
  return (
    <Tip label={label} kbd={kbd} placement="right" alwaysShow={alwaysShow}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "relative grid h-9 w-9 place-items-center text-text-2 transition-colors",
          "hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-accent-soft text-vault",
        )}
        style={{ borderRadius: 9 }}
      >
        {children}
        {pinned && (
          <span
            aria-hidden
            title="Pinned"
            className="absolute -right-[2px] -top-[2px] h-1.5 w-1.5 rounded-full bg-vault"
          />
        )}
      </button>
    </Tip>
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
    { id: "strikethrough", label: "Strikethrough", Icon: Strikethrough },
  ],
  [{ id: "note", label: "Comment", Icon: MessageSquare }],
  [
    { id: "image", label: "Insert image", Icon: ImageIcon },
    { id: "rect", label: "Rectangle", Icon: Square },
    { id: "freehand", label: "Freehand", Icon: Pencil },
  ],
];

// Per-tool contextual canvas actions. When a tool is active and listed here,
// the floating toolbar SWAPS to its actions — never opens a second rail.
const CONTEXTUAL_GROUPS: Record<
  string,
  Array<Array<{ id: EditorTool; label: string; Icon: React.ComponentType<{ className?: string }> }>>
> = {
  redact: [
    [{ id: "select", label: "Select", Icon: MousePointer2 }],
    [{ id: "redact", label: "Draw redaction box", Icon: Square }],
  ],
  "page-crop": [
    [{ id: "select", label: "Select", Icon: MousePointer2 }],
    [{ id: "page-crop", label: "Draw crop box", Icon: Crop }],
  ],
};

function FloatingToolbar({
  activeToolId,
  active,
  onChange,
  onUndo,
  onRedo,
}: {
  activeToolId: string | null;
  active: EditorTool;
  onChange: (t: EditorTool) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const contextual = activeToolId ? CONTEXTUAL_GROUPS[activeToolId] : null;
  const groups = contextual ?? EDITOR_GROUPS;
  const label = contextual ? `${activeToolId} tools` : "Editor tools";
  return (
    <div
      className="absolute left-1/2 top-2.5 z-30 flex -translate-x-1/2 items-center gap-1 border border-border bg-surface-3 px-1.5 py-1"
      style={{ borderRadius: 11, boxShadow: "var(--shadow-float)" }}
      role="toolbar"
      aria-label={label}
    >
      {groups.map((group, gi) => (
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
      <ToolbarBtn label="Undo" onClick={onUndo}>
        <Undo2 className="h-[15px] w-[15px]" />
      </ToolbarBtn>
      <ToolbarBtn label="Redo" onClick={onRedo}>
        <Redo2 className="h-[15px] w-[15px]" />
      </ToolbarBtn>
    </div>
  );
}

function ToolbarBtn({
  children,
  label,
  kbd,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  kbd?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tip label={label} kbd={kbd} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md text-text-2 transition-colors",
          "hover:text-foreground hover:bg-surface-2",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-vault text-vault-foreground hover:bg-vault hover:text-vault-foreground",
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

/* --------------------- Contextual properties bar -------------------- */

function ContextualBar({
  tool,
  state,
  dispatch,
}: {
  tool: EditorTool;
  state: ReturnType<typeof reducer> extends infer S ? S : never;
  dispatch: React.Dispatch<EditorAction>;
}) {
  // Find the currently selected annotation, if any.
  const sel = state.doc?.annotations.find((a) => a.id === state.selectedAnnoId) ?? null;
  const isTextLike =
    (tool === "edit-text" || tool === "text") &&
    sel &&
    (sel.kind === "text-edit" || sel.kind === "text");

  // Render either the wired text-edit bar OR the generic stub for other tools.
  const inner = isTextLike
    ? <TextEditPropsBar anno={sel as Extract<typeof sel, { kind: "text-edit" | "text" }>} dispatch={dispatch} />
    : (tool === "edit-text" || tool === "text")
      ? <span className="text-text-muted">{tool === "edit-text"
          ? "Click any text on the page to edit — font is auto-detected."
          : "Click on the page to add a text box."}</span>
      : contextStub(tool);
  if (!inner) return null;
  return (
    <div
      className="absolute left-1/2 top-[58px] z-20 flex -translate-x-1/2 items-center gap-2 border border-border bg-surface-3 px-2.5 py-1.5 text-[12px] text-text-2"
      style={{ borderRadius: 11, boxShadow: "var(--shadow-float)" }}
    >
      {inner}
    </div>
  );
}

// Functional properties bar for a selected text/text-edit annotation.
function TextEditPropsBar({
  anno,
  dispatch,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anno: any;
  dispatch: React.Dispatch<EditorAction>;
}) {
  const isEdit = anno.kind === "text-edit";
  const patch = (p: Record<string, unknown>) =>
    dispatch({ type: "UPDATE_ANNO", id: anno.id, patch: p as never });
  const fontKey: string = anno.fontKey ?? (anno.family === "serif" ? "tinos" : anno.family === "mono" ? "cousine" : "arimo");
  const fontMeta = FONT_META[fontKey as FontKey] ?? FONT_META.arimo;
  const fontOverride = typeof anno.fontFamilyOverride === "string" ? anno.fontFamilyOverride : "";
  const detectedFamilyLabel = fontOverride
    ? fontOverride.split(",")[0].replace(/['"]/g, "").trim() || "Detected font"
    : "";
  const fontValue = fontOverride ? "__detected" : fontKey;
  const setFontKey = (key: FontKey) => {
    const meta = FONT_META[key] ?? FONT_META.arimo;
    patch({ fontKey: key, family: meta.kind, fontApproximate: false, fontFamilyOverride: undefined });
  };
  return (
    <>
      <select
        aria-label="Font"
        value={fontValue}
        onChange={(e) => {
          if (e.target.value === "__detected") return;
          setFontKey(e.target.value as FontKey);
        }}
        className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[12px] text-foreground focus:outline-none focus:border-vault/50"
        title={`Metric-compatible: matches ${fontMeta.matches}`}
      >
        {fontOverride && <option value="__detected">{detectedFamilyLabel}</option>}
        {Object.values(FONT_META).map((m) => (
          <option key={m.key} value={m.key}>{m.label} — {m.matches}</option>
        ))}
      </select>
      <input
        aria-label="Size"
        type="number"
        min={4}
        max={144}
        step={0.5}
        value={Math.round(anno.fontSize * 10) / 10}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v) && v > 0) patch({ fontSize: v });
        }}
        className="w-14 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[12px] text-foreground focus:outline-none focus:border-vault/50"
      />
      <span className="h-4 w-px bg-border" />
      <PropToggle
        active={!!anno.bold}
        onClick={() => patch({ bold: !anno.bold })}
        title="Bold"
      >
        <span className="font-bold">B</span>
      </PropToggle>
      <PropToggle
        active={!!anno.italic}
        onClick={() => patch({ italic: !anno.italic })}
        title="Italic"
      >
        <span className="italic">I</span>
      </PropToggle>
      <span className="h-4 w-px bg-border" />
      <ColorPicker
        value={anno.color}
        onChange={(c) => patch({ color: c })}
      />
      <input
        aria-label="Text color"
        type="color"
        value={rgbToHex(anno.color)}
        onChange={(e) => patch({ color: hexToRgb(e.target.value) })}
        className="h-5 w-5 cursor-pointer rounded-sm border border-border bg-transparent p-0"
        title="Custom color"
      />
      {isEdit && (
        <>
          <span className="h-4 w-px bg-border" />
          <span
            className="text-text-muted"
            title="Edit replaces text as an overlay and matches the font as closely as possible — adjust it here if needed."
            aria-label="Help"
          >
            ⓘ
          </span>
        </>
      )}
    </>
  );
}

function PropToggle({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "grid h-6 min-w-[24px] place-items-center rounded-md px-1.5 text-[12px] text-text-2 hover:bg-surface-2 hover:text-foreground",
        active && "bg-vault text-vault-foreground hover:bg-vault hover:text-vault-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: RGB;
  onChange: (c: RGB) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {PALETTE.map((c, i) => {
        const isActive =
          Math.abs(c.r - value.r) < 0.02 &&
          Math.abs(c.g - value.g) < 0.02 &&
          Math.abs(c.b - value.b) < 0.02;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(c)}
            aria-label="Color"
            className={cn(
              "h-4 w-4 rounded-full ring-1 ring-border",
              isActive && "ring-2 ring-vault",
            )}
            style={{ background: `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})` }}
          />
        );
      })}
    </div>
  );
}

function rgbToHex(c: RGB): string {
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
function hexToRgb(hex: string): RGB {
  const s = hex.replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((x) => x + x).join("") : s, 16);
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
}

// Stub bars for non-text tools (unchanged from previous behaviour).
function contextStub(tool: EditorTool): React.ReactNode | null {
  switch (tool) {
    case "highlight":
    case "underline":
    case "strikethrough":
      return <span className="text-text-muted">Drag across text to mark.</span>;
    case "rect":
    case "ellipse":
    case "line":
    case "arrow":
    case "freehand":
      return <span className="text-text-muted">Drag on the page to draw.</span>;
    case "image":
      return <span className="text-text-muted">Click the page to place the image. Select it to crop.</span>;
    case "redact":
      return <span className="text-text-muted">Drag to mark text or regions for permanent redaction on export.</span>;
    case "page-crop":
      return <span className="text-text-muted">Drag a box over the page to crop. Drag again to replace, or × to clear. Applied per page on export.</span>;
    case "note":
    case "select":
    default:
      return null;
  }
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
    <Tip label={label} placement="bottom-end">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md border border-border bg-surface-2 text-text-2",
          "hover:text-foreground transition-colors",
          active && "text-vault bg-accent-soft border-vault/30",
        )}
      >
        {children}
      </button>
    </Tip>
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
  recents,
  onResume,
  onDismissRecent,
  onClearRecents,
}: {
  onOpen: () => void;
  onBlank: () => void;
  onTemplate: (name: string) => void;
  recents: RecentMeta[];
  onResume: (id: string) => void;
  onDismissRecent: (id: string) => void;
  onClearRecents: () => void;
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

        {recents.length > 0 && (
          <div className="mt-8 text-left">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-text-muted">
                Resume recent
              </div>
              <button
                type="button"
                onClick={onClearRecents}
                className="text-[11px] text-text-muted hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <ul className="space-y-1.5">
              {recents.map((r) => (
                <li
                  key={r.id}
                  className="group flex items-center gap-2 rounded-md border border-border/70 bg-surface-2 px-2.5 py-2"
                  style={{ borderWidth: 0.5, borderRadius: 9 }}
                >
                  <button
                    type="button"
                    onClick={() => onResume(r.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    title={`Resume ${r.name}`}
                  >
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center bg-accent-soft text-vault"
                      style={{ borderRadius: 7 }}
                    >
                      <FileType className="h-[14px] w-[14px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-foreground">
                        Resume {r.name}
                      </span>
                      <span className="block font-mono text-[10.5px] text-text-muted">
                        {prettyBytes(r.size)} · {relTime(r.addedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissRecent(r.id)}
                    aria-label={`Remove ${r.name}`}
                    className="grid h-7 w-7 place-items-center rounded-md text-text-muted opacity-0 transition-opacity hover:bg-surface-3 hover:text-foreground group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 px-1 text-[10.5px] text-text-muted">
              Recent files are stored only on this device.
            </div>
          </div>
        )}


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
  file,
  replaceFile,
  editorDispatch,
  otherTabs,
}: {
  open: boolean;
  activeTool: RailTool | null;
  onClose: () => void;
  file: File | null;
  replaceFile: (f: File) => void;
  editorDispatch: React.Dispatch<EditorAction>;
  otherTabs: Array<{ id: string; name: string; file: File }>;
}) {
  return (
    <aside
      aria-label="Inspector"
      className={cn(
        "shrink-0 border-l border-border bg-surface-1 overflow-hidden",
        "transition-[width] duration-200",
      )}
      style={{
        width: open && activeTool ? 280 : 0,
        transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {activeTool ? (
        <div className="flex h-full w-[280px] flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
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
          <div className="flex-1 overflow-auto px-3 py-3">
            <ToolPanel toolId={activeTool.id} ctx={{ file, replaceFile, editorDispatch, otherTabs }} />
          </div>
        </div>
      ) : (
        open && (
          <div className="grid h-full w-[280px] place-items-center px-4 text-center text-[11.5px] text-text-muted">
            Mount slot — feature panel loads here
          </div>
        )
      )}
    </aside>
  );
}

/* --------------------------- Tool modal ------------------------------ */

function ToolModal({
  onSelect,
  onClose,
  activeToolId,
  manualPinSet,
  onTogglePin,
  railCount,
  manualPinCount,
}: {
  onSelect: (id: string) => void;
  onClose: () => void;
  activeToolId: string | null;
  manualPinSet: Set<string>;
  onTogglePin: (id: string) => void;
  railCount: number;
  manualPinCount: number;
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
          <span
            className="font-mono text-[10.5px] text-text-muted"
            title={`Manual pins: ${manualPinCount}/${PIN_CAP_TOTAL}. Rail uses ${railCount}/${PIN_CAP_TOTAL} slots; the rest auto-fill from your most-used tools.`}
          >
            Rail {railCount}/{PIN_CAP_TOTAL}
          </span>
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
                  {items.map((tool) => {
                    const isPinned = manualPinSet.has(tool.id);
                    const railFull = manualPinCount >= PIN_CAP_TOTAL && !isPinned;
                    return (
                      <div
                        key={tool.id}
                        className={cn(
                          "relative flex items-center rounded-md border border-transparent bg-surface-2 transition-colors",
                          "hover:bg-surface-3 hover:border-border",
                          activeToolId === tool.id && "border-vault/40 bg-accent-soft",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onSelect(tool.id)}
                          title={tool.label + (SHORTCUTS[tool.id] ? `  ${SHORTCUTS[tool.id]}` : "")}
                          className="flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left min-w-0"
                        >
                          <span
                            className={cn(
                              "grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-1 text-text-2",
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
                          {isPinned && (
                            <span
                              aria-hidden
                              className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-vault"
                              title="Pinned to rail"
                            />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (railFull) {
                              toast.error(
                                `Rail is full (${PIN_CAP_TOTAL} max). Unpin a tool first.`,
                              );
                              return;
                            }
                            onTogglePin(tool.id);
                          }}
                          aria-disabled={railFull}
                          aria-label={isPinned ? "Unpin from rail" : "Pin to rail"}
                          title={
                            isPinned
                              ? "Unpin from rail"
                              : railFull
                                ? `Rail is full (${PIN_CAP_TOTAL} max). Unpin a tool first.`
                                : "Pin to rail"
                          }
                          className={cn(
                            "mr-1.5 grid h-6 w-6 shrink-0 place-items-center rounded text-text-muted transition-colors",
                            "hover:bg-surface-1 hover:text-foreground",
                            isPinned && "text-vault hover:text-vault",
                            railFull && "opacity-40",
                          )}
                        >
                          {isPinned ? (
                            <PinOff className="h-[13px] w-[13px]" />
                          ) : (
                            <Pin className="h-[13px] w-[13px]" />
                          )}
                        </button>
                      </div>
                    );
                  })}
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
        <div className="border-t border-border px-3 py-2 text-[10.5px] leading-snug text-text-muted">
          Manual pins (dot) stay locked. Remaining slots auto-fill with your most-used tools. Max {PIN_CAP_TOTAL} in the rail.
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
  const btn = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
    >
      {children}
    </button>
  );
  return label ? <Tip label={label} placement="top">{btn}</Tip> : btn;
}

type ZoomModeOpt = "smart" | "fit-width" | "fit-page" | "actual" | "custom";

function ZoomModeSelect({
  mode,
  onChange,
}: {
  mode: ZoomModeOpt;
  onChange: (m: ZoomModeOpt) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const LABEL: Record<ZoomModeOpt, string> = {
    smart: "Smart",
    "fit-width": "Fit Width",
    "fit-page": "Fit Page",
    actual: "Actual Size",
    custom: "Custom",
  };
  const options: ZoomModeOpt[] = ["smart", "fit-width", "fit-page", "actual"];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-text-2 hover:bg-surface-2 hover:text-foreground"
        title="Zoom mode"
      >
        <StretchHorizontal className="h-3.5 w-3.5" />
        <span>{LABEL[mode]}</span>
      </button>
      {open ? (
        <div className="absolute bottom-[110%] right-0 z-50 min-w-[150px] rounded-md border border-border bg-surface-1 p-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setOpen(false); }}
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[12px] hover:bg-surface-2 ${
                mode === o ? "text-foreground" : "text-text-2"
              }`}
            >
              <span>{LABEL[o]}</span>
              {mode === o ? <span className="text-[10px] text-text-muted">●</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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

// Compact a list of 1-based page numbers into ranges. e.g. [1,2,3,5,7,8] →
// "1–3, 5, 7–8". Returns "—" for empty.
function formatPageRanges(pagesInput: number[]): string {
  if (pagesInput.length === 0) return "—";
  const pages = [...pagesInput].sort((a, b) => a - b);
  const out: string[] = [];
  let start = pages[0];
  let prev = start;
  for (let i = 1; i <= pages.length; i++) {
    const cur = pages[i];
    if (cur !== prev + 1) {
      out.push(start === prev ? `${start}` : `${start}\u2013${prev}`);
      start = cur;
    }
    prev = cur;
  }
  return out.join(", ");
}

function relTime(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}


/* ---------------------- Editor pages list (native) -------------------- */
// Virtualized renderer: loads pdf.js doc ONCE, measures every page, then
// mounts EditorCanvas only for pages near the viewport. Off-screen pages
// render as sized placeholders so the scrollbar stays accurate while
// memory stays bounded. pdf.js parsing runs in its Web Worker.

import type { Dispatch as ReactDispatch } from "react";
import type { State as EditorState } from "@/lib/editor/state";
import { loadPdfjs } from "@/lib/pdf/worker";

const VIRT_BUFFER_PX = 800; // render pages within this many px of viewport

function EditorPages({
  state, dispatch, zoom, gap, onRequestOcr, ocrRunning, onScannedChange,
  ocrPages, ocrPagesCopied, showOcrTags, pageLayout = "single",
  onAutoFit, fitNonce, zoomMode = "actual",
}: {
  state: EditorState;
  dispatch: ReactDispatch<EditorAction>;
  zoom: number;
  gap: number;
  onRequestOcr?: () => void;
  ocrRunning?: boolean;
  onScannedChange?: (pageIndex: number, isScanned: boolean) => void;
  ocrPages?: Set<number>;
  ocrPagesCopied?: Set<number>;
  showOcrTags?: boolean;
  pageLayout?: "single" | "double";
  onAutoFit?: (zoom: number) => void;
  fitNonce?: number;
  zoomMode?: "smart" | "fit-width" | "fit-page" | "actual" | "custom";
}) {


  const scale = (zoom / 100) * 1.3;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [sizes, setSizes] = useState<Array<{ width: number; height: number }>>([]);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [visible, setVisible] = useState<Set<number>>(() => new Set([0, 1, 2]));
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const srcBytes = state.doc?.srcBytes;
  const pages = state.doc?.pages;

  // Observe the scroll-area size so we can auto-fit on resize.
  useEffect(() => {
    const root = containerRef.current?.parentElement;
    if (!root) return;
    setContainerWidth(root.clientWidth);
    setContainerHeight(root.clientHeight);
    const ro = new ResizeObserver(() => {
      setContainerWidth(root.clientWidth);
      setContainerHeight(root.clientHeight);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  // Auto-fit zoom based on zoomMode. "custom" → never override the user.
  // "smart" picks fit-width for standard docs (≤ Legal+slack), fit-page for
  // posters / large-format pages so the whole page is visible at open.
  useEffect(() => {
    if (!onAutoFit) return;
    if (zoomMode === "custom") return;
    if (sizes.length === 0 || containerWidth <= 0) return;
    const first = sizes[0];
    const second = sizes[1] ?? first;
    const horizontalPadding = 48; // px-4 + scrollbar slack
    const verticalPadding = 48;
    const availW = Math.max(100, containerWidth - horizontalPadding);
    const availH = Math.max(100, containerHeight - verticalPadding);
    const rowGap = Math.max(8, Math.floor(gap / 2));
    const naturalW = pageLayout === "double"
      ? (first.width + second.width) * 1.3 + rowGap
      : first.width * 1.3;
    const naturalH = first.height * 1.3;

    let next = 100;
    if (zoomMode === "actual") {
      next = 100;
    } else if (zoomMode === "fit-width") {
      next = Math.round((availW / naturalW) * 100);
    } else if (zoomMode === "fit-page") {
      next = Math.round(Math.min(availW / naturalW, availH / naturalH) * 100);
    } else {
      // smart: large-format → fit-page, otherwise fit-width.
      // Letter=612x792, A4=595x842, Legal=612x1008, Tabloid=792x1224.
      // Anything wider/taller (A3=842x1191, A2=1191x1684, posters, plans)
      // is "large-format" → fit the whole page.
      const isLargeFormat = first.width > 900 || first.height > 1300;
      if (isLargeFormat) {
        next = Math.round(Math.min(availW / naturalW, availH / naturalH) * 100);
      } else {
        next = Math.round((availW / naturalW) * 100);
      }
    }
    next = Math.max(25, Math.min(400, next));
    onAutoFit(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLayout, sizes, srcBytes, containerWidth, containerHeight, fitNonce, zoomMode]);


  // Load doc once per srcBytes.
  useEffect(() => {
    if (!srcBytes) { setPdfDoc(null); setSizes([]); return; }
    let cancelled = false;
    setProgress({ loaded: 0, total: 0 });
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const task = pdfjs.getDocument({ data: srcBytes.slice() });
        task.onProgress = (p: { loaded: number; total: number }) => {
          if (!cancelled) setProgress({ loaded: p.loaded, total: p.total });
        };
        const doc = await task.promise;
        if (cancelled) return;
        // Measure all pages (cheap — getPage doesn't render).
        const measured: Array<{ width: number; height: number }> = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const vp = page.getViewport({ scale: 1 });
          measured.push({ width: vp.width, height: vp.height });
        }
        if (cancelled) return;
        setSizes(measured);
        setPdfDoc(doc);
        setProgress(null);
      } catch (err) {
        console.error("[EditorPages] doc load failed", err);
        setProgress(null);
      }
    })();
    return () => { cancelled = true; };
  }, [srcBytes]);

  // Recompute which pages are within viewport+buffer.
  const recompute = useCallback(() => {
    const root = containerRef.current?.parentElement; // the scrollable area
    if (!root || !pages) return;
    const rootRect = root.getBoundingClientRect();
    const next = new Set<number>();
    for (let i = 0; i < pageRefs.current.length; i++) {
      const el = pageRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const above = rootRect.top - r.bottom;
      const below = r.top - rootRect.bottom;
      if (above <= VIRT_BUFFER_PX && below <= VIRT_BUFFER_PX) next.add(i);
    }
    if (next.size === 0 && pages.length > 0) next.add(0);
    setVisible((prev) => {
      if (prev.size === next.size) {
        let same = true;
        for (const v of next) if (!prev.has(v)) { same = false; break; }
        if (same) return prev;
      }
      return next;
    });
  }, [pages]);

  useEffect(() => {
    const root = containerRef.current?.parentElement;
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; recompute(); });
    };
    recompute();
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [recompute, sizes.length, zoom]);

  if (!state.doc) return null;

  const renderPage = (op: NonNullable<typeof pages>[number], i: number) => {
    const meta = sizes[op.srcPage] ?? { width: op.width || 612, height: op.height || 792 };
    const w = Math.ceil(meta.width * scale);
    const h = Math.ceil(meta.height * scale);
    const inView = visible.has(i);
    const annosForPage = state.doc!.annotations.filter((a) => a.page === i);
    const isOcrPage = !!ocrPages?.has(i);
    const isCopiedPage = !isOcrPage && !!ocrPagesCopied?.has(i);
    const showTag = showOcrTags && (isOcrPage || isCopiedPage);
    return (
      <div
        key={`${i}-${op.srcPage}-${op.rotation}-${op.blank ? 1 : 0}`}
        ref={(el) => { pageRefs.current[i] = el; }}
        data-page-index={i}
        style={{ width: w, minHeight: h }}
        className="relative"
      >
        {inView && (pdfDoc || op.blank) ? (
          <EditorCanvas
            pageIndex={i}
            op={op}
            srcBytes={state.doc!.srcBytes}
            annos={annosForPage}
            state={state}
            dispatch={dispatch}
            scale={scale}
            pdfDoc={pdfDoc}
            onRequestOcr={onRequestOcr}
            ocrRunning={ocrRunning}
            onScannedChange={onScannedChange}
            isOcrPage={isOcrPage}
          />
        ) : (
          <div
            style={{ width: w, height: h }}
            className="rounded-sm bg-[var(--paper)] opacity-60"
            aria-hidden
          />
        )}
        {showTag && (
          <div className="pointer-events-none absolute right-3 top-3 z-10">
            <span
              className="pointer-events-auto inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted/70 hover:text-text-muted transition-colors"
              title={
                isOcrPage
                  ? "Text recognised on-device — edit with the Text tool."
                  : "Already had a text layer — copied through unchanged."
              }
              aria-label={isOcrPage ? "OCR applied to this page" : "Page is already searchable"}
            >
              <FileCheck2 className="h-2.5 w-2.5" aria-hidden />
              OCR
            </span>
          </div>
        )}
      </div>
    );
  };

  const rowGap = Math.max(8, Math.floor(gap / 2));

  return (
    <div
      ref={containerRef}
      className="mx-auto flex flex-col items-center py-6 px-4"
      style={{ gap }}
    >
      {progress && (
        <div className="text-[12px] text-text-muted">
          {progress.total > 0
            ? `Loading document… ${Math.round((progress.loaded / progress.total) * 100)}%`
            : "Loading document…"}
          {sizes.length === 0 && srcBytes && srcBytes.byteLength > 20_000_000 && (
            <span className="ml-2 opacity-70">Large file — optimizing…</span>
          )}
        </div>
      )}
      {pageLayout === "double"
        ? (() => {
            const rows: React.ReactNode[] = [];
            for (let i = 0; i < pages!.length; i += 2) {
              const left = pages![i];
              const right = pages![i + 1];
              rows.push(
                <div
                  key={`row-${i}`}
                  className="flex items-start justify-center"
                  style={{ gap: rowGap }}
                >
                  {renderPage(left, i)}
                  {right ? renderPage(right, i + 1) : null}
                </div>
              );
            }
            return rows;
          })()
        : pages!.map((op, i) => renderPage(op, i))}
    </div>
  );
}
