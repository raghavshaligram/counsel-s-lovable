/* eslint-disable @typescript-eslint/no-explicit-any */
 * Table of Authorities (TOA) — Pro feature.
 *
 * Reuses the Citation Hyperlinker's PATTERNS (single source of truth for
 * what counts as a citation) but does its own text extraction so it can
 * (a) join multiple pdf.js text-items into a single page string — case
 * names like "Miranda v. Arizona" almost always live in the run BEFORE
 * the reporter citation and would be lost if we scanned item-by-item as
 * the underline path does — and (b) capture a look-behind for the case
 * name preceding a reporter citation.
 *
 * Deterministic, on-device, single pdf.js pass. No re-parse of pdf-lib
 * on scan.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

import { loadPdfjs } from "@/lib/pdf/worker";
import { PATTERNS, type CitationKind } from "./detect";

export type ToaSection = "cases" | "statutes" | "rules" | "other";

export interface ToaEntry {
  id: string;
  section: ToaSection;
  /** Full display line, e.g. "Miranda v. Arizona, 384 U.S. 436 (1966)". */
  display: string;
  /** Lowercased sort key with leading "In re " / "Ex parte " / "The " stripped. */
  sortKey: string;
  /** 1-based page numbers, sorted ascending, deduplicated. */
  pages: number[];
  /** Raw reporter citation as extracted (for reference). */
  citation: string;
  kind: CitationKind;
}

export const SECTION_TITLES: Record<ToaSection, string> = {
  cases: "Cases",
  statutes: "Statutes",
  rules: "Rules & Regulations",
  other: "Other Authorities",
};

export const SECTION_ORDER: ToaSection[] = [
  "cases",
  "statutes",
  "rules",
  "other",
];

/**
 * Case-name lookbehind: matches "Foo v. Bar" or "In re Foo" style names
 * appearing IMMEDIATELY before the reporter citation (trailing comma /
 * whitespace tolerated). Party names are 1–7 tokens each; a token is a
 * capitalized word or one of the small connective words allowed in a
 * party name (of, and, &, the, de, la, du, van, van, di).
 */
const PARTY_WORD =
  "(?:[A-Z][A-Za-z0-9.'\\-]*|of|and|&|the|for|de|la|du|van|di|von)";
const CASE_LOOKBEHIND = new RegExp(
  `((?:In re |Ex parte |Matter of )?${PARTY_WORD}(?:\\s+${PARTY_WORD}){0,6}\\s+v\\.\\s+${PARTY_WORD}(?:\\s+${PARTY_WORD}){0,6}),?\\s*$`,
);
const IN_RE_LOOKBEHIND = new RegExp(
  `((?:In re|Ex parte|Matter of)\\s+${PARTY_WORD}(?:\\s+${PARTY_WORD}){0,7}),?\\s*$`,
);

/** Trailing "(YYYY)" that many case cites include — pull into the display. */
const YEAR_TRAILER = /^\s*\(\s*(\d{4})\s*\)/;

/** Rules / regs are US Code-shaped but should live under "Rules". */
const RULES_HINT =
  /\b(?:Fed\.\s?R\.|F\.\s?R\.\s?(?:Civ|Crim|App|Evid|Bankr)\.?\s?P\.|C\.F\.R\.)\b/;

function sectionFor(kind: CitationKind, text: string): ToaSection {
  if (RULES_HINT.test(text)) return "rules";
  if (kind === "us-code") return "statutes";
  if (
    kind === "us-supreme" ||
    kind === "federal-reporter" ||
    kind === "federal-supplement" ||
    kind === "regional-reporter"
  ) {
    return "cases";
  }
  return "other";
}

function makeSortKey(display: string): string {
  return display
    .toLowerCase()
    .replace(/^(in re\s+|ex parte\s+|matter of\s+|the\s+)/, "")
    .trim();
}

export interface ToaProgress {
  page: number;
  totalPages: number;
}

/**
 * Scan every page, aggregate citations into TOA entries (deduped by
 * display text). Pages are 1-indexed in the returned entries.
 */
export async function buildToa(
  bytes: Uint8Array,
  onProgress?: (p: ToaProgress) => void,
): Promise<ToaEntry[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const byKey = new Map<string, ToaEntry>();
  let counter = 0;
  try {
    const totalPages = doc.numPages;
    for (let p = 1; p <= totalPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Join items into a single normalized page string. This lets a case
      // name that sits in the item BEFORE the reporter citation still be
      // matched by the lookbehind — the item-level pass in detect.ts is
      // scoped tighter because it needs a per-glyph rect.
      const raw = (
        content.items as Array<{ str: string; hasEOL?: boolean }>
      )
        .map((it) => it.str ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      for (const { kind, re } of PATTERNS) {
        // PATTERNS use the /g flag — reset lastIndex per page.
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(raw)) !== null) {
          const cite = m[0];
          const section = sectionFor(kind, cite);
          let display = cite;

          if (section === "cases") {
            const before = raw.slice(Math.max(0, m.index - 160), m.index);
            const cm =
              CASE_LOOKBEHIND.exec(before) ?? IN_RE_LOOKBEHIND.exec(before);
            if (cm) {
              display = `${cm[1]}, ${cite}`;
            }
            // Grab a trailing "(YYYY)" year if present.
            const after = raw.slice(
              m.index + cite.length,
              m.index + cite.length + 12,
            );
            const ym = YEAR_TRAILER.exec(after);
            if (ym) display = `${display} (${ym[1]})`;
          }

          const key = display;
          const existing = byKey.get(key);
          if (existing) {
            if (!existing.pages.includes(p)) existing.pages.push(p);
          } else {
            byKey.set(key, {
              id: `toa-${counter++}`,
              section,
              display,
              sortKey: makeSortKey(display),
              pages: [p],
              citation: cite,
              kind,
            });
          }
        }
      }
      onProgress?.({ page: p, totalPages });
    }
  } finally {
    try {
      (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      /* ignore */
    }
  }

  const out = Array.from(byKey.values());
  for (const e of out) e.pages.sort((a, b) => a - b);
  return out;
}

export function groupToa(entries: ToaEntry[]): Record<ToaSection, ToaEntry[]> {
  const groups: Record<ToaSection, ToaEntry[]> = {
    cases: [],
    statutes: [],
    rules: [],
    other: [],
  };
  for (const e of entries) groups[e.section].push({ ...e });
  for (const key of SECTION_ORDER) {
    groups[key].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }
  return groups;
}

export function formatPageList(pages: number[]): string {
  return pages.join(", ");
}

/**
 * Plain-text TOA — for the "copy into brief" affordance.
 */
export function toaAsText(entries: ToaEntry[]): string {
  const groups = groupToa(entries);
  const lines: string[] = ["TABLE OF AUTHORITIES", ""];
  for (const key of SECTION_ORDER) {
    const arr = groups[key];
    if (arr.length === 0) continue;
    lines.push(SECTION_TITLES[key].toUpperCase());
    lines.push("");
    for (const e of arr) {
      const dots = ".".repeat(Math.max(3, 60 - e.display.length));
      lines.push(`${e.display} ${dots} ${formatPageList(e.pages)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/* ------------------------------------------------------------------ */
/*  PDF rendering                                                      */
/* ------------------------------------------------------------------ */

interface RenderOpts {
  /** US Letter default. */
  pageSize?: [number, number];
  margin?: number;
  bodySize?: number;
  title?: string;
}

/**
 * Render a standalone TOA PDF using Standard 14 Times (no external font
 * dependency). Layout: centered title, section headings in bold, entries
 * as "Name .......... 3, 7" with a real dot leader.
 */
export async function buildToaPdfBytes(
  entries: ToaEntry[],
  opts: RenderOpts = {},
): Promise<Uint8Array> {
  const [W, H] = opts.pageSize ?? [612, 792];
  const margin = opts.margin ?? 72;
  const bodySize = opts.bodySize ?? 11;
  const title = opts.title ?? "TABLE OF AUTHORITIES";
  const contentW = W - margin * 2;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);

  let page = doc.addPage([W, H]);
  let y = H - margin;

  const titleSize = 14;
  const titleW = bold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (W - titleW) / 2,
    y,
    font: bold,
    size: titleSize,
  });
  y -= titleSize + 20;

  const lineHeight = bodySize + 5;
  const sectionGap = 10;

  const ensureRoom = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([W, H]);
      y = H - margin;
    }
  };

  const groups = groupToa(entries);
  for (const key of SECTION_ORDER) {
    const arr = groups[key];
    if (arr.length === 0) continue;
    ensureRoom(lineHeight + 6);
    page.drawText(SECTION_TITLES[key], {
      x: margin,
      y,
      font: bold,
      size: bodySize + 1,
    });
    y -= lineHeight + 3;

    for (const entry of arr) {
      const pagesStr = formatPageList(entry.pages);
      const pagesW = font.widthOfTextAtSize(pagesStr, bodySize);
      const gutter = 6;
      const nameMaxW = contentW - pagesW - gutter - 24; // leave room for dots

      // Wrap the display name if it exceeds the available width.
      const words = entry.display.split(" ");
      const wrapped: string[] = [];
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(test, bodySize) > nameMaxW && line) {
          wrapped.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) wrapped.push(line);

      // Continuation lines: indent, no dots, no page number.
      for (let i = 0; i < wrapped.length - 1; i++) {
        ensureRoom(lineHeight);
        page.drawText(wrapped[i], {
          x: margin,
          y,
          font,
          size: bodySize,
        });
        y -= lineHeight;
      }

      // Final line: dot leader + page numbers, right-aligned.
      const last = wrapped[wrapped.length - 1];
      ensureRoom(lineHeight);
      page.drawText(last, { x: margin, y, font, size: bodySize });
      const lastW = font.widthOfTextAtSize(last, bodySize);
      const dotStart = margin + lastW + gutter;
      const pagesX = margin + contentW - pagesW;
      const dotEnd = pagesX - gutter;
      // Build dot string that fits the gap.
      const dotUnitW = font.widthOfTextAtSize(". ", bodySize);
      if (dotEnd > dotStart && dotUnitW > 0) {
        const count = Math.floor((dotEnd - dotStart) / dotUnitW);
        if (count > 0) {
          const dots = ". ".repeat(count);
          page.drawText(dots, {
            x: dotStart,
            y,
            font,
            size: bodySize,
          });
        }
      }
      page.drawText(pagesStr, { x: pagesX, y, font, size: bodySize });
      y -= lineHeight;
    }
    y -= sectionGap;
  }

  return doc.save();
}

/**
 * Prepend a rendered TOA (one or more pages) to an existing PDF. Non-
 * destructive of the source's annotations / outline — copyPages carries
 * the TOA in as fresh pages inserted at index 0.
 */
export async function prependToaToPdf(
  sourceBytes: Uint8Array,
  entries: ToaEntry[],
  opts: RenderOpts = {},
): Promise<Uint8Array> {
  const toaBytes = await buildToaPdfBytes(entries, opts);
  const target = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  const toaDoc = await PDFDocument.load(toaBytes);
  const copied = await target.copyPages(toaDoc, toaDoc.getPageIndices());
  for (let i = 0; i < copied.length; i++) {
    target.insertPage(i, copied[i]);
  }
  return target.save();
}
