/**
 * Intelligent Action Bar — replaces the old ContextualBar.
 *
 * Two-section adaptive bar: Primary Actions (context-aware, workflow-driven)
 * on top, Properties (secondary formatting) below. The set of actions and
 * properties adapts to the selected object, current tool, and the last
 * committed action ("workflow stage").
 *
 * Docked at the top-center of the canvas (same slot the ContextualBar used).
 * Editor-canvas.tsx is off-limits, so we can't project the per-selection
 * rect into screen space to float the bar next to it. Docking keeps a stable
 * anchor while still delivering the intelligent, adaptive behavior.
 *
 * Content transitions with a subtle scale/fade so the bar morphs between
 * contexts instead of hard-swapping.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpToLine,
  ArrowDownToLine,
  Check,
  Copy,
  Crop,
  Download,
  Eraser,
  FileImage,
  Flame,
  RotateCcw,
  RefreshCw,
  Replace,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Anno, RGB } from "@/lib/editor/types";
import type { State as EditorState, Action as EditorAction } from "@/lib/editor/state";
import { PALETTE } from "@/lib/editor/state";
import { FONT_META, type FontKey } from "@/lib/editor/fonts";
import { isSignatureDataUrl } from "./signature-registry";
import type { Stage, Target } from "./types";

/* ---------- Target resolution ---------- */

function resolveTarget(state: EditorState): Target {
  const sel = state.doc?.annotations.find((a) => a.id === state.selectedAnnoId) ?? null;
  const tool = state.tool;

  if (sel) {
    if (sel.kind === "text-edit" || sel.kind === "text") {
      const editing = tool === "edit-text" || tool === "text";
      return { kind: editing ? "text-editing" : "text", anno: sel };
    }
    if (sel.kind === "image") {
      return {
        kind: isSignatureDataUrl(sel.dataUrl) ? "signature" : "image",
        anno: sel,
      };
    }
    if (sel.kind === "redact") return { kind: "redaction", anno: sel };
    if (
      sel.kind === "rect" || sel.kind === "ellipse" ||
      sel.kind === "line" || sel.kind === "arrow" ||
      sel.kind === "freehand"
    ) return { kind: "shape", anno: sel };
    if (sel.kind === "highlight" || sel.kind === "underline" || sel.kind === "strikethrough") {
      return { kind: "mark", anno: sel };
    }
  }

  const drawTools = new Set([
    "rect", "ellipse", "line", "arrow", "freehand",
    "highlight", "underline", "strikethrough",
    "redact", "text", "image", "edit-text",
  ]);
  if (drawTools.has(tool)) return { kind: "draw-tool", tool };
  return { kind: "none" };
}

/* ---------- Primitives ---------- */

function PrimaryBtn({
  icon: Icon,
  label,
  onClick,
  variant,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger" | "primary";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-40 disabled:pointer-events-none",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
        variant === "primary" && "bg-vault text-vault-foreground hover:opacity-90",
        (!variant || variant === "default") && "text-text-2 hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

function IconToggle({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
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

function SwatchRow({ value, onChange }: { value: RGB; onChange: (c: RGB) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {PALETTE.map((c, i) => {
        const active = Math.abs(c.r - value.r) < 0.02 && Math.abs(c.g - value.g) < 0.02 && Math.abs(c.b - value.b) < 0.02;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(c)}
            aria-label="Color"
            className={cn("h-4 w-4 rounded-full ring-1 ring-border", active && "ring-2 ring-vault")}
            style={{ background: `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})` }}
          />
        );
      })}
    </div>
  );
}

function OpacitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      aria-label="Opacity"
      type="range"
      min={0.1}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-20 accent-vault"
      title={`Opacity ${Math.round(value * 100)}%`}
    />
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-border" aria-hidden />;
}

function Stub(label: string) {
  toast.message(`${label} — coming soon`, {
    description: "This action is on the roadmap.",
  });
}

/* ---------- Helpers ---------- */

function nextZOrder(state: EditorState, id: string, dir: "forward" | "backward"): Anno[] | null {
  if (!state.doc) return null;
  const list = [...state.doc.annotations];
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const j = dir === "forward" ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
  if (i === j) return list;
  const [item] = list.splice(i, 1);
  list.splice(j, 0, item);
  return list;
}

function duplicateAnno(a: Anno): Anno {
  const copy: Anno = JSON.parse(JSON.stringify(a));
  copy.id = Math.random().toString(36).slice(2, 10);
  copy.x = (copy.x ?? 0) + 12;
  copy.y = (copy.y ?? 0) + 12;
  return copy;
}

/* ---------- Section renderers ---------- */

function TextPrimary({
  editing,
  stage,
  onDone,
  onCancel,
  onDuplicateStyle,
}: {
  editing: boolean;
  stage: Stage;
  onDone: () => void;
  onCancel: () => void;
  onDuplicateStyle: () => void;
}) {
  if (editing) {
    return (
      <>
        <PrimaryBtn icon={Check} label="Done" variant="primary" onClick={onDone} />
        <PrimaryBtn icon={X} label="Cancel" onClick={onCancel} />
        <Divider />
        <PrimaryBtn icon={Wand2} label="Match Original" onClick={() => Stub("Match Original Font")} />
        <PrimaryBtn icon={Replace} label="Replace Font" onClick={() => Stub("Replace Font")} />
        <PrimaryBtn icon={Sparkles} label="Apply To Similar" onClick={() => Stub("Apply To Similar")} />
      </>
    );
  }
  if (stage === "font-changed") {
    return (
      <>
        <PrimaryBtn icon={Wand2} label="Match Original Font" onClick={() => Stub("Match Original Font")} />
        <PrimaryBtn icon={Sparkles} label="Apply To Similar" onClick={() => Stub("Apply To Similar")} />
        <PrimaryBtn icon={Replace} label="Replace Everywhere" onClick={() => Stub("Replace Everywhere")} />
        <Divider />
        <PrimaryBtn icon={Copy} label="Duplicate Style" onClick={onDuplicateStyle} />
      </>
    );
  }
  return (
    <>
      <PrimaryBtn icon={Wand2} label="Match Original Font" onClick={() => Stub("Match Original Font")} />
      <PrimaryBtn icon={Replace} label="Replace Font" onClick={() => Stub("Replace Font")} />
      <PrimaryBtn icon={RefreshCw} label="Replace Everywhere" onClick={() => Stub("Replace Everywhere")} />
      <PrimaryBtn icon={Search} label="Find Similar Text" onClick={() => Stub("Find Similar Text")} />
      <PrimaryBtn icon={Copy} label="Duplicate Style" onClick={onDuplicateStyle} />
    </>
  );
}

function TextProps({
  anno,
  patch,
}: {
  anno: Extract<Anno, { kind: "text" | "text-edit" }>;
  patch: (p: Record<string, unknown>) => void;
}) {
  const fontKey: string =
    (anno.kind === "text-edit" && anno.fontKey) ||
    (anno.family === "serif" ? "tinos" : anno.family === "mono" ? "cousine" : "arimo");
  return (
    <>
      <select
        aria-label="Font"
        value={fontKey}
        onChange={(e) => {
          const key = e.target.value as FontKey;
          const meta = FONT_META[key] ?? FONT_META.arimo;
          patch({ fontKey: key, family: meta.kind, fontApproximate: false, fontFamilyOverride: undefined });
        }}
        className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[12px] text-foreground focus:outline-none focus:border-vault/50"
      >
        {Object.values(FONT_META).map((m) => (
          <option key={m.key} value={m.key}>{m.label}</option>
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
      <IconToggle active={!!anno.bold} onClick={() => patch({ bold: !anno.bold })} title="Bold">
        <span className="font-bold">B</span>
      </IconToggle>
      <IconToggle active={!!anno.italic} onClick={() => patch({ italic: !anno.italic })} title="Italic">
        <span className="italic">I</span>
      </IconToggle>
      <IconToggle active={!!anno.underline} onClick={() => patch({ underline: !anno.underline })} title="Underline">
        <span className="underline">U</span>
      </IconToggle>
      <Divider />
      <SwatchRow value={anno.color} onChange={(c) => patch({ color: c })} />
      <Divider />
      <IconToggle active={anno.align === "left" || !anno.align} onClick={() => patch({ align: "left" })} title="Align left">⟵</IconToggle>
      <IconToggle active={anno.align === "center"} onClick={() => patch({ align: "center" })} title="Align center">↔</IconToggle>
      <IconToggle active={anno.align === "right"} onClick={() => patch({ align: "right" })} title="Align right">⟶</IconToggle>
    </>
  );
}

/* ---------- Main bar ---------- */

export function IntelligentActionBar({
  state,
  dispatch,
  openTool,
}: {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  openTool: (id: string) => void;
}) {
  const target = useMemo(() => resolveTarget(state), [state]);

  // Per-selection stage machine — resets when the target identity changes.
  const [stage, setStage] = useState<Stage>("default");
  const targetKey =
    target.kind === "none" ? "none" :
    target.kind === "draw-tool" ? `draw:${target.tool}` :
    `${target.kind}:${target.anno.id}`;
  const lastKey = useRef(targetKey);
  useEffect(() => {
    if (lastKey.current !== targetKey) {
      lastKey.current = targetKey;
      setStage("default");
    }
  }, [targetKey]);

  // Auto-revert transient "duplicated" stage after 2s.
  useEffect(() => {
    if (stage !== "duplicated") return;
    const t = window.setTimeout(() => setStage("default"), 2000);
    return () => window.clearTimeout(t);
  }, [stage]);

  if (target.kind === "none") return null;

  const patch = (id: string, p: Record<string, unknown>) =>
    dispatch({ type: "UPDATE_ANNO", id, patch: p as never });

  const onDelete = () => {
    if (target.kind === "draw-tool") return;
    dispatch({ type: "DELETE_ANNO", id: target.anno.id });
  };

  const onDuplicate = () => {
    if (target.kind === "draw-tool") return;
    const copy = duplicateAnno(target.anno);
    dispatch({ type: "ADD_ANNO", a: copy });
    setStage("duplicated");
  };

  const bringForward = () => {
    if (target.kind === "draw-tool") return;
    const list = nextZOrder(state, target.anno.id, "forward");
    if (list && state.doc) dispatch({ type: "LOAD_SIDECAR", annotations: list });
  };
  const sendBackward = () => {
    if (target.kind === "draw-tool") return;
    const list = nextZOrder(state, target.anno.id, "backward");
    if (list && state.doc) dispatch({ type: "LOAD_SIDECAR", annotations: list });
  };

  /* --- render primary + properties per context --- */
  let primary: React.ReactNode = null;
  let props: React.ReactNode = null;
  let contextLabel = "";

  if (target.kind === "text" || target.kind === "text-editing") {
    contextLabel = target.kind === "text-editing" ? "Editing text" : "Text";
    primary = (
      <TextPrimary
        editing={target.kind === "text-editing"}
        stage={stage}
        onDone={() => dispatch({ type: "SELECT_ANNO", id: null })}
        onCancel={() => dispatch({ type: "SELECT_ANNO", id: null })}
        onDuplicateStyle={onDuplicate}
      />
    );
    if (target.kind !== "text-editing") {
      props = (
        <TextProps
          anno={target.anno}
          patch={(p) => {
            patch(target.anno.id, p);
            if ("fontKey" in p || "fontFamilyOverride" in p) setStage("font-changed");
          }}
        />
      );
    }
  } else if (target.kind === "image" || target.kind === "signature") {
    const a = target.anno;
    contextLabel = target.kind === "signature" ? "Signature" : "Image";
    const cropped = stage === "cropped";
    if (target.kind === "signature") {
      primary = (
        <>
          <PrimaryBtn icon={Replace} label="Replace" onClick={() => openTool("sign")} />
          <PrimaryBtn icon={Copy} label="Duplicate" onClick={onDuplicate} />
          <PrimaryBtn icon={ShieldCheck} label="Flatten" onClick={() => openTool("flatten")} />
          <PrimaryBtn icon={Check} label="Verify" onClick={() => Stub("Verify Signature")} />
        </>
      );
    } else {
      primary = (
        <>
          <PrimaryBtn icon={Replace} label="Replace" onClick={() => openTool("image")} />
          {cropped ? (
            <>
              <PrimaryBtn icon={RotateCcw} label="Reset Crop" onClick={() => { openTool("crop"); setStage("default"); }} />
              <PrimaryBtn icon={Sparkles} label="Apply Same Crop" onClick={() => Stub("Apply Same Crop")} />
            </>
          ) : (
            <PrimaryBtn icon={Crop} label="Crop" onClick={() => { openTool("crop"); setStage("cropped"); }} />
          )}
          <PrimaryBtn icon={Zap} label="Compress" onClick={() => Stub("Compress Image")} />
          <PrimaryBtn icon={Download} label="Extract" onClick={() => {
            const link = document.createElement("a");
            link.href = a.dataUrl;
            link.download = `image.${a.mime === "image/png" ? "png" : "jpg"}`;
            link.click();
          }} />
          <PrimaryBtn icon={Sparkles} label="AI Enhance" onClick={() => Stub("AI Enhance")} />
        </>
      );
    }
    props = (
      <>
        <span className="text-[11px] uppercase tracking-wider text-text-muted">Opacity</span>
        <OpacitySlider value={a.opacity} onChange={(v) => patch(a.id, { opacity: v })} />
        <Divider />
        <IconToggle onClick={() => patch(a.id, { /* rotation handled via editor */ })} title="Rotate 90°">
          <RotateCw className="h-3.5 w-3.5" />
        </IconToggle>
        <Divider />
        <IconToggle onClick={bringForward} title="Bring forward">
          <ArrowUpToLine className="h-3.5 w-3.5" />
        </IconToggle>
        <IconToggle onClick={sendBackward} title="Send backward">
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </IconToggle>
      </>
    );
  } else if (target.kind === "redaction") {
    contextLabel = "Redaction";
    const a = target.anno;
    const previewed = stage === "preview-burned";
    primary = previewed ? (
      <>
        <PrimaryBtn icon={Flame} label="Commit Burn" variant="danger" onClick={() => openTool("redact")} />
        <PrimaryBtn icon={RotateCcw} label="Undo Preview" onClick={() => setStage("default")} />
      </>
    ) : (
      <>
        <PrimaryBtn icon={Eraser} label="Preview Burn" onClick={() => { openTool("redact"); setStage("preview-burned"); }} />
        <PrimaryBtn icon={Search} label="Find Similar" onClick={() => Stub("Find Similar")} />
        <PrimaryBtn icon={TypeIcon} label="Mark Entire Line" onClick={() => Stub("Mark Entire Line")} />
        <PrimaryBtn icon={FileImage} label="Apply To Pages" onClick={() => Stub("Apply To Pages")} />
        <PrimaryBtn icon={Flame} label="Burn Redactions" variant="danger" onClick={() => openTool("redact")} />
      </>
    );
    props = (
      <>
        <SwatchRow value={a.color} onChange={(c) => patch(a.id, { color: c })} />
        <Divider />
        <OpacitySlider value={a.opacity} onChange={(v) => patch(a.id, { opacity: v })} />
      </>
    );
  } else if (target.kind === "shape") {
    contextLabel = "Shape";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = target.anno as any;
    const dup = stage === "duplicated";
    primary = (
      <>
        <PrimaryBtn icon={Copy} label={dup ? "Duplicate Again" : "Duplicate"} onClick={onDuplicate} />
        <PrimaryBtn icon={ArrowUpToLine} label="Bring Forward" onClick={bringForward} />
        <PrimaryBtn icon={ArrowDownToLine} label="Send Backward" onClick={sendBackward} />
      </>
    );
    const showFill = a.kind === "rect" || a.kind === "ellipse";
    props = (
      <>
        <SwatchRow value={a.color} onChange={(c) => patch(a.id, { color: c })} />
        <input
          aria-label="Stroke"
          type="number"
          min={0.5}
          max={20}
          step={0.5}
          value={a.stroke ?? 1}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v > 0) patch(a.id, { stroke: v });
          }}
          className="w-14 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[12px] text-foreground focus:outline-none focus:border-vault/50"
          title="Thickness"
        />
        <OpacitySlider value={a.opacity} onChange={(v) => patch(a.id, { opacity: v })} />
        {showFill && (
          <IconToggle active={!!a.fill} onClick={() => patch(a.id, { fill: !a.fill })} title="Fill">
            Fill
          </IconToggle>
        )}
      </>
    );
  } else if (target.kind === "mark") {
    contextLabel = "Mark";
    const a = target.anno;
    primary = (
      <>
        <PrimaryBtn icon={Copy} label="Duplicate Style" onClick={onDuplicate} />
        <PrimaryBtn icon={Search} label="Find Similar Text" onClick={() => Stub("Find Similar Text")} />
      </>
    );
    props = (
      <>
        <SwatchRow value={a.color} onChange={(c) => patch(a.id, { color: c })} />
        <Divider />
        <OpacitySlider value={a.opacity} onChange={(v) => patch(a.id, { opacity: v })} />
      </>
    );
  } else if (target.kind === "draw-tool") {
    contextLabel = `Draw · ${target.tool}`;
    primary = (
      <span className="px-1 text-[12px] text-text-muted">
        {target.tool === "redact"
          ? "Drag to mark text or regions for redaction."
          : target.tool === "text"
          ? "Click on the page to add a text box."
          : target.tool === "edit-text"
          ? "Click any text on the page to edit."
          : target.tool === "image"
          ? "Click the page to place your image."
          : "Drag on the page to draw."}
      </span>
    );
  }

  // Suppress the whole bar for pure select with no selection.
  const isDrawOnly = target.kind === "draw-tool";

  return (
    <div
      key={targetKey}
      className={cn(
        "absolute left-1/2 top-[58px] z-20 flex -translate-x-1/2 flex-col gap-1.5 border border-border bg-surface-3 px-2.5 py-1.5",
        "animate-scale-in",
      )}
      style={{ borderRadius: 12, boxShadow: "var(--shadow-float)", minWidth: 320 }}
      role="toolbar"
      aria-label={`${contextLabel} actions`}
    >
      {/* Primary row */}
      <div className="flex items-center gap-1">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          {contextLabel}
        </span>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <div className="flex items-center gap-1">{primary}</div>
        {!isDrawOnly && (
          <>
            <span className="ml-auto pl-1" />
            <button
              type="button"
              onClick={onDelete}
              title="Delete"
              aria-label="Delete"
              className="grid h-6 w-6 place-items-center rounded-md text-text-2 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {/* Properties row */}
      {props && (
        <div className="flex items-center gap-1.5 border-t border-border/70 pt-1.5 text-[12px] text-text-2">
          <span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-text-muted">
            Properties
          </span>
          {props}
        </div>
      )}
    </div>
  );
}
