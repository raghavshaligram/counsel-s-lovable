/**
 * Citation Hyperlinker — detection pass.
 *
 * Scans a PDF's rendered text layer (via pdf.js, which itself runs off the
 * main thread) for common US legal citations and returns per-match records
 * with a PDF-user-space rect suitable for a /Link annotation.
 *
 * v1 covers citations contained in a single pdf.js text-item run. Citations
 * that break across runs (rare in a filed brief) are skipped. Design mirrors
 * `src/lib/outline/linkify.ts` — nothing here creates or verifies case law;
 * the target URL is a PUBLIC LOOKUP (search) for the citation string.
 */
import { loadPdfjs } from "@/lib/pdf/worker";
import { TOA_PAGE_MARKER } from "./toa";

export type CitationKind =
  | "us-supreme"
  | "federal-reporter"
  | "federal-supplement"
  | "us-code"
  | "regional-reporter";

export interface CitationHit {
  id: string;
  /** 0-based page index. */
  page: number;
  /** PDF user-space rect [llx, lly, urx, ury]. */
  rect: [number, number, number, number];
  /** Raw matched text as it appears in the document. */
  text: string;
  kind: CitationKind;
  /** Suggested public lookup URL (search, not a guaranteed case page). */
  lookupUrl: string;
  /** True when detected on top of an OCR-only text layer (no visible glyph). */
  ocrOnly: boolean;
}

/**
 * Ordered by specificity — first pattern that matches at a given offset wins.
 * All patterns are anchored on word boundaries so we don't slice a longer
 * token. We use non-capturing groups so `RegExp.exec` returns the full hit
 * unchanged.
 */
interface Pattern {
  kind: CitationKind;
  re: RegExp;
}

export const PATTERNS: Pattern[] = [
  // 384 U.S. 436  |  384 U. S. 436
  { kind: "us-supreme", re: /\b\d{1,4}\s+U\.\s?S\.\s+\d{1,5}\b/g },
  // 42 U.S.C. § 1983  |  42 U.S.C. 1983  |  42 U.S.C. §§ 1981-1988
  {
    kind: "us-code",
    re: /\b\d{1,3}\s+U\.\s?S\.\s?C\.(?:\s*§+\s*|\s+)\d+[A-Za-z]?(?:[-–]\d+[A-Za-z]?)?(?:\([\w\d]+\))*/g,
  },
  // 123 F. Supp. 2d 456  |  123 F.Supp.3d 456
  {
    kind: "federal-supplement",
    re: /\b\d{1,4}\s+F\.\s?Supp\.\s?(?:2d|3d)?\s+\d{1,5}\b/g,
  },
  // 410 F.3d 123  |  200 F. 2d 45
  {
    kind: "federal-reporter",
    re: /\b\d{1,4}\s+F\.(?:\s?(?:2d|3d|4th))?\s+\d{1,5}\b/g,
  },
  // 45 A.2d 12  |  212 P.3d 987  |  99 N.E.2d 55  |  17 So. 3d 900
  {
    kind: "regional-reporter",
    re: /\b\d{1,4}\s+(?:A|P|N\.\s?E|N\.\s?W|S\.\s?E|S\.\s?W|So)\.\s?(?:2d|3d)?\s+\d{1,5}\b/g,
  },
];

export function buildLookupUrl(kind: CitationKind, text: string): string {
  const q = encodeURIComponent(text.trim());
  if (kind === "us-code") {
    // Cornell LII maintains stable public USC pages; a search there is a
    // reliable landing point.
    return `https://www.law.cornell.edu/search/site/${q}`;
  }
  // CourtListener case-law search — free public case-text source.
  return `https://www.courtlistener.com/?q=${q}&type=o&order_by=score+desc`;
}

let idCounter = 0;
function nextId(): string {
  idCounter = (idCounter + 1) | 0;
  return `cite-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function rectsOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

export interface DetectProgress {
  page: number;
  totalPages: number;
}

/**
 * Scan every page's text layer for citations. `onProgress` is invoked once
 * per page for large-doc feedback. pdf.js runs in its own worker, so heavy
 * text extraction does not block the main thread.
 */
export async function detectCitations(
  bytes: Uint8Array,
  onProgress?: (p: DetectProgress) => void,
): Promise<CitationHit[]> {
  const pdfjs = await loadPdfjs();
  // pdf.js may mutate the buffer — pass a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const hits: CitationHit[] = [];
  try {
    const totalPages = doc.numPages;
    for (let p = 1; p <= totalPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Skip generated Table of Authorities pages. TOA page numbers are
      // internal go-to-page jumps; re-linking them to external lookups
      // would wrongly point "Miranda v. Arizona ... 4" to CourtListener.
      // The invisible marker is stamped by `renderToa`.
      const joined = (content.items as Array<{ str?: string }>)
        .map((it) => it.str ?? "")
        .join(" ");
      if (joined.includes(TOA_PAGE_MARKER)) {
        onProgress?.({ page: p, totalPages });
        continue;
      }
      const pageHits: CitationHit[] = [];
      for (const item of content.items as Array<{
        str: string;
        transform: number[];
        width: number;
        height: number;
        hasEOL?: boolean;
      }>) {
        const str = item.str ?? "";
        if (!str || str.length < 3) continue;
        const t = item.transform;
        const originX = t[4];
        const originY = t[5];
        const height = item.height || Math.abs(t[3]) || 10;
        const width = item.width || 0;
        const totalChars = str.length || 1;
        const charWidth = width / totalChars;

        for (const { kind, re } of PATTERNS) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(str)) !== null) {
            const text = m[0];
            // Proportional slice. When the match covers the whole item run
            // we anchor to the item's real bounds (item.width already
            // reflects glyph metrics precisely). For a sub-range we fall
            // back to the average char width but pad both edges so digits
            // and glyphs wider than the average (§, wide numerals) are
            // never clipped — the visible underline / clickable span must
            // cover the FULL citation, especially trailing digits.
            const startIdx = m.index;
            const endIdx = m.index + text.length;
            const isFullRun =
              startIdx === 0 &&
              endIdx === totalChars &&
              str.trim().length === text.length;
            const leftPad = isFullRun ? 0 : charWidth * 0.15;
            const rightPad = isFullRun ? 0 : charWidth * 0.9;
            const rawStartX = originX + startIdx * charWidth;
            const rawEndX = isFullRun
              ? originX + width
              : originX + endIdx * charWidth;
            const startX = Math.max(originX, rawStartX - leftPad);
            const endX = Math.min(originX + width, rawEndX + rightPad);
            const rect: [number, number, number, number] = [
              startX,
              originY,
              endX,
              originY + height,
            ];
            if (pageHits.some((h) => rectsOverlap(h.rect, rect))) continue;
            pageHits.push({
              id: nextId(),
              page: p - 1,
              rect,
              text,
              kind,
              lookupUrl: buildLookupUrl(kind, text),
              ocrOnly: (item.height ?? 0) === 0,
            });
          }
        }
      }
      hits.push(...pageHits);
      onProgress?.({ page: p, totalPages });
    }
  } finally {
    try {
      (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      /* ignore */
    }
  }
  return hits;
}

export const CITATION_KIND_LABEL: Record<CitationKind, string> = {
  "us-supreme": "U.S. Reports",
  "federal-reporter": "Federal Reporter",
  "federal-supplement": "Federal Supplement",
  "us-code": "U.S. Code",
  "regional-reporter": "Regional reporter",
};
