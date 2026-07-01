/**
 * Built-in Workflow Builder templates — pre-made pipelines that seed the
 * canvas for common legal tasks. Users load one, customize params, then
 * "Save as..." to persist as their own workflow.
 *
 * IMPORTANT: templates must reference the SAME op names as the automation
 * registry. Redaction uses the pattern/AI adapters that share the verified
 * burn + gate path (never a bypass). Steps that can't run headless
 * (privilege report, AI detect) are surfaced with a "manual" note in the
 * builder so users can substitute or run them via the dedicated tool.
 */
import type { PipelineStep } from "@/lib/automation/types";

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  steps: PipelineStep[];
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "discovery-prep",
    name: "Discovery Prep",
    description: "OCR scans, redact obvious PII patterns, then Bates-stamp and sanitize.",
    steps: [
      { op: "ocr", label: "OCR (text layer)", params: { languages: ["eng"], highAccuracy: false } },
      {
        op: "redact-pattern",
        label: "Pattern redact (SSN + emails)",
        params: {
          query: "\\b\\d{3}-\\d{2}-\\d{4}\\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
          regex: true,
          matchCase: false,
          wholeWord: false,
          scope: "word",
          ocr: false,
        },
      },
      {
        op: "bates",
        label: "Bates stamp",
        params: {
          prefix: "PROD",
          startAt: 1,
          digits: 6,
          position: "br",
          fontSize: 10,
          color: "black",
          margin: 24,
        },
      },
      { op: "sanitize", label: "Sanitize / strip metadata", params: {} },
    ],
  },
  {
    id: "production-set",
    name: "Production Set",
    description: "Bates-stamp, sanitize, then export as PDF/A for archival production.",
    steps: [
      {
        op: "bates",
        label: "Bates stamp",
        params: {
          prefix: "BATES",
          startAt: 1,
          digits: 6,
          position: "br",
          fontSize: 10,
          color: "black",
          margin: 24,
        },
      },
      { op: "sanitize", label: "Sanitize / strip metadata", params: {} },
      { op: "to-pdfa", label: "PDF/A export", params: {} },
    ],
  },
  {
    id: "privilege-pass",
    name: "Privilege Pass",
    description: "Redact common privilege markers (attorney-client, work product) with a keyword sweep.",
    steps: [
      { op: "ocr", label: "OCR (text layer)", params: { languages: ["eng"], highAccuracy: false } },
      {
        op: "redact-pattern",
        label: "Privilege keyword redact",
        params: {
          query: "attorney[- ]client|work[- ]product|privileged|confidential communication",
          regex: true,
          matchCase: false,
          wholeWord: false,
          scope: "word",
          ocr: false,
        },
      },
      {
        op: "watermark",
        label: "PRIVILEGED watermark",
        params: { text: "PRIVILEGED", opacity: 20, size: 72, pos: "diagonal" },
      },
    ],
  },
  {
    id: "file-ready",
    name: "File-Ready",
    description: "Sanitize, redact obvious PII, then export as PDF/A for court filing.",
    steps: [
      { op: "sanitize", label: "Sanitize / strip metadata", params: {} },
      {
        op: "redact-pattern",
        label: "Pattern redact (SSN)",
        params: {
          query: "\\b\\d{3}-\\d{2}-\\d{4}\\b",
          regex: true,
          matchCase: false,
          wholeWord: false,
          scope: "word",
          ocr: false,
        },
      },
      { op: "to-pdfa", label: "PDF/A export", params: {} },
    ],
  },
];
