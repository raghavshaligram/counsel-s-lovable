// Public types for the font resolver. See src/lib/fonts/resolver.ts for the
// resolution algorithm and src/lib/fonts/registry.ts for the canonical catalog.

export type FontKind = "sans" | "serif" | "mono" | "display";

export type FontVendor =
  | "microsoft"
  | "adobe"
  | "google"
  | "apple"
  | "legal"
  | "engineering"
  | "generic";

export interface FontQuery {
  /** 1. Embedded PDF font descriptor (/FontName from the FontDescriptor dict). */
  descriptor?: string;
  /** 2. PostScript name (e.g. "TimesNewRomanPS-BoldItalicMT"). */
  postscriptName?: string;
  /** 3. PDF font family (/FontFamily entry). */
  pdfFamily?: string;
  /** 4. CSS font-family string, may be a comma-separated stack. */
  cssFamily?: string;
  /** Optional numeric or CSS-keyword weight hint (200, "bold", "semibold"…). */
  weightHint?: number | string;
  /** Optional italic override, when the caller already knows. */
  italicHint?: boolean;
}

export interface CanonicalFont {
  /** Stable slug id, e.g. "arial", "times-new-roman". */
  id: string;
  /** Display name, e.g. "Times New Roman". */
  family: string;
  kind: FontKind;
  vendor: FontVendor;
  /** Ready-to-use CSS font-family stack. */
  cssStack: string;
  /** Metric-compatible open twin for embedding (Calibri → Carlito, etc.). */
  metricTwin?: string;
}

export type ResolveSource =
  | "descriptor"
  | "postscript"
  | "pdfFamily"
  | "cssFamily"
  | "alias"
  | "generic";

export interface ResolveResult {
  font: CanonicalFont;
  weight: number; // 100..900
  italic: boolean;
  bold: boolean; // weight >= 600
  confidence: number; // 0..1
  exact: boolean;
  source: ResolveSource;
  /** Which alias/id/token produced the hit (for diagnostics). */
  matchedKey?: string;
}
