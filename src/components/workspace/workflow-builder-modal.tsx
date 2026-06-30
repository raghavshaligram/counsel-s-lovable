/**
 * Workflow Builder modal — Pro feature.
 *
 * Visual pipeline editor on top of the EXISTING automation engine
 * (`@/lib/automation`). We do not reimplement op logic; this UI only
 * composes ordered steps from the existing op registry, runs them via
 * `runPipeline` (off-main-thread Web Worker), and surfaces per-step
 * progress.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  [name field]                       [Save]  [Run]           │
 *   ├──────────┬─────────────────────────────────┬───────────────┤
 *   │ Palette  │ Sequence canvas                 │ Inspector     │
 *   │ (drag)   │ (drag to reorder, click=select) │ (params)      │
 *   └──────────┴─────────────────────────────────┴───────────────┘
 *
 * On-device. Drag-and-drop via native HTML5 (no dnd-kit dependency).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  X, Play, Save, GripVertical, Trash2, Plus,
  Loader2, CircleCheck, CircleAlert, Circle,
  FileText, ImageIcon, Stamp, Hash,
  Layers, PackageOpen, RotateCw, Scissors, ShieldCheck,
} from "lucide-react";
import { runPipeline, downloadBytes } from "@/lib/automation/runner";
import type { Pipeline, ProgressEvent } from "@/lib/automation/types";
import { listPipelines, savePipeline, type Pipeline as SavedPipeline } from "@/lib/pipelines";
import { cn } from "@/lib/utils";

/* ============================================================
 * Op catalogue — UI metadata + defaults for the registry ops.
 * ============================================================ */

type ParamField =
  | { kind: "text"; key: string; label: string; placeholder?: string }
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number }
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: "checkbox"; key: string; label: string };

interface OpMeta {
  /** Matches automation registry key. */
  op: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  defaults: Record<string, unknown>;
  fields: ParamField[];
}

const OP_CATALOGUE: OpMeta[] = [
  {
    op: "sanitize",
    label: "Sanitize",
    description: "Strip metadata, JS, embedded files.",
    icon: ShieldCheck,
    defaults: {},
    fields: [],
  },
  {
    op: "bates",
    label: "Bates stamp",
    description: "Sequential numbering for production.",
    icon: Hash,
    defaults: {
      prefix: "ABC", suffix: "", startAt: 1, digits: 6,
      position: "br", fontSize: 10, color: "black", margin: 24,
    },
    fields: [
      { kind: "text", key: "prefix", label: "Prefix", placeholder: "ABC" },
      { kind: "text", key: "suffix", label: "Suffix" },
      { kind: "number", key: "startAt", label: "Start at", min: 1, step: 1 },
      { kind: "number", key: "digits", label: "Digits", min: 1, max: 10, step: 1 },
      { kind: "select", key: "position", label: "Position", options: [
        { value: "tl", label: "Top left" }, { value: "tc", label: "Top center" }, { value: "tr", label: "Top right" },
        { value: "bl", label: "Bottom left" }, { value: "bc", label: "Bottom center" }, { value: "br", label: "Bottom right" },
      ]},
      { kind: "number", key: "fontSize", label: "Font size", min: 6, max: 32, step: 1 },
      { kind: "select", key: "color", label: "Color", options: [
        { value: "black", label: "Black" }, { value: "blue", label: "Blue" }, { value: "red", label: "Red" },
      ]},
    ],
  },
  {
    op: "page-numbers",
    label: "Page numbers",
    description: "Add 1, 2, 3… or Page n of m.",
    icon: FileText,
    defaults: {
      anchor: "bottom-center", format: "page-n",
      startAt: 1, skipFirst: 0, fontSize: 10, margin: 24, prefix: "",
    },
    fields: [
      { kind: "select", key: "anchor", label: "Position", options: [
        { value: "top-left", label: "Top left" }, { value: "top-center", label: "Top center" }, { value: "top-right", label: "Top right" },
        { value: "bottom-left", label: "Bottom left" }, { value: "bottom-center", label: "Bottom center" }, { value: "bottom-right", label: "Bottom right" },
      ]},
      { kind: "select", key: "format", label: "Format", options: [
        { value: "n", label: "1" }, { value: "page-n", label: "Page 1" },
        { value: "n-of-m", label: "1 of N" }, { value: "roman", label: "i, ii, iii" },
      ]},
      { kind: "number", key: "startAt", label: "Start at", min: 1, step: 1 },
      { kind: "number", key: "skipFirst", label: "Skip first N pages", min: 0, step: 1 },
      { kind: "number", key: "fontSize", label: "Font size", min: 6, max: 32, step: 1 },
    ],
  },
  {
    op: "header-footer",
    label: "Header / footer",
    description: "Tokens: {page} {pages} {date} {filename}.",
    icon: Layers,
    defaults: {
      headerText: "", footerText: "{filename} — {date}",
      align: "center", fontSize: 9, margin: 18, rule: "all",
    },
    fields: [
      { kind: "text", key: "headerText", label: "Header text" },
      { kind: "text", key: "footerText", label: "Footer text" },
      { kind: "select", key: "align", label: "Align", options: [
        { value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" },
      ]},
      { kind: "select", key: "rule", label: "Apply to", options: [
        { value: "all", label: "All pages" }, { value: "no-first", label: "Skip first" },
        { value: "odd", label: "Odd pages" }, { value: "even", label: "Even pages" },
      ]},
      { kind: "number", key: "fontSize", label: "Font size", min: 6, max: 24, step: 1 },
    ],
  },
  {
    op: "watermark",
    label: "Watermark",
    description: "Diagonal text mark across pages.",
    icon: Stamp,
    defaults: { text: "DRAFT", opacity: 25, size: 96, pos: "diagonal" },
    fields: [
      { kind: "text", key: "text", label: "Text", placeholder: "DRAFT" },
      { kind: "number", key: "opacity", label: "Opacity %", min: 5, max: 100, step: 1 },
      { kind: "number", key: "size", label: "Size (pt)", min: 12, max: 160, step: 2 },
      { kind: "select", key: "pos", label: "Position", options: [
        { value: "diagonal", label: "Diagonal" }, { value: "center", label: "Center" },
        { value: "top", label: "Top" }, { value: "bottom", label: "Bottom" },
      ]},
    ],
  },
  {
    op: "rotate",
    label: "Rotate",
    description: "Rotate all or selected pages.",
    icon: RotateCw,
    defaults: { angle: 90, scope: "all", custom: "" },
    fields: [
      { kind: "select", key: "angle", label: "Angle", options: [
        { value: "90", label: "90°" }, { value: "180", label: "180°" }, { value: "270", label: "270°" },
      ]},
      { kind: "select", key: "scope", label: "Scope", options: [
        { value: "all", label: "All" }, { value: "odd", label: "Odd" },
        { value: "even", label: "Even" }, { value: "custom", label: "Custom range" },
      ]},
      { kind: "text", key: "custom", label: "Custom range (1-3, 5)" },
    ],
  },
  {
    op: "extract-pages",
    label: "Extract pages",
    description: "Keep only the given page ranges.",
    icon: Scissors,
    defaults: { ranges: "1-" },
    fields: [
      { kind: "text", key: "ranges", label: "Ranges (e.g. 1-3, 5)" },
    ],
  },
  {
    op: "flatten",
    label: "Flatten",
    description: "Burn form fields & annotations.",
    icon: ImageIcon,
    defaults: { forms: true, annotations: true, clearSensitiveFirst: false },
    fields: [
      { kind: "checkbox", key: "forms", label: "Flatten form fields" },
      { kind: "checkbox", key: "annotations", label: "Flatten annotations" },
      { kind: "checkbox", key: "clearSensitiveFirst", label: "Clear sensitive values first" },
    ],
  },
  {
    op: "compress",
    label: "Compress",
    description: "Shrink output PDF.",
    icon: PackageOpen,
    defaults: { preset: "medium", grayscale: false },
    fields: [
      { kind: "select", key: "preset", label: "Preset", options: [
        { value: "low", label: "Low" }, { value: "medium", label: "Medium" },
        { value: "high", label: "High" }, { value: "extreme", label: "Extreme" },
      ]},
      { kind: "checkbox", key: "grayscale", label: "Convert to grayscale" },
    ],
  },
];

const META_BY_OP = new Map(OP_CATALOGUE.map((m) => [m.op, m]));

/* ============================================================
 * State
 * ============================================================ */

type StepStatus = "idle" | "pending" | "running" | "done" | "failed";
interface BuilderStep {
  id: string;
  op: string;
  params: Record<string, unknown>;
  status: StepStatus;
  message?: string;
  elapsedMs?: number;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function coerceParam(field: ParamField, raw: string | boolean): unknown {
  if (field.kind === "number") return Number(raw);
  if (field.kind === "select" && field.key === "angle") return Number(raw);
  if (field.kind === "checkbox") return Boolean(raw);
  return raw;
}

/* ============================================================
 * Modal
 * ============================================================ */

export function WorkflowBuilderModal({
  onClose, sourceFile,
}: { onClose: () => void; sourceFile: File | null }) {
  const [name, setName] = useState("Untitled workflow");
  const [steps, setSteps] = useState<BuilderStep[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const dragRef = useRef<{ from: number | null; src: "palette" | "canvas" | null; op?: string }>({ from: null, src: null });

  const selected = useMemo(
    () => steps.find((s) => s.id === selectedId) ?? null,
    [steps, selectedId],
  );

  /* ---------------- step CRUD ---------------- */

  const addStep = useCallback((op: string, atIndex?: number) => {
    const meta = META_BY_OP.get(op);
    if (!meta) return;
    const step: BuilderStep = {
      id: uid(), op, params: { ...meta.defaults }, status: "idle",
    };
    setSteps((prev) => {
      const next = [...prev];
      const idx = atIndex ?? next.length;
      next.splice(idx, 0, step);
      return next;
    });
    setSelectedId(step.id);
  }, []);

  const moveStep = useCallback((from: number, to: number) => {
    setSteps((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to > prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, item);
      return next;
    });
  }, []);

  const removeStep = useCallback((id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  const updateParam = useCallback((id: string, key: string, value: unknown) => {
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, params: { ...s.params, [key]: value } } : s));
  }, []);

  /* ---------------- run ---------------- */

  const handleRun = useCallback(async () => {
    if (!sourceFile) { toast.error("Open a PDF in the workspace first."); return; }
    if (steps.length === 0) { toast.error("Add at least one step."); return; }
    setRunning(true);
    setSteps((prev) => prev.map((s) => ({ ...s, status: "pending", message: undefined, elapsedMs: undefined })));

    const pipeline: Pipeline = steps.map((s) => {
      const meta = META_BY_OP.get(s.op);
      return { op: s.op, params: s.params, label: meta?.label ?? s.op };
    });

    try {
      const bytes = new Uint8Array(await sourceFile.arrayBuffer());
      const result = await runPipeline(bytes, pipeline, {
        onProgress: (ev: ProgressEvent) => {
          if (ev.type === "step-start") {
            setSteps((prev) => prev.map((s, i) => i === ev.index ? { ...s, status: "running" } : s));
          } else if (ev.type === "step-done") {
            setSteps((prev) => prev.map((s, i) => i === ev.index ? { ...s, status: "done", elapsedMs: ev.elapsedMs } : s));
          } else if (ev.type === "step-error") {
            setSteps((prev) => prev.map((s, i) => i === ev.index ? { ...s, status: "failed", message: ev.error } : s));
          }
        },
      });
      const base = sourceFile.name.replace(/\.pdf$/i, "");
      downloadBytes(result.bytes, `${base}.${name.replace(/[^a-z0-9-_]+/gi, "_") || "workflow"}.pdf`);
      toast.success(`Workflow done · ${result.steps.length} steps · ${(result.totalElapsedMs / 1000).toFixed(1)}s`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Workflow failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  }, [sourceFile, steps, name]);

  const handleSave = useCallback(() => {
    if (steps.length === 0) { toast.error("Nothing to save."); return; }
    const saved: SavedPipeline = {
      $schema: "counselpdf.pipeline/1",
      name: name.trim() || "Untitled workflow",
      steps: steps.map((s) => ({ tool: s.op, args: s.params })),
    };
    try {
      savePipeline(saved);
      toast.success(`Saved “${saved.name}”`);
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [name, steps]);

  const loadSaved = useCallback((p: SavedPipeline) => {
    setName(p.name);
    setSteps(p.steps.map((s) => ({
      id: uid(), op: s.tool, params: { ...(s.args ?? {}) }, status: "idle",
    })));
    setSelectedId(null);
  }, []);

  const savedList = useMemo(() => listPipelines(), [steps.length === -1]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- render ---------------- */

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-xl">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={running}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-vault/50 focus:ring-1 focus:ring-vault/30"
            placeholder="Workflow name"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={running || steps.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:border-vault/40 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> Save workflow
          </button>
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running || steps.length === 0 || !sourceFile}
            className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded p-1 text-text-2 hover:bg-surface-2 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid flex-1 grid-cols-[220px_1fr_280px] overflow-hidden">
          {/* ── Palette ─────────────────────────────────────── */}
          <aside className="flex flex-col overflow-y-auto border-r border-border bg-surface-1 p-2.5">
            <div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wider text-text-2">
              Operations
            </div>
            {OP_CATALOGUE.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.op}
                  type="button"
                  draggable={!running}
                  onDragStart={(e) => {
                    dragRef.current = { from: null, src: "palette", op: m.op };
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData("text/plain", `palette:${m.op}`);
                  }}
                  onClick={() => addStep(m.op)}
                  className="group mb-1 flex w-full cursor-grab items-start gap-2 rounded-md border border-border bg-surface-2 p-2 text-left hover:border-vault/40 active:cursor-grabbing"
                  title={m.description}
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vault" />
                  <div className="min-w-0">
                    <div className="text-[12px] text-foreground">{m.label}</div>
                    <div className="truncate text-[10.5px] text-text-2">{m.description}</div>
                  </div>
                  <Plus className="ml-auto h-3 w-3 text-text-2 opacity-0 group-hover:opacity-100" />
                </button>
              );
            })}

            {savedList.length > 0 && (
              <>
                <div className="mb-1.5 mt-3 px-1 text-[10.5px] font-medium uppercase tracking-wider text-text-2">
                  Saved
                </div>
                {savedList.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => loadSaved(p)}
                    className="mb-1 flex w-full items-center justify-between rounded-md border border-border bg-surface-2 px-2 py-1.5 text-left text-[12px] text-foreground hover:border-vault/40"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-[10.5px] text-text-2">{p.steps.length}</span>
                  </button>
                ))}
              </>
            )}
          </aside>

          {/* ── Sequence canvas ─────────────────────────────── */}
          <main
            className="flex flex-col overflow-y-auto bg-surface-2/40 p-4"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = dragRef.current.src === "palette" ? "copy" : "move"; }}
            onDrop={(e) => {
              e.preventDefault();
              const data = e.dataTransfer.getData("text/plain");
              if (data.startsWith("palette:")) addStep(data.slice("palette:".length));
              dragRef.current = { from: null, src: null };
            }}
          >
            {!sourceFile && (
              <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
                Open a PDF in the workspace before running — the active document is the input.
              </div>
            )}

            {steps.length === 0 ? (
              <div className="grid flex-1 place-items-center rounded-md border border-dashed border-border text-[12.5px] text-text-2">
                Drag operations here to build a workflow.
              </div>
            ) : (
              <ol className="flex flex-col">
                {steps.map((s, idx) => {
                  const meta = META_BY_OP.get(s.op);
                  if (!meta) return null;
                  const Icon = meta.icon;
                  const isSel = s.id === selectedId;
                  return (
                    <li key={s.id} className="relative">
                      <div
                        onClick={() => setSelectedId(s.id)}
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const data = e.dataTransfer.getData("text/plain");
                          if (data.startsWith("palette:")) {
                            addStep(data.slice("palette:".length), idx);
                          } else if (data.startsWith("canvas:")) {
                            moveStep(Number(data.slice("canvas:".length)), idx);
                          }
                          dragRef.current = { from: null, src: null };
                        }}
                        className={cn(
                          "group flex cursor-pointer items-center gap-2.5 rounded-md border bg-surface-1 p-2.5 transition-colors",
                          isSel ? "border-vault/60 ring-1 ring-vault/30" : "border-border hover:border-vault/40",
                        )}
                      >
                        <button
                          type="button"
                          draggable={!running}
                          onDragStart={(e) => {
                            dragRef.current = { from: idx, src: "canvas" };
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", `canvas:${idx}`);
                          }}
                          className="cursor-grab text-text-2 active:cursor-grabbing"
                          aria-label="Drag to reorder"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-vault/15 text-[10.5px] font-medium text-vault">
                          {idx + 1}
                        </span>
                        <Icon className="h-3.5 w-3.5 shrink-0 text-vault" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] text-foreground">{meta.label}</div>
                          <div className="truncate text-[10.5px] text-text-2">
                            {summariseParams(s.op, s.params)}
                          </div>
                        </div>
                        <StatusBadge status={s.status} elapsedMs={s.elapsedMs} message={s.message} />
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeStep(s.id); }}
                          disabled={running}
                          className="rounded p-1 text-text-2 hover:bg-surface-2 hover:text-red-400 disabled:opacity-50"
                          aria-label="Remove step"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {idx < steps.length - 1 && (
                        <div className="ml-[18px] h-3 w-px bg-border" aria-hidden />
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </main>

          {/* ── Inspector ───────────────────────────────────── */}
          <aside className="flex flex-col overflow-y-auto border-l border-border bg-surface-1 p-3">
            {!selected ? (
              <div className="grid flex-1 place-items-center px-2 text-center text-[12px] text-text-2">
                Select a step to edit its parameters.
              </div>
            ) : (
              <Inspector
                step={selected}
                onChange={(key, val) => updateParam(selected.id, key, val)}
                disabled={running}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Inspector
 * ============================================================ */

function Inspector({
  step, onChange, disabled,
}: {
  step: BuilderStep;
  onChange: (key: string, value: unknown) => void;
  disabled: boolean;
}) {
  const meta = META_BY_OP.get(step.op);
  if (!meta) return null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[13px] text-foreground">{meta.label}</div>
        <div className="mt-0.5 text-[11.5px] text-text-2">{meta.description}</div>
      </div>
      {meta.fields.length === 0 && (
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[11.5px] text-text-2">
          This step has no parameters.
        </div>
      )}
      {meta.fields.map((f) => {
        const id = `f-${step.id}-${f.key}`;
        const val = step.params[f.key];
        if (f.kind === "text") {
          return (
            <label key={f.key} htmlFor={id} className="flex flex-col gap-1 text-[11.5px] text-text-2">
              {f.label}
              <input
                id={id} type="text"
                value={typeof val === "string" ? val : ""}
                placeholder={f.placeholder}
                disabled={disabled}
                onChange={(e) => onChange(f.key, coerceParam(f, e.target.value))}
                className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-vault/50 focus:ring-1 focus:ring-vault/30"
              />
            </label>
          );
        }
        if (f.kind === "number") {
          return (
            <label key={f.key} htmlFor={id} className="flex flex-col gap-1 text-[11.5px] text-text-2">
              {f.label}
              <input
                id={id} type="number"
                value={typeof val === "number" ? val : Number(val) || 0}
                min={f.min} max={f.max} step={f.step ?? 1}
                disabled={disabled}
                onChange={(e) => onChange(f.key, coerceParam(f, e.target.value))}
                className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-vault/50 focus:ring-1 focus:ring-vault/30"
              />
            </label>
          );
        }
        if (f.kind === "select") {
          return (
            <label key={f.key} htmlFor={id} className="flex flex-col gap-1 text-[11.5px] text-text-2">
              {f.label}
              <select
                id={id}
                value={String(val ?? "")}
                disabled={disabled}
                onChange={(e) => onChange(f.key, coerceParam(f, e.target.value))}
                className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-vault/50 focus:ring-1 focus:ring-vault/30"
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          );
        }
        // checkbox
        return (
          <label key={f.key} htmlFor={id} className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
            <input
              id={id} type="checkbox"
              checked={Boolean(val)}
              disabled={disabled}
              onChange={(e) => onChange(f.key, e.target.checked)}
              className="h-3.5 w-3.5 accent-vault"
            />
            {f.label}
          </label>
        );
      })}
    </div>
  );
}

/* ============================================================
 * Bits
 * ============================================================ */

function StatusBadge({ status, elapsedMs, message }: { status: StepStatus; elapsedMs?: number; message?: string }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-vault">
        <Loader2 className="h-3 w-3 animate-spin" /> running
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-400" title={elapsedMs ? `${elapsedMs}ms` : undefined}>
        <CircleCheck className="h-3 w-3" /> done
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-red-400" title={message}>
        <CircleAlert className="h-3 w-3" /> failed
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-text-2">
        <Circle className="h-3 w-3" /> pending
      </span>
    );
  }
  return null;
}

function summariseParams(op: string, p: Record<string, unknown>): string {
  switch (op) {
    case "bates":
      return `${String(p.prefix ?? "")}…  start ${String(p.startAt ?? 1)} · ${String(p.position ?? "br")}`;
    case "page-numbers":
      return `${String(p.format ?? "page-n")} · ${String(p.anchor ?? "bottom-center")}`;
    case "watermark":
      return `“${String(p.text ?? "")}” · ${String(p.pos ?? "diagonal")}`;
    case "rotate":
      return `${String(p.angle ?? 90)}° · ${String(p.scope ?? "all")}`;
    case "extract-pages":
      return `pages ${String(p.ranges ?? "1-")}`;
    case "compress":
      return `${String(p.preset ?? "medium")}${p.grayscale ? " · grayscale" : ""}`;
    case "flatten":
      return `${p.forms ? "forms" : ""}${p.forms && p.annotations ? " + " : ""}${p.annotations ? "annotations" : ""}`;
    case "header-footer":
      return `${String(p.footerText ?? p.headerText ?? "")}`;
    case "sanitize":
      return "metadata · JS · embeds";
    default:
      return "";
  }
}

// Used by tool-panels.tsx default-export pattern if needed.
export default WorkflowBuilderModal;

// Re-exported to satisfy unused-import lint when ScanText is referenced via dynamic imports.
export const _ScanText = ScanText;
