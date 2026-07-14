// Transaction extraction — shared types.

import type { ExtractedTable } from "@/lib/pdf/extract-tables";

export type DocType =
  | "bank_statement"
  | "invoice"
  | "ledes"
  | "generic";

export type Confidence = "low" | "medium" | "high";

export type DetectResult = {
  type: DocType;
  confidence: Confidence;
  evidence: string[];
};

export type Locale = "US" | "EU";

export type SchemaColumn = {
  key: string;
  label: string;
  kind: "date" | "text" | "number" | "money";
};

export type TypedRow = Record<string, string | number | null>;

export type ParseResult = {
  type: DocType;
  schema: SchemaColumn[];
  rows: TypedRow[];
  /** Optional summary (bank statements, invoices). */
  header?: Record<string, string | number | null>;
  /** Column mapping: schema.key -> raw column index (or null if not mapped). */
  mapping: Record<string, number | null>;
  /** Warnings (reconciliation failures, unrecognised codes, etc). */
  warnings: string[];
};

export type ParseCtx = {
  tables: ExtractedTable[];
  pageText: string;
  locale: Locale;
};
