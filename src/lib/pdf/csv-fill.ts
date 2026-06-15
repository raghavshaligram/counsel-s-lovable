/**
 * CSV → AcroForm batch fill. Reuses applyFormFill (already on-device,
 * pdf-lib based) and runs it once per CSV row.
 *
 *   parseCsv(text)            → { headers, rows }
 *   generateBatch({...})      → File[]   (one filled PDF per row)
 *
 * Mapping shape:
 *   { [pdfFieldName]: csvHeader | "" }
 * Empty string = leave the field at its current default for that row.
 */

import { applyFormFill } from "./sign-fill";

export type CsvData = { headers: string[]; rows: Record<string, string>[] };

/** Tiny RFC-4180-ish CSV parser. Handles quoted cells, embedded commas, and "". */
export function parseCsv(text: string): CsvData {
  // Normalise newlines, strip BOM.
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cur.push(cell);
        cell = "";
      } else if (c === "\n") {
        cur.push(cell);
        rows.push(cur);
        cur = [];
        cell = "";
      } else {
        cell += c;
      }
    }
  }
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell);
    rows.push(cur);
  }
  // Drop trailing blank rows.
  while (rows.length && rows[rows.length - 1].every((x) => x.trim() === "")) {
    rows.pop();
  }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
  return { headers, rows: dataRows };
}

export type GenerateBatchOpts = {
  file: File;
  rows: Record<string, string>[];
  /** PDF field name → CSV header (or "" to skip). */
  mapping: Record<string, string>;
  flatten: boolean;
  /** File naming. Available tokens: {i} = 1-based index, {col:HEADER}. */
  nameTemplate?: string;
  onProgress?: (done: number, total: number) => void;
};

export async function generateBatch({
  file,
  rows,
  mapping,
  flatten,
  nameTemplate = "{base} — row {i}.pdf",
  onProgress,
}: GenerateBatchOpts): Promise<File[]> {
  const base = file.name.replace(/\.pdf$/i, "");
  const out: File[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const values: Record<string, string> = {};
    for (const [field, header] of Object.entries(mapping)) {
      if (!header) continue;
      const v = row[header];
      if (v !== undefined) values[field] = v;
    }
    const filled = await applyFormFill({ file, values, flatten });
    const name = nameTemplate
      .replace(/\{base\}/g, base)
      .replace(/\{i\}/g, String(i + 1))
      .replace(/\{col:([^}]+)\}/g, (_, h) => row[h] ?? "");
    const safe = name.replace(/[\\/:*?"<>|]+/g, "_");
    out.push(new File([await filled.arrayBuffer()], safe, { type: "application/pdf" }));
    onProgress?.(i + 1, rows.length);
  }
  return out;
}
