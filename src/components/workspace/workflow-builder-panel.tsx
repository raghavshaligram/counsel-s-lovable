/**
 * Workflow Builder — visual pipeline authoring on top of the existing
 * automation engine (src/lib/automation). Pro-gated.
 *
 * Presentation: launched from the Legal rail. The inspector panel shows
 * a small launcher; the actual builder opens in a wide modal with three
 * regions — LEFT palette, CENTER sequence canvas, RIGHT step inspector —
 * because a cramped side panel can't host a drag/drop workflow surface.
 *
 * Does NOT touch the PDF viewer, tab lifecycle, editor-canvas, or the
 * open path. Reuses OPS registry + runPipeline verbatim.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
  ScanText,
  Eye,
  FileCheck2,
  Combine,
  SplitSquareVertical,
  Search,
  Gavel,
  Ban,
  FolderOpen,
  BookTemplate,
  Trash2,
  Pencil,
  Check,
  FileUp,
  FileIcon,
  Files,
  FileArchive,
} from "lucide-react";
import { toast } from "sonner";
import { zipSync, type Zippable } from "fflate";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIsPro, useRequirePro, LockBadge } from "@/lib/pro-gate";

import type { Pipeline, PipelineStep, ProgressEvent } from "@/lib/automation/types";
import { runPipeline, downloadBytes } from "@/lib/automation";
import {
  CONDITION_LABELS,
  CONDITION_SHORT,
  type ConditionKind,
  type StepCondition,
} from "@/lib/automation/conditions";
import {
  listWorkflows,
  saveWorkflow as saveWorkflowFn,
  renameWorkflow as renameWorkflowFn,
  deleteWorkflow as deleteWorkflowFn,
  type SavedWorkflow,
} from "@/lib/workflows.functions";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "@/lib/workflow-templates";

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
  /** If set, the op is visible in the palette but cannot be dragged in.
   *  Explains why (manual-only, multi-file, DOM-only, etc.). */
  unavailable?: string;
};

type PaletteGroup = {
  category: string;
  ops: OpDef[];
};

const PALETTE_GROUPS: PaletteGroup[] = [
  {
    category: "Document",
    ops: [
      {
        op: "rotate",
        label: "Rotate pages",
        icon: RotateCw,
        blurb: "Rotate all/odd/even pages.",
        defaults: { angle: 90, scope: "all" },
      },
      {
        op: "extract-pages",
        label: "Extract pages",
        icon: Scissors,
        blurb: "Keep only a range (e.g. 1-5, 8, 12-15).",
        defaults: { ranges: "1-1" },
      },
      {
        op: "split",
        label: "Split into files",
        icon: SplitSquareVertical,
        blurb: "Produces multiple PDFs — run from the Split tool.",
        defaults: {},
        unavailable: "Split produces many outputs; workflows are single-output. Use the Split tool.",
      },
      {
        op: "merge",
        label: "Merge / combine",
        icon: Combine,
        blurb: "Combine multiple PDFs — needs more than one input.",
        defaults: {},
        unavailable: "Merge needs multiple input files; workflows run on a single open PDF.",
      },
    ],
  },
  {
    category: "Layout",
    ops: [
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
    ],
  },
  {
    category: "Redaction",
    ops: [
      {
        op: "redact-pattern",
        label: "Pattern / bulk redact",
        icon: Ban,
        blurb: "Keyword or regex redaction — verified burn + gate.",
        defaults: {
          query: "",
          matchCase: false,
          wholeWord: true,
          regex: false,
          scope: "word",
          ocr: false,
        },
      },
      {
        op: "redact-manual",
        label: "Manual redaction",
        icon: Ban,
        blurb: "Draw redaction boxes by hand.",
        defaults: {},
        unavailable: "Manual redaction requires drawing boxes — not workflow-eligible. Use pattern/AI redaction.",
      },
    ],
  },
  {
    category: "Discovery",
    ops: [
      {
        op: "ai-detect",
        label: "AI detect sensitive",
        icon: Sparkles,
        blurb: "Find PII with pattern + NER.",
        defaults: {},
        unavailable: "AI detection surfaces findings for review, not bytes — runs from the Redact tool.",
      },
      {
        op: "privilege-scan",
        label: "Privilege scan",
        icon: Gavel,
        blurb: "Attorney-client / work-product keyword scan.",
        defaults: {},
        unavailable: "Privilege scan produces a report, not a modified PDF.",
      },
      {
        op: "keyword-search",
        label: "Keyword search",
        icon: Search,
        blurb: "Locate keywords across the document.",
        defaults: {},
        unavailable: "Search returns hits for review, not a modified PDF.",
      },
    ],
  },
  {
    category: "Convert",
    ops: [
      {
        op: "ocr",
        label: "OCR (text layer)",
        icon: ScanText,
        blurb: "Recognise text on scanned pages (main-thread step).",
        defaults: { languages: ["eng"], highAccuracy: false },
      },
      {
        op: "to-pdfa",
        label: "Convert to PDF/A-2b",
        icon: FileCheck2,
        blurb: "Always outputs PDF/A-2b archival format (independent of the workspace export dropdown). Place as the last step.",
        defaults: {},
      },
      {
        op: "compress",
        label: "Compress",
        icon: PackageOpen,
        blurb: "Structural or rasterised compression.",
        defaults: { preset: "medium" },
      },
    ],
  },
  {
    category: "Secure",
    ops: [
      {
        op: "sanitize",
        label: "Sanitize / strip metadata",
        icon: ShieldCheck,
        blurb: "Strip metadata, XMP, and JavaScript.",
        defaults: {},
      },
      {
        op: "flatten",
        label: "Flatten forms",
        icon: Layers,
        blurb: "Bake form values into page content (safety-gated).",
        defaults: { forms: true, annotations: false, clearSensitiveFirst: false },
      },
      {
        op: "protect",
        label: "Password protect",
        icon: Eye,
        blurb: "Encrypt with password + permissions.",
        defaults: {
          userPassword: "",
          ownerPassword: "",
          permissions: {
            printing: true,
            modifying: false,
            copying: false,
            annotating: true,
            fillingForms: true,
            contentAccessibility: true,
            documentAssembly: false,
          },
        },
      },
      {
        op: "unlock",
        label: "Unlock password",
        icon: Eye,
        blurb: "Remove encryption (password required if set).",
        defaults: { password: "" },
      },
      {
        op: "repair",
        label: "Repair",
        icon: ShieldCheck,
        blurb: "Rebuild damaged/truncated PDFs (pdf-lib → pdf.js → qpdf).",
        defaults: {},
      },
    ],
  },
];

const PALETTE: OpDef[] = PALETTE_GROUPS.flatMap((g) => g.ops);

function paletteFor(op: string): OpDef | undefined {
  return PALETTE.find((p) => p.op === op);
}

/* -------------------------------------------------------------------- */
/* Types                                                                */
/* -------------------------------------------------------------------- */

type StepStatus = "idle" | "running" | "done" | "error" | "skipped";

type UiStep = PipelineStep & {
  uid: string;
  status: StepStatus;
  message?: string;
};

let uidSeq = 0;
const nextUid = () => `ws-${++uidSeq}-${Date.now()}`;

/* -------------------------------------------------------------------- */
/* Inspector-side launcher                                              */
/* -------------------------------------------------------------------- */

export function WorkflowBuilderPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const isPro = useIsPro();
  const requirePro = useRequirePro();
  const [open, setOpen] = useState(false);

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

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-surface-2 p-3 text-[12px] leading-snug text-text">
        <div className="mb-2 flex items-center gap-2 text-vault">
          <WorkflowIcon className="h-4 w-4" />
          <span className="font-medium">Workflow Builder</span>
        </div>
        <p className="text-text-muted">
          Compose OCR, Bates, sanitize, watermark, compress and more into a
          reusable, on-device pipeline. Opens in a full workspace with a
          palette, sequence canvas, and step inspector.
        </p>
      </div>
      <Button
        size="sm"
        className="bg-vault text-white hover:bg-vault/90"
        onClick={() => setOpen(true)}
      >
        <WorkflowIcon className="mr-1 h-3.5 w-3.5" />
        Open Workflow Builder
      </Button>

      <WorkflowBuilderModal open={open} onOpenChange={setOpen} ctx={ctx} />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Modal — full 3-column builder                                        */
/* -------------------------------------------------------------------- */

function WorkflowBuilderModal({
  open,
  onOpenChange,
  ctx,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: ToolPanelCtx;
}) {
  const { file: currentFile } = ctx;

  // Run mode: single file (current or picked) vs batch (many files, sequential).
  const [mode, setMode] = useState<"single" | "batch">("single");

  // Single-file source override: when the user picks/drops a file inside the
  // builder, it takes precedence over the currently open document.
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const activeFile = pickedFile ?? currentFile ?? null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOverFile, setDragOverFile] = useState(false);

  const acceptPickedFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      toast.error("Please choose a PDF file.");
      return;
    }
    setPickedFile(f);
    toast.success(`Using ${f.name}`);
  }, []);

  // Batch source state (queue of files) + per-file result rows.
  type BatchRow = {
    id: string;
    name: string;
    size: number;
    status: "queued" | "processing" | "done" | "failed";
    outName?: string;
    bytes?: Uint8Array;
    error?: string;
    elapsedMs?: number;
  };
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchIndex, setBatchIndex] = useState<number>(-1);
  const [batchRunning, setBatchRunning] = useState(false);
  const [outputNameMode, setOutputNameMode] = useState<"suffix" | "keep">("suffix");
  const [outputSuffix, setOutputSuffix] = useState<string>("-processed");
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const batchAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const acceptBatchFiles = useCallback((files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const arr = Array.from(files).filter(
      (f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf",
    );
    if (arr.length === 0) {
      toast.error("No PDFs found in that selection.");
      return;
    }
    setBatchFiles((cur) => {
      // De-dupe by name+size to avoid accidental double-drops.
      const key = (f: File) => `${f.name}::${f.size}`;
      const existing = new Set(cur.map(key));
      const merged = [...cur];
      for (const f of arr) if (!existing.has(key(f))) merged.push(f);
      return merged;
    });
    toast.success(`Added ${arr.length} PDF${arr.length === 1 ? "" : "s"}`);
  }, []);

  const removeBatchFile = (idx: number) => {
    setBatchFiles((cur) => cur.filter((_, i) => i !== idx));
    setBatchRows((cur) => cur.filter((_, i) => i !== idx));
  };
  const clearBatch = () => {
    setBatchFiles([]);
    setBatchRows([]);
    setBatchIndex(-1);
  };


  const [name, setName] = useState("Untitled workflow");
  const [steps, setSteps] = useState<UiStep[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [resultBytes, setResultBytes] = useState<Uint8Array | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedWorkflow[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savingNow, setSavingNow] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const dragKind = useRef<"palette" | "reorder" | null>(null);
  const dragOp = useRef<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  const listWorkflowsFn = useServerFn(listWorkflows);
  const saveFn = useServerFn(saveWorkflowFn);
  const renameFn = useServerFn(renameWorkflowFn);
  const deleteFn = useServerFn(deleteWorkflowFn);

  const selected = useMemo(
    () => (selectedUid ? steps.find((s) => s.uid === selectedUid) ?? null : null),
    [selectedUid, steps],
  );

  const refreshSaved = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const rows = await listWorkflowsFn();
      setSaved(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Could not load saved workflows: ${msg}`);
    } finally {
      setLoadingSaved(false);
    }
  }, [listWorkflowsFn]);

  // Fetch on modal open.
  useEffect(() => {
    if (!open) return;
    void refreshSaved();
  }, [open, refreshSaved]);

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
  const updateCondition = (uid: string, condition: StepCondition | undefined) => {
    setSteps((cur) =>
      cur.map((s) => (s.uid === uid ? { ...s, condition } : s)),
    );
  };

  /* -------- Load (from saved or template) -------- */
  const loadSteps = useCallback((wfName: string, pipelineSteps: PipelineStep[], id: string | null) => {
    setName(wfName);
    setSavedId(id);
    setResultBytes(null);
    const ui: UiStep[] = pipelineSteps.map((s) => ({
      uid: nextUid(),
      op: s.op,
      label: s.label,
      params: (s.params ?? {}) as Record<string, unknown>,
      condition: s.condition,
      status: "idle",
    }));
    setSteps(ui);
    setSelectedUid(ui[0]?.uid ?? null);
  }, []);

  const loadSaved = (wf: SavedWorkflow) => {
    loadSteps(wf.name, wf.steps as PipelineStep[], wf.id);
    setLibraryOpen(false);
    toast.success(`Loaded “${wf.name}”`);
  };

  const loadTemplate = (tpl: WorkflowTemplate) => {
    // Start from template as a new (unsaved) workflow so "Save" creates a personal copy.
    loadSteps(tpl.name, tpl.steps, null);
    setTemplatesOpen(false);
    toast.success(`Template “${tpl.name}” loaded — customize and save.`);
  };

  /* -------- Save (cloud, per-user via RLS) -------- */
  const doSave = useCallback(
    async (opts: { asNew?: boolean } = {}) => {
      const trimmed = name.trim();
      if (!trimmed) {
        toast.error("Give the workflow a name before saving.");
        return;
      }
      if (steps.length === 0) {
        toast.error("Add at least one step before saving.");
        return;
      }
      setSavingNow(true);
      try {
        const cleanSteps = steps.map(({ op, params, label, condition }) => ({
          op,
          params: (params ?? {}) as Record<string, unknown>,
          label,
          condition,
        }));
        const res = await saveFn({
          data: { id: opts.asNew ? null : savedId, name: trimmed, steps: cleanSteps },
        });
        setSavedId(res.id);
        await refreshSaved();
        toast.success(`Saved “${trimmed}”`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Could not save: ${msg}`);
      } finally {
        setSavingNow(false);
      }
    },
    [name, steps, savedId, saveFn, refreshSaved],
  );

  const doRename = async (id: string, next: string) => {
    const trimmed = next.trim();
    if (!trimmed) {
      toast.error("Name cannot be empty.");
      return;
    }
    try {
      await renameFn({ data: { id, name: trimmed } });
      if (savedId === id) setName(trimmed);
      await refreshSaved();
      setRenameId(null);
      toast.success("Renamed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Rename failed: ${msg}`);
    }
  };

  const doDelete = async (id: string, wfName: string) => {
    if (!confirm(`Delete workflow “${wfName}”? This cannot be undone.`)) return;
    try {
      await deleteFn({ data: { id } });
      if (savedId === id) setSavedId(null);
      await refreshSaved();
      toast.success("Deleted.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Delete failed: ${msg}`);
    }
  };



  /* -------- Run -------- */
  const runWorkflow = useCallback(async () => {
    if (!activeFile) {
      toast.error("Add a PDF to run this workflow on.");
      return;
    }
    if (steps.length === 0) {
      toast.error("Drag operations into the sequence first.");
      return;
    }
    setRunning(true);
    setResultBytes(null);
    setSteps((cur) => cur.map((s) => ({ ...s, status: "idle", message: undefined })));

    const pipeline: Pipeline = steps.map(({ op, params, label, condition }) => ({ op, params, label, condition }));
    const bytes = new Uint8Array(await activeFile.arrayBuffer());

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
          } else if (ev.type === "step-progress") {
            setSteps((cur) =>
              cur.map((s, i) => (i === ev.index ? { ...s, status: "running", message: ev.message ?? s.message } : s)),
            );
          } else if (ev.type === "step-skipped") {
            setSteps((cur) =>
              cur.map((s, i) =>
                i === ev.index
                  ? { ...s, status: "skipped", message: `skipped — ${ev.reason}` }
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
  }, [activeFile, steps]);

  const downloadResult = () => {
    if (!resultBytes) return;
    const base = activeFile?.name.replace(/\.pdf$/i, "") ?? "workflow-output";
    downloadBytes(resultBytes, `${base}-workflow.pdf`);
  };

  /* -------- Batch run (sequential, memory-safe) -------- */
  const renameOutput = useCallback(
    (name: string) => {
      const base = name.replace(/\.pdf$/i, "");
      if (outputNameMode === "keep") return `${base}.pdf`;
      const suf = outputSuffix.trim() || "-processed";
      return `${base}${suf}.pdf`;
    },
    [outputNameMode, outputSuffix],
  );

  const runBatch = useCallback(async () => {
    if (batchFiles.length === 0) {
      toast.error("Add at least one PDF to the batch.");
      return;
    }
    if (steps.length === 0) {
      toast.error("Drag operations into the sequence first.");
      return;
    }

    // Reset rows -> all queued, clear any previous output bytes to free memory.
    setBatchRows(
      batchFiles.map((f) => ({
        id: `${f.name}::${f.size}::${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        size: f.size,
        status: "queued",
      })),
    );
    setBatchIndex(-1);
    setBatchRunning(true);
    batchAbortRef.current = { aborted: false };

    const pipeline: Pipeline = steps.map(({ op, params, label, condition }) => ({ op, params, label, condition }));

    // Sequential — one file's bytes in memory at a time. When a file finishes,
    // its input Uint8Array goes out of scope and the browser can reclaim it.
    for (let i = 0; i < batchFiles.length; i++) {
      if (batchAbortRef.current.aborted) break;
      const file = batchFiles[i];
      setBatchIndex(i);
      setBatchRows((cur) =>
        cur.map((r, idx) => (idx === i ? { ...r, status: "processing" } : r)),
      );
      // Reset step statuses so conditional skip states reflect THIS file.
      setSteps((cur) => cur.map((s) => ({ ...s, status: "idle", message: undefined })));

      const tStart = performance.now();
      try {
        // Read bytes lazily per-file so we never hold N inputs at once.
        const bytes = new Uint8Array(await file.arrayBuffer());
        const res = await runPipeline(bytes, pipeline, {
          onProgress: (ev: ProgressEvent) => {
            if (ev.type === "step-start") {
              setSteps((cur) => cur.map((s, si) => (si === ev.index ? { ...s, status: "running", message: undefined } : s)));
            } else if (ev.type === "step-done") {
              setSteps((cur) => cur.map((s, si) => (si === ev.index ? { ...s, status: "done", message: `${Math.round(ev.elapsedMs)} ms` } : s)));
            } else if (ev.type === "step-skipped") {
              setSteps((cur) => cur.map((s, si) => (si === ev.index ? { ...s, status: "skipped", message: `skipped — ${ev.reason}` } : s)));
            } else if (ev.type === "step-error") {
              setSteps((cur) => cur.map((s, si) => (si === ev.index ? { ...s, status: "error", message: ev.error } : s)));
            }
          },
        });
        const elapsed = performance.now() - tStart;
        setBatchRows((cur) =>
          cur.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: "done",
                  bytes: res.bytes,
                  outName: renameOutput(file.name),
                  elapsedMs: elapsed,
                }
              : r,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setBatchRows((cur) =>
          cur.map((r, idx) =>
            idx === i ? { ...r, status: "failed", error: msg } : r,
          ),
        );
      }
      // Yield to the event loop so the UI stays responsive between files.
      await new Promise((r) => setTimeout(r, 0));
    }

    setBatchIndex(-1);
    setBatchRunning(false);
    toast.success("Batch complete.");
  }, [batchFiles, steps, renameOutput]);

  const cancelBatch = () => {
    batchAbortRef.current.aborted = true;
    toast.message("Batch will stop after the current file.");
  };

  const downloadBatchRow = (row: BatchRow) => {
    if (row.status !== "done" || !row.bytes || !row.outName) return;
    downloadBytes(row.bytes, row.outName);
  };

  const downloadBatchZip = () => {
    const done = batchRows.filter((r) => r.status === "done" && r.bytes && r.outName);
    if (done.length === 0) {
      toast.error("Nothing to download yet.");
      return;
    }
    const z: Zippable = {};
    for (const r of done) {
      let name = r.outName!;
      let n = 2;
      while (z[name]) {
        name = r.outName!.replace(/(\.pdf)?$/i, `-${n}$1`);
        n++;
      }
      z[name] = r.bytes!;
    }
    const zipped = zipSync(z, { level: 6 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name.trim() || "workflow").replace(/[^\w-]+/g, "_") || "workflow"}-${stamp}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const batchStats = useMemo(() => {
    const done = batchRows.filter((r) => r.status === "done").length;
    const failed = batchRows.filter((r) => r.status === "failed").length;
    const processing = batchRows.filter((r) => r.status === "processing").length;
    return { done, failed, processing, total: batchRows.length };
  }, [batchRows]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[88vh] max-h-[88vh] w-[96vw] max-w-[1280px] flex-col gap-0 overflow-hidden p-0",
          "border-border bg-surface-1 text-text sm:rounded-lg",
          "[&>button:last-of-type]:hidden",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-3">
          <WorkflowIcon className="h-4 w-4 shrink-0 text-vault" />
          <DialogTitle className="sr-only">Workflow Builder</DialogTitle>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 max-w-[320px] text-[13px]"
            placeholder="Workflow name"
          />
          <div className="ml-auto flex items-center gap-2">
            {/* Run-mode toggle */}
            <div className="flex items-center rounded-md border border-border bg-surface-1 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMode("single")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 transition",
                  mode === "single"
                    ? "bg-vault/15 text-text"
                    : "text-text-muted hover:text-text",
                )}
                title="Run on a single file"
              >
                <FileIcon className="h-3 w-3" />
                Single
              </button>
              <button
                type="button"
                onClick={() => setMode("batch")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 transition",
                  mode === "batch"
                    ? "bg-vault/15 text-text"
                    : "text-text-muted hover:text-text",
                )}
                title="Run the workflow on many files sequentially"
              >
                <Files className="h-3 w-3" />
                Batch
              </button>
            </div>

            {mode === "single" ? (
              <FileSourcePicker
                activeFile={activeFile}
                currentFile={currentFile ?? null}
                pickedFile={pickedFile}
                onPick={acceptPickedFile}
                onClearOverride={() => setPickedFile(null)}
                onUseCurrent={() => setPickedFile(null)}
                fileInputRef={fileInputRef}
                dragOver={dragOverFile}
                setDragOver={setDragOverFile}
              />
            ) : (
              <BatchSourcePicker
                fileCount={batchFiles.length}
                doneCount={batchStats.done}
                failedCount={batchStats.failed}
                running={batchRunning}
                onPick={acceptBatchFiles}
                onClear={clearBatch}
                inputRef={batchInputRef}
              />
            )}





            {/* Templates */}
            <Popover open={templatesOpen} onOpenChange={setTemplatesOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 px-2.5 text-text-muted hover:text-text"
                >
                  <BookTemplate className="h-4 w-4" />
                  Templates
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[340px] p-0">
                <div className="border-b border-border px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
                  Legal starter templates
                </div>
                <div className="max-h-[360px] overflow-y-auto p-1.5">
                  {WORKFLOW_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => loadTemplate(tpl)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-2"
                    >
                      <span className="text-[12.5px] font-medium text-text">{tpl.name}</span>
                      <span className="text-[10.5px] leading-snug text-text-muted">
                        {tpl.description}
                      </span>
                      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-text-muted/70">
                        {tpl.steps.length} step{tpl.steps.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* My workflows */}
            <Popover open={libraryOpen} onOpenChange={setLibraryOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 px-2.5 text-text-muted hover:text-text"
                >
                  <FolderOpen className="h-4 w-4" />
                  My workflows
                  {saved.length > 0 && (
                    <span className="ml-0.5 rounded bg-surface-1 px-1 text-[10px] text-text-muted">
                      {saved.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[360px] p-0">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
                    Saved (syncs across devices)
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshSaved()}
                    className="text-[10.5px] text-text-muted hover:text-text"
                    disabled={loadingSaved}
                  >
                    {loadingSaved ? "Loading…" : "Refresh"}
                  </button>
                </div>
                <div className="max-h-[360px] overflow-y-auto p-1.5">
                  {loadingSaved && saved.length === 0 ? (
                    <div className="grid place-items-center py-6 text-[11.5px] text-text-muted">
                      <Loader2 className="mb-1 h-4 w-4 animate-spin" />
                      Loading…
                    </div>
                  ) : saved.length === 0 ? (
                    <div className="px-2.5 py-4 text-[11.5px] leading-snug text-text-muted">
                      No saved workflows yet. Build a pipeline and click Save.
                    </div>
                  ) : (
                    saved.map((wf) => (
                      <div
                        key={wf.id}
                        className={cn(
                          "flex items-center gap-1 rounded-md px-1.5 py-1.5 hover:bg-surface-2",
                          savedId === wf.id && "bg-surface-2/60",
                        )}
                      >
                        {renameId === wf.id ? (
                          <>
                            <Input
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void doRename(wf.id, renameDraft);
                                if (e.key === "Escape") setRenameId(null);
                              }}
                              autoFocus
                              className="h-7 flex-1 text-[12px]"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => void doRename(wf.id, renameDraft)}
                              aria-label="Confirm rename"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => setRenameId(null)}
                              aria-label="Cancel rename"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => loadSaved(wf)}
                              className="flex min-w-0 flex-1 flex-col items-start px-1.5 py-0.5 text-left"
                              title="Load into builder"
                            >
                              <span className="truncate text-[12.5px] text-text">{wf.name}</span>
                              <span className="text-[10px] text-text-muted">
                                {wf.steps.length} step{wf.steps.length === 1 ? "" : "s"} · updated{" "}
                                {new Date(wf.updatedAt).toLocaleDateString()}
                              </span>
                            </button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-text-muted hover:text-text"
                              onClick={() => {
                                setRenameId(wf.id);
                                setRenameDraft(wf.name);
                              }}
                              aria-label="Rename"
                              title="Rename"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-text-muted hover:text-danger"
                              onClick={() => void doDelete(wf.id, wf.name)}
                              aria-label="Delete"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <div className="mx-0.5 h-4 w-px bg-border" />

            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2.5 text-text-muted hover:text-text"
              onClick={() => void doSave()}
              disabled={savingNow || steps.length === 0}
              title={savedId ? "Update this workflow" : "Save workflow to your library"}
            >
              {savingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savedId ? "Save" : "Save"}
            </Button>
            {savedId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 px-2.5 text-text-muted hover:text-text"
                onClick={() => void doSave({ asNew: true })}
                disabled={savingNow || steps.length === 0}
                title="Save as a new workflow"
              >
                Save as…
              </Button>
            )}
            {mode === "batch" && batchRunning ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-3"
                onClick={cancelBatch}
              >
                <X className="h-4 w-4" />
                Stop after current
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-vault px-3 text-white hover:bg-vault/90"
                onClick={mode === "batch" ? runBatch : runWorkflow}
                disabled={
                  mode === "batch"
                    ? batchRunning || batchFiles.length === 0 || steps.length === 0
                    : running || !activeFile || steps.length === 0
                }
                title={
                  mode === "batch"
                    ? `Run the workflow on ${batchFiles.length} file${batchFiles.length === 1 ? "" : "s"}`
                    : "Run the workflow on the selected file"
                }
              >
                {running || batchRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {mode === "batch" ? `Run batch (${batchFiles.length})` : "Run"}
              </Button>
            )}
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-text-muted hover:text-text"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>


        {/* Body — three columns */}
        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_320px]">
          {/* LEFT — palette */}
          <aside className="flex min-h-0 flex-col border-r border-border bg-surface-2/40">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
                Operations
              </span>
              <span className="text-[10.5px] text-text-muted">Drag →</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <div className="flex flex-col gap-3">
                {PALETTE_GROUPS.map((group) => (
                  <div key={group.category} className="flex flex-col gap-1">
                    <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted/80">
                      {group.category}
                    </div>
                    <div className="flex flex-col gap-1">
                      {group.ops.map((p) => {
                        const Icon = p.icon;
                        const disabled = !!p.unavailable;
                        return (
                          <button
                            key={p.op}
                            draggable={!disabled}
                            disabled={disabled}
                            onDragStart={disabled ? undefined : onPaletteDragStart(p.op)}
                            onDoubleClick={
                              disabled
                                ? undefined
                                : () =>
                                    onDropAt(steps.length)({
                                      preventDefault: () => {},
                                    } as unknown as React.DragEvent)
                            }
                            className={cn(
                              "group flex items-start gap-2 rounded-md border px-2 py-2 text-left transition",
                              disabled
                                ? "cursor-not-allowed border-dashed border-border/60 bg-surface-1/40 opacity-60"
                                : "cursor-grab border-border bg-surface-1 hover:border-vault/40 hover:bg-surface-2",
                            )}
                            title={
                              disabled
                                ? `Not workflow-eligible — ${p.unavailable}`
                                : `${p.blurb} — drag into the sequence or double-click to append`
                            }
                          >
                            <span
                              className={cn(
                                "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded",
                                disabled ? "bg-surface-2 text-text-muted" : "bg-vault/10 text-vault",
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[12px] text-text">{p.label}</span>
                                {disabled && (
                                  <span className="shrink-0 rounded-sm border border-border px-1 text-[9px] uppercase tracking-wide text-text-muted">
                                    n/a
                                  </span>
                                )}
                              </span>
                              <span className="truncate text-[10.5px] text-text-muted">
                                {disabled ? p.unavailable : p.blurb}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>


          {/* CENTER — sequence canvas */}
          <main
            className="flex min-h-0 flex-col bg-surface-1"
            onDragOver={allowDrop}
            onDrop={onDropAt(steps.length)}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
                Sequence
              </span>
              <span className="text-[10.5px] text-text-muted">
                {steps.length} step{steps.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {steps.length === 0 ? (
                <div className="grid h-full min-h-[240px] place-items-center rounded-lg border border-dashed border-border bg-surface-2/30 px-6 py-12 text-center text-[12.5px] text-text-muted">
                  <div className="flex flex-col items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Drag operations from the left into this canvas to build your pipeline.
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex max-w-[520px] flex-col">
                  {steps.map((s, i) => (
                    <div key={s.uid}>
                      <div
                        onDragOver={allowDrop}
                        onDrop={onDropAt(i)}
                        className="my-0.5 h-3 rounded border border-dashed border-transparent transition hover:border-vault/40 data-[active=true]:border-vault/60"
                        data-active={false}
                        aria-label={`Drop above step ${i + 1}`}
                      />
                      <StepCard
                        step={s}
                        index={i}
                        selected={selectedUid === s.uid}
                        onSelect={() => setSelectedUid(s.uid)}
                        onRemove={() => removeStep(s.uid)}
                        onDragStart={onReorderDragStart(i)}
                      />
                    </div>
                  ))}
                  {/* trailing drop target */}
                  <div
                    onDragOver={allowDrop}
                    onDrop={onDropAt(steps.length)}
                    className="mt-2 grid h-8 place-items-center rounded border border-dashed border-border/60 text-[10.5px] text-text-muted/70 transition hover:border-vault/40 hover:text-text-muted"
                  >
                    Drop here to append
                  </div>
                </div>
              )}

            </div>

            {mode === "single" && resultBytes && (
              <div className="flex items-center justify-between border-t border-border bg-vault/5 px-4 py-2.5 text-[12px] text-text">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-vault" />
                  Output ready ({(resultBytes.byteLength / 1024).toFixed(1)} KB)
                </span>
                <Button size="sm" variant="outline" className="h-7" onClick={downloadResult}>
                  <Download className="mr-1 h-3.5 w-3.5" />
                  Download
                </Button>
              </div>
            )}

            {mode === "batch" && batchRows.length > 0 && (
              <BatchProgressPanel
                rows={batchRows}
                current={batchIndex}
                running={batchRunning}
                stats={batchStats}
                outputNameMode={outputNameMode}
                setOutputNameMode={setOutputNameMode}
                outputSuffix={outputSuffix}
                setOutputSuffix={setOutputSuffix}
                onDownload={downloadBatchRow}
                onDownloadZip={downloadBatchZip}
                onRemove={removeBatchFile}
                onClear={clearBatch}
              />
            )}
          </main>

          {/* RIGHT — step inspector */}
          <aside className="flex min-h-0 flex-col border-l border-border bg-surface-2/40">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">
                Step parameters
              </span>
              {selected && (
                <span className="truncate text-[11px] text-text">
                  {paletteFor(selected.op)?.label ?? selected.op}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {selected ? (
                <div className="flex flex-col gap-3">
                  <ConditionEditor
                    condition={selected.condition}
                    onChange={(c) => updateCondition(selected.uid, c)}
                  />
                  <div className="border-t border-border pt-3">
                    <StepParamsEditor
                      step={selected}
                      onChange={(patch) => updateParams(selected.uid, patch)}
                    />
                  </div>
                </div>
              ) : (
                <p className="px-1 text-[11.5px] leading-snug text-text-muted">
                  Select a step in the sequence to edit its parameters.
                </p>
              )}
              <p className="mt-4 border-t border-border pt-3 text-[10.5px] leading-snug text-text-muted">
                Runs on-device in a Web Worker via the shared automation engine.
                Output uses the same verified export path as manual tools.
              </p>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
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
        "group flex items-center gap-2 rounded-md border bg-surface-1 px-2.5 py-2 transition",
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
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-vault/10 text-vault">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex flex-1 flex-col overflow-hidden">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] text-text">
            {index + 1}. {def?.label ?? step.op}
          </span>
          {step.condition && step.condition.kind !== "always" && (
            <span
              className="shrink-0 rounded-sm border border-vault/50 bg-vault/10 px-1 text-[9px] uppercase tracking-wide text-vault"
              title={CONDITION_LABELS[step.condition.kind]}
            >
              {CONDITION_SHORT[step.condition.kind]}
              {step.condition.kind === "if-size-over-mb" && step.condition.thresholdMb
                ? ` ${step.condition.thresholdMb}MB`
                : ""}
            </span>
          )}
        </span>
        {step.message && (
          <span
            className={cn(
              "truncate text-[10.5px]",
              step.status === "error"
                ? "text-red-400"
                : step.status === "skipped"
                  ? "text-text-muted italic"
                  : "text-text-muted",
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
        className="rounded p-1 text-text-muted/60 transition hover:bg-surface-2 hover:text-danger"
        aria-label="Remove step"
        title="Remove"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function StatusDot({ status }: { status: StepStatus }) {
  const label =
    status === "running"
      ? "Running"
      : status === "done"
        ? "Done"
        : status === "error"
          ? "Failed"
          : status === "skipped"
            ? "Skipped (condition not met)"
            : "Pending";
  const icon =
    status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-vault" />
    ) : status === "done" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-vault" />
    ) : status === "error" ? (
      <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
    ) : status === "skipped" ? (
      <Ban className="h-3.5 w-3.5 text-text-muted/70" />
    ) : (
      <Circle className="h-3.5 w-3.5 text-text-muted/50" />
    );
  return (
    <span
      role="status"
      aria-label={`Step status: ${label}`}
      title={label}
      className="inline-flex shrink-0 items-center"
    >
      {icon}
    </span>
  );
}


/* -------------------------------------------------------------------- */
/* Condition editor — makes a step conditional                          */
/* -------------------------------------------------------------------- */

function ConditionEditor({
  condition,
  onChange,
}: {
  condition: StepCondition | undefined;
  onChange: (c: StepCondition | undefined) => void;
}) {
  const enabled = !!condition && condition.kind !== "always";
  const kind: ConditionKind = condition?.kind ?? "always";
  const threshold = condition?.thresholdMb ?? 5;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-1/60 p-2.5">
      <label className="flex items-center gap-2 text-[11.5px] text-text">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { kind: "if-scanned" }
                : undefined,
            )
          }
        />
        <span className="font-medium">Run only if…</span>
        <span className="ml-auto rounded-sm border border-border px-1 text-[9px] uppercase tracking-wide text-text-muted">
          Conditional
        </span>
      </label>
      {enabled && (
        <>
          <Select
            value={kind}
            onValueChange={(v) => {
              const nextKind = v as ConditionKind;
              if (nextKind === "always") return onChange(undefined);
              onChange({
                kind: nextKind,
                thresholdMb: nextKind === "if-size-over-mb" ? threshold : undefined,
              });
            }}
          >
            <SelectTrigger className="h-7 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="if-scanned">{CONDITION_LABELS["if-scanned"]}</SelectItem>
              <SelectItem value="if-has-text">{CONDITION_LABELS["if-has-text"]}</SelectItem>
              <SelectItem value="if-has-sensitive">{CONDITION_LABELS["if-has-sensitive"]}</SelectItem>
              <SelectItem value="if-has-privilege">{CONDITION_LABELS["if-has-privilege"]}</SelectItem>
              <SelectItem value="if-size-over-mb">{CONDITION_LABELS["if-size-over-mb"]}</SelectItem>
            </SelectContent>
          </Select>
          {kind === "if-size-over-mb" && (
            <div className="flex items-center gap-2 text-[11.5px] text-text">
              <span className="text-text-muted">Threshold:</span>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={threshold}
                onChange={(e) =>
                  onChange({
                    kind: "if-size-over-mb",
                    thresholdMb: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="h-7 w-20 text-[12px]"
              />
              <span className="text-text-muted">MB</span>
            </div>
          )}
          <p className="text-[10.5px] leading-snug text-text-muted">
            Evaluated per file — in a batch, each document is checked
            independently. Skipped steps show as "skipped".
          </p>
        </>
      )}
    </div>
  );
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

    case "ocr":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Languages (comma-separated Tesseract codes)">
            <Input
              className="h-7 text-[12px]"
              value={Array.isArray(p.languages) ? (p.languages as string[]).join(", ") : "eng"}
              onChange={(e) =>
                onChange({
                  languages: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <label className="flex items-center gap-2 text-[11.5px] text-text">
            <input
              type="checkbox"
              checked={!!p.highAccuracy}
              onChange={(e) => onChange({ highAccuracy: e.target.checked })}
            />
            High accuracy (slower)
          </label>
          <p className="text-[10.5px] leading-snug text-text-muted">
            Runs on the main thread (Tesseract + canvas). Progress reports per page.
          </p>
        </div>
      );

    case "redact-pattern":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Query (keyword or regex)">
            <Input
              className="h-7 text-[12px]"
              value={str("query")}
              placeholder="e.g. John Doe  or  \d{3}-\d{2}-\d{4}"
              onChange={(e) => onChange({ query: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Scope">
              <Select value={str("scope") || "word"} onValueChange={(v) => onChange({ scope: v })}>
                <SelectTrigger className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="word">Word</SelectItem>
                  <SelectItem value="line">Line</SelectItem>
                  <SelectItem value="sentence">Sentence</SelectItem>
                  <SelectItem value="page">Whole page</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex flex-col gap-1 text-[11.5px] text-text">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!p.matchCase} onChange={(e) => onChange({ matchCase: e.target.checked })} />
                Match case
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!p.wholeWord} onChange={(e) => onChange({ wholeWord: e.target.checked })} />
                Whole word
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!p.regex} onChange={(e) => onChange({ regex: e.target.checked })} />
                Regex
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!p.ocr} onChange={(e) => onChange({ ocr: e.target.checked })} />
                Include OCR on scanned pages
              </label>
            </div>
          </div>
          <p className="text-[10.5px] leading-snug text-text-muted">
            Uses the verified rasterize + redaction-gate path — same as the manual Redact tool.
          </p>
        </div>
      );


    case "protect": {
      const perms = (p.permissions as Record<string, boolean> | undefined) ?? {};
      const setPerm = (k: string, v: boolean) =>
        onChange({ permissions: { ...perms, [k]: v } });
      return (
        <div className="flex flex-col gap-2">
          <Field label="User password (required)">
            <Input
              className="h-7 text-[12px]"
              type="password"
              value={str("userPassword")}
              onChange={(e) => onChange({ userPassword: e.target.value })}
            />
          </Field>
          <Field label="Owner password (optional)">
            <Input
              className="h-7 text-[12px]"
              type="password"
              value={str("ownerPassword")}
              onChange={(e) => onChange({ ownerPassword: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-1 pt-1 text-[11.5px] text-text">
            {[
              ["printing", "Printing"],
              ["modifying", "Modify"],
              ["copying", "Copy text"],
              ["annotating", "Annotate"],
              ["fillingForms", "Fill forms"],
              ["contentAccessibility", "A11y"],
              ["documentAssembly", "Assemble"],
            ].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={perms[k] !== false}
                  onChange={(e) => setPerm(k, e.target.checked)}
                />
                {l}
              </label>
            ))}
          </div>
        </div>
      );
    }

    case "unlock":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Password (leave blank if unknown / not encrypted)">
            <Input
              className="h-7 text-[12px]"
              type="password"
              value={str("password")}
              onChange={(e) => onChange({ password: e.target.value })}
            />
          </Field>
          <p className="text-[10.5px] leading-snug text-text-muted">
            Rebuilds the PDF without encryption via pdf-lib.
          </p>
        </div>
      );

    case "repair":
      return (
        <p className="text-[11.5px] text-text-muted">
          No parameters. Tries pdf-lib → pdf.js rasterise → qpdf WASM in sequence.
        </p>
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



/* -------------------------------------------------------------------- */
/* File source picker — lets the builder run on the current doc, a       */
/* picked file, or a drag-dropped file, without requiring anything to be */
/* open in the viewer first.                                             */
/* -------------------------------------------------------------------- */
function FileSourcePicker({
  activeFile,
  currentFile,
  pickedFile,
  onPick,
  onClearOverride,
  onUseCurrent,
  fileInputRef,
  dragOver,
  setDragOver,
}: {
  activeFile: File | null;
  currentFile: File | null;
  pickedFile: File | null;
  onPick: (f: File | null | undefined) => void;
  onClearOverride: () => void;
  onUseCurrent: () => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
}) {
  const hasCurrent = !!currentFile;
  const usingPicked = !!pickedFile;

  const label = activeFile
    ? activeFile.name
    : hasCurrent
      ? currentFile!.name
      : "No file — pick or drop a PDF";

  return (
    <div
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]",
        dragOver
          ? "border-vault/60 bg-vault/10 text-text"
          : activeFile
            ? "border-border bg-surface-1 text-text"
            : "border-dashed border-border/70 bg-surface-1/50 text-text-muted",
      )}
      title={activeFile ? `Workflow will run on ${activeFile.name}` : "Drop a PDF or click Pick"}
    >
      <FileIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <span className="max-w-[220px] truncate">{label}</span>
      {usingPicked && hasCurrent && (
        <button
          type="button"
          onClick={onUseCurrent}
          className="ml-1 rounded px-1 py-0.5 text-[10.5px] text-text-muted underline-offset-2 hover:text-text hover:underline"
          title={`Switch back to current document (${currentFile!.name})`}
        >
          Use current
        </button>
      )}
      {usingPicked && !hasCurrent && (
        <button
          type="button"
          onClick={onClearOverride}
          className="ml-1 rounded px-1 py-0.5 text-[10.5px] text-text-muted hover:text-text"
          title="Clear picked file"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="ml-1 inline-flex items-center gap-1 rounded border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-text-muted hover:text-text"
      >
        <FileUp className="h-3 w-3" />
        {activeFile ? "Change" : "Pick file"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Batch source picker — drop many PDFs at once (or a folder).           */
/* -------------------------------------------------------------------- */
function BatchSourcePicker({
  fileCount,
  doneCount,
  failedCount,
  running,
  onPick,
  onClear,
  inputRef,
}: {
  fileCount: number;
  doneCount: number;
  failedCount: number;
  running: boolean;
  onPick: (files: FileList | File[] | null | undefined) => void;
  onClear: () => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
}) {
  const [dragOver, setDragOver] = useState(false);
  const label =
    fileCount === 0
      ? "Drop PDFs or click Pick files"
      : `${fileCount} file${fileCount === 1 ? "" : "s"} queued` +
        (doneCount || failedCount
          ? ` · ${doneCount} done${failedCount ? ` · ${failedCount} failed` : ""}`
          : "");
  return (
    <div
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onPick(e.dataTransfer.files);
      }}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]",
        dragOver
          ? "border-vault/60 bg-vault/10 text-text"
          : fileCount
            ? "border-border bg-surface-1 text-text"
            : "border-dashed border-border/70 bg-surface-1/50 text-text-muted",
      )}
      title="Drop many PDFs here, or pick files / a folder"
    >
      <Files className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <span className="max-w-[260px] truncate">{label}</span>
      {fileCount > 0 && !running && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 rounded px-1 py-0.5 text-[10.5px] text-text-muted hover:text-text"
          title="Clear queue"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <button
        type="button"
        disabled={running}
        onClick={() => inputRef.current?.click()}
        className="ml-1 inline-flex items-center gap-1 rounded border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-text-muted hover:text-text disabled:opacity-50"
      >
        <FileUp className="h-3 w-3" />
        {fileCount ? "Add more" : "Pick files"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        // Chromium-only folder pick (harmless attributes elsewhere).
        // Multi-file selection; folders can be dropped in via drag-drop.
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Batch progress panel — per-file status + downloads + naming controls  */
/* -------------------------------------------------------------------- */
type BatchPanelRow = {
  id: string;
  name: string;
  size: number;
  status: "queued" | "processing" | "done" | "failed";
  outName?: string;
  bytes?: Uint8Array;
  error?: string;
  elapsedMs?: number;
};

function BatchProgressPanel({
  rows,
  current,
  running,
  stats,
  outputNameMode,
  setOutputNameMode,
  outputSuffix,
  setOutputSuffix,
  onDownload,
  onDownloadZip,
  onRemove,
  onClear,
}: {
  rows: BatchPanelRow[];
  current: number;
  running: boolean;
  stats: { done: number; failed: number; processing: number; total: number };
  outputNameMode: "suffix" | "keep";
  setOutputNameMode: (m: "suffix" | "keep") => void;
  outputSuffix: string;
  setOutputSuffix: (s: string) => void;
  onDownload: (row: BatchPanelRow) => void;
  onDownloadZip: () => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const overallPct =
    stats.total === 0 ? 0 : Math.round(((stats.done + stats.failed) / stats.total) * 100);
  const currentName = current >= 0 && current < rows.length ? rows[current].name : null;
  return (
    <div className="flex max-h-[42%] min-h-[180px] flex-col border-t border-border bg-surface-2/50">
      {/* Summary bar */}
      <div className="flex items-center gap-3 border-b border-border bg-vault/5 px-4 py-2 text-[12px] text-text">
        <span className="flex items-center gap-1.5">
          <Files className="h-4 w-4 text-vault" />
          {running
            ? `Processing ${Math.min(current + 1, stats.total)} of ${stats.total}${
                currentName ? ` — ${currentName}` : ""
              }`
            : `${stats.done} done · ${stats.failed} failed · ${stats.total} total`}
        </span>
        <div className="relative ml-1 h-1.5 flex-1 overflow-hidden rounded-full bg-surface-1">
          <div
            className="absolute inset-y-0 left-0 bg-vault transition-[width]"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <span className="text-[10.5px] text-text-muted">{overallPct}%</span>
        <div className="mx-2 h-4 w-px bg-border" />

        {/* Output naming controls */}
        <div className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
          <span>Names:</span>
          <select
            className="h-6 rounded border border-border bg-surface-1 px-1 text-[10.5px] text-text"
            value={outputNameMode}
            onChange={(e) => setOutputNameMode(e.target.value as "suffix" | "keep")}
            disabled={running}
          >
            <option value="suffix">Add suffix</option>
            <option value="keep">Keep original</option>
          </select>
          {outputNameMode === "suffix" && (
            <input
              type="text"
              value={outputSuffix}
              onChange={(e) => setOutputSuffix(e.target.value)}
              placeholder="-processed"
              disabled={running}
              className="h-6 w-24 rounded border border-border bg-surface-1 px-1.5 text-[10.5px] text-text"
            />
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={onDownloadZip}
            disabled={stats.done === 0}
            title="Download all successful outputs as a ZIP"
          >
            <FileArchive className="h-3.5 w-3.5" />
            Download ZIP
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-text-muted hover:text-text"
            onClick={onClear}
            disabled={running}
            title="Clear the batch queue"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Per-file rows */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[11.5px]">
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                className={cn(
                  "border-b border-border/60",
                  r.status === "processing" && "bg-vault/5",
                )}
              >
                <td className="w-6 py-1.5 pl-3 pr-1">
                  {r.status === "queued" && (
                    <Circle className="h-3.5 w-3.5 text-text-muted/50" />
                  )}
                  {r.status === "processing" && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-vault" />
                  )}
                  {r.status === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-vault" />
                  )}
                  {r.status === "failed" && (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  )}
                </td>
                <td className="max-w-[320px] truncate py-1.5 pr-2 text-text">{r.name}</td>
                <td className="w-20 py-1.5 pr-2 text-[10.5px] text-text-muted">
                  {(r.size / 1024).toFixed(0)} KB
                </td>
                <td className="py-1.5 pr-2 text-[10.5px] text-text-muted">
                  {r.status === "failed" ? (
                    <span
                      className="text-red-500"
                      title={r.error}
                    >
                      Failed: {r.error?.slice(0, 80)}
                      {r.error && r.error.length > 80 ? "…" : ""}
                    </span>
                  ) : r.status === "done" ? (
                    <>
                      <span className="text-text">{r.outName}</span>
                      {r.elapsedMs != null && (
                        <span className="ml-1.5">· {Math.round(r.elapsedMs)} ms</span>
                      )}
                    </>
                  ) : r.status === "processing" ? (
                    <span>Running workflow…</span>
                  ) : (
                    <span>Queued</span>
                  )}
                </td>
                <td className="w-28 py-1.5 pr-3 text-right">
                  {r.status === "done" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-1.5 text-[10.5px] text-text-muted hover:text-text"
                      onClick={() => onDownload(r)}
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </Button>
                  )}
                  {(r.status === "queued" || r.status === "failed") && !running && (
                    <button
                      type="button"
                      onClick={() => onRemove(i)}
                      className="rounded p-1 text-text-muted hover:text-text"
                      title="Remove from queue"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* Silence unused import warning — LockBadge is exported for parity but not
 * used inside this panel body (the Pro gate uses its own lock). */
void LockBadge;

