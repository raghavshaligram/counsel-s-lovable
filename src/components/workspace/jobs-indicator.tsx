/**
 * Small pill in the workspace header showing background jobs.
 *
 * Click to open a popover listing each running / recently-finished job:
 * document name, kind, per-job progress bar, cancel button. Independent
 * of active tab focus — a job for Document A is visible while working
 * on Document B.
 */
import { useMemo } from "react";
import { Loader2, X, CheckCircle2, AlertCircle, Ban } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useJobsStore, jobLabel, type Job } from "@/lib/jobs/registry";

function statusIcon(j: Job) {
  if (j.status === "running" || j.status === "queued")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-vault" />;
  if (j.status === "completed")
    return <CheckCircle2 className="h-3.5 w-3.5 text-vault" />;
  if (j.status === "canceled")
    return <Ban className="h-3.5 w-3.5 text-muted-foreground" />;
  return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
}

export function JobsIndicator() {
  const jobs = useJobsStore((s) => s.jobs);
  const cancelJob = useJobsStore((s) => s.cancelJob);
  const dismissJob = useJobsStore((s) => s.dismissJob);
  const clearFinished = useJobsStore((s) => s.clearFinished);

  const active = useMemo(
    () => jobs.filter((j) => j.status === "running" || j.status === "queued"),
    [jobs],
  );

  if (jobs.length === 0) return null;

  const aggregate =
    active.length === 0
      ? 1
      : active.reduce((s, j) => s + (j.progress.fraction || 0), 0) /
        active.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Background jobs (${active.length} active)`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-[11.5px] font-medium text-foreground/85 hover:border-vault/60 hover:text-foreground transition-colors"
        >
          {active.length > 0 ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-vault" />
              <span>
                {active.length} job{active.length === 1 ? "" : "s"} · {Math.round(aggregate * 100)}%
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3 w-3 text-vault" />
              <span>Jobs</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-[12px] font-semibold">Background jobs</div>
          <button
            type="button"
            onClick={clearFinished}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Clear finished
          </button>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {jobs.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              No jobs
            </div>
          ) : (
            [...jobs].reverse().map((j) => {
              const pct = Math.max(0, Math.min(100, Math.round((j.progress.fraction || 0) * 100)));
              const isActive = j.status === "running" || j.status === "queued";
              return (
                <div key={j.id} className="border-b border-border/60 px-3 py-2 last:border-b-0">
                  <div className="flex items-center gap-2">
                    {statusIcon(j)}
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[12px] font-medium text-foreground">
                        {jobLabel(j.kind)} — {j.docLabel}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {j.status === "failed"
                          ? j.error ?? "Failed"
                          : j.progress.step ?? j.status}
                      </div>
                    </div>
                    {isActive ? (
                      <button
                        type="button"
                        onClick={() => cancelJob(j.id)}
                        aria-label="Cancel job"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => dismissJob(j.id)}
                        aria-label="Dismiss"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {isActive && (
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-vault transition-[width] duration-200"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
