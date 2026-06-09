// PDF Editor — single-page route holding the working document, toolbar,
// page thumbnails sidebar, and the active page canvas with annotations.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import {
  MousePointer2, Type, Highlighter, Square, Circle, Pen, StickyNote,
  Image as ImageIcon, PencilLine, Trash2, Plus, RotateCw, Download,
  ChevronLeft, ChevronRight, Undo2, Redo2, FileSignature, BadgeCheck,
  Underline as UnderlineIcon, Strikethrough, Minus, ArrowRight,
  EyeOff, Droplets, Lock, CalendarDays,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { loadPdfjs } from "@/lib/pdf/worker";
import { exportEditedPdf } from "@/lib/editor/export";
import { computeQuads } from "@/lib/editor/quad-capture";
import { CommentsPanel } from "@/components/editor/CommentsPanel";
import type { Anno, EditorDoc, ExportSettings, PageOp, ProtectSettings, RGB, Tool, TextSource, WatermarkSettings } from "@/lib/editor/types";

export const Route = createFileRoute("/editor")({
  head: () => ({
    meta: [
      { title: "PDF Editor — annotate, edit text, reorder pages | VaultPDF" },
      {
        name: "description",
        content:
          "A full-featured PDF editor in your browser. Annotate, highlight, draw, add images, edit existing text, and reorder pages — nothing uploads.",
      },
      { property: "og:title", content: "PDF Editor — VaultPDF" },
      { property: "og:description", content: "Annotate, edit, and rearrange PDFs entirely in your browser." },
    ],
    links: [{ rel: "canonical", href: "/editor" }],
  }),
  component: EditorRoute,
});

// ---------- state ----------

type State = {
  doc: EditorDoc | null;
  current: number; // page index in working list
  tool: Tool;
  selectedAnnoId: string | null;
  color: RGB;
  fillShape: boolean;
  stroke: number;
  fontSize: number;
  opacity: number;
  pendingImage: { dataUrl: string; mime: "image/png" | "image/jpeg"; w: number; h: number } | null;
  watermark: WatermarkSettings | null;
  protect: ProtectSettings | null;
  // history
  past: EditorDoc[];
  future: EditorDoc[];
};

type Action =
  | { type: "LOAD"; doc: EditorDoc }
  | { type: "SET_PAGE"; n: number }
  | { type: "SET_TOOL"; t: Tool }
  | { type: "SET_COLOR"; c: RGB }
  | { type: "SET_OPACITY"; v: number }
  | { type: "SET_STROKE"; v: number }
  | { type: "SET_FONT"; v: number }
  | { type: "SET_FILL"; v: boolean }
  | { type: "SELECT_ANNO"; id: string | null }
  | { type: "ADD_ANNO"; a: Anno }
  | { type: "UPDATE_ANNO"; id: string; patch: Partial<Anno> }
  | { type: "DELETE_ANNO"; id: string }
  | { type: "REORDER_PAGE"; from: number; to: number }
  | { type: "DELETE_PAGE"; n: number }
  | { type: "INSERT_BLANK"; after: number; width: number; height: number }
  | { type: "ROTATE_PAGE"; n: number }
  | { type: "SET_PENDING_IMAGE"; img: State["pendingImage"] }
  | { type: "SET_WATERMARK"; w: WatermarkSettings | null }
  | { type: "SET_PROTECT"; p: ProtectSettings | null }
  | { type: "UNDO" }
  | { type: "REDO" };

function commit(state: State, nextDoc: EditorDoc): State {
  return {
    ...state,
    doc: nextDoc,
    past: state.doc ? [...state.past.slice(-49), state.doc] : state.past,
    future: [],
  };
}

const initialState: State = {
  doc: null,
  current: 0,
  tool: "select",
  selectedAnnoId: null,
  color: { r: 1, g: 0.85, b: 0 },
  fillShape: false,
  stroke: 2,
  fontSize: 14,
  opacity: 1,
  pendingImage: null,
  watermark: null,
  protect: null,
  past: [],
  future: [],
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "LOAD":
      return { ...initialState, doc: a.doc, color: s.color };
    case "SET_PAGE":
      return { ...s, current: a.n, selectedAnnoId: null };
    case "SET_TOOL":
      return { ...s, tool: a.t, selectedAnnoId: a.t === "select" ? s.selectedAnnoId : null };
    case "SET_COLOR": return { ...s, color: a.c };
    case "SET_OPACITY": return { ...s, opacity: a.v };
    case "SET_STROKE": return { ...s, stroke: a.v };
    case "SET_FONT": return { ...s, fontSize: a.v };
    case "SET_FILL": return { ...s, fillShape: a.v };
    case "SELECT_ANNO": return { ...s, selectedAnnoId: a.id };
    case "SET_PENDING_IMAGE": return { ...s, pendingImage: a.img };
    case "SET_WATERMARK": return { ...s, watermark: a.w };
    case "SET_PROTECT": return { ...s, protect: a.p };
    case "ADD_ANNO": {
      if (!s.doc) return s;
      return commit(s, { ...s.doc, annotations: [...s.doc.annotations, a.a] });
    }
    case "UPDATE_ANNO": {
      if (!s.doc) return s;
      return {
        ...s,
        doc: {
          ...s.doc,
          annotations: s.doc.annotations.map((x) =>
            x.id === a.id ? ({ ...x, ...a.patch } as Anno) : x,
          ),
        },
      };
    }
    case "DELETE_ANNO": {
      if (!s.doc) return s;
      return commit(s, { ...s.doc, annotations: s.doc.annotations.filter((x) => x.id !== a.id) });
    }
    case "REORDER_PAGE": {
      if (!s.doc) return s;
      const pages = [...s.doc.pages];
      const [moved] = pages.splice(a.from, 1);
      pages.splice(a.to, 0, moved);
      const remap = (i: number) =>
        i === a.from ? a.to : i < a.from && i >= a.to ? i + 1 : i > a.from && i <= a.to ? i - 1 : i;
      const annotations = s.doc.annotations.map((x) => ({ ...x, page: remap(x.page) }));
      return commit({ ...s, current: remap(s.current) }, { ...s.doc, pages, annotations });
    }
    case "DELETE_PAGE": {
      if (!s.doc || s.doc.pages.length <= 1) return s;
      const pages = s.doc.pages.filter((_, i) => i !== a.n);
      const annotations = s.doc.annotations
        .filter((x) => x.page !== a.n)
        .map((x) => ({ ...x, page: x.page > a.n ? x.page - 1 : x.page }));
      const current = Math.min(s.current, pages.length - 1);
      return commit({ ...s, current }, { ...s.doc, pages, annotations });
    }
    case "INSERT_BLANK": {
      if (!s.doc) return s;
      const pages = [...s.doc.pages];
      const newPage: PageOp = { srcPage: -1, rotation: 0, blank: true, width: a.width, height: a.height };
      pages.splice(a.after + 1, 0, newPage);
      const annotations = s.doc.annotations.map((x) => ({ ...x, page: x.page > a.after ? x.page + 1 : x.page }));
      return commit({ ...s, current: a.after + 1 }, { ...s.doc, pages, annotations });
    }
    case "ROTATE_PAGE": {
      if (!s.doc) return s;
      const pages = s.doc.pages.map((p, i) =>
        i === a.n ? { ...p, rotation: (((p.rotation + 90) % 360) as PageOp["rotation"]) } : p,
      );
      return commit(s, { ...s.doc, pages });
    }
    case "UNDO": {
      if (!s.past.length || !s.doc) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future] };
    }
    case "REDO": {
      if (!s.future.length || !s.doc) return s;
      const next = s.future[0];
      return { ...s, doc: next, past: s.doc ? [...s.past, s.doc] : s.past, future: s.future.slice(1) };
    }
  }
}

// ---------- helpers ----------

const COLORS: RGB[] = [
  { r: 1, g: 0.85, b: 0 },     // yellow
  { r: 1, g: 0.2, b: 0.2 },    // red
  { r: 0.1, g: 0.5, b: 1 },    // blue
  { r: 0.1, g: 0.7, b: 0.3 },  // green
  { r: 0, g: 0, b: 0 },        // black
  { r: 1, g: 1, b: 1 },        // white
];

const rgbCss = (c: RGB, a = 1) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- component ----------

function EditorRoute() {
  return (
    <AppShell>
      <Editor />
    </AppShell>
  );
}

function Editor() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loading, setLoading] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [author, setAuthor] = useState("Me");



  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state.doc) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA";
      if (inField) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); dispatch({ type: "UNDO" }); return; }
      if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); dispatch({ type: "REDO" }); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && state.selectedAnnoId) {
        e.preventDefault();
        dispatch({ type: "DELETE_ANNO", id: state.selectedAnnoId });
      }
      const map: Record<string, Tool> = { v: "select", t: "text", h: "highlight", u: "underline", s: "strikethrough", r: "rect", o: "ellipse", l: "line", a: "arrow", p: "freehand", n: "note", i: "image", e: "edit-text", d: "redact" };
      if (map[e.key.toLowerCase()]) dispatch({ type: "SET_TOOL", t: map[e.key.toLowerCase()] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.doc, state.selectedAnnoId]);

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const lib = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages: PageOp[] = lib.getPages().map((p, i) => {
        const { width, height } = p.getSize();
        return { srcPage: i, rotation: 0, width, height };
      });
      dispatch({
        type: "LOAD",
        doc: { fileName: file.name, srcBytes: bytes, pages, annotations: [] },
      });
    } catch (err) {
      toast.error("Could not open this PDF", { description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  const onExport = useCallback(async () => {
    if (!state.doc) return;
    try {
      toast.loading("Building PDF…", { id: "exp" });
      const settings: ExportSettings = {
        watermark: state.watermark ?? undefined,
        protect: state.protect ?? undefined,
      };
      const bytes = await exportEditedPdf(state.doc, settings);
      toast.success("Done", { id: "exp" });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = state.doc.fileName.replace(/\.pdf$/i, "") + "-edited.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Export failed", { id: "exp", description: (err as Error).message });
    }
  }, [state.doc, state.watermark, state.protect]);

  if (!state.doc) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-3">PDF Editor</h1>
        <p className="text-muted-foreground mb-8 max-w-xl">
          Annotate, draw, add images, edit text, and rearrange pages. Everything happens in this tab — your file never uploads.
        </p>
        <FileDropzone onFile={loadFile} label={loading ? "Opening…" : "Drop your PDF here"} />
      </div>
    );
  }

  const currentPage = state.doc.pages[state.current];
  const annosForPage = state.doc.annotations.filter((a) => a.page === state.current);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <Toolbar
        state={state}
        dispatch={dispatch}
        onExport={onExport}
        commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen((v) => !v)}
      />
      <div className="flex flex-1 min-h-0">
        <PagesSidebar state={state} dispatch={dispatch} />
        <div className="flex-1 min-w-0 overflow-auto bg-muted/40">
          <div className="mx-auto py-6 px-4 flex flex-col items-center gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Page {state.current + 1} of {state.doc.pages.length}
              {currentPage.blank ? " · Blank" : ""}
              {currentPage.rotation ? ` · Rotated ${currentPage.rotation}°` : ""}
            </div>
            <PageCanvas
              key={`${state.current}-${currentPage.srcPage}-${currentPage.rotation}-${currentPage.blank ? 1 : 0}`}
              op={currentPage}
              srcBytes={state.doc.srcBytes}
              annos={annosForPage}
              state={state}
              dispatch={dispatch}
            />
            <div className="flex items-center gap-2 pt-2">
              <Button size="sm" variant="outline" disabled={state.current === 0} onClick={() => dispatch({ type: "SET_PAGE", n: state.current - 1 })}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" disabled={state.current >= state.doc.pages.length - 1} onClick={() => dispatch({ type: "SET_PAGE", n: state.current + 1 })}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        {commentsOpen && (
          <CommentsPanel
            annos={state.doc.annotations}
            author={author}
            onAuthorChange={setAuthor}
            onClose={() => setCommentsOpen(false)}
            onJump={(a) => {
              if (a.page !== state.current) dispatch({ type: "SET_PAGE", n: a.page });
              dispatch({ type: "SELECT_ANNO", id: a.id });
            }}
            onPatch={(id, patch) => dispatch({ type: "UPDATE_ANNO", id, patch: patch as Partial<Anno> })}
          />
        )}
      </div>
    </div>
  );
}



// ---------- toolbar ----------

function Toolbar({ state, dispatch, onExport, commentsOpen, onToggleComments }: { state: State; dispatch: React.Dispatch<Action>; onExport: () => void; commentsOpen: boolean; onToggleComments: () => void }) {
  const [signOpen, setSignOpen] = useState(false);
  const [stampOpen, setStampOpen] = useState(false);
  const [watermarkOpen, setWatermarkOpen] = useState(false);
  const [protectOpen, setProtectOpen] = useState(false);
  const setPendingImageFromCanvas = (canvas: HTMLCanvasElement) => {
    const dataUrl = canvas.toDataURL("image/png");
    dispatch({ type: "SET_PENDING_IMAGE", img: { dataUrl, mime: "image/png", w: canvas.width, h: canvas.height } });
    dispatch({ type: "SET_TOOL", t: "image" });
    toast.message("Click on the page to place it");
  };
  const addDateStamp = () => {
    if (!state.doc) return;
    const txt = new Date().toLocaleDateString();
    const page = state.doc.pages[state.current];
    dispatch({ type: "ADD_ANNO", a: {
      id: Math.random().toString(36).slice(2, 10),
      kind: "text", page: state.current,
      x: page.width / 2 - 60, y: page.height / 2 - 10,
      w: 160, h: 24,
      color: { r: 0.05, g: 0.07, b: 0.16 }, opacity: 1,
      text: txt, fontSize: 14,
    } });
    dispatch({ type: "SET_TOOL", t: "select" });
    toast.success("Date placed — drag to position");
  };
  const selectedAnno = state.selectedAnnoId && state.doc
    ? state.doc.annotations.find((a) => a.id === state.selectedAnnoId) ?? null
    : null;
  const effOpacity = (selectedAnno && "opacity" in selectedAnno ? (selectedAnno as { opacity: number }).opacity : state.opacity);
  const effFont = selectedAnno && "fontSize" in selectedAnno ? (selectedAnno as { fontSize: number }).fontSize : state.fontSize;
  const effStroke = selectedAnno && "stroke" in selectedAnno ? (selectedAnno as { stroke: number }).stroke : state.stroke;
  const supportsStroke = selectedAnno ? ["rect", "ellipse", "freehand", "underline", "strikethrough", "line", "arrow"].includes(selectedAnno.kind) : (["rect", "ellipse", "freehand", "underline", "strikethrough", "line", "arrow"].includes(state.tool));
  const supportsFont = selectedAnno ? ["text", "note", "text-edit"].includes(selectedAnno.kind) : (state.tool === "text" || state.tool === "edit-text" || state.tool === "note");
  const tools: { id: Tool; icon: React.FC<{ className?: string }>; label: string }[] = [
    { id: "select", icon: MousePointer2, label: "Select" },
    { id: "text", icon: Type, label: "Text" },
    { id: "highlight", icon: Highlighter, label: "Highlight" },
    { id: "underline", icon: UnderlineIcon, label: "Underline" },
    { id: "strikethrough", icon: Strikethrough, label: "Strikethrough" },
    { id: "rect", icon: Square, label: "Rectangle" },
    { id: "ellipse", icon: Circle, label: "Ellipse" },
    { id: "line", icon: Minus, label: "Line" },
    { id: "arrow", icon: ArrowRight, label: "Arrow" },
    { id: "freehand", icon: Pen, label: "Draw" },
    { id: "note", icon: StickyNote, label: "Note" },
    { id: "image", icon: ImageIcon, label: "Image" },
    { id: "edit-text", icon: PencilLine, label: "Edit text" },
    { id: "redact", icon: EyeOff, label: "Redact (D)" },
  ];

  const onPickImage = async (file: File) => {
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });
    dispatch({ type: "SET_PENDING_IMAGE", img: { dataUrl, mime, ...dims } });
    dispatch({ type: "SET_TOOL", t: "image" });
    toast.message("Click on the page to place the image");
  };

  return (
    <div className="border-b border-border bg-card/70 backdrop-blur px-3 py-2 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => dispatch({ type: "SET_TOOL", t: t.id })}
            title={t.label}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-md transition-colors",
              state.tool === t.id ? "bg-vault text-vault-foreground" : "hover:bg-accent text-muted-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
          </button>
        ))}
        {state.tool === "image" && (
          <label className="ml-1 inline-flex items-center gap-1 text-xs cursor-pointer rounded-md border border-border px-2 py-1.5 hover:bg-accent">
            Choose…
            <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => e.target.files?.[0] && onPickImage(e.target.files[0])} />
          </label>
        )}
        <button
          onClick={() => setSignOpen(true)}
          title="Sign"
          className="grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-accent text-muted-foreground"
        >
          <FileSignature className="h-4 w-4" />
        </button>
        <button
          onClick={() => setStampOpen(true)}
          title="Stamp"
          className="grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-accent text-muted-foreground"
        >
          <BadgeCheck className="h-4 w-4" />
        </button>
        <button
          onClick={addDateStamp}
          title="Insert today's date"
          className="grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-accent text-muted-foreground"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <div className="mx-1 h-6 w-px bg-border" />
        <button
          onClick={() => setWatermarkOpen(true)}
          title={state.watermark ? `Watermark: "${state.watermark.text}"` : "Watermark"}
          className={cn("grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-accent",
            state.watermark ? "text-vault" : "text-muted-foreground")}
        >
          <Droplets className="h-4 w-4" />
        </button>
        <button
          onClick={() => setProtectOpen(true)}
          title={state.protect ? "Password protection ON" : "Password protect"}
          className={cn("grid h-9 w-9 place-items-center rounded-md transition-colors hover:bg-accent",
            state.protect ? "text-vault" : "text-muted-foreground")}
        >
          <Lock className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-1 h-6 w-px bg-border" />

      <div className="flex items-center gap-1">
        {COLORS.map((c, i) => (
          <button
            key={i}
            onClick={() => dispatch({ type: "SET_COLOR", c })}
            className={cn("h-6 w-6 rounded-full border", state.color === c ? "ring-2 ring-vault" : "border-border")}
            style={{ background: rgbCss(c) }}
            title="Color"
          />
        ))}
      </div>

      <div className="mx-1 h-6 w-px bg-border" />

      {(state.tool === "rect" || state.tool === "ellipse") && (
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Fill</span>
          <Switch checked={state.fillShape} onCheckedChange={(v) => dispatch({ type: "SET_FILL", v })} />
        </label>
      )}
      {supportsStroke && (
        <div className="flex items-center gap-2 w-32">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Stroke</span>
          <Slider value={[effStroke]} min={1} max={12} step={1} onValueChange={([v]) => {
            dispatch({ type: "SET_STROKE", v });
            if (selectedAnno) dispatch({ type: "UPDATE_ANNO", id: selectedAnno.id, patch: { stroke: v } as Partial<Anno> });
          }} />
        </div>
      )}
      {supportsFont && (
        <div className="flex items-center gap-2 w-32">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Size</span>
          <Slider value={[effFont]} min={6} max={64} step={1} onValueChange={([v]) => {
            dispatch({ type: "SET_FONT", v });
            if (selectedAnno) dispatch({ type: "UPDATE_ANNO", id: selectedAnno.id, patch: { fontSize: v } as Partial<Anno> });
          }} />
        </div>
      )}
      <div className="flex items-center gap-2 w-32">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Opacity</span>
        <Slider value={[effOpacity * 100]} min={10} max={100} step={5} onValueChange={([v]) => {
          const o = v / 100;
          dispatch({ type: "SET_OPACITY", v: o });
          if (selectedAnno) dispatch({ type: "UPDATE_ANNO", id: selectedAnno.id, patch: { opacity: o } as Partial<Anno> });
        }} />
      </div>

      <div className="mx-1 h-6 w-px bg-border" />
      <Button variant="ghost" size="sm" disabled={!state.past.length} onClick={() => dispatch({ type: "UNDO" })} title="Undo">
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" disabled={!state.future.length} onClick={() => dispatch({ type: "REDO" })} title="Redo">
        <Redo2 className="h-4 w-4" />
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant={commentsOpen ? "default" : "outline"}
          onClick={onToggleComments}
          title="Toggle comments panel"
        >
          <MessageSquare className="h-4 w-4 mr-1.5" />
          Comments
          {state.doc && state.doc.annotations.length > 0 && (
            <span className="ml-1.5 text-[10px] opacity-70">{state.doc.annotations.length}</span>
          )}
        </Button>
        <Button size="sm" onClick={onExport} className="bg-vault text-vault-foreground hover:opacity-90">
          <Download className="h-4 w-4 mr-1.5" />
          Export PDF
        </Button>
      </div>


      <SignatureDialog open={signOpen} onOpenChange={setSignOpen} onSave={setPendingImageFromCanvas} />
      <StampDialog open={stampOpen} onOpenChange={setStampOpen} onSave={setPendingImageFromCanvas} />
      <WatermarkDialog
        open={watermarkOpen}
        onOpenChange={setWatermarkOpen}
        value={state.watermark}
        onSave={(w) => dispatch({ type: "SET_WATERMARK", w })}
      />
      <ProtectDialog
        open={protectOpen}
        onOpenChange={setProtectOpen}
        value={state.protect}
        onSave={(p) => dispatch({ type: "SET_PROTECT", p })}
      />
    </div>
  );
}

// ---------- pages sidebar ----------

function PagesSidebar({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  if (!state.doc) return null;

  return (
    <aside className="w-44 shrink-0 border-r border-border bg-card/40 overflow-y-auto p-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground px-2 py-2">Pages</div>
      <div className="space-y-2">
        {state.doc.pages.map((p, i) => (
          <div
            key={i}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom !== null && dragFrom !== i) dispatch({ type: "REORDER_PAGE", from: dragFrom, to: i });
              setDragFrom(null);
            }}
            className={cn(
              "group relative rounded-md border bg-background overflow-hidden cursor-pointer",
              i === state.current ? "border-vault ring-1 ring-vault/40" : "border-border hover:border-foreground/30",
            )}
            onClick={() => dispatch({ type: "SET_PAGE", n: i })}
          >
            <Thumbnail op={p} srcBytes={state.doc!.srcBytes} />
            <div className="px-2 py-1 text-[10px] flex items-center justify-between">
              <span className="text-muted-foreground">{i + 1}</span>
              <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                <button title="Rotate" className="p-1 hover:text-foreground" onClick={(e) => { e.stopPropagation(); dispatch({ type: "ROTATE_PAGE", n: i }); }}>
                  <RotateCw className="h-3 w-3" />
                </button>
                <button title="Insert blank after" className="p-1 hover:text-foreground" onClick={(e) => { e.stopPropagation(); dispatch({ type: "INSERT_BLANK", after: i, width: p.width, height: p.height }); }}>
                  <Plus className="h-3 w-3" />
                </button>
                <button title="Delete" className="p-1 hover:text-destructive" onClick={(e) => { e.stopPropagation(); dispatch({ type: "DELETE_PAGE", n: i }); }}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Thumbnail({ op, srcBytes }: { op: PageOp; srcBytes: Uint8Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (op.blank) {
        const c = ref.current; if (!c) return;
        c.width = 120; c.height = 160;
        const ctx = c.getContext("2d"); if (!ctx) return;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = "#ddd"; ctx.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
        return;
      }
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: srcBytes.slice() }).promise;
      if (cancelled) return;
      const page = await doc.getPage(op.srcPage + 1);
      const baseVp = page.getViewport({ scale: 1, rotation: op.rotation });
      const scale = 140 / baseVp.width;
      const vp = page.getViewport({ scale, rotation: op.rotation });
      const c = ref.current; if (!c) return;
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d"); if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as Parameters<typeof page.render>[0]).promise;
    })();
    return () => { cancelled = true; };
  }, [op, srcBytes]);
  return <canvas ref={ref} className="block w-full h-auto bg-white" />;
}

// ---------- page canvas + annotation layer ----------

type TextItem = { x: number; y: number; w: number; h: number; str: string; family: "sans" | "serif" | "mono"; bold: boolean; italic: boolean; transform?: number[]; fontName?: string };

function PageCanvas({
  op, srcBytes, annos, state, dispatch,
}: {
  op: PageOp; srcBytes: Uint8Array; annos: Anno[]; state: State; dispatch: React.Dispatch<Action>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [displayScale, setDisplayScale] = useState(1.3);
  const [drawing, setDrawing] = useState<null | { x0: number; y0: number; x: number; y: number; points?: { x: number; y: number }[] }>(null);
  // id of the annotation currently in inline-edit mode (text / note)
  const [editingId, setEditingId] = useState<string | null>(null);
  // modal target for the dedicated "Edit text" dialog
  const [textEditTarget, setTextEditTarget] = useState<
    | { kind: "new"; item: TextItem }
    | { kind: "existing"; annoId: string }
    | null
  >(null);

  // Render the page
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current; if (!canvas) return;
      if (op.blank) {
        const w = op.width * displayScale, h = op.height * displayScale;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        setTextItems([]);
        return;
      }
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: srcBytes.slice() }).promise;
      if (cancelled) return;
      const page = await doc.getPage(op.srcPage + 1);
      const vp = page.getViewport({ scale: displayScale, rotation: op.rotation });
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise;

      // Extract text item positions (for "edit text" mode). Use base viewport
      // (scale 1, no rotation) so the coords match PDF points top-left.
      const baseVp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const styles = (content as unknown as { styles: Record<string, { fontFamily?: string }> }).styles ?? {};
      type Raw = { str: string; transform: number[]; width: number; height: number; fontName?: string };
      const items: TextItem[] = (content.items as Raw[]).flatMap((it) => {
        if (!it.str || !it.str.trim()) return [];
        const m = pdfjs.Util.transform(baseVp.transform, it.transform);
        const fh = Math.hypot(m[2], m[3]);
        const ff = (it.fontName && styles[it.fontName]?.fontFamily) || it.fontName || "";
        const ffl = ff.toLowerCase();
        const family: "sans" | "serif" | "mono" =
          /mono|courier|consol|typewriter/.test(ffl) ? "mono" :
          /serif|times|roman|garamond|georgia|cambria|book/.test(ffl) ? "serif" :
          "sans";
        const bold = /bold|black|heavy|semibold|demibold/.test(ffl);
        const italic = /italic|oblique/.test(ffl);
        return [{ x: m[4], y: m[5] - fh, w: it.width, h: fh, str: it.str, family, bold, italic, transform: it.transform, fontName: it.fontName }];
      });
      setTextItems(items);
    })();
    return () => { cancelled = true; };
  }, [op, srcBytes, displayScale]);

  // Annotation coords → screen (account for rotation by rendering at vp scale; overlay sized to canvas px)
  const pageW = op.width, pageH = op.height;
  const screenW = canvasRef.current?.width ?? Math.ceil(pageW * displayScale);
  const screenH = canvasRef.current?.height ?? Math.ceil(pageH * displayScale);

  // For rotation we keep annotations in unrotated PDF coords. We display them
  // in the canvas (which IS rotated). The simplest correct approach: don't
  // transform — operate on unrotated coords. So we apply the inverse rotation
  // when converting screen → PDF, and the forward rotation PDF → screen.
  const rot = op.rotation;
  const toScreen = useCallback(
    (x: number, y: number) => {
      // Rotate around page center then translate
      const s = displayScale;
      const cx = pageW / 2, cy = pageH / 2;
      let nx = x - cx, ny = y - cy;
      const r = (rot * Math.PI) / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      const rx = nx * cos - ny * sin;
      const ry = nx * sin + ny * cos;
      // After rotation, page swaps dims when 90/270
      const newW = rot % 180 === 0 ? pageW : pageH;
      const newH = rot % 180 === 0 ? pageH : pageW;
      return { x: (rx + newW / 2) * s, y: (ry + newH / 2) * s };
    },
    [rot, pageW, pageH, displayScale],
  );
  const toPdf = useCallback(
    (sx: number, sy: number) => {
      const s = displayScale;
      const newW = rot % 180 === 0 ? pageW : pageH;
      const newH = rot % 180 === 0 ? pageH : pageW;
      const rx = sx / s - newW / 2;
      const ry = sy / s - newH / 2;
      const r = (-rot * Math.PI) / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      const nx = rx * cos - ry * sin;
      const ny = rx * sin + ry * cos;
      return { x: nx + pageW / 2, y: ny + pageH / 2 };
    },
    [rot, pageW, pageH, displayScale],
  );

  // mouse handlers (operate in screen space, convert to PDF)
  const overlayRef = useRef<HTMLDivElement>(null);
  const getXY = (e: React.MouseEvent | React.PointerEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (state.tool === "select" || state.tool === "edit-text") return;
    e.preventDefault();
    overlayRef.current?.setPointerCapture(e.pointerId);
    const { x, y } = getXY(e);

    // Image: drop at click
    if (state.tool === "image" && state.pendingImage) {
      const { x: px, y: py } = toPdf(x, y);
      const targetW = Math.min(180, state.pendingImage.w * 0.5);
      const ratio = state.pendingImage.h / state.pendingImage.w;
      dispatch({ type: "ADD_ANNO", a: {
        id: uid(), kind: "image", page: state.current, x: px, y: py,
        w: targetW, h: targetW * ratio, color: { r: 0, g: 0, b: 0 }, opacity: state.opacity,
        dataUrl: state.pendingImage.dataUrl, mime: state.pendingImage.mime,
      } });
      dispatch({ type: "SET_PENDING_IMAGE", img: null });
      dispatch({ type: "SET_TOOL", t: "select" });
      return;
    }

    if (state.tool === "text") {
      const { x: px, y: py } = toPdf(x, y);
      const w = Math.max(120, state.fontSize * 8);
      const id = uid();
      dispatch({ type: "ADD_ANNO", a: {
        id, kind: "text", page: state.current,
        x: px, y: py, w, h: state.fontSize * 1.4,
        color: state.color, opacity: state.opacity, text: "", fontSize: state.fontSize,
      } });
      setEditingId(id);
      dispatch({ type: "SET_TOOL", t: "select" });
      dispatch({ type: "SELECT_ANNO", id });
      return;
    }

    if (state.tool === "note") {
      const { x: px, y: py } = toPdf(x, y);
      const id = uid();
      dispatch({ type: "ADD_ANNO", a: {
        id, kind: "note", page: state.current,
        x: px, y: py, w: 140, h: 70,
        color: state.color, opacity: state.opacity, text: "",
      } });
      setEditingId(id);
      dispatch({ type: "SET_TOOL", t: "select" });
      dispatch({ type: "SELECT_ANNO", id });
      return;
    }

    if (state.tool === "freehand") {
      setDrawing({ x0: x, y0: y, x, y, points: [{ x, y }] });
      return;
    }
    setDrawing({ x0: x, y0: y, x, y });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing) return;
    const { x, y } = getXY(e);
    if (state.tool === "freehand") {
      setDrawing((d) => d && { ...d, x, y, points: [...(d.points ?? []), { x, y }] });
    } else {
      setDrawing((d) => d && { ...d, x, y });
    }
  };
  const onPointerUp = () => {
    if (!drawing) return;
    const { x0, y0, x, y, points } = drawing;
    setDrawing(null);
    if (state.tool === "freehand" && points && points.length > 1) {
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
      const tl = toPdf(minX, minY);
      const br = toPdf(maxX, maxY);
      const ax = Math.min(tl.x, br.x), ay = Math.min(tl.y, br.y);
      const aw = Math.abs(br.x - tl.x), ah = Math.abs(br.y - tl.y);
      // Convert each point to PDF coords relative to (ax, ay)
      const pdfPoints = points.map((p) => {
        const q = toPdf(p.x, p.y);
        return { x: q.x - ax, y: q.y - ay };
      });
      dispatch({ type: "ADD_ANNO", a: {
        id: uid(), kind: "freehand", page: state.current,
        x: ax, y: ay, w: aw || 1, h: ah || 1,
        color: state.color, opacity: state.opacity, stroke: state.stroke, points: pdfPoints,
      } });
      return;
    }
    const a = toPdf(Math.min(x0, x), Math.min(y0, y));
    const b = toPdf(Math.max(x0, x), Math.max(y0, y));
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w < 3 || h < 3) return;
    if (state.tool === "highlight") {
      const quads = computeQuads({ x: a.x, y: a.y, w, h }, textItems);
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "highlight", page: state.current, x: a.x, y: a.y, w, h, color: state.color, opacity: Math.min(state.opacity, 0.5), quads: quads.length ? quads : undefined } });
    } else if (state.tool === "underline") {
      const quads = computeQuads({ x: a.x, y: a.y, w, h }, textItems);
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "underline", page: state.current, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, quads: quads.length ? quads : undefined } });
    } else if (state.tool === "strikethrough") {
      const quads = computeQuads({ x: a.x, y: a.y, w, h }, textItems);
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "strikethrough", page: state.current, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, quads: quads.length ? quads : undefined } });
    } else if (state.tool === "rect") {
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "rect", page: state.current, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, fill: state.fillShape } });
    } else if (state.tool === "ellipse") {
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "ellipse", page: state.current, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, fill: state.fillShape } });
    } else if (state.tool === "line" || state.tool === "arrow") {
      // Preserve drag direction so the arrowhead points where the user dragged
      const start = toPdf(x0, y0);
      const end = toPdf(x, y);
      const flipX = start.x > end.x;
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: state.tool, page: state.current, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, flipX } });
    } else if (state.tool === "redact") {
      // Capture overlapping text item strings so the export rewriter can
      // erase them from the underlying content stream.
      const sources: TextSource[] = [];
      for (const it of textItems) {
        const ix2 = it.x + it.w, iy2 = it.y + it.h;
        const ox = Math.max(0, Math.min(a.x + w, ix2) - Math.max(a.x, it.x));
        const oy = Math.max(0, Math.min(a.y + h, iy2) - Math.max(a.y, it.y));
        if (ox > 1 && oy > it.h * 0.35) {
          sources.push({ originalString: it.str, transform: it.transform, fontName: it.fontName });
        }
      }
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "redact", page: state.current, x: a.x, y: a.y, w, h, color: { r: 0, g: 0, b: 0 }, opacity: 1, sources: sources.length ? sources : undefined } });
    }
  };

  // edit-text overlays
  const editTextHits = useMemo(() => {
    if (state.tool !== "edit-text") return [];
    return textItems;
  }, [state.tool, textItems]);

  const editExistingText = (it: TextItem) => {
    // Open the modal editor pre-filled with the original text & detected font.
    setTextEditTarget({ kind: "new", item: it });
  };

  // Commit a new or updated text-edit annotation from the modal.
  const commitTextEdit = (
    payload: { text: string; family: "sans" | "serif" | "mono"; bold: boolean; italic: boolean; fontSize: number; color: RGB; bg: RGB },
  ) => {
    if (!textEditTarget) return;
    if (textEditTarget.kind === "new") {
      const it = textEditTarget.item;
      const padX = Math.max(2, it.h * 0.15);
      const padTop = Math.max(2, it.h * 0.35);
      const padBottom = Math.max(2, it.h * 0.45);
      const id = uid();
      dispatch({ type: "ADD_ANNO", a: {
        id, kind: "text-edit", page: state.current,
        x: it.x - padX,
        y: it.y - padTop,
        w: it.w + padX * 2,
        h: it.h + padTop + padBottom,
        color: payload.color,
        opacity: 1,
        text: payload.text,
        fontSize: payload.fontSize,
        bg: payload.bg,
        family: payload.family,
        bold: payload.bold,
        italic: payload.italic,
        textOffsetY: padTop,
        source: { originalString: it.str, transform: it.transform, fontName: it.fontName },
      } });
      dispatch({ type: "SELECT_ANNO", id });
    } else {
      dispatch({ type: "UPDATE_ANNO", id: textEditTarget.annoId, patch: {
        text: payload.text,
        family: payload.family,
        bold: payload.bold,
        italic: payload.italic,
        fontSize: payload.fontSize,
        color: payload.color,
        bg: payload.bg,
      } as Partial<Anno> });
    }
    setTextEditTarget(null);
  };

  // Render annotation overlays (in unrotated PDF coords → rotate to screen)
  const renderAnno = (a: Anno) => {
    const selected = state.selectedAnnoId === a.id;
    // Compute bbox in screen by transforming all 4 corners then taking min/max
    const pts = [
      toScreen(a.x, a.y),
      toScreen(a.x + a.w, a.y),
      toScreen(a.x, a.y + a.h),
      toScreen(a.x + a.w, a.y + a.h),
    ];
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    const w = maxX - minX, h = maxY - minY;

    const onMouseDownAnno = (e: React.MouseEvent) => {
      if (!(state.tool === "select" || selected)) return;
      if (isEditingThis) return; // don't drag while typing
      e.stopPropagation();
      dispatch({ type: "SELECT_ANNO", id: a.id });
      const startX = e.clientX, startY = e.clientY;
      const origX = a.x, origY = a.y;
      let moved = false;
      const move = (ev: MouseEvent) => {
        const dxScreen = ev.clientX - startX;
        const dyScreen = ev.clientY - startY;
        if (!moved && Math.hypot(dxScreen, dyScreen) < 3) return;
        moved = true;
        const r = (-rot * Math.PI) / 180;
        const cos = Math.cos(r), sin = Math.sin(r);
        const dxP = (dxScreen * cos - dyScreen * sin) / displayScale;
        const dyP = (dxScreen * sin + dyScreen * cos) / displayScale;
        dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { x: origX + dxP, y: origY + dyP } as Partial<Anno> });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        // click without drag → text-edit opens dialog, text/note opens inline editor
        if (!moved && selected) {
          if (a.kind === "text-edit") setTextEditTarget({ kind: "existing", annoId: a.id });
          else if (a.kind === "text" || a.kind === "note") setEditingId(a.id);
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    const onResize = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const origW = a.w, origH = a.h;
      const move = (ev: MouseEvent) => {
        const dxScreen = ev.clientX - startX;
        const dyScreen = ev.clientY - startY;
        const r = (-rot * Math.PI) / 180;
        const cos = Math.cos(r), sin = Math.sin(r);
        const dwP = (dxScreen * cos - dyScreen * sin) / displayScale;
        const dhP = (dxScreen * sin + dyScreen * cos) / displayScale;
        dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { w: Math.max(8, origW + dwP), h: Math.max(8, origH + dhP) } as Partial<Anno> });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };

    const isEditingThis = editingId === a.id;
    const interactive = state.tool === "select" || isEditingThis || selected;
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      left: minX, top: minY, width: w, height: h,
      transform: `rotate(${rot}deg)`,
      transformOrigin: "center center",
      pointerEvents: interactive ? "auto" : "none",
      cursor: isEditingThis ? "text" : (interactive ? "move" : "default"),
    };

    let inner: React.ReactNode = null;
    switch (a.kind) {
      case "highlight": {
        if (a.quads?.length) {
          inner = (
            <div style={{ position: "absolute", inset: 0 }}>
              {a.quads.map((q, qi) => (
                <div key={qi} style={{ position: "absolute",
                  left: (q.x - a.x) * displayScale, top: (q.y - a.y) * displayScale,
                  width: q.w * displayScale, height: q.h * displayScale,
                  background: rgbCss(a.color, a.opacity), mixBlendMode: "multiply" }} />
              ))}
            </div>
          );
        } else {
          inner = <div style={{ width: "100%", height: "100%", background: rgbCss(a.color, a.opacity), mixBlendMode: "multiply" }} />;
        }
        break;
      }
      case "underline": {
        const sw = Math.max(1, a.stroke * displayScale);
        if (a.quads?.length) {
          inner = (
            <div style={{ position: "absolute", inset: 0 }}>
              {a.quads.map((q, qi) => (
                <div key={qi} style={{ position: "absolute",
                  left: (q.x - a.x) * displayScale,
                  top: (q.y - a.y + q.h) * displayScale - sw,
                  width: q.w * displayScale, height: sw,
                  background: rgbCss(a.color, a.opacity) }} />
              ))}
            </div>
          );
        } else {
          inner = <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: sw, background: rgbCss(a.color, a.opacity) }} />;
        }
        break;
      }
      case "strikethrough": {
        const sw = Math.max(1, a.stroke * displayScale);
        if (a.quads?.length) {
          inner = (
            <div style={{ position: "absolute", inset: 0 }}>
              {a.quads.map((q, qi) => (
                <div key={qi} style={{ position: "absolute",
                  left: (q.x - a.x) * displayScale,
                  top: (q.y - a.y + q.h / 2) * displayScale - sw / 2,
                  width: q.w * displayScale, height: sw,
                  background: rgbCss(a.color, a.opacity) }} />
              ))}
            </div>
          );
        } else {
          inner = <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: sw, background: rgbCss(a.color, a.opacity), transform: "translateY(-50%)" }} />;
        }
        break;
      }
      case "redact":
        inner = <div style={{ width: "100%", height: "100%", background: "#000" }} />;
        break;
      case "line":
      case "arrow": {
        const sw = a.w, sh = a.h;
        const x1 = a.flipX ? sw : 0;
        const y1 = 0;
        const x2 = a.flipX ? 0 : sw;
        const y2 = sh;
        const stroke = rgbCss(a.color, a.opacity);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 10 + a.stroke * 1.5;
        const sp = Math.PI / 7;
        const hx1 = x2 - headLen * Math.cos(ang - sp);
        const hy1 = y2 - headLen * Math.sin(ang - sp);
        const hx2 = x2 - headLen * Math.cos(ang + sp);
        const hy2 = y2 - headLen * Math.sin(ang + sp);
        inner = (
          <svg width="100%" height="100%" viewBox={`0 0 ${sw} ${sh}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={a.stroke} strokeLinecap="round" />
            {a.kind === "arrow" && (
              <>
                <line x1={x2} y1={y2} x2={hx1} y2={hy1} stroke={stroke} strokeWidth={a.stroke} strokeLinecap="round" />
                <line x1={x2} y1={y2} x2={hx2} y2={hy2} stroke={stroke} strokeWidth={a.stroke} strokeLinecap="round" />
              </>
            )}
          </svg>
        );
        break;
      }
      case "rect":
        inner = <div style={{ width: "100%", height: "100%", border: `${a.stroke * displayScale}px solid ${rgbCss(a.color, a.opacity)}`, background: a.fill ? rgbCss(a.color, a.opacity) : "transparent" }} />;
        break;
      case "ellipse":
        inner = <div style={{ width: "100%", height: "100%", borderRadius: "50%", border: `${a.stroke * displayScale}px solid ${rgbCss(a.color, a.opacity)}`, background: a.fill ? rgbCss(a.color, a.opacity) : "transparent" }} />;
        break;
      case "text":
      case "text-edit": {
        const isEditing = editingId === a.id;
        const bg = a.kind === "text-edit" ? rgbCss(a.bg) : "transparent";
        const fam = a.kind === "text-edit"
          ? (a.family === "serif" ? `'Times New Roman', Times, serif`
            : a.family === "mono" ? `'Courier New', Courier, monospace`
            : `Helvetica, Arial, sans-serif`)
          : `Helvetica, Arial, sans-serif`;
        const padTop = a.kind === "text-edit" && a.textOffsetY ? a.textOffsetY * displayScale : 0;
        const textStyle: React.CSSProperties = {
          width: "100%", height: "100%",
          background: bg,
          color: rgbCss(a.color, a.opacity),
          fontSize: a.fontSize * displayScale,
          fontFamily: fam,
          fontWeight: a.kind === "text-edit" && a.bold ? 700 : 400,
          fontStyle: a.kind === "text-edit" && a.italic ? "italic" : "normal",
          lineHeight: 1.15,
          whiteSpace: "pre-wrap",
          overflow: "hidden",
          padding: 0,
          paddingTop: padTop,
          boxSizing: "border-box",
          margin: 0,
          border: "none",
          outline: "none",
          resize: "none",
          caretColor: rgbCss(a.color),
        };
        inner = isEditing && a.kind === "text" ? (
          <textarea
            autoFocus
            value={a.text}
            onChange={(e) => dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { text: e.target.value } as Partial<Anno> })}
            onBlur={() => {
              if (!a.text.trim()) dispatch({ type: "DELETE_ANNO", id: a.id });
              setEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={textStyle}
          />
        ) : (
          <div style={textStyle}>{a.text || (a.kind === "text" ? "Type here…" : "")}</div>
        );
        break;
      }
      case "note": {
        const isEditing = editingId === a.id;
        const noteStyle: React.CSSProperties = {
          width: "100%", height: "100%",
          background: "rgba(255,229,77,0.95)",
          border: "1px solid #b89800",
          color: "#000",
          fontSize: 9 * displayScale,
          padding: 4 * displayScale,
          overflow: "hidden",
          fontFamily: "Helvetica, Arial, sans-serif",
          lineHeight: 1.2,
          margin: 0,
          outline: "none",
          resize: "none",
        };
        inner = isEditing ? (
          <textarea
            autoFocus
            value={a.text}
            onChange={(e) => dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { text: e.target.value } as Partial<Anno> })}
            onBlur={() => {
              if (!a.text.trim()) dispatch({ type: "DELETE_ANNO", id: a.id });
              setEditingId(null);
            }}
            onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={noteStyle}
          />
        ) : (
          <div style={noteStyle}>{a.text || "Note…"}</div>
        );
        break;
      }
      case "image":
        inner = <img src={a.dataUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", opacity: a.opacity }} />;
        break;
      case "freehand": {
        const sw = a.w, sh = a.h;
        const d = a.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        inner = (
          <svg width="100%" height="100%" viewBox={`0 0 ${sw} ${sh}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
            <path d={d} stroke={rgbCss(a.color, a.opacity)} strokeWidth={a.stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
        break;
      }
    }

    return (
      <div
        key={a.id}
        style={baseStyle}
        onMouseDown={onMouseDownAnno}
        onDoubleClick={(e) => {
          if (a.kind === "text-edit") {
            e.stopPropagation();
            setTextEditTarget({ kind: "existing", annoId: a.id });
          } else if (a.kind === "text" || a.kind === "note") {
            e.stopPropagation();
            setEditingId(a.id);
          }
        }}
      >
        {inner}
        {selected && (
          <>
            <div style={{ position: "absolute", inset: -2, border: "1.5px dashed var(--vault)", pointerEvents: "none" }} />
            <div onMouseDown={onResize} style={{ position: "absolute", right: -6, bottom: -6, width: 12, height: 12, background: "var(--vault)", border: "2px solid white", borderRadius: 2, cursor: "nwse-resize" }} />
            <button onClick={(e) => { e.stopPropagation(); dispatch({ type: "DELETE_ANNO", id: a.id }); }} style={{ position: "absolute", top: -10, right: -10, background: "#dc2626", color: "white", borderRadius: 999, width: 18, height: 18, fontSize: 10, lineHeight: 1, display: "grid", placeItems: "center" }}>×</button>
          </>
        )}
      </div>
    );
  };

  const cursorByTool: Record<Tool, string> = {
    select: "default", text: "text", highlight: "crosshair",
    underline: "crosshair", strikethrough: "crosshair",
    rect: "crosshair", ellipse: "crosshair",
    line: "crosshair", arrow: "crosshair",
    freehand: "crosshair", note: "copy", image: "copy", "edit-text": "pointer", redact: "crosshair",
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const zoomIn = () => setDisplayScale((s) => Math.min(4, +(s * 1.25).toFixed(3)));
  const zoomOut = () => setDisplayScale((s) => Math.max(0.25, +(s / 1.25).toFixed(3)));
  const zoomReset = () => setDisplayScale(1);
  const zoomFit = () => {
    const el = wrapRef.current; if (!el) return;
    const avail = el.clientWidth - 24;
    const pw = rot % 180 === 0 ? pageW : pageH;
    if (avail > 0 && pw > 0) setDisplayScale(Math.max(0.25, Math.min(4, avail / pw)));
  };
  // ctrl/cmd + wheel zoom on the canvas wrapper
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      setDisplayScale((s) => {
        const next = dir > 0 ? s * 1.1 : s / 1.1;
        return Math.max(0.25, Math.min(4, +next.toFixed(3)));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={wrapRef} className="space-y-2">
      <div className="flex items-center gap-1 text-xs">
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={zoomOut} title="Zoom out (Ctrl -)">−</Button>
        <button onClick={zoomReset} className="h-7 min-w-[58px] px-2 rounded-md border border-border text-center tabular-nums hover:bg-accent" title="Reset to 100%">{Math.round(displayScale * 100)}%</button>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={zoomIn} title="Zoom in (Ctrl +)">+</Button>
        <Button size="sm" variant="outline" className="h-7 px-2 ml-1" onClick={zoomFit} title="Fit to width">Fit</Button>
        <span className="text-muted-foreground ml-2 hidden md:inline">Hold ⌘/Ctrl + scroll to zoom</span>
      </div>
      <div className="relative inline-block shadow-lg" style={{ background: "white" }}>
        <canvas ref={canvasRef} className="block" />
        <div
          ref={overlayRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => {
            if (state.tool === "select" && e.target === e.currentTarget) dispatch({ type: "SELECT_ANNO", id: null });
          }}
          style={{ position: "absolute", inset: 0, width: screenW, height: screenH, cursor: cursorByTool[state.tool] }}
        >
          {annos.map(renderAnno)}
          {editTextHits.map((it, i) => {
            const tl = toScreen(it.x, it.y);
            const tr = toScreen(it.x + it.w, it.y);
            const bl = toScreen(it.x, it.y + it.h);
            const br = toScreen(it.x + it.w, it.y + it.h);
            const minX = Math.min(tl.x, tr.x, bl.x, br.x);
            const minY = Math.min(tl.y, tr.y, bl.y, br.y);
            const maxX = Math.max(tl.x, tr.x, bl.x, br.x);
            const maxY = Math.max(tl.y, tr.y, bl.y, br.y);
            return (
              <div
                key={i}
                onClick={(e) => { e.stopPropagation(); editExistingText(it); }}
                title={it.str}
                style={{
                  position: "absolute", left: minX, top: minY, width: maxX - minX, height: maxY - minY,
                  background: "rgba(0, 128, 255, 0.08)", border: "1px dashed rgba(0,128,255,0.5)",
                  cursor: "text", pointerEvents: "auto",
                }}
              />
            );
          })}
          {drawing && state.tool !== "select" && (
            <DrawingPreview drawing={drawing} state={state} />
          )}
        </div>
      </div>
      <TextEditDialog
        target={textEditTarget}
        annos={annos}
        onClose={() => setTextEditTarget(null)}
        onCommit={commitTextEdit}
      />
    </div>
  );
}

type DrawingState = { x0: number; y0: number; x: number; y: number; points?: { x: number; y: number }[] };
function DrawingPreview({ drawing, state }: { drawing: DrawingState; state: State }) {
  if (state.tool === "freehand" && drawing.points) {
    const d = drawing.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    return (
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
        <path d={d} stroke={rgbCss(state.color, state.opacity)} strokeWidth={state.stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  const x = Math.min(drawing.x0, drawing.x), y = Math.min(drawing.y0, drawing.y);
  const w = Math.abs(drawing.x - drawing.x0), h = Math.abs(drawing.y - drawing.y0);
  const style: React.CSSProperties = { position: "absolute", left: x, top: y, width: w, height: h, pointerEvents: "none" };
  if (state.tool === "highlight") return <div style={{ ...style, background: rgbCss(state.color, Math.min(state.opacity, 0.5)), mixBlendMode: "multiply" }} />;
  if (state.tool === "underline") return <div style={{ ...style, borderBottom: `${state.stroke}px solid ${rgbCss(state.color, state.opacity)}` }} />;
  if (state.tool === "strikethrough") return <div style={{ ...style, borderTop: `${state.stroke}px solid ${rgbCss(state.color, state.opacity)}`, marginTop: h / 2 }} />;
  if (state.tool === "ellipse") return <div style={{ ...style, border: `${state.stroke}px solid ${rgbCss(state.color, state.opacity)}`, borderRadius: "50%", background: state.fillShape ? rgbCss(state.color, state.opacity) : "transparent" }} />;
  if (state.tool === "rect") return <div style={{ ...style, border: `${state.stroke}px solid ${rgbCss(state.color, state.opacity)}`, background: state.fillShape ? rgbCss(state.color, state.opacity) : "transparent" }} />;
  if (state.tool === "redact") return <div style={{ ...style, background: "#000" }} />;
  if (state.tool === "line" || state.tool === "arrow") {
    return (
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
        <line x1={drawing.x0} y1={drawing.y0} x2={drawing.x} y2={drawing.y} stroke={rgbCss(state.color, state.opacity)} strokeWidth={state.stroke} strokeLinecap="round" />
      </svg>
    );
  }
  return null;
}

// ---------- Signature dialog ----------

function SignatureDialog({
  open, onOpenChange, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (canvas: HTMLCanvasElement) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = useState(false);
  const [color, setColor] = useState("#111111");
  const [stroke, setStroke] = useState(2.5);

  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    setHasInk(false);
  }, [open]);

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    const rect = c.getBoundingClientRect();
    const sx = c.width / rect.width, sy = c.height / rect.height;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = color; ctx.lineWidth = stroke * sx;
    ctx.beginPath();
    ctx.moveTo((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy);
    c.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      ctx.lineTo((ev.clientX - rect.left) * sx, (ev.clientY - rect.top) * sy);
      ctx.stroke();
      setHasInk(true);
    };
    const up = () => {
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
  };

  const clear = () => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const save = () => {
    const c = canvasRef.current; if (!c) return;
    // Trim whitespace by scanning pixel alpha vs white-ish
    const ctx = c.getContext("2d"); if (!ctx) return;
    const { width, height } = c;
    const img = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // not near-white?
        if (img[i] < 240 || img[i + 1] < 240 || img[i + 2] < 240) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    let outCanvas = c;
    if (maxX >= 0) {
      const pad = 8;
      const sx = Math.max(0, minX - pad);
      const sy = Math.max(0, minY - pad);
      const sw = Math.min(width - sx, maxX - minX + pad * 2);
      const sh = Math.min(height - sy, maxY - minY + pad * 2);
      const trimmed = document.createElement("canvas");
      trimmed.width = sw; trimmed.height = sh;
      const tctx = trimmed.getContext("2d")!;
      tctx.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
      outCanvas = trimmed;
    }
    onSave(outCanvas);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Draw your signature</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 rounded border border-border bg-transparent" />
          </label>
          <label className="flex items-center gap-1.5">Stroke
            <input type="range" min={1} max={6} step={0.5} value={stroke} onChange={(e) => setStroke(Number(e.target.value))} />
            <span className="tabular-nums w-6">{stroke}</span>
          </label>
          <Button size="sm" variant="outline" onClick={clear} className="ml-auto">Clear</Button>
        </div>
        <div className="rounded-md border border-border overflow-hidden bg-white">
          <canvas
            ref={canvasRef}
            width={1200}
            height={400}
            onPointerDown={start}
            className="block w-full touch-none cursor-crosshair"
            style={{ aspectRatio: "3 / 1" }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!hasInk} onClick={save} className="bg-vault text-vault-foreground hover:opacity-90">Use signature</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Stamp dialog ----------

const STAMPS: { label: string; color: string }[] = [
  { label: "APPROVED", color: "#16a34a" },
  { label: "REJECTED", color: "#dc2626" },
  { label: "DRAFT", color: "#6b7280" },
  { label: "CONFIDENTIAL", color: "#dc2626" },
  { label: "REVIEWED", color: "#0ea5e9" },
  { label: "PAID", color: "#16a34a" },
  { label: "URGENT", color: "#dc2626" },
  { label: "FINAL", color: "#7c3aed" },
];

function StampDialog({
  open, onOpenChange, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (canvas: HTMLCanvasElement) => void;
}) {
  const [text, setText] = useState("APPROVED");
  const [color, setColor] = useState("#dc2626");

  const renderToCanvas = (label: string, hex: string): HTMLCanvasElement => {
    const dpr = 2;
    const padX = 28, padY = 16, border = 6;
    const ctx0 = document.createElement("canvas").getContext("2d")!;
    const fontSize = 48;
    ctx0.font = `900 ${fontSize}px Helvetica, Arial, sans-serif`;
    const m = ctx0.measureText(label);
    const tw = Math.ceil(m.width);
    const th = fontSize * 1.1;
    const w = tw + padX * 2 + border * 2;
    const h = Math.ceil(th + padY * 2 + border * 2);
    const c = document.createElement("canvas");
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    // transparent background
    ctx.clearRect(0, 0, w, h);
    // rounded rect border
    const r = 8;
    ctx.strokeStyle = hex; ctx.lineWidth = border;
    ctx.beginPath();
    ctx.moveTo(border + r, border);
    ctx.lineTo(w - border - r, border);
    ctx.quadraticCurveTo(w - border, border, w - border, border + r);
    ctx.lineTo(w - border, h - border - r);
    ctx.quadraticCurveTo(w - border, h - border, w - border - r, h - border);
    ctx.lineTo(border + r, h - border);
    ctx.quadraticCurveTo(border, h - border, border, h - border - r);
    ctx.lineTo(border, border + r);
    ctx.quadraticCurveTo(border, border, border + r, border);
    ctx.closePath();
    ctx.stroke();
    // text
    ctx.fillStyle = hex;
    ctx.font = `900 ${fontSize}px Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(label, w / 2, h / 2 + 2);
    return c;
  };

  const pick = (label: string, hex: string) => {
    setText(label); setColor(hex);
  };
  const save = () => {
    const label = (text || "STAMP").toUpperCase().trim();
    if (!label) return;
    onSave(renderToCanvas(label, color));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add a stamp</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2">
          {STAMPS.map((s) => (
            <button
              key={s.label}
              onClick={() => pick(s.label, s.color)}
              className={cn("rounded-md border-2 px-2 py-2 text-[11px] font-extrabold tracking-wider transition",
                text === s.label ? "ring-2 ring-vault" : "")}
              style={{ color: s.color, borderColor: s.color }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs pt-2">
          <label className="flex items-center gap-1.5 flex-1">Custom
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value.toUpperCase())}
              maxLength={24}
              className="flex-1 h-8 px-2 rounded border border-border bg-transparent uppercase tracking-wider"
            />
          </label>
          <label className="flex items-center gap-1.5">Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 rounded border border-border bg-transparent" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} className="bg-vault text-vault-foreground hover:opacity-90">Use stamp</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Watermark dialog ----------

const WM_POSITIONS: WatermarkSettings["position"][] = ["diagonal", "center", "top", "bottom"];

function WatermarkDialog({
  open, onOpenChange, value, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: WatermarkSettings | null;
  onSave: (w: WatermarkSettings | null) => void;
}) {
  const [text, setText] = useState(value?.text ?? "CONFIDENTIAL");
  const [size, setSize] = useState(value?.size ?? 72);
  const [opacity, setOpacity] = useState(Math.round((value?.opacity ?? 0.2) * 100));
  const [position, setPosition] = useState<WatermarkSettings["position"]>(value?.position ?? "diagonal");
  const [hex, setHex] = useState("#808080");
  useEffect(() => {
    if (!open) return;
    setText(value?.text ?? "CONFIDENTIAL");
    setSize(value?.size ?? 72);
    setOpacity(Math.round((value?.opacity ?? 0.2) * 100));
    setPosition(value?.position ?? "diagonal");
  }, [open, value]);

  const save = () => {
    if (!text.trim()) { onSave(null); onOpenChange(false); return; }
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    onSave({ text: text.trim(), size, opacity: opacity / 100, position, color: { r, g, b } });
    onOpenChange(false);
    toast.success("Watermark will be applied on export");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader><DialogTitle>Watermark every page</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Text</label>
            <input value={text} onChange={(e) => setText(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Position</div>
            <div className="grid grid-cols-4 gap-2">
              {WM_POSITIONS.map((p) => (
                <button key={p} onClick={() => setPosition(p)}
                  className={cn("rounded-md border px-2 py-1.5 text-xs capitalize",
                    position === p ? "border-vault bg-vault/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent")}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-xs">
              <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground"><span>Size</span><span className="font-mono">{size}pt</span></div>
              <input type="range" min={12} max={160} value={size} onChange={(e) => setSize(parseInt(e.target.value, 10))} className="mt-1 w-full accent-vault" />
            </label>
            <label className="text-xs">
              <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground"><span>Opacity</span><span className="font-mono">{opacity}%</span></div>
              <input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(parseInt(e.target.value, 10))} className="mt-1 w-full accent-vault" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs">Color
            <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} className="h-7 w-9 rounded border border-border bg-transparent" />
          </label>
        </div>
        <DialogFooter>
          {value && <Button variant="ghost" onClick={() => { onSave(null); onOpenChange(false); toast.message("Watermark removed"); }}>Remove</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} className="bg-vault text-vault-foreground hover:opacity-90">Apply on export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Protect dialog ----------

const PERM_ROWS: { key: keyof ProtectSettings["permissions"]; label: string }[] = [
  { key: "printing", label: "Allow printing" },
  { key: "copying", label: "Allow copying text" },
  { key: "modifying", label: "Allow editing" },
  { key: "annotating", label: "Allow annotating" },
  { key: "fillingForms", label: "Allow filling forms" },
  { key: "documentAssembly", label: "Allow page assembly" },
  { key: "contentAccessibility", label: "Allow screen readers" },
];

function ProtectDialog({
  open, onOpenChange, value, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: ProtectSettings | null;
  onSave: (p: ProtectSettings | null) => void;
}) {
  const [pw, setPw] = useState(value?.userPassword ?? "");
  const [pw2, setPw2] = useState(value?.userPassword ?? "");
  const [useOwner, setUseOwner] = useState(!!value?.ownerPassword);
  const [ownerPw, setOwnerPw] = useState(value?.ownerPassword ?? "");
  const [perms, setPerms] = useState<ProtectSettings["permissions"]>(
    value?.permissions ?? {
      printing: true, modifying: false, copying: false,
      annotating: true, fillingForms: true,
      contentAccessibility: true, documentAssembly: false,
    },
  );
  useEffect(() => {
    if (!open) return;
    setPw(value?.userPassword ?? "");
    setPw2(value?.userPassword ?? "");
    setUseOwner(!!value?.ownerPassword);
    setOwnerPw(value?.ownerPassword ?? "");
    if (value?.permissions) setPerms(value.permissions);
  }, [open, value]);

  const save = () => {
    if (pw.length < 4) { toast.error("Password must be at least 4 characters."); return; }
    if (pw !== pw2) { toast.error("Passwords don't match."); return; }
    onSave({ userPassword: pw, ownerPassword: useOwner ? ownerPw : undefined, permissions: perms });
    onOpenChange(false);
    toast.success("Encryption will be applied on export");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader><DialogTitle>Password-protect the exported PDF</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm" autoComplete="new-password" />
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm" autoComplete="new-password" />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={useOwner} onChange={(e) => setUseOwner(e.target.checked)} className="h-4 w-4 accent-vault" />
            Set separate owner password (controls permissions)
          </label>
          {useOwner && (
            <input type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} placeholder="Owner password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" autoComplete="new-password" />
          )}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Permissions</div>
            <div className="grid grid-cols-2 gap-1.5">
              {PERM_ROWS.map((row) => (
                <label key={row.key} className="flex items-center gap-2 rounded border border-border bg-background/40 px-2 py-1.5 text-xs">
                  <input type="checkbox" checked={perms[row.key]}
                    onChange={() => setPerms((p) => ({ ...p, [row.key]: !p[row.key] }))}
                    className="h-3.5 w-3.5 accent-vault" />
                  {row.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          {value && <Button variant="ghost" onClick={() => { onSave(null); onOpenChange(false); toast.message("Password removed"); }}>Remove</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} className="bg-vault text-vault-foreground hover:opacity-90">Set password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Edit Text dialog ----------

const FAMILY_OPTIONS: { value: "sans" | "serif" | "mono"; label: string; css: string }[] = [
  { value: "sans", label: "Sans (Helvetica)", css: "Helvetica, Arial, sans-serif" },
  { value: "serif", label: "Serif (Times)", css: "'Times New Roman', Times, serif" },
  { value: "mono", label: "Mono (Courier)", css: "'Courier New', Courier, monospace" },
];

function rgbToHex(c: RGB): string {
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function TextEditDialog({
  target, annos, onClose, onCommit,
}: {
  target:
    | { kind: "new"; item: TextItem }
    | { kind: "existing"; annoId: string }
    | null;
  annos: Anno[];
  onClose: () => void;
  onCommit: (p: { text: string; family: "sans" | "serif" | "mono"; bold: boolean; italic: boolean; fontSize: number; color: RGB; bg: RGB }) => void;
}) {
  const existing = target?.kind === "existing"
    ? (annos.find((a) => a.id === target.annoId) as Anno | undefined)
    : undefined;

  const seed = (() => {
    if (target?.kind === "new") {
      const it = target.item;
      return {
        text: it.str,
        family: it.family,
        bold: it.bold,
        italic: it.italic,
        fontSize: +(it.h * 0.95).toFixed(2),
        color: { r: 0, g: 0, b: 0 } as RGB,
        bg: { r: 1, g: 1, b: 1 } as RGB,
      };
    }
    if (existing && existing.kind === "text-edit") {
      return {
        text: existing.text,
        family: existing.family ?? "sans",
        bold: !!existing.bold,
        italic: !!existing.italic,
        fontSize: existing.fontSize,
        color: existing.color,
        bg: existing.bg,
      };
    }
    return null;
  })();

  const [text, setText] = useState("");
  const [family, setFamily] = useState<"sans" | "serif" | "mono">("sans");
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [colorHex, setColorHex] = useState("#000000");
  const [bgHex, setBgHex] = useState("#ffffff");

  // Seed whenever target changes
  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    setFamily(seed.family);
    setBold(seed.bold);
    setItalic(seed.italic);
    setFontSize(seed.fontSize);
    setColorHex(rgbToHex(seed.color));
    setBgHex(rgbToHex(seed.bg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind === "new" ? target.item : target?.annoId]);

  const open = target !== null;
  const isNew = target?.kind === "new";
  const originalText = target?.kind === "new" ? target.item.str : undefined;

  const handleSave = () => {
    onCommit({
      text,
      family,
      bold,
      italic,
      fontSize,
      color: hexToRgb(colorHex),
      bg: hexToRgb(bgHex),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "Edit text" : "Update text edit"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isNew && originalText && (
            <div className="text-xs text-muted-foreground">
              Replacing: <span className="font-mono text-foreground/80">&ldquo;{originalText}&rdquo;</span>
            </div>
          )}
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
            style={{
              fontFamily: FAMILY_OPTIONS.find((f) => f.value === family)?.css,
              fontWeight: bold ? 700 : 400,
              fontStyle: italic ? "italic" : "normal",
            }}
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Font</span>
              <select
                value={family}
                onChange={(e) => setFamily(e.target.value as "sans" | "serif" | "mono")}
                className="w-full rounded-md border border-input bg-background p-1.5 text-sm"
              >
                {FAMILY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Size ({fontSize.toFixed(1)} pt)</span>
              <input
                type="number"
                step={0.5}
                min={4}
                max={144}
                value={fontSize}
                onChange={(e) => setFontSize(Math.max(4, +e.target.value || 4))}
                className="w-full rounded-md border border-input bg-background p-1.5 text-sm"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bold} onChange={() => setBold((v) => !v)} className="h-3.5 w-3.5 accent-vault" />
              Bold
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={italic} onChange={() => setItalic((v) => !v)} className="h-3.5 w-3.5 accent-vault" />
              Italic
            </label>
            <label className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Color</span>
              <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-input bg-background" />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Background</span>
              <input type="color" value={bgHex} onChange={(e) => setBgHex(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-input bg-background" />
            </label>
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground">
            VaultPDF covers the original glyphs with a matched background fill and redraws your replacement on top — the visual edit applies cleanly across all viewers. Underlying text-extraction may still return the original characters until we ship destructive content-stream rewrite (coming next).
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} className="bg-vault text-vault-foreground hover:opacity-90" disabled={!text.trim()}>
            {isNew ? "Replace text" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
