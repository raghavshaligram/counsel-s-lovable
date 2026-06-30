/**
 * Multi-file Bates modal — Pro-only.
 *
 * Lets the user add multiple PDFs, drag to order them, configure Bates
 * (prefix/suffix/start/digits/position), preview the resulting per-file
 * range, then stamp ONE continuous sequence across the whole set.
 *
 * Output: separate files (keeping original names) OR a single merged
 * stamped PDF — user picks.
 *
 * Reuses `addBates`'s pdf-lib logic via `stampMultiFileBates`. Runs on
 * device; the worker yields between pages so the UI stays responsive on
 * large sets.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X, GripVertical, Upload, Trash2, Loader2 } from "lucide-react";
import { downloadPdf } from "@/lib/pdf/download";
import { ExportFormatRow } from "@/components/workspace/export-format-row";
import {
  planMultiFileBates,
  stampMultiFileBates,
  type FileBatesRange,
  type MultiBatesProgress,
} from "@/lib/batch/ops/bates-multi";
import type { BatesOpts, BatesPosition, BatesColor } from "@/lib/batch/ops/bates";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
}

const POSITIONS: { value: BatesPosition; label: string }[] = [
  { value: "tl", label: "Top left" },
  { value: "tc", label: "Top center" },
  { value: "tr", label: "Top right" },
  { value: "bl", label: "Bottom left" },
  { value: "bc", label: "Bottom center" },
  { value: "br", label: "Bottom right" },
];

const COLORS: { value: BatesColor; label: string }[] = [
  { value: "black", label: "Black" },
  { value: "red", label: "Red" },
  { value: "blue", label: "Blue" },
];

export function MultiFileBatesModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [opts, setOpts] = useState<BatesOpts>({
    prefix: "ABC",
    suffix: "",
    startAt: 1,
    digits: 6,
    position: "br",
    fontSize: 10,
    color: "black",
    margin: 24,
  });
  const [merge, setMerge] = useState(false);
  const [mergedName, setMergedName] = useState("bates-merged.pdf");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MultiBatesProgress | null>(null);
  const [preview, setPreview] = useState<FileBatesRange[] | null>(null);

  // Recompute preview whenever the file list or numbering opts change.
  useEffect(() => {
    let cancelled = false;
    if (rows.length === 0) {
      setPreview(null);
      return;
    }
    void (async () => {
      try {
        const plan = await planMultiFileBates(
          rows.map((r) => ({ name: r.name, bytes: r.bytes })),
          opts,
        );
        if (!cancelled) setPreview(plan);
      } catch (err) {
        if (!cancelled) {
          console.error("[multi-bates] preview failed", err);
          setPreview(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, opts]);

  const addFiles = useCallback(async (fl: FileList | null) => {
    if (!fl) return;
    const incoming: Row[] = [];
    for (const f of Array.from(fl)) {
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") continue;
      incoming.push({
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        size: f.size,
        bytes: new Uint8Array(await f.arrayBuffer()),
      });
    }
    if (incoming.length === 0) {
      toast.error("No PDFs selected");
      return;
    }
    setRows((cur) => [...cur, ...incoming]);
  }, []);

  const move = useCallback((from: number, to: number) => {
    setRows((cur) => {
      if (to < 0 || to >= cur.length || from === to) return cur;
      const next = cur.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const removeAt = useCallback((id: string) => {
    setRows((cur) => cur.filter((r) => r.id !== id));
  }, []);

  const totalPages = useMemo(
    () => preview?.reduce((n, r) => n + r.pageCount, 0) ?? 0,
    [preview],
  );

  const run = useCallback(async () => {
    if (rows.length === 0) {
      toast.error("Add at least one PDF");
      return;
    }
    if (!opts.prefix && !opts.suffix) {
      toast.error("Set a prefix or suffix");
      return;
    }
    setBusy(true);
    setProgress(null);
    const tid = "multi-bates";
    toast.loading("Stamping Bates across files…", { id: tid });
    try {
      const result = await stampMultiFileBates(
        rows.map((r) => ({ name: r.name, bytes: r.bytes })),
        opts,
        {
          merge,
          mergedName,
          onProgress: setProgress,
        },
      );
      if (merge && result.merged) {
        await downloadPdf(result.merged.bytes, result.merged.name);
        toast.success(`Merged Bates set saved (${totalPages} pages)`, { id: tid });
      } else {
        for (const f of result.files) {
          const out = f.name.replace(/\.pdf$/i, "") + "-bates.pdf";
          await downloadPdf(f.bytes, out);
        }
        toast.success(
          `${result.files.length} file${result.files.length === 1 ? "" : "s"} stamped (${totalPages} pages)`,
          { id: tid },
        );
      }
      onClose();
    } catch (err) {
      console.error("[multi-bates] failed", err);
      toast.error("Multi-file Bates failed", {
        id: tid,
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [rows, opts, merge, mergedName, totalPages, onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-display text-[15px] leading-none">Multi-file Bates stamping</h2>
            <p className="mt-1 text-[11.5px] text-text-2">
              Apply one continuous Bates sequence across multiple PDFs · on-device
            </p>
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

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-[1.2fr_1fr]">
          {/* ── Left: file list ─────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[12.5px] font-medium text-foreground">Files (in order)</h3>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11.5px] text-foreground hover:border-vault/40">
                <Upload className="h-3 w-3" />
                Add PDFs
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            {rows.length === 0 ? (
              <div className="grid place-items-center rounded-md border border-dashed border-border py-8 text-[12px] text-text-2">
                Add PDFs to begin
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {rows.map((r, idx) => {
                  const range = preview?.[idx];
                  return (
                    <li
                      key={r.id}
                      draggable={!busy}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(idx))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(e.dataTransfer.getData("text/plain"));
                        if (Number.isFinite(from)) move(from, idx);
                      }}
                      className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px]"
                    >
                      <GripVertical className="h-3.5 w-3.5 cursor-grab text-text-2" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-foreground">{r.name}</span>
                        <span className="text-[10.5px] text-text-2">
                          {range
                            ? `${range.pageCount} page${range.pageCount === 1 ? "" : "s"} · ${range.firstStamp} – ${range.lastStamp}`
                            : "…"}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={busy || idx === 0}
                          onClick={() => move(idx, idx - 1)}
                          className="rounded px-1 text-text-2 hover:bg-surface-1 hover:text-foreground disabled:opacity-30"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || idx === rows.length - 1}
                          onClick={() => move(idx, idx + 1)}
                          className="rounded px-1 text-text-2 hover:bg-surface-1 hover:text-foreground disabled:opacity-30"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
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
                  );
                })}
              </ul>
            )}

            {preview && preview.length > 0 && (
              <div className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[11.5px] text-text-2">
                <div className="text-foreground">
                  Total: {totalPages} page{totalPages === 1 ? "" : "s"} · stamps{" "}
                  <span className="font-mono">{preview[0].firstStamp}</span> to{" "}
                  <span className="font-mono">{preview[preview.length - 1].lastStamp}</span>
                </div>
              </div>
            )}
          </section>

          {/* ── Right: config ─────────────────────────────────── */}
          <section className="flex flex-col gap-2.5">
            <h3 className="text-[12.5px] font-medium text-foreground">Bates configuration</h3>
            <Field label="Prefix">
              <input
                value={opts.prefix}
                disabled={busy}
                onChange={(e) => setOpts({ ...opts, prefix: e.target.value })}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                placeholder="ABC"
              />
            </Field>
            <Field label="Suffix">
              <input
                value={opts.suffix ?? ""}
                disabled={busy}
                onChange={(e) => setOpts({ ...opts, suffix: e.target.value })}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                placeholder=""
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start at">
                <input
                  type="number"
                  min={0}
                  value={opts.startAt}
                  disabled={busy}
                  onChange={(e) =>
                    setOpts({ ...opts, startAt: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                />
              </Field>
              <Field label="Digits (zero-pad)">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={opts.digits}
                  disabled={busy}
                  onChange={(e) =>
                    setOpts({
                      ...opts,
                      digits: Math.max(1, Math.min(12, Number(e.target.value) || 1)),
                    })
                  }
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                />
              </Field>
            </div>
            <Field label="Position on page">
              <select
                value={opts.position}
                disabled={busy}
                onChange={(e) =>
                  setOpts({ ...opts, position: e.target.value as BatesPosition })
                }
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
              >
                {POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Font size">
                <input
                  type="number"
                  min={6}
                  max={48}
                  value={opts.fontSize}
                  disabled={busy}
                  onChange={(e) =>
                    setOpts({ ...opts, fontSize: Math.max(6, Number(e.target.value) || 10) })
                  }
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                />
              </Field>
              <Field label="Color">
                <select
                  value={opts.color}
                  disabled={busy}
                  onChange={(e) =>
                    setOpts({ ...opts, color: e.target.value as BatesColor })
                  }
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]"
                >
                  {COLORS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-2 rounded-md border border-border bg-surface-2 p-2.5">
              <div className="mb-1.5 text-[12px] font-medium text-foreground">Output</div>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-[12px] text-foreground">
                <input
                  type="radio"
                  name="multi-bates-output"
                  checked={!merge}
                  onChange={() => setMerge(false)}
                  disabled={busy}
                />
                Separate files (keep original names)
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-[12px] text-foreground">
                <input
                  type="radio"
                  name="multi-bates-output"
                  checked={merge}
                  onChange={() => setMerge(true)}
                  disabled={busy}
                />
                Single merged PDF
              </label>
              {merge && (
                <input
                  type="text"
                  value={mergedName}
                  disabled={busy}
                  onChange={(e) => setMergedName(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px]"
                  placeholder="bates-merged.pdf"
                />
              )}
            </div>
            <ExportFormatRow className="mt-2" />
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface-1 px-5 py-3">
          <div className="min-w-0 flex-1 truncate text-[11.5px] text-text-2">
            {busy && progress ? (
              <span>
                {progress.fileName} · page {progress.page}/{progress.pageCount} ·{" "}
                {progress.totalPagesDone}/{progress.totalPages}
              </span>
            ) : rows.length > 0 ? (
              <span>
                Ready · {rows.length} file{rows.length === 1 ? "" : "s"} · {totalPages} pages
              </span>
            ) : (
              <span>Add PDFs and configure Bates</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-foreground hover:border-vault/40 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || rows.length === 0}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
                (busy || rows.length === 0) && "cursor-not-allowed opacity-60",
              )}
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {busy ? "Stamping…" : merge ? "Stamp & merge" : "Stamp files"}
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
      <span className="text-[10.5px] uppercase tracking-wide text-text-2">{label}</span>
      {children}
    </label>
  );
}
