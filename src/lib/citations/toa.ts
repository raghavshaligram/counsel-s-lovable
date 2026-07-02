/**
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
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  rgb,
} from "pdf-lib";

/**
 * Invisible marker string stamped on every generated TOA page. Detectors
 * (Citation Hyperlinker) look for this in the pdf.js text layer to
 * exclude TOA pages from external URI linking — TOA page numbers are
 * internal jumps and must never be re-linked to CourtListener / Cornell.
 */
export const TOA_PAGE_MARKER = "__VPDF_TOA_PAGE__";

import { loadPdfjs } from "@/lib/pdf/worker";
import { PATTERNS, buildLookupUrl, type CitationKind } from "./detect";

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

      // Skip existing TOA pages so re-scanning a doc that already has a
      // generated TOA doesn't cascade its own entries back in.
      if (raw.includes(TOA_PAGE_MARKER)) {
        onProgress?.({ page: p, totalPages });
        continue;
      }


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
  /**
   * How many pages to add to every page reference before rendering.
   * Used by `prependToaToPdf` so the TOA prints the FINAL page numbers
   * (post-insertion) rather than the source's original numbers. Standalone
   * renders leave this at 0.
   */
  shift?: number;
}

/**
 * Per-page-number rect captured during rendering. `toaPageIndex` is the
 * index within the produced TOA document; `targetOriginalPage` is the
 * unshifted page number from the source brief (1-based), so the caller
 * can compute the final destination index as `shift + targetOriginalPage - 1`.
 */
export interface ToaLinkRect {
  toaPageIndex: number;
  rect: [number, number, number, number];
  targetOriginalPage: number;
}

/**
 * Per-entry external-lookup rect captured while drawing the display text
 * (case name / citation). One entry can produce multiple rects when its
 * display wraps across lines. Attached as URI /Link annotations pointing
 * at CourtListener / Cornell — same URL-building logic the Citation
 * Hyperlinker uses (`buildLookupUrl`).
 */
export interface ToaEntryLink {
  toaPageIndex: number;
  rects: Array<[number, number, number, number]>;
  url: string;
  text: string;
}

export interface ToaRender {
  bytes: Uint8Array;
  pageCount: number;
  links: ToaLinkRect[];
  entryLinks: ToaEntryLink[];
}

/**
 * Render TOA pages. Returns bytes plus per-page-number link rects so a
 * caller can attach internal /Link GoTo annotations pointing into the
 * combined document.
 */
export async function renderToa(
  entries: ToaEntry[],
  opts: RenderOpts = {},
): Promise<ToaRender> {
  const [W, H] = opts.pageSize ?? [612, 792];
  const margin = opts.margin ?? 72;
  const bodySize = opts.bodySize ?? 11;
  const title = opts.title ?? "TABLE OF AUTHORITIES";
  const shift = opts.shift ?? 0;
  const contentW = W - margin * 2;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const links: ToaLinkRect[] = [];

  /**
   * Draw an invisible marker on every TOA page so downstream tools can
   * recognize it as a generated TOA (see `TOA_PAGE_MARKER`). White text
   * at 1pt on white paper — extractable via pdf.js text layer, not
   * visually present. This is how Citation Hyperlinker excludes TOA
   * pages: without the marker, the TOA's own entries would get
   * external URI links, which is wrong for a court-style TOA whose
   * page numbers must remain internal jumps.
   */
  const stampMarker = (p: ReturnType<typeof doc.addPage>) => {
    p.drawText(TOA_PAGE_MARKER, {
      x: 2,
      y: 2,
      font,
      size: 1,
      color: rgb(1, 1, 1),
    });
  };

  let page = doc.addPage([W, H]);
  let pageIdx = 0;
  let y = H - margin;
  stampMarker(page);

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
      pageIdx += 1;
      y = H - margin;
      stampMarker(page);
    }
  };

  const shiftedList = (pages: number[]) =>
    pages.map((p) => p + shift);

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
      const shownPages = shiftedList(entry.pages);
      const pagesStr = shownPages.join(", ");
      const pagesW = font.widthOfTextAtSize(pagesStr, bodySize);
      const gutter = 6;
      const nameMaxW = contentW - pagesW - gutter - 24;

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

      const last = wrapped[wrapped.length - 1];
      ensureRoom(lineHeight);
      page.drawText(last, { x: margin, y, font, size: bodySize });
      const lastW = font.widthOfTextAtSize(last, bodySize);
      const dotStart = margin + lastW + gutter;
      const pagesX = margin + contentW - pagesW;
      const dotEnd = pagesX - gutter;
      const dotUnitW = font.widthOfTextAtSize(". ", bodySize);
      if (dotEnd > dotStart && dotUnitW > 0) {
        const count = Math.floor((dotEnd - dotStart) / dotUnitW);
        if (count > 0) {
          page.drawText(". ".repeat(count), {
            x: dotStart,
            y,
            font,
            size: bodySize,
          });
        }
      }

      // Draw each page number as its own token so we can capture per-
      // number rects for the internal GoTo link annotations.
      let cx = pagesX;
      const sep = ", ";
      const sepW = font.widthOfTextAtSize(sep, bodySize);
      // Link-blue matches the inline citation hyperlinker treatment so
      // TOA page-refs read as clickable at a glance.
      const linkColor = rgb(0.16, 0.36, 0.68);
      for (let i = 0; i < shownPages.length; i++) {
        const shownStr = String(shownPages[i]);
        const numW = font.widthOfTextAtSize(shownStr, bodySize);
        page.drawText(shownStr, {
          x: cx,
          y,
          font,
          size: bodySize,
          color: linkColor,
        });
        // Underline under the page number.
        page.drawLine({
          start: { x: cx, y: y - 1.2 },
          end: { x: cx + numW, y: y - 1.2 },
          thickness: 0.6,
          color: linkColor,
        });
        links.push({
          toaPageIndex: pageIdx,
          rect: [
            cx - 1,
            y - 2,
            cx + numW + 1,
            y + bodySize + 1,
          ],
          targetOriginalPage: entry.pages[i],
        });
        cx += numW;
        if (i < shownPages.length - 1) {
          page.drawText(sep, { x: cx, y, font, size: bodySize });
          cx += sepW;
        }
      }
      y -= lineHeight;
    }
    y -= sectionGap;
  }

  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount(), links };
}

/**
 * Standalone TOA PDF (no internal links — target document is unknown).
 * Kept for the "Download TOA alone" affordance.
 */
export async function buildToaPdfBytes(
  entries: ToaEntry[],
  opts: RenderOpts = {},
): Promise<Uint8Array> {
  const { bytes } = await renderToa(entries, { ...opts, shift: 0 });
  return bytes;
}

/**
 * Prepend a TOA to `sourceBytes` producing ONE combined PDF: TOA pages
 * + original brief. Page references in the TOA reflect the FINAL
 * (post-insertion) page numbers, and each page-number token is wrapped
 * in an internal /Link GoTo annotation that jumps to the referenced
 * page inside the combined document.
 *
 * Iterates the render a few times to stabilize the TOA page count
 * (adding a shift can change wrap → change page count → change shift).
 */
export async function prependToaToPdf(
  sourceBytes: Uint8Array,
  entries: ToaEntry[],
  opts: RenderOpts = {},
): Promise<Uint8Array> {
  // Estimate the TOA page count. Start with 1, re-render until stable
  // (bounded so a pathological input can't loop forever).
  let shift = 1;
  let render = await renderToa(entries, { ...opts, shift });
  for (let i = 0; i < 4 && render.pageCount !== shift; i++) {
    shift = render.pageCount;
    render = await renderToa(entries, { ...opts, shift });
  }

  const target = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  const toaDoc = await PDFDocument.load(render.bytes);
  const copied = await target.copyPages(toaDoc, toaDoc.getPageIndices());
  for (let i = 0; i < copied.length; i++) {
    target.insertPage(i, copied[i]);
  }

  // Attach internal GoTo annotations for every page-number token.
  // Preserves any existing annotations on the copied pages (there are
  // none from a fresh render, but this stays safe if that ever changes)
  // and never touches the original brief's annotations — including
  // Citation Hyperlinker /Link URI annotations, which live on later
  // pages and go through untouched.
  const ctx = target.context;
  const totalPages = target.getPageCount();
  for (const l of render.links) {
    const finalIdx = shift + l.targetOriginalPage - 1;
    if (finalIdx < 0 || finalIdx >= totalPages) continue;
    if (l.toaPageIndex < 0 || l.toaPageIndex >= shift) continue;

    const toaPage = target.getPage(l.toaPageIndex);
    const targetPage = target.getPage(finalIdx);

    const dest = ctx.obj([
      targetPage.ref,
      PDFName.of("XYZ"),
      PDFNull,
      PDFNull,
      PDFNull,
    ]);

    const annot = ctx.obj({}) as PDFDict;
    annot.set(PDFName.of("Type"), PDFName.of("Annot"));
    annot.set(PDFName.of("Subtype"), PDFName.of("Link"));
    annot.set(
      PDFName.of("Rect"),
      ctx.obj(l.rect.map((n) => PDFNumber.of(n))),
    );
    annot.set(
      PDFName.of("Border"),
      ctx.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]),
    );
    annot.set(PDFName.of("H"), PDFName.of("I"));
    annot.set(PDFName.of("Dest"), dest);
    const ref: PDFRef = ctx.register(annot);

    const existing = toaPage.node.get(PDFName.of("Annots"));
    if (existing instanceof PDFArray) {
      existing.push(ref);
    } else {
      toaPage.node.set(PDFName.of("Annots"), ctx.obj([ref]));
    }
  }

  return target.save();
}

