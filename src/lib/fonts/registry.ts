// Canonical catalog of families the resolver knows about. Every entry is
// addressable by its `id` (a stable slug) via `getCanonical`.

import type { CanonicalFont } from "./types";

const FAMILIES: CanonicalFont[] = [
  // ── Microsoft Office ─────────────────────────────────────────────────
  { id: "arial",          family: "Arial",          kind: "sans",  vendor: "microsoft", cssStack: "Arial, Helvetica, sans-serif", metricTwin: "arimo" },
  { id: "arial-narrow",   family: "Arial Narrow",   kind: "sans",  vendor: "microsoft", cssStack: "'Arial Narrow', Arial, sans-serif" },
  { id: "calibri",        family: "Calibri",        kind: "sans",  vendor: "microsoft", cssStack: "Calibri, 'Segoe UI', sans-serif", metricTwin: "carlito" },
  { id: "aptos",          family: "Aptos",          kind: "sans",  vendor: "microsoft", cssStack: "Aptos, Calibri, 'Segoe UI', sans-serif" },
  { id: "cambria",        family: "Cambria",        kind: "serif", vendor: "microsoft", cssStack: "Cambria, Georgia, serif", metricTwin: "caladea" },
  { id: "candara",        family: "Candara",        kind: "sans",  vendor: "microsoft", cssStack: "Candara, 'Segoe UI', sans-serif" },
  { id: "consolas",       family: "Consolas",       kind: "mono",  vendor: "microsoft", cssStack: "Consolas, 'Courier New', monospace", metricTwin: "cousine" },
  { id: "courier-new",    family: "Courier New",    kind: "mono",  vendor: "microsoft", cssStack: "'Courier New', Courier, monospace", metricTwin: "cousine" },
  { id: "georgia",        family: "Georgia",        kind: "serif", vendor: "microsoft", cssStack: "Georgia, 'Times New Roman', serif" },
  { id: "segoe-ui",       family: "Segoe UI",       kind: "sans",  vendor: "microsoft", cssStack: "'Segoe UI', Tahoma, sans-serif" },
  { id: "tahoma",         family: "Tahoma",         kind: "sans",  vendor: "microsoft", cssStack: "Tahoma, Geneva, sans-serif" },
  { id: "trebuchet-ms",   family: "Trebuchet MS",   kind: "sans",  vendor: "microsoft", cssStack: "'Trebuchet MS', Arial, sans-serif" },
  { id: "verdana",        family: "Verdana",        kind: "sans",  vendor: "microsoft", cssStack: "Verdana, Geneva, sans-serif" },

  // ── Adobe ────────────────────────────────────────────────────────────
  { id: "helvetica",       family: "Helvetica",       kind: "sans",  vendor: "adobe", cssStack: "Helvetica, Arial, sans-serif", metricTwin: "arimo" },
  { id: "helvetica-neue",  family: "Helvetica Neue",  kind: "sans",  vendor: "adobe", cssStack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "times",           family: "Times",           kind: "serif", vendor: "adobe", cssStack: "Times, 'Times New Roman', serif", metricTwin: "tinos" },
  { id: "times-new-roman", family: "Times New Roman", kind: "serif", vendor: "adobe", cssStack: "'Times New Roman', Times, serif", metricTwin: "tinos" },
  { id: "myriad-pro",      family: "Myriad Pro",      kind: "sans",  vendor: "adobe", cssStack: "'Myriad Pro', Myriad, 'Helvetica Neue', Helvetica, sans-serif" },
  { id: "minion-pro",      family: "Minion Pro",      kind: "serif", vendor: "adobe", cssStack: "'Minion Pro', Minion, Georgia, serif" },
  { id: "garamond",        family: "Garamond",        kind: "serif", vendor: "adobe", cssStack: "Garamond, 'EB Garamond', Georgia, serif" },
  { id: "warnock",         family: "Warnock Pro",     kind: "serif", vendor: "adobe", cssStack: "'Warnock Pro', Warnock, Georgia, serif" },

  // ── Google ───────────────────────────────────────────────────────────
  { id: "roboto",     family: "Roboto",     kind: "sans",  vendor: "google", cssStack: "Roboto, Arial, sans-serif" },
  { id: "open-sans",  family: "Open Sans",  kind: "sans",  vendor: "google", cssStack: "'Open Sans', Arial, sans-serif" },
  { id: "noto-sans",  family: "Noto Sans",  kind: "sans",  vendor: "google", cssStack: "'Noto Sans', Arial, sans-serif" },
  { id: "noto-serif", family: "Noto Serif", kind: "serif", vendor: "google", cssStack: "'Noto Serif', 'Times New Roman', serif" },
  { id: "inter",      family: "Inter",      kind: "sans",  vendor: "google", cssStack: "Inter, 'Helvetica Neue', Arial, sans-serif" },

  // ── Apple ────────────────────────────────────────────────────────────
  { id: "sf-pro",         family: "SF Pro",         kind: "sans", vendor: "apple", cssStack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif" },
  { id: "geneva",         family: "Geneva",         kind: "sans", vendor: "apple", cssStack: "Geneva, Tahoma, sans-serif" },
  { id: "lucida-grande",  family: "Lucida Grande",  kind: "sans", vendor: "apple", cssStack: "'Lucida Grande', 'Lucida Sans Unicode', sans-serif" },

  // ── Legal ────────────────────────────────────────────────────────────
  { id: "book-antiqua",       family: "Book Antiqua",       kind: "serif", vendor: "legal", cssStack: "'Book Antiqua', Palatino, 'Palatino Linotype', serif" },
  { id: "century-schoolbook", family: "Century Schoolbook", kind: "serif", vendor: "legal", cssStack: "'Century Schoolbook', 'New Century Schoolbook', Georgia, serif" },
  { id: "bookman",            family: "Bookman",            kind: "serif", vendor: "legal", cssStack: "'Bookman Old Style', Bookman, Georgia, serif" },

  // ── Engineering ──────────────────────────────────────────────────────
  { id: "ocr-a",   family: "OCR-A",   kind: "mono",    vendor: "engineering", cssStack: "'OCR A Std', 'OCRA', monospace" },
  { id: "ocr-b",   family: "OCR-B",   kind: "mono",    vendor: "engineering", cssStack: "'OCR B Std', 'OCRB', monospace" },
  { id: "din",     family: "DIN",     kind: "sans",    vendor: "engineering", cssStack: "'DIN', 'DIN Next', 'Helvetica Neue', sans-serif" },
  { id: "univers", family: "Univers", kind: "sans",    vendor: "engineering", cssStack: "Univers, 'Helvetica Neue', Helvetica, sans-serif" },

  // ── Generic fallbacks ────────────────────────────────────────────────
  { id: "generic-sans",  family: "Sans Serif", kind: "sans",  vendor: "generic", cssStack: "system-ui, -apple-system, Arial, sans-serif" },
  { id: "generic-serif", family: "Serif",      kind: "serif", vendor: "generic", cssStack: "Georgia, 'Times New Roman', serif" },
  { id: "generic-mono",  family: "Monospace",  kind: "mono",  vendor: "generic", cssStack: "ui-monospace, 'Courier New', monospace" },
];

const BY_ID = new Map<string, CanonicalFont>(FAMILIES.map((f) => [f.id, f]));

export function getCanonical(id: string): CanonicalFont | undefined {
  return BY_ID.get(id);
}

export function allFamilies(): CanonicalFont[] {
  return FAMILIES.slice();
}

export function genericFor(kind: "sans" | "serif" | "mono"): CanonicalFont {
  return BY_ID.get(`generic-${kind}`)!;
}
