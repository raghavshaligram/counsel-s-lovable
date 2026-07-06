import { create } from "zustand";
import type { Detection } from "@/lib/pdf/detect-pii";

export type PiiScanStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type PiiScanRecord = {
  docId: string;
  docLabel: string;
  jobId: string;
  status: PiiScanStatus;
  progress: string;
  findings: Detection[] | null;
  usedOcr: boolean;
  scannedPages: number[];
  lowConfidenceOcrPages: number[];
  ocrUnderDetectedPages: number[];
  totalPagesScanned: number;
  error?: string;
  startedAt: number;
  endedAt?: number;
};

type BeginScan = {
  docId: string;
  docLabel: string;
  jobId: string;
};

type CompleteScan = {
  findings: Detection[];
  usedOcr: boolean;
  scannedPages: number[];
  lowConfidenceOcrPages: number[];
  ocrUnderDetectedPages: number[];
  totalPagesScanned: number;
};

type PiiScanState = {
  scans: Record<string, PiiScanRecord>;
  beginScan: (scan: BeginScan) => void;
  updateProgress: (docId: string, progress: string) => void;
  appendFindings: (docId: string, findings: Detection[]) => void;
  completeScan: (docId: string, result: CompleteScan) => void;
  failScan: (docId: string, error: string, canceled?: boolean) => void;
  clearScan: (docId: string) => void;
};

export const usePiiScanResultsStore = create<PiiScanState>((set) => ({
  scans: {},
  beginScan: ({ docId, docLabel, jobId }) =>
    set((s) => ({
      scans: {
        ...s.scans,
        [docId]: {
          docId,
          docLabel,
          jobId,
          status: "queued",
          progress: "Queued…",
          findings: null,
          usedOcr: false,
          scannedPages: [],
          lowConfidenceOcrPages: [],
          ocrUnderDetectedPages: [],
          totalPagesScanned: 0,
          startedAt: Date.now(),
        },
      },
    })),
  updateProgress: (docId, progress) =>
    set((s) => {
      const cur = s.scans[docId];
      if (!cur || cur.status === "completed" || cur.status === "failed" || cur.status === "canceled") return s;
      return {
        scans: {
          ...s.scans,
          [docId]: { ...cur, status: "running", progress },
        },
      };
    }),
  appendFindings: (docId, findings) => {
    if (findings.length === 0) return;
    set((s) => {
      const cur = s.scans[docId];
      if (!cur || cur.status === "completed" || cur.status === "failed" || cur.status === "canceled") return s;
      return {
        scans: {
          ...s.scans,
          [docId]: {
            ...cur,
            status: "running",
            findings: [...(cur.findings ?? []), ...findings],
          },
        },
      };
    });
  },
  completeScan: (docId, result) =>
    set((s) => {
      const cur = s.scans[docId];
      if (!cur) return s;
      return {
        scans: {
          ...s.scans,
          [docId]: {
            ...cur,
            status: "completed",
            progress: "Done",
            findings: result.findings,
            usedOcr: result.usedOcr,
            scannedPages: result.scannedPages,
            lowConfidenceOcrPages: result.lowConfidenceOcrPages,
            ocrUnderDetectedPages: result.ocrUnderDetectedPages,
            totalPagesScanned: result.totalPagesScanned,
            endedAt: Date.now(),
          },
        },
      };
    }),
  failScan: (docId, error, canceled = false) =>
    set((s) => {
      const cur = s.scans[docId];
      if (!cur) return s;
      return {
        scans: {
          ...s.scans,
          [docId]: {
            ...cur,
            status: canceled ? "canceled" : "failed",
            progress: canceled ? "Canceled" : "Failed",
            error: canceled ? undefined : error,
            endedAt: Date.now(),
          },
        },
      };
    }),
  clearScan: (docId) =>
    set((s) => {
      const { [docId]: _drop, ...rest } = s.scans;
      void _drop;
      return { scans: rest };
    }),
}));
