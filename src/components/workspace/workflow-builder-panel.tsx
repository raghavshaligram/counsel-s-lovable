/**
 * Workflow Builder — visual pipeline authoring on top of the existing
 * automation engine (src/lib/automation). Pro-gated. Isolated panel: reads
 * the active tab's file, runs steps in a worker, writes result via download.
 *
 * Does NOT touch the PDF viewer, tab lifecycle, editor-canvas, or the
 * open path. Reuses OPS registry + runPipeline verbatim.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Play,
  Save,
  GripVertical,
  X,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Circle,
  Download,
  Lock,
  Sparkles,
  Stamp,
  Hash,
  ShieldCheck,
  PackageOpen,
  RotateCw,
  Scissors,
  FileText,
  Layers,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIsPro, useRequirePro, LockBadge } from "@/lib/pro-gate";

import type { Pipeline, PipelineStep, ProgressEvent } from "@/lib/automation/types";
import { runPipeline, downloadBytes } from "@/lib/automation";

import type { ToolPanelCtx } from "./tool-panels";

/* -------------------------------------------------------------------- */
/* Palette                                                              */
/* -------------------------------------------------------------------- */

type OpDef = {
  op: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
  defaults: Record<string, unknown>;
};

const PALETTE: OpDef[] = [
  {
    op: "sanitize",
    label: "Sanitize metadata",
    icon: ShieldCheck,
    blurb: "Strip metadata, XMP, and JavaScript.",
    defaults: {},
  },
  {
    op: "bates",
    label: "Bates stamp",
    icon: Hash,
    blurb: "Sequential production numbers on every page.",
    defaults: {
      prefix: "BATES",
      startAt: 1,
      digits: 6,
      position: "br",
      fontSize: 10,
      color: "black",
      margin: 24,
    },
  },
  {
    op: "page-numbers",
    label: "Page numbers",
    icon: FileText,
    blurb: "Add page numbers at a chosen anchor.",
    defaults: {
      anchor: "bottom-center",
      format: "n-of-m",
      startAt: 1,
      skipFirst: 0,
      fontSize: 10,
      margin: 24,
    },
  },
  {
    op: "header-footer",
    label: "Header / footer",
    icon: Layers,
    blurb: "Text at top/bottom of each page.",
    defaults: {
      headerText: "",
      footerText: "Confidential",
      align: "center",
      fontSize: 9,
      margin: 24,
      rule: "all",
    },
  },
  {
    op: "watermark",
    label: "Watermark",
    icon: Stamp,
    blurb: "Diagonal text watermark.",
    defaults: { text: "CONFIDENTIAL", opacity: 20, size: 72, pos: "diagonal" },
  },
  {
    op: "rotate",
    label: "Rotate pages",
    icon: RotateCw,
    blurb: "Rotate all/odd/even pages.",
    defaults: { angle: 90, scope: "all" },
  },
  {
    op: "compress",
    label: "Compress",
    icon: PackageOpen,
    blurb: "Structural or rasterised compression.",
    defaults: { preset: "medium" },
  },
  {
    op: "flatten",
    label: "Flatten forms",
    icon: Layers,
    blurb: "Bake form values into page content (safety-gated).",
    defaults: { forms: true, annotations: false, clearSensitiveFirst: false },
  },
  {
    op: "extract-pages",
    label: "Extract pages",
    icon: Scissors,
    blurb: "Keep only a range (e.g. 1-5, 8, 12-15).",
    defaults: { ranges: "1-1" },
  },
];

function paletteFor(op: string): OpDef | undefined {
  return PALETTE.find((p) => p.op === op);
}

/* -------------------------------------------------------------------- */
/* Types                                                                */
/* -------------------------------------------------------------------- */

type StepStatus = "idle" | "running" | "done" | "error";

type UiStep = PipelineStep & {
  uid: string;
  status: StepStatus;
  message?: string;
};

let uidSeq = 0;
const nextUid = () => `ws-${++uidSeq}-${Date.now()}`;

/* -------------------------------------------------------------------- */
/* Panel                                                                */
/* -------------------------------------------------------------------- */

export function WorkflowBuilderPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const isPro = useIsPro();
  const requirePro = useRequirePro();
  const { file } = ctx;

  const [name, setName] = useState("Untitled workflow");
  const [steps, setSteps] = useState<UiStep[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [resultBytes, setResultBytes] = useState<Uint8Array | null>(null);
  const dragKind = useRef<"palette" | "reorder" | null>(null);
  const dragOp = useRef<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  const selected = useMemo(
    () => (selectedUid ? steps.find((s) => s.uid === selectedUid) ?? null : null),
    [selectedUid, steps],
  );

  /* -------- Pro gate -------- */
  if (!isPro) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-vault/30 bg-vault/5 p-4 text-[12px] leading-snug text-text">
          <div className="mb-2 flex items-center gap-2 text-vault">
            <Lock className="h-4 w-4" />
            <span className="font-medium">Workflow Builder — Pro</span>
          </div>
          <p className="text-text-muted">
            Chain OCR, Bates, sanitize, watermark, compress and more into a
            reusable, on-device pipeline. Every workflow uses the same
            verified export path as manual tools.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-vault text-white hover:bg-vault/90"
          onClick={() => requirePro("Workflows & automation")}
        >
          Unlock Workflow Builder
        </Button>
      </div>
    );
  }

  /* -------- Palette drag start -------- */
  const onPaletteDragStart = (op: string) => (e: React.DragEvent) => {
    dragKind.current = "palette";
    dragOp.current = op;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", op);
  };
  const onReorderDragStart = (index: number) => (e: React.DragEvent) => {
    dragKind.current = "reorder";
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };
  const onDropAt = (targetIndex: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragKind.current === "palette" && dragOp.current) {
      const def = paletteFor(dragOp.current);
      if (!def) return;
      const step: UiStep = {
        uid: nextUid(),
        op: def.op,
        label: def.label,
        params: { ...def.defaults },
        status: "idle",
      };
      setSteps((cur) => {
        const next = [...cur];
        next.splice(Math.min(targetIndex, next.length), 0, step);
        return next;
      });
      setSelectedUid(step.uid);
    } else if (dragKind.current === "reorder" && dragIndex.current !== null) {
      const from = dragIndex.current;
      setSteps((cur) => {
        if (from === targetIndex || from < 0 || from >= cur.length) return cur;
        const next = [...cur];
        const [moved] = next.splice(from, 1);
        const insertAt = from < targetIndex ? targetIndex - 1 : targetIndex;
        next.splice(insertAt, 0, moved);
        return next;
      });
    }
    dragKind.current = null;
    dragOp.current = null;
    dragIndex.current = null;
  };
  const allowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = dragKind.current === "reorder" ? "move" : "copy";
  };

  /* -------- Step operations -------- */
  const removeStep = (uid: string) => {
    setSteps((cur) => cur.filter((s) => s.uid !== uid));
    if (selectedUid === uid) setSelectedUid(null);
  };
  const updateParams = (uid: string, patch: Record<string, unknown>) => {
    setSteps((cur) =>
      cur.map((s) => (s.uid === uid ? { ...s, params: { ...(s.params as object), ...patch } } : s)),
    );
  };

  /* -------- Save -------- */
  const saveWorkflow = () => {
    if (steps.length === 0) {
      toast.error("Add at least one step before saving.");
      return;
    }
    const key = "counselpdf.workflows";
    try {
      const raw = localStorage.getItem(key);
      const list = raw ? (JSON.parse(raw) as Array<{ name: string; steps: PipelineStep[] }>) : [];
      const cleanSteps: PipelineStep[] = steps.map(({ op, params, label }) => ({ op, params, label }));
      const dedup = list.filter((w) => w.name !== name);
      dedup.push({ name, steps: cleanSteps });
      localStorage.setItem(key, JSON.stringify(dedup));
      toast.success(`Saved “${name}”`);
    } catch {
      toast.error("Could not save workflow.");
    }
  };

  /* -------- Run -------- */
  const runWorkflow = useCallback(async () => {
    if (!file) {
      toast.error("Open a PDF first.");
      return;
    }
    if (steps.length === 0) {
      toast.error("Drag operations into the sequence first.");
      return;
    }
    setRunning(true);
    setResultBytes(null);
    setSteps((cur) => cur.map((s) => ({ ...s, status: "idle", message: undefined })));

    const pipeline: Pipeline = steps.map(({ op, params, label }) => ({ op, params, label }));
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      const res = await runPipeline(bytes, pipeline, {
        onProgress: (ev: ProgressEvent) => {
          if (ev.type === "step-start") {
            setSteps((cur) =>
              cur.map((s, i) => (i === ev.index ? { ...s, status: "running", message: undefined } : s)),
            );
          } else if (ev.type === "step-done") {
            setSteps((cur) =>
              cur.map((s, i) =>
                i === ev.index
                  ? { ...s, status: "done", message: `${Math.round(ev.elapsedMs)} ms` }
                  : s,
              ),
            );
          } else if (ev.type === "step-error") {
            setSteps((cur) =>
              cur.map((s, i) => (i === ev.index ? { ...s, status: "error", message: ev.error } : s)),
            );
          }
        },
      });
      setResultBytes(res.bytes);
      toast.success("Workflow complete.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }, [file, steps]);

  const downloadResult = () => {
    if (!resultBytes) return;
    const base = file?.name.replace(/\.pdf$/i, "") ?? "workflow-output";
    downloadBytes(resultBytes, `${base}-workflow.pdf`);
  };

  /* -------- Render -------- */
  return (
    <div className="flex flex-col gap-3">
      {/* Top: name + actions */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2.5">
        <div className="flex items-center gap-2">
          <WorkflowIcon className="h-4 w-4 text-vault" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 flex-1 text-[12px]"
            placeholder="Workflow name"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 flex-1 bg-vault text-white hover:bg-vault/90"
            onClick={runWorkflow}
            disabled={running || !file || steps.length === 0}
          >
            {running ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1 h-3.5 w-3.5" />
            )}
            Run
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={saveWorkflow}>
            <Save className="mr-1 h-3.5 w-3.5" />
            Save
          </Button>
        </div>
        {!file && (
          <p className="text-[11px] leading-snug text-text-muted">
            Open a PDF to run the workflow.
          </p>
        )}
      </div>

      {/* Palette */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
            Operations
          </span>
          <span className="text-[10.5px] text-text-muted">Drag into sequence ↓</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {PALETTE.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.op}
                draggable
                onDragStart={onPaletteDragStart(p.op)}
                onDoubleClick={() => onDropAt(steps.length)({ preventDefault: () => {} } as unknown as React.DragEvent)}
                className="group flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-left text-[11.5px] text-text transition hover:border-vault/40 hover:bg-surface-2"
                title={`${p.blurb} — drag into the sequence or double-click to append`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-vault" />
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Sequence */}
      <section
        className="flex min-h-[120px] flex-col gap-1.5 rounded-md border border-dashed border-border bg-surface-1/40 p-2"
        onDragOver={allowDrop}
        onDrop={onDropAt(steps.length)}
      >
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
            Sequence
          </span>
          <span className="text-[10.5px] text-text-muted">{steps.length} step{steps.length === 1 ? "" : "s"}</span>
        </div>

        {steps.length === 0 && (
          <div className="grid flex-1 place-items-center px-2 py-6 text-center text-[11.5px] text-text-muted">
            <div className="flex flex-col items-center gap-1">
              <Plus className="h-4 w-4" />
              Drop operations here to build your pipeline.
            </div>
          </div>
        )}

        {steps.map((s, i) => (
          <div key={s.uid}>
            {/* Drop zone above each step */}
            <div
              onDragOver={allowDrop}
              onDrop={onDropAt(i)}
              className="h-1.5"
            />
            <StepCard
              step={s}
              index={i}
              selected={selectedUid === s.uid}
              onSelect={() => setSelectedUid(s.uid)}
              onRemove={() => removeStep(s.uid)}
              onDragStart={onReorderDragStart(i)}
            />
            {/* Connector arrow */}
            {i < steps.length - 1 && (
              <div className="my-0.5 flex h-3 items-center justify-center text-text-muted">
                <div className="h-3 w-px bg-border" />
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Inspector */}
      {selected && (
        <section className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
              Step parameters
            </span>
            <span className="text-[11px] text-text">{paletteFor(selected.op)?.label ?? selected.op}</span>
          </div>
          <StepParamsEditor
            step={selected}
            onChange={(patch) => updateParams(selected.uid, patch)}
          />
        </section>
      )}

      {/* Result */}
      {resultBytes && (
        <div className="flex items-center justify-between rounded-md border border-vault/30 bg-vault/5 px-2.5 py-2 text-[11.5px] text-text">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-vault" />
            Output ready ({(resultBytes.byteLength / 1024).toFixed(1)} KB)
          </span>
          <Button size="sm" variant="outline" className="h-7" onClick={downloadResult}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Download
          </Button>
        </div>
      )}

      <p className="text-[10.5px] leading-snug text-text-muted">
        Runs on-device in a Web Worker via the shared automation engine.
        Output uses the same verified export path as manual tools.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Step card                                                            */
/* -------------------------------------------------------------------- */

function StepCard({
  step,
  index,
  selected,
  onSelect,
  onRemove,
  onDragStart,
}: {
  step: UiStep;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const def = paletteFor(step.op);
  const Icon = def?.icon ?? Sparkles;
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-2 rounded-md border bg-surface-1 px-2 py-1.5 transition",
        selected ? "border-vault/60 ring-1 ring-vault/30" : "border-border hover:border-vault/30",
      )}
    >
      <span
        draggable
        onDragStart={onDragStart}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab text-text-muted hover:text-text"
        title="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-vault/10 text-vault">
        <Icon className="h-3 w-3" />
      </span>
      <span className="flex flex-1 flex-col overflow-hidden">
        <span className="truncate text-[12px] text-text">
          {index + 1}. {def?.label ?? step.op}
        </span>
        {step.message && (
          <span
            className={cn(
              "truncate text-[10.5px]",
              step.status === "error" ? "text-red-400" : "text-text-muted",
            )}
          >
            {step.message}
          </span>
        )}
      </span>
      <StatusDot status={step.status} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="rounded p-0.5 text-text-muted opacity-0 transition hover:bg-surface-2 hover:text-text group-hover:opacity-100"
        aria-label="Remove step"
        title="Remove"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function StatusDot({ status }: { status: StepStatus }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-vault" />;
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-vault" />;
  if (status === "error") return <AlertTriangle className="h-3.5 w-3.5 text-red-400" />;
  return <Circle className="h-3.5 w-3.5 text-text-muted/40" />;
}

/* -------------------------------------------------------------------- */
/* Params editor                                                        */
/* -------------------------------------------------------------------- */

function StepParamsEditor({
  step,
  onChange,
}: {
  step: UiStep;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const p = step.params as Record<string, unknown>;
  const str = (k: string) => (p[k] as string | undefined) ?? "";
  const num = (k: string) => Number((p[k] as number | undefined) ?? 0);

  switch (step.op) {
    case "sanitize":
      return (
        <p className="text-[11.5px] text-text-muted">
          Strips document metadata, XMP, and embedded JavaScript. No parameters.
        </p>
      );

    case "bates":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Prefix">
            <Input className="h-7 text-[12px]" value={str("prefix")} onChange={(e) => onChange({ prefix: e.target.value })} />
          </Field>
          <Field label="Start at">
            <Input className="h-7 text-[12px]" type="number" value={num("startAt")} onChange={(e) => onChange({ startAt: Number(e.target.value) })} />
          </Field>
          <Field label="Digits">
            <Input className="h-7 text-[12px]" type="number" min={1} max={10} value={num("digits")} onChange={(e) => onChange({ digits: Number(e.target.value) })} />
          </Field>
          <Field label="Position">
            <Select value={str("position") || "br"} onValueChange={(v) => onChange({ position: v })}>
              <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[["tl","Top left"],["tc","Top center"],["tr","Top right"],["bl","Bottom left"],["bc","Bottom center"],["br","Bottom right"]].map(([v,l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      );

    case "page-numbers":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Anchor">
            <Select value={str("anchor") || "bottom-center"} onValueChange={(v) => onChange({ anchor: v })}>
              <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["top-left","top-center","top-right","bottom-left","bottom-center","bottom-right"].map(v => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Format">
            <Select value={str("format") || "n-of-m"} onValueChange={(v) => onChange({ format: v })}>
              <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="n">1, 2, 3</SelectItem>
                <SelectItem value="page-n">Page N</SelectItem>
                <SelectItem value="n-of-m">N of M</SelectItem>
                <SelectItem value="roman">i, ii, iii</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start at">
            <Input className="h-7 text-[12px]" type="number" value={num("startAt")} onChange={(e) => onChange({ startAt: Number(e.target.value) })} />
          </Field>
          <Field label="Skip first">
            <Input className="h-7 text-[12px]" type="number" value={num("skipFirst")} onChange={(e) => onChange({ skipFirst: Number(e.target.value) })} />
          </Field>
        </div>
      );

    case "header-footer":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Header text">
            <Input className="h-7 text-[12px]" value={str("headerText")} onChange={(e) => onChange({ headerText: e.target.value })} />
          </Field>
          <Field label="Footer text">
            <Input className="h-7 text-[12px]" value={str("footerText")} onChange={(e) => onChange({ footerText: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Align">
              <Select value={str("align") || "center"} onValueChange={(v) => onChange({ align: v })}>
                <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Rule">
              <Select value={str("rule") || "all"} onValueChange={(v) => onChange({ rule: v })}>
                <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All pages</SelectItem>
                  <SelectItem value="odd">Odd</SelectItem>
                  <SelectItem value="even">Even</SelectItem>
                  <SelectItem value="no-first">Skip first</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
      );

    case "watermark":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Text">
            <Input className="h-7 text-[12px]" value={str("text")} onChange={(e) => onChange({ text: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Opacity (%)">
              <Input className="h-7 text-[12px]" type="number" min={5} max={100} value={num("opacity")} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
            </Field>
            <Field label="Size (pt)">
              <Input className="h-7 text-[12px]" type="number" min={12} max={160} value={num("size")} onChange={(e) => onChange({ size: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Position">
            <Select value={str("pos") || "diagonal"} onValueChange={(v) => onChange({ pos: v })}>
              <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="diagonal">Diagonal</SelectItem>
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
                <SelectItem value="center">Center</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      );

    case "rotate":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Angle">
            <Select value={String(num("angle") || 90)} onValueChange={(v) => onChange({ angle: Number(v) })}>
              <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="90">90°</SelectItem>
                <SelectItem value="180">180°</SelectItem>
                <SelectItem value="270">270°</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Scope">
            <Select value={str("scope") || "all"} onValueChange={(v) => onChange({ scope: v })}>
              <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pages</SelectItem>
                <SelectItem value="odd">Odd</SelectItem>
                <SelectItem value="even">Even</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      );

    case "compress":
      return (
        <Field label="Preset">
          <Select value={str("preset") || "medium"} onValueChange={(v) => onChange({ preset: v })}>
            <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="extreme">Extreme</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      );

    case "flatten":
      return (
        <div className="flex flex-col gap-1.5 text-[11.5px] text-text">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!p.forms} onChange={(e) => onChange({ forms: e.target.checked })} />
            Flatten form fields
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!p.annotations} onChange={(e) => onChange({ annotations: e.target.checked })} />
            Flatten annotations
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!p.clearSensitiveFirst} onChange={(e) => onChange({ clearSensitiveFirst: e.target.checked })} />
            Clear sensitive values first (safety-gated)
          </label>
        </div>
      );

    case "extract-pages":
      return (
        <Field label="Ranges (e.g. 1-3, 5, 8-10)">
          <Input className="h-7 text-[12px]" value={str("ranges")} onChange={(e) => onChange({ ranges: e.target.value })} />
        </Field>
      );

    default:
      return <p className="text-[11.5px] text-text-muted">No parameters.</p>;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10.5px] uppercase tracking-wide text-text-muted">{label}</Label>
      {children}
    </div>
  );
}

/* Silence unused import warning — LockBadge is exported for parity but not
 * used inside this panel body (the Pro gate uses its own lock). */
void LockBadge;
