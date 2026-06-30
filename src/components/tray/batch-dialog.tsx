/**
 * BatchDialog — generic "Apply to all in tray" runner UI.
 *
 * Any tool can mount this dialog, pass an op + opts, and get a designed
 * progress ledger + zipped result download. No per-tool design pass needed.
 */
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { runBatch, zipBatchOutputs, downloadBytes, type BatchOp, type BatchProgress } from "@/lib/batch/runner";
import { downloadPdf } from "@/lib/pdf/download";
import { ExportFormatRow } from "@/components/workspace/export-format-row";
import { useTray } from "@/lib/tray/store";
import { CheckCircle2, Loader2, AlertTriangle, Download, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props<O> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  op: BatchOp<O>;
  opts: O;
  /** suffix appended to original name before .pdf. e.g. "compressed" */
  suffix?: string;
  zipName?: string;
}

export function BatchDialog<O>({
  open,
  onOpenChange,
  title,
  description,
  op,
  opts,
  suffix = "processed",
  zipName = "counselpdf-batch.zip",
}: Props<O>) {
  const entries = useTray((s) => s.entries);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [finalResult, setFinalResult] = useState<BatchProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      setProgress(null);
      setFinalResult(null);
      setRunning(false);
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  const start = async () => {
    if (entries.length === 0) return;
    setRunning(true);
    setFinalResult(null);
    abortRef.current = new AbortController();
    const result = await runBatch({
      entries,
      op,
      opts,
      rename: (e) => e.name.replace(/\.pdf$/i, "") + `-${suffix}.pdf`,
      onProgress: (p) => setProgress(p),
      signal: abortRef.current.signal,
    });
    setFinalResult(result);
    setRunning(false);
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const downloadAll = async () => {
    if (!finalResult) return;
    const completed = finalResult.files.filter((f) => f.status === "done").length;
    if (completed === 0) return;
    if (completed === 1) {
      const f = finalResult.files.find((x) => x.status === "done");
      if (f && f.status === "done") await downloadPdf(f.bytes, f.outName);
      return;
    }
    // Multiple files → run each through downloadPdf so the user's format
    // preference (PDF / PDF/A) is applied per file, then zip is skipped.
    for (const f of finalResult.files) {
      if (f.status === "done") await downloadPdf(f.bytes, f.outName);
    }
  };

  const view = progress ?? { total: entries.length, done: 0, failed: 0, files: entries.map((e) => ({ id: e.id, name: e.name, status: "queued" as const })) };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Add PDFs to the tray first.
          </div>
        ) : (
          <>
            <div className="rounded-md border border-whisper bg-canvas/40">
              <div className="flex items-center justify-between px-3 py-2 border-b border-whisper text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <span>Batch ledger</span>
                <span className="font-mono">
                  {view.done}/{view.total} done
                  {view.failed > 0 && <span className="text-evidence"> · {view.failed} failed</span>}
                </span>
              </div>
              <ul className="max-h-72 overflow-y-auto divide-y divide-whisper/60">
                {view.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                    <StatusIcon status={f.status} />
                    <span className="text-sm truncate flex-1" title={f.name}>{f.name}</span>
                    <span className={cn(
                      "font-mono text-[10px] uppercase tracking-wider",
                      f.status === "done" && "text-vault",
                      f.status === "error" && "text-evidence",
                      f.status === "running" && "text-muted-foreground",
                      f.status === "queued" && "text-muted-foreground/60",
                    )}>
                      {f.status === "error" ? f.error.slice(0, 24) : f.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {finalResult ? "Complete" : running ? "Working…" : "Ready"}
              </div>
              <div className="flex gap-2">
                {!running && !finalResult && (
                  <Button onClick={start} className="bg-vault text-vault-foreground hover:bg-vault/90">
                    Run on {entries.length} file{entries.length === 1 ? "" : "s"}
                  </Button>
                )}
                {running && (
                  <Button variant="outline" onClick={cancel}>Cancel</Button>
                )}
                {finalResult && finalResult.done > 0 && (
                  <Button onClick={downloadAll} className="bg-vault text-vault-foreground hover:bg-vault/90">
                    <Download className="h-4 w-4 mr-2" />
                    {finalResult.done > 1 ? "Download .zip" : "Download"}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusIcon({ status }: { status: "queued" | "running" | "done" | "error" }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-vault shrink-0" />;
  if (status === "error") return <AlertTriangle className="h-4 w-4 text-evidence shrink-0" />;
  if (status === "running") return <Loader2 className="h-4 w-4 text-vault animate-spin shrink-0" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />;
}
