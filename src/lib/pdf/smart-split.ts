/**
 * Smart Document Splitter — detection-driven splitting.
 *
 * Extends the existing Split tool (see ./split.ts). All detection runs
 * on-device and yields between pages so the UI stays responsive.
 *
 * Detection modes:
 *   - blank     : near-empty scan-separator pages
 *   - everyN    : split every N pages
 *   - outline   : split at top-level PDF bookmarks
 *   - pattern   : split at pages matching a text pattern (regex or literal)
 *
 * A "break page" is the FIRST page of a new resulting document (1-based,
 * always > 1). Groups are derived by `groupsFromBreaks` and can be split
 * with `splitByGroups` — which streams each part into a zip so we never
 * hold every output in memory at once.
 */
import { PDFDocument } from "pdf-lib";
import { importChunk } from "@/lib/chunk-import";
import { loadPdfjs } from "@/lib/pdf/worker";
import { parsePdf } from "@/lib/outline/parse";
import type { OutlineNode } from "@/lib/outline/types";

// ---------- Types ---------------------------------------------------

export type DetectionMode = "blank" | "everyN" | "outline" | "pattern";

export type PatternKind = "literal" | "regex";

export interface SmartDetectOptions {
  modes: DetectionMode[];
  everyN?: number;
  pattern?: string;
  patternKind?: PatternKind;
  patternCaseSensitive?: boolean;
  /** Anchor pattern to the START of the page text (default true — titles/headings). */
  patternAnchorStart?: boolean;
  /** Yield control between pages so the UI stays responsive. */
  onProgress?: (page: number, total: number, stage: string) => void;
}

export interface DetectedBreak {
  /** 1-based page number where a NEW document begins (always > 1, <= total). */
  page: number;
  /** Which detector(s) proposed this break. */
  sources: DetectionMode[];
  /** Short human-readable reason ("blank separator", "outline: Exhibit A", …). */
  reason: string;
  /** Suggested name for the resulting doc that STARTS at this page. */
  suggestedName?: string;
}

export interface SmartDetectResult {
  total: number;
  breaks: DetectedBreak[];
  /** 1-based page numbers detected as blank/separator (only populated when
   *  the "blank" mode ran). Consumers typically exclude these from output. */
  blankPages: number[];
  /** First-doc suggested name (before the first break). */
  firstName?: string;
}

export interface PartPreview {
  index: number;         // 0-based
  /** 1-based page numbers included in this document, in order. Excludes
   *  any dropped separator pages, so the array IS the final content. */
  pages: number[];
  startPage: number;     // 1-based inclusive (= pages[0])
  endPage: number;       // 1-based inclusive (= pages[pages.length-1])
  pageCount: number;     // = pages.length
  name: string;          // suggested filename (no extension)
  reason?: string;       // why the split BEFORE startPage
}

export interface SplitProgress {
  part: number;
  total: number;
}

// ---------- Helpers -------------------------------------------------

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

function sanitizeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function padIndex(i: number, total: number): string {
  const width = String(total).length;
  return String(i).padStart(Math.max(2, width), "0");
}

/** Build page-open groups (arrays of 1-based page numbers) from break pages. */
export function groupsFromBreaks(total: number, breakPages: number[]): number[][] {
  const cleaned = Array.from(new Set(breakPages))
    .filter((n) => Number.isInteger(n) && n > 1 && n <= total)
    .sort((a, b) => a - b);
  const cuts = [1, ...cleaned, total + 1];
  const groups: number[][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1] - 1;
    if (end < start) continue;
    const g: number[] = [];
    for (let p = start; p <= end; p++) g.push(p);
    groups.push(g);
  }
  return groups;
}

// ---------- Per-page text cache ------------------------------------

async function extractPageTexts(
  file: File,
  onProgress?: (page: number, total: number, stage: string) => void,
  stage = "Reading pages",
): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages, stage);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    out.push(text);
    await yieldToUi();
  }
  return out;
}

// ---------- Detection: blank / separator pages ---------------------

/** A page is "blank" if it has almost no extractable text. */
function isBlankPageText(text: string): boolean {
  return text.replace(/\s/g, "").length < 8;
}

// ---------- Detection: outline -------------------------------------

function flattenTopLevelOutline(nodes: OutlineNode[]): { title: string; page: number }[] {
  return nodes
    .filter((n) => n.dest && Number.isFinite(n.dest.page))
    .map((n) => ({ title: n.title || "Untitled", page: (n.dest!.page ?? 0) + 1 }));
}

// ---------- Detection: text pattern --------------------------------

function buildMatcher(opts: SmartDetectOptions): ((text: string) => string | null) | null {
  const raw = (opts.pattern ?? "").trim();
  if (!raw) return null;
  const anchor = opts.patternAnchorStart !== false;
  if (opts.patternKind === "regex") {
    try {
      const flags = opts.patternCaseSensitive ? "" : "i";
      const rx = new RegExp(raw, flags);
      return (text) => {
        const head = anchor ? text.slice(0, 200) : text;
        const m = head.match(rx);
        return m ? m[0].slice(0, 80) : null;
      };
    } catch {
      return null;
    }
  }
  const needle = opts.patternCaseSensitive ? raw : raw.toLowerCase();
  return (text) => {
    const head = anchor ? text.slice(0, 200) : text;
    const hay = opts.patternCaseSensitive ? head : head.toLowerCase();
    const idx = hay.indexOf(needle);
    if (idx < 0) return null;
    return head.slice(idx, idx + Math.max(needle.length, 40));
  };
}

// ---------- Public: detect ------------------------------------------

export async function detectSmartBreaks(
  file: File,
  opts: SmartDetectOptions,
): Promise<SmartDetectResult> {
  const modes = new Set(opts.modes);
  if (modes.size === 0) {
    // count pages so caller has something to show
    const pdfDoc = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    return { total: pdfDoc.getPageCount(), breaks: [], blankPages: [] };
  }

  const needsText = modes.has("blank") || modes.has("pattern");
  let texts: string[] = [];
  let total = 0;

  if (needsText) {
    texts = await extractPageTexts(file, opts.onProgress);
    total = texts.length;
  } else {
    const pdfDoc = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    total = pdfDoc.getPageCount();
  }

  const map = new Map<number, DetectedBreak>();
  const addBreak = (page: number, source: DetectionMode, reason: string, name?: string) => {
    if (page <= 1 || page > total) return;
    const cur = map.get(page);
    if (cur) {
      if (!cur.sources.includes(source)) cur.sources.push(source);
      if (!cur.suggestedName && name) cur.suggestedName = name;
      if (!cur.reason.includes(reason)) cur.reason = cur.reason + " · " + reason;
    } else {
      map.set(page, { page, sources: [source], reason, suggestedName: name });
    }
  };

  // Blank/separator pages: blanks DELIMIT documents. For every run of one
  // or more blank pages, the first content page after the run starts a
  // new document. The blanks themselves are dropped from output.
  const blankPages: number[] = [];
  if (modes.has("blank") && texts.length) {
    for (let i = 0; i < texts.length; i++) {
      if (isBlankPageText(texts[i])) blankPages.push(i + 1);
    }
    // Walk once and mark the first non-blank AFTER each blank run.
    let i = 0;
    while (i < texts.length) {
      if (!isBlankPageText(texts[i])) {
        i++;
        continue;
      }
      // Skip the whole blank run
      while (i < texts.length && isBlankPageText(texts[i])) i++;
      if (i < texts.length) {
        addBreak(i + 1, "blank", "after blank separator");
      }
    }
  }

  // Every N pages
  if (modes.has("everyN")) {
    const n = Math.max(1, Math.floor(opts.everyN ?? 10));
    for (let start = 1 + n; start <= total; start += n) {
      addBreak(start, "everyN", `every ${n} pages`);
    }
  }

  // Outline / bookmarks
  if (modes.has("outline")) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { parsed } = await parsePdf(bytes);
      const top = flattenTopLevelOutline(parsed.outline);
      for (const item of top) {
        if (item.page > 1) {
          addBreak(item.page, "outline", `bookmark: ${item.title}`, sanitizeName(item.title));
        }
      }
    } catch {
      /* outline optional */
    }
  }

  // Text pattern — a new document starts only when the matched IDENTIFIER
  // changes. "EXHIBIT A" followed by "EXHIBIT A (continued)" stays inside
  // one document; the split fires when the identifier flips to "EXHIBIT B".
  if (modes.has("pattern")) {
    const match = buildMatcher(opts);
    if (match && texts.length) {
      let lastKey: string | null = null;
      for (let p = 0; p < texts.length; p++) {
        const hit = match(texts[p]);
        if (!hit) continue;
        const key = normalizePatternKey(hit);
        if (!key) continue;
        if (lastKey === null) {
          // First matching page: only breaks if it isn't page 1.
          if (p + 1 > 1) {
            addBreak(p + 1, "pattern", `starts "${hit}"`, sanitizeName(hit));
          }
        } else if (key !== lastKey) {
          addBreak(p + 1, "pattern", `starts "${hit}"`, sanitizeName(hit));
        }
        lastKey = key;
      }
    }
  }

  const breaks = Array.from(map.values()).sort((a, b) => a.page - b.page);

  // First-doc name: derive from outline top-level page-1 title if present.
  let firstName: string | undefined;
  if (modes.has("outline")) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { parsed } = await parsePdf(bytes);
      const top = flattenTopLevelOutline(parsed.outline);
      const first = top.find((t) => t.page === 1);
      if (first) firstName = sanitizeName(first.title);
    } catch {
      /* ignore */
    }
  }

  return { total, breaks, blankPages, firstName };
}

// ---------- Public: preview -----------------------------------------

export interface BuildPreviewInput {
  total: number;
  breakPages: number[];                        // 1-based, > 1
  /** Pages to DROP from output (e.g. blank separator pages). */
  excludePages?: number[];
  names?: Record<number, string | undefined>;  // startPage → suggested name
  reasons?: Record<number, string | undefined>;
  baseName: string;
}

export function buildPreview(input: BuildPreviewInput): PartPreview[] {
  const exclude = new Set(input.excludePages ?? []);
  const groups = groupsFromBreaks(input.total, input.breakPages);
  const parts: PartPreview[] = [];
  let visibleIndex = 0;
  for (const g of groups) {
    const pages = g.filter((p) => !exclude.has(p));
    if (pages.length === 0) continue; // whole group was separators
    const startPage = pages[0];
    // Look up the suggested name using the ORIGINAL group start (the break
    // page) so pattern/outline detections still attach even if that page
    // itself was skipped as a separator.
    const suggested = input.names?.[g[0]] ?? input.names?.[startPage];
    const totalParts = groups.length; // upper bound for padding width
    const name = suggested
      ? `${input.baseName}-${padIndex(visibleIndex + 1, totalParts)}-${suggested}`
      : `${input.baseName}-part${padIndex(visibleIndex + 1, totalParts)}`;
    parts.push({
      index: visibleIndex,
      pages,
      startPage,
      endPage: pages[pages.length - 1],
      pageCount: pages.length,
      name,
      reason: input.reasons?.[g[0]] ?? input.reasons?.[startPage],
    });
    visibleIndex++;
  }
  return parts;
}

// ---------- Public: split by groups ---------------------------------

export interface SmartSplitOutput {
  kind: "zip";
  blob: Blob;
  filename: string;
  fileCount: number;
  pageCount: number;
}

/**
 * Copy the pages for each part into its own PDF, streaming into a zip.
 * The source PDFDocument is loaded ONCE and reused; each output document
 * is created, written, and released before the next one starts so memory
 * stays bounded regardless of input size.
 */
export async function splitByParts(
  file: File,
  parts: PartPreview[],
  opts: { zipName?: string; onProgress?: (p: SplitProgress) => void } = {},
): Promise<SmartSplitOutput> {
  if (parts.length === 0) throw new Error("No parts to split");
  const src = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const JSZip = (await importChunk(() => import("jszip"))).default;
  const zip = new JSZip();

  // Ensure unique filenames within the zip.
  const used = new Set<string>();
  const uniq = (base: string): string => {
    let name = `${base}.pdf`;
    let n = 2;
    while (used.has(name)) {
      name = `${base} (${n}).pdf`;
      n++;
    }
    used.add(name);
    return name;
  };

  let totalPages = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    opts.onProgress?.({ part: i + 1, total: parts.length });
    const indices: number[] = part.pages.map((p) => p - 1);
    totalPages += indices.length;
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    copied.forEach((pg) => out.addPage(pg));
    const bytes = await out.save();
    zip.file(uniq(sanitizeName(part.name) || `part${i + 1}`), bytes);
    await yieldToUi();
  }

  const base = file.name.replace(/\.pdf$/i, "");
  const blob = await zip.generateAsync({ type: "blob" });
  return {
    kind: "zip",
    blob,
    filename: opts.zipName ?? `${base}-smart-split.zip`,
    fileCount: parts.length,
    pageCount: totalPages,
  };
}
