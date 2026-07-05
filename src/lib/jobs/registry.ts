/**
 * App-level background job registry.
 *
 * Jobs are decoupled from the active tab: starting an OCR / redaction /
 * detection run creates an entry here; the entry survives tab switches
 * and tab closes. UI (jobs indicator, toasts) subscribes to this store.
 *
 * Execution model: each job runs an async worker function that already
 * yields to the event loop and (where relevant) offloads CPU work to
 * Web Workers (Tesseract, OffscreenCanvas rendering). The registry
 * enforces a concurrency cap so rapid job creation queues rather than
 * piles memory.
 *
 * Cancellation: each job carries an AbortController; cancel() aborts the
 * signal, and cooperating pipelines (detect-pii, rasterize, verify, ocr)
 * observe it at page boundaries.
 */
import { create } from "zustand";
import { toast } from "sonner";

export type JobKind =
  | "ocr"
  | "detect-pii"
  | "rasterize-redact"
  | "redact-export"
  | "verify"
  | "compress"
  | "bates"
  | "watermark"
  | "split"
  | "exhibit-binder"
  | "extract-chunks";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type JobProgress = {
  /** 0..1 */
  fraction: number;
  /** Short human step, e.g. "OCR page 812/3000". */
  step?: string;
};

export type Job = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** Tab id that started the job. Job outlives the tab. */
  docId: string;
  /** Filename snapshot at start — safe to render even if tab is closed. */
  docLabel: string;
  progress: JobProgress;
  startedAt: number;
  endedAt?: number;
  error?: string;
  /** Aborts the job. */
  cancel: () => void;
};

type JobState = {
  jobs: Job[];
  cancelJob: (id: string) => void;
  dismissJob: (id: string) => void;
  clearFinished: () => void;
};

/** Max heavy jobs running simultaneously. Additional jobs queue. */
export const CONCURRENCY_CAP = 2;

// Zustand store — module-singleton, independent of any component tree.
export const useJobsStore = create<JobState>((set, get) => ({
  jobs: [],
  cancelJob: (id) => {
    const j = get().jobs.find((x) => x.id === id);
    if (j && (j.status === "running" || j.status === "queued")) {
      try { j.cancel(); } catch { /* noop */ }
    }
  },
  dismissJob: (id) =>
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
  clearFinished: () =>
    set((s) => ({
      jobs: s.jobs.filter(
        (j) => j.status === "running" || j.status === "queued",
      ),
    })),
}));

// ---- internals ---------------------------------------------------------

type Pending = {
  job: Job;
  run: (signal: AbortSignal, onProgress: (p: JobProgress) => void) => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  controller: AbortController;
};

const queue: Pending[] = [];
let runningCount = 0;

type CompletionListener = (job: Job, result: unknown) => void;
const completionListeners = new Set<CompletionListener>();

export function onJobCompletion(cb: CompletionListener): () => void {
  completionListeners.add(cb);
  return () => completionListeners.delete(cb);
}

function updateJob(id: string, patch: Partial<Job>) {
  useJobsStore.setState((s) => ({
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
  }));
}

function nextId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pump() {
  while (runningCount < CONCURRENCY_CAP && queue.length > 0) {
    const p = queue.shift()!;
    if (p.controller.signal.aborted) {
      updateJob(p.job.id, { status: "canceled", endedAt: Date.now() });
      p.reject(new DOMException("Canceled", "AbortError"));
      continue;
    }
    runningCount += 1;
    updateJob(p.job.id, { status: "running" });
    const onProgress = (prog: JobProgress) => {
      updateJob(p.job.id, { progress: prog });
    };
    p.run(p.controller.signal, onProgress).then(
      (result) => {
        runningCount -= 1;
        updateJob(p.job.id, {
          status: "completed",
          endedAt: Date.now(),
          progress: { fraction: 1, step: "Done" },
        });
        const done = useJobsStore.getState().jobs.find((j) => j.id === p.job.id);
        if (done) {
          for (const cb of completionListeners) {
            try { cb(done, result); } catch { /* noop */ }
          }
        }
        p.resolve(result);
        pump();
      },
      (err) => {
        runningCount -= 1;
        const aborted =
          err instanceof DOMException && err.name === "AbortError";
        updateJob(p.job.id, {
          status: aborted ? "canceled" : "failed",
          endedAt: Date.now(),
          error: aborted ? undefined : (err instanceof Error ? err.message : String(err)),
        });
        const done = useJobsStore.getState().jobs.find((j) => j.id === p.job.id);
        if (done && !aborted) {
          for (const cb of completionListeners) {
            try { cb(done, undefined); } catch { /* noop */ }
          }
        }
        p.reject(err);
        pump();
      },
    );
  }
}

export type StartJobSpec = {
  kind: JobKind;
  docId: string;
  docLabel: string;
};

/**
 * Run an async operation as a tracked background job.
 *
 * The runner receives an AbortSignal and a progress reporter. It should
 * observe the signal at page boundaries and call onProgress periodically.
 *
 * Returns the operation's result. The caller may `await` it while the
 * user works on other tabs — the job continues regardless of tab focus.
 */
export function runAsJob<T>(
  spec: StartJobSpec,
  run: (ctx: {
    signal: AbortSignal;
    onProgress: (p: JobProgress) => void;
    jobId: string;
  }) => Promise<T>,
): { jobId: string; promise: Promise<T> } {
  const controller = new AbortController();
  const id = nextId();
  const job: Job = {
    id,
    kind: spec.kind,
    status: "queued",
    docId: spec.docId,
    docLabel: spec.docLabel,
    progress: { fraction: 0, step: "Queued" },
    startedAt: Date.now(),
    cancel: () => controller.abort(),
  };
  useJobsStore.setState((s) => ({ jobs: [...s.jobs, job] }));

  const promise = new Promise<T>((resolve, reject) => {
    queue.push({
      job,
      controller,
      run: (signal, onProgress) =>
        run({ signal, onProgress, jobId: id }),
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    pump();
  });
  return { jobId: id, promise };
}

// ---- selectors ---------------------------------------------------------

export function activeJobs(jobs: Job[]): Job[] {
  return jobs.filter((j) => j.status === "running" || j.status === "queued");
}

export function jobLabel(kind: JobKind): string {
  switch (kind) {
    case "ocr": return "OCR";
    case "detect-pii": return "Scanning for PII";
    case "rasterize-redact": return "Rasterizing";
    case "redact-export": return "Redacting";
    case "verify": return "Verifying";
  }
}

// ---- global completion toasts -----------------------------------------
// Registered once (module init) so toasts fire regardless of which tab is
// focused when a job finishes.
let toastsBound = false;
export function bindGlobalCompletionToasts() {
  if (toastsBound) return;
  toastsBound = true;
  onJobCompletion((job) => {
    if (job.status === "completed") {
      toast.success(`${jobLabel(job.kind)} complete`, {
        description: job.docLabel,
      });
    } else if (job.status === "failed") {
      toast.error(`${jobLabel(job.kind)} failed`, {
        description: `${job.docLabel}${job.error ? ` — ${job.error}` : ""}`,
      });
    }
  });
}
