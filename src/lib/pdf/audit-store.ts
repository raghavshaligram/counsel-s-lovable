/**
 * Audit store — per-export-run capture of stage snapshots + stage diffs.
 *
 * Enabled when `import.meta.env.DEV` OR `localStorage["vault:audit"] === "1"`.
 * Results are logged to console (grouped per stage transition) and stashed on
 * `window.__vaultAudit` for interactive inspection.
 */
import { auditStage, diffStages, type AuditStage, type StageAudit, type StageDiff, type HashDelta } from "./audit-object-graph";

export interface AuditRun {
  startedAt: number;
  perRun: StageAudit[];
  diffs: StageDiff[];
}

let current: AuditRun | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __vaultAudit: AuditRun | null | undefined;
}

export function isAuditEnabled(): boolean {
  try {
    const flag = typeof localStorage !== "undefined" && localStorage.getItem("vault:audit") === "1";
    // import.meta.env.DEV may be undefined in some runtimes.
    const dev = typeof import.meta !== "undefined" && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
    return flag || dev;
  } catch {
    return false;
  }
}

export function beginAuditRun(): AuditRun | null {
  if (!isAuditEnabled()) return null;
  current = { startedAt: Date.now(), perRun: [], diffs: [] };
  if (typeof window !== "undefined") (window as unknown as { __vaultAudit: AuditRun }).__vaultAudit = current;
  // eslint-disable-next-line no-console
  console.info("[audit] run started — window.__vaultAudit");
  return current;
}

export function currentRun(): AuditRun | null {
  return current;
}

const MB = (n: number) => Math.round((n / 1024 / 1024) * 100) / 100;

function summarizeDeltas(list: HashDelta[], limit = 10) {
  return list.slice(0, limit).map((d) => ({
    kind: d.kind,
    MB_each: MB(d.bytesEach),
    before: d.copiesBefore,
    after: d.copiesAfter,
    delta: d.copiesDelta,
    wasted_MB: MB(d.wastedBytesDelta),
    hint: d.hint ?? "",
    sha: d.sha256.slice(0, 12),
  }));
}

export async function captureStage(stage: AuditStage, bytes: Uint8Array): Promise<StageAudit | null> {
  if (!current) return null;
  const t0 = performance.now();
  let audit: StageAudit;
  try {
    audit = await auditStage(bytes, stage);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[audit] captureStage(${stage}) failed`, err);
    return null;
  }
  const ms = Math.round(performance.now() - t0);
  current.perRun.push(audit);

  // eslint-disable-next-line no-console
  console.groupCollapsed(`[audit] stage=${stage}  fileMB=${MB(audit.fileBytes)}  streams=${Object.keys(audit.streams).length}  objs=${audit.totalIndirectObjects}  (${ms}ms)`);
  // eslint-disable-next-line no-console
  console.table({
    fileMB: MB(audit.fileBytes),
    streamMB: MB(audit.totalStreamBytes),
    Image_MB: MB(audit.bytesByKind.Image),
    FontFile_MB: MB(audit.bytesByKind.FontFile),
    Form_MB: MB(audit.bytesByKind.Form),
    AnnotAP_MB: MB(audit.bytesByKind.AnnotAP),
    Content_MB: MB(audit.bytesByKind.ContentStream),
    Other_MB: MB(audit.bytesByKind.Other),
  });
  // eslint-disable-next-line no-console
  console.table({
    Image_copies: audit.copiesByKind.Image, Image_unique: audit.uniqueByKind.Image,
    Font_copies: audit.copiesByKind.FontFile, Font_unique: audit.uniqueByKind.FontFile,
    Form_copies: audit.copiesByKind.Form, Form_unique: audit.uniqueByKind.Form,
    AnnotAP_copies: audit.copiesByKind.AnnotAP, AnnotAP_unique: audit.uniqueByKind.AnnotAP,
  });
  // eslint-disable-next-line no-console
  console.groupEnd();

  // If we have a previous stage, log the diff — this is the primary payload.
  if (current.perRun.length >= 2) {
    const prev = current.perRun[current.perRun.length - 2];
    const diff = diffStages(prev, audit);
    current.diffs.push(diff);
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[audit] ${prev.stage} → ${audit.stage}   ΔfileMB=${MB(diff.fileBytesDelta)}   duplicated=${diff.duplicated.length}   introduced=${diff.introduced.length}   removed=${diff.removed.length}`);
    if (diff.duplicated.length) {
      // eslint-disable-next-line no-console
      console.log(`▼ DUPLICATED (top ${Math.min(10, diff.duplicated.length)} by wasted bytes) — this is the culprit list`);
      // eslint-disable-next-line no-console
      console.table(summarizeDeltas(diff.duplicated));
    }
    if (diff.introduced.length) {
      // eslint-disable-next-line no-console
      console.log(`▼ INTRODUCED (top ${Math.min(10, diff.introduced.length)} by total bytes)`);
      // eslint-disable-next-line no-console
      console.table(summarizeDeltas(diff.introduced));
    }
    if (diff.removed.length) {
      // eslint-disable-next-line no-console
      console.log(`▼ REMOVED (top ${Math.min(5, diff.removed.length)})`);
      // eslint-disable-next-line no-console
      console.table(summarizeDeltas(diff.removed, 5));
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  }

  return audit;
}

export function endAuditRun(): AuditRun | null {
  const run = current;
  if (run) {
    // eslint-disable-next-line no-console
    console.info(`[audit] run finished — ${run.perRun.length} stages, ${run.diffs.length} transitions. window.__vaultAudit holds full data.`);
  }
  current = null;
  return run;
}

/** Serialize the run to a compact JSON string for the "Copy JSON" button.
 *  Truncates per-hash `refs`/`refCounts` to 20 entries to keep output usable. */
export function serializeRun(run: AuditRun): string {
  const trimmed = {
    startedAt: run.startedAt,
    perRun: run.perRun.map((s) => ({
      stage: s.stage,
      fileBytes: s.fileBytes,
      totalIndirectObjects: s.totalIndirectObjects,
      bytesByKind: s.bytesByKind,
      copiesByKind: s.copiesByKind,
      uniqueByKind: s.uniqueByKind,
      totalStreamBytes: s.totalStreamBytes,
      streams: Object.fromEntries(
        Object.entries(s.streams).map(([h, r]) => [
          h,
          {
            ...r,
            refs: r.refs.slice(0, 20),
            refCounts: r.refCounts.slice(0, 20),
          },
        ]),
      ),
    })),
    diffs: run.diffs,
  };
  return JSON.stringify(trimmed, null, 2);
}
