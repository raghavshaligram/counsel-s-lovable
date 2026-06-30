/**
 * Exhibit Binder modal — Pro-only.
 *
 * Drag-and-drop builder for a court-ready bundle:
 *   - One primary brief slot (optional)
 *   - Ordered list of exhibits with reorder / rename / remove
 *   - Configurable label scheme (letters or numbers) and ToC title
 *   - Optional continuous numbering (page numbers or Bates) across the bundle
 *
 * Build is on-device via `buildExhibitBinder`; the worker yields between
 * heavy steps so the UI stays responsive on large sets. Output is a single
 * PDF with a hyperlinked ToC, slip-sheets, and (optionally) numbering.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { X, GripVertical, Upload, Trash2, FilePlus2, BookOpen } from "lucide-react";
import { downloadPdf } from "@/lib/pdf/download";
import { ExportFormatRow } from "@/components/workspace/export-format-row";
import {
  buildExhibitBinder,
  cleanExhibitTitle,
  exhibitLabel,
  type BinderProgress,
  type BinderNumbering,
  type ExhibitLabelScheme,
} from "@/lib/batch/ops/exhibit-binder";
import type { BatesOpts, BatesPosition } from "@/lib/batch/ops/bates";
import { cn } from "@/lib/utils";

interface ExhibitRow {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  title: string; // editable display title
  labelOverride: string; // editable label (e.g. "Exhibit A"); empty = auto
}

const POSITIONS: { value: BatesPosition; label: string }[] = [
  { value: "bl", label: "Bottom left" },
  { value: "bc", label: "Bottom center" },
  { value: "br", label: "Bottom right" },
  { value: "tl", label: "Top left" },
  { value: "tc", label: "Top center" },
  { value: "tr", label: "Top right" },
];

function readPdf(f: File): Promise<Uint8Array> {
  return f.arrayBuffer().then((b) => new Uint8Array(b));
}

export function ExhibitBinderModal({ onClose }: { onClose: () => void }) {
  const [brief, setBrief] = useState<ExhibitRow | null>(null);
  const [exhibits, setExhibits] = useState<ExhibitRow[]>([]);

  const [labelScheme, setLabelScheme] = useState<ExhibitLabelScheme>("letters");
  const [labelPrefix, setLabelPrefix] = useState("Exhibit ");
  const [includeToc, setIncludeToc] = useState(true);
  const [tocTitle, setTocTitle] = useState("Table of Contents");

  const [numbering, setNumbering] = useState<BinderNumbering>("page");
  const [bates, setBates] = useState<BatesOpts>({
    prefix: "ABC",
    suffix: "",
    startAt: 1,
    digits: 6,
    position: "br",
    fontSize: 10,
    color: "black",
    margin: 24,
  });
  const [skipNumberingOnToc, setSkipNumberingOnToc] = useState(true);
  const [tocTarget, setTocTarget] = useState<"divider" | "content">("divider");
  const [outputName, setOutputName] = useState("exhibit-binder.pdf");

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BinderProgress | null>(null);

  /* ---------------- file intake ---------------- */

  const pickBrief = useCallback(async (fl: FileList | null) => {
    if (!fl || fl.length === 0) return;
    const f = fl[0];
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      toast.error("Brief must be a PDF");
      return;
    }
    setBrief({
      id: `brief-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      size: f.size,
      bytes: await readPdf(f),
      title: cleanExhibitTitle(f.name),
      labelOverride: "",
    });
  }, []);

  const addExhibits = useCallback(async (fl: FileList | null) => {
    if (!fl) return;
    const incoming: ExhibitRow[] = [];
    for (const f of Array.from(fl)) {
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") continue;
      incoming.push({
        id: `ex-${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        size: f.size,
        bytes: await readPdf(f),
        title: cleanExhibitTitle(f.name),
        labelOverride: "",
      });
    }
    if (incoming.length === 0) {
      toast.error("No PDFs selected");
      return;
    }
    setExhibits((cur) => [...cur, ...incoming]);
  }, []);

  const move = useCallback((from: number, to: number) => {
    setExhibits((cur) => {
      if (to < 0 || to >= cur.length || from === to) return cur;
      const next = cur.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const rename = useCallback((id: string, title: string) => {
    setExhibits((cur) => cur.map((r) => (r.id === id ? { ...r, title } : r)));
  }, []);

  const setLabelFor = useCallback((id: string, labelOverride: string) => {
    setExhibits((cur) => cur.map((r) => (r.id === id ? { ...r, labelOverride } : r)));
  }, []);

  const removeAt = useCallback((id: string) => {
    setExhibits((cur) => cur.filter((r) => r.id !== id));
  }, []);

  /* ---------------- build ---------------- */

  const run = useCallback(async () => {
    if (exhibits.length === 0) {
      toast.error("Add at least one exhibit");
      return;
    }
    if (numbering === "bates" && !bates.prefix && !bates.suffix) {
      toast.error("Set a Bates prefix or suffix");
      return;
    }
    setBusy(true);
    setProgress(null);
    const tid = "exhibit-binder";
    toast.loading("Assembling exhibit binder…", { id: tid });
    try {
      const { bytes, entries } = await buildExhibitBinder(
        {
          brief: brief
            ? { name: brief.name, title: brief.title, bytes: brief.bytes }
            : null,
          exhibits: exhibits.map((e, i) => ({
            name: e.name,
            title: e.title,
            label: e.labelOverride.trim() || undefined,
            bytes: e.bytes,
          })),
          labelScheme,
          labelPrefix,
          includeToc,
          tocTitle,
          tocTarget,
          numbering,
          bates: numbering === "bates" ? bates : undefined,
          skipNumberingOnToc,
        },
        setProgress,
      );
      await downloadPdf(
        bytes,
        outputName.endsWith(".pdf") ? outputName : outputName + ".pdf",
      );
      toast.success(
        `Binder ready · ${entries.length} exhibit${entries.length === 1 ? "" : "s"}`,
        { id: tid },
      );
      onClose();
    } catch (err) {
      console.error("[exhibit-binder] failed", err);
      toast.error("Failed to build binder", {
        id: tid,
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [
    brief, exhibits, labelScheme, labelPrefix, includeToc, tocTitle, tocTarget,
    numbering, bates, skipNumberingOnToc, outputName, onClose,
  ]);

  const progressText = progress
    ? progress.phase === "brief"
      ? `Copying brief · ${progress.label ?? ""}`
      : progress.phase === "exhibits"
        ? `Adding ${progress.label ?? "exhibit"} · ${progress.current}/${progress.total}`
        : progress.phase === "toc"
          ? `Building Table of Contents`
          : progress.phase === "numbering"
            ? `Applying continuous numbering`
            : `Finalizing`
    : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-vault" />
            <div>
              <h2 className="font-display text-[15px] leading-none">Exhibit Binder</h2>
              <p className="mt-1 text-[11.5px] text-text-2">
                Brief + exhibits → one PDF with hyperlinked ToC and slip-sheets · on-device
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-text-2 hover:bg-surface-2 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-[1.3fr_1fr]">
          {/* ── Left: brief + exhibits list ─────────────────────────── */}
          <section className="flex flex-col gap-3">
            {/* Brief slot */}
            <div>
              <h3 className="mb-1.5 text-[12.5px] font-medium text-foreground">
                Primary brief (optional)
              </h3>
              {brief ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px]">
                  <FilePlus2 className="h-3.5 w-3.5 text-vault" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{brief.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setBrief(null)}
                    className="rounded p-1 text-text-2 hover:bg-surface-1 hover:text-red-400"
                    aria-label="Remove brief"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <label className="grid cursor-pointer place-items-center rounded-md border border-dashed border-border bg-surface-2 px-3 py-3 text-[11.5px] text-text-2 hover:border-vault/40 hover:text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Upload className="h-3 w-3" />
                    Add brief PDF
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      void pickBrief(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              )}
            </div>

            {/* Exhibits */}
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-[12.5px] font-medium text-foreground">
                  Exhibits (drag to order)
                </h3>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11.5px] text-foreground hover:border-vault/40">
                  <Upload className="h-3 w-3" />
                  Add exhibits
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void addExhibits(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              {exhibits.length === 0 ? (
                <div className="mt-1.5 grid place-items-center rounded-md border border-dashed border-border py-8 text-[12px] text-text-2">
                  Add exhibit PDFs to begin
                </div>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {exhibits.map((r, idx) => (
                    <li
                      key={r.id}
                      draggable={!busy}
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", String(idx))
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(e.dataTransfer.getData("text/plain"));
                        if (Number.isFinite(from)) move(from, idx);
                      }}
                      className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px]"
                    >
                      <GripVertical className="h-3.5 w-3.5 cursor-grab text-text-2" />
                      <input
                        value={r.labelOverride}
                        disabled={busy}
                        onChange={(e) => setLabelFor(r.id, e.target.value)}
                        placeholder={`${labelPrefix}${exhibitLabel(idx, labelScheme)}`}
                        title="Exhibit label (leave blank to auto-assign in order)"
                        className="w-[88px] shrink-0 rounded bg-vault/15 px-1.5 py-0.5 text-center font-mono text-[10.5px] text-vault outline-none placeholder:text-vault/60 focus:ring-1 focus:ring-vault/40"
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <input
                          value={r.title}
                          disabled={busy}
                          onChange={(e) => rename(r.id, e.target.value)}
                          placeholder="Exhibit title"
                          className="w-full truncate bg-transparent text-foreground outline-none focus:ring-1 focus:ring-vault/40"
                        />
                        <span className="truncate text-[10.5px] text-text-2">{r.name}</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={busy || idx === 0}
                          onClick={() => move(idx, idx - 1)}
                          className="rounded px-1 text-text-2 hover:bg-surface-1 hover:text-foreground disabled:opacity-30"
                          aria-label="Move up"
                        >↑</button>
                        <button
                          type="button"
                          disabled={busy || idx === exhibits.length - 1}
                          onClick={() => move(idx, idx + 1)}
                          className="rounded px-1 text-text-2 hover:bg-surface-1 hover:text-foreground disabled:opacity-30"
                          aria-label="Move down"
                        >↓</button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removeAt(r.id)}
                          className="rounded p-1 text-text-2 hover:bg-surface-1 hover:text-red-400"
                          aria-label="Remove"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ── Right: config ──────────────────────────────────────── */}
          <section className="flex flex-col gap-2.5">
            <h3 className="text-[12.5px] font-medium text-foreground">Binder configuration</h3>

            <Field label="Label scheme">
              <div className="flex gap-1.5">
                <SchemeChip
                  active={labelScheme === "letters"}
                  onClick={() => setLabelScheme("letters")}
                  disabled={busy}
                >
                  Letters (A, B, C…)
                </SchemeChip>
                <SchemeChip
                  active={labelScheme === "numbers"}
                  onClick={() => setLabelScheme("numbers")}
                  disabled={busy}
                >
                  Numbers (1, 2, 3…)
                </SchemeChip>
              </div>
            </Field>

            <Field label="Label prefix">
              <input
                value={labelPrefix}
                disabled={busy}
                onChange={(e) => setLabelPrefix(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                placeholder="Exhibit "
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground">
              <input
                type="checkbox"
                checked={includeToc}
                disabled={busy}
                onChange={(e) => setIncludeToc(e.target.checked)}
              />
              Include hyperlinked Table of Contents
            </label>
            {includeToc && (
              <Field label="ToC title">
                <input
                  value={tocTitle}
                  disabled={busy}
                  onChange={(e) => setTocTitle(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                />
              </Field>
            )}
            {includeToc && (
              <Field label="Table of Contents points to">
                <div className="flex gap-1.5">
                  <SchemeChip
                    active={tocTarget === "divider"}
                    onClick={() => setTocTarget("divider")}
                    disabled={busy}
                  >
                    Tab / Divider page
                  </SchemeChip>
                  <SchemeChip
                    active={tocTarget === "content"}
                    onClick={() => setTocTarget("content")}
                    disabled={busy}
                  >
                    First content page
                  </SchemeChip>
                </div>
                <p className="mt-1 text-[10.5px] text-text-2">
                  {tocTarget === "divider"
                    ? "Default — matches physical binders. Each exhibit begins at its tab."
                    : "ToC number and link both jump to the first page of exhibit content."}
                </p>
              </Field>
            )}



            <Field label="Continuous numbering">
              <div className="flex gap-1.5">
                <SchemeChip active={numbering === "none"} onClick={() => setNumbering("none")} disabled={busy}>None</SchemeChip>
                <SchemeChip active={numbering === "page"} onClick={() => setNumbering("page")} disabled={busy}>Page #</SchemeChip>
                <SchemeChip active={numbering === "bates"} onClick={() => setNumbering("bates")} disabled={busy}>Bates</SchemeChip>
              </div>
            </Field>

            {numbering === "bates" && (
              <div className="rounded-md border border-border bg-surface-2 p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Prefix">
                    <input
                      value={bates.prefix}
                      disabled={busy}
                      onChange={(e) => setBates({ ...bates, prefix: e.target.value })}
                      className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px]"
                    />
                  </Field>
                  <Field label="Suffix">
                    <input
                      value={bates.suffix ?? ""}
                      disabled={busy}
                      onChange={(e) => setBates({ ...bates, suffix: e.target.value })}
                      className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px]"
                    />
                  </Field>
                  <Field label="Start at">
                    <input
                      type="number"
                      min={0}
                      value={bates.startAt}
                      disabled={busy}
                      onChange={(e) =>
                        setBates({ ...bates, startAt: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px]"
                    />
                  </Field>
                  <Field label="Digits">
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={bates.digits}
                      disabled={busy}
                      onChange={(e) =>
                        setBates({
                          ...bates,
                          digits: Math.max(1, Math.min(12, Number(e.target.value) || 1)),
                        })
                      }
                      className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px]"
                    />
                  </Field>
                </div>
                <div className="mt-2">
                  <Field label="Position">
                    <select
                      value={bates.position}
                      disabled={busy}
                      onChange={(e) =>
                        setBates({ ...bates, position: e.target.value as BatesPosition })
                      }
                      className="w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px]"
                    >
                      {POSITIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            )}

            {numbering !== "none" && includeToc && (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground">
                <input
                  type="checkbox"
                  checked={skipNumberingOnToc}
                  disabled={busy}
                  onChange={(e) => setSkipNumberingOnToc(e.target.checked)}
                />
                Skip numbering on ToC pages
              </label>
            )}

            <Field label="Output filename">
              <input
                value={outputName}
                disabled={busy}
                onChange={(e) => setOutputName(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                placeholder="exhibit-binder.pdf"
              />
            </Field>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface-1 px-5 py-3">
          <div className="min-w-0 flex-1 truncate text-[11.5px] text-text-2">
            {busy && progressText ? (
              <span>{progressText}</span>
            ) : exhibits.length > 0 ? (
              <span>
                Ready · {exhibits.length} exhibit{exhibits.length === 1 ? "" : "s"}
                {brief ? " + brief" : ""}
              </span>
            ) : (
              <span>Add a brief and exhibits to begin</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-foreground hover:border-vault/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || exhibits.length === 0}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
                (busy || exhibits.length === 0) && "cursor-not-allowed opacity-60",
              )}
            >
              {busy ? "Building…" : "Build binder"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function SchemeChip({
  active, onClick, disabled, children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border px-2 py-1 text-[11.5px]",
        active
          ? "border-vault/60 bg-accent-soft text-vault"
          : "border-border bg-surface-2 text-foreground hover:border-vault/40",
        disabled && "opacity-50",
      )}
    >
      {children}
    </button>
  );
}
