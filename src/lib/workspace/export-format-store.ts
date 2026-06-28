/**
 * Preferred export format — persists "pdf" or "pdf-a" across sessions.
 * Surfaced wherever VaultPDF lets the user download a PDF; PDF/A is opt-in.
 */
import { useEffect, useState } from "react";

export type ExportFormat = "pdf" | "pdf-a";
const KEY = "vaultpdf.export-format";

const subs = new Set<(v: ExportFormat) => void>();

export function getExportFormat(): ExportFormat {
  if (typeof localStorage === "undefined") return "pdf";
  return localStorage.getItem(KEY) === "pdf-a" ? "pdf-a" : "pdf";
}

export function setExportFormat(v: ExportFormat) {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, v);
  for (const fn of subs) fn(v);
}

export function useExportFormat(): [ExportFormat, (v: ExportFormat) => void] {
  // Always start as "pdf" so SSR and the first client render agree;
  // hydrate the stored value after mount to avoid a hydration mismatch.
  const [v, setV] = useState<ExportFormat>("pdf");
  useEffect(() => {
    setV(getExportFormat());
    const cb = (next: ExportFormat) => setV(next);
    subs.add(cb);
    return () => { subs.delete(cb); };
  }, []);
  return [v, setExportFormat];
}

export const PDFA_NOTE =
  "PDF/A — archival format required by many courts for filing.";
