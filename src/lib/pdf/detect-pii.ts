// On-device PII detection. Extracts the text layer from each page with
// positions, runs regex patterns, returns redaction boxes in the same
// canvas coordinate space the redact page uses (scale = 1.5).
//
// We deliberately redact the ENTIRE text item that contains a match rather
// than trying to char-level position a substring — for a redaction tool,
// over-covering is correct behaviour (no half-visible account numbers).

import { getPdfjs } from "./worker";
import { importChunk } from "@/lib/chunk-import";

export type PiiCategory =
  | "ssn"
  | "email"
  | "phone"
  | "creditCard"
  | "date"
  | "name"
  | "ipAddress"
  | "iban";

export type Detection = {
  id: string;
  page: number;
  // Canvas coords (scale = 1.5). Kept for backwards compatibility with the
  // legacy /redact route renderer.
  x: number;
  y: number;
  w: number;
  h: number;
  category: PiiCategory;
  snippet: string;
  /**
   * Source text-item metadata captured from the PDF text layer. Required by
   * the editor's destructive content-stream rewriter — without this the
   * burn pass paints a black cover but the underlying glyphs survive.
   * Absent for OCR-derived findings on scanned pages (visual cover only).
   */
  source?: {
    originalString: string;
    transform?: number[];
    fontName?: string;
  };
  /**
   * Bounding box in PDF points, top-left origin — the coordinate space the
   * workspace editor uses for annotations. canvas_px / scale.
   */
  pdfRect?: { x: number; y: number; w: number; h: number };
};

const PATTERNS: { category: PiiCategory; re: RegExp }[] = [
  { category: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { category: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  {
    category: "phone",
    re: /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,
  },
  { category: "creditCard", re: /\b(?:\d[ -]*?){13,19}\b/ },
  { category: "date", re: /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/ },
  { category: "ipAddress", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { category: "iban", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/ },
  // Names: two or more consecutive capitalized tokens. Heuristic — we filter
  // out common headers/words via NAME_STOPWORDS before accepting a hit so
  // labels like "Case No." or "Page Two" don't flood the findings list.
  {
    category: "name",
    re: /\b[A-Z][a-z]{1,}(?:\s+(?:[A-Z]\.?|[A-Z][a-z]{1,})){1,3}\b/,
  },
];

// Capitalized tokens that frequently appear in headings/forms and should not
// promote a string to a "name" finding on their own.
const NAME_STOPWORDS = new Set([
  "Case", "Page", "Exhibit", "Plaintiff", "Defendant", "United", "States",
  "District", "County", "Court", "Department", "Section", "Chapter", "Article",
  "Schedule", "Appendix", "Attachment", "Memorandum", "Subject", "From", "To",
  "Date", "Re", "Notice", "Order", "Motion", "Reply", "Brief",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]);

export const CATEGORY_META: Record<PiiCategory, { label: string; hint: string }> = {
  ssn: { label: "SSN", hint: "Social security numbers" },
  email: { label: "Email", hint: "Email addresses" },
  phone: { label: "Phone", hint: "Phone numbers" },
  creditCard: { label: "Card / account #", hint: "Long digit sequences (cards, accounts)" },
  date: { label: "Date", hint: "Dates (DOB / issued / expiry)" },
  name: { label: "Name", hint: "Likely person names (heuristic)" },
  ipAddress: { label: "IP", hint: "IP addresses" },
  iban: { label: "IBAN", hint: "International bank account numbers" },
};


export type DetectProgress = {
  stage: "text" | "ocr";
  page: number;
  totalPages: number;
};

export async function detectPiiInPdf(
  file: File,
  scale = 1.5,
  onProgress?: (p: DetectProgress) => void,
  preloadedDoc?: { numPages: number; getPage: (n: number) => Promise<unknown> },
): Promise<{ detections: Detection[]; usedOcr: boolean }> {
  const pdfjs = await getPdfjs();
  // Reuse the doc loaded by the caller (e.g. redact route already parsed the
  // file to render pages). Avoids a second arrayBuffer() + getDocument() on
  // large PDFs.
  const doc = (preloadedDoc as unknown as Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>) ??
    (await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise);
  const detections: Detection[] = [];
  const ocrPages: number[] = [];

  // Pass 1 — native text layer
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.({ stage: "text", page: i, totalPages: doc.numPages });
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const content = await page.getTextContent();
    const items = content.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;

    // Heuristic: a scanned page has ~no text items.
    const totalChars = items.reduce((n, it) => n + (it.str?.length ?? 0), 0);
    if (totalChars < 20) {
      ocrPages.push(i);
      continue;
    }

    for (const raw of items) {
      const str = raw.str;
      if (!str || !str.trim()) continue;
      const cat = matchCategory(str);
      if (!cat) continue;
      const m = pdfjs.Util.transform(viewport.transform, raw.transform);
      const fontHeight = Math.hypot(m[2], m[3]);
      const itemWidth = raw.width * scale;
      const x = m[4];
      const y = m[5] - fontHeight;
      const pad = Math.max(2, fontHeight * 0.15);
      detections.push({
        id: `det-${i}-${detections.length}`,
        page: i,
        x: x - pad,
        y: y - pad,
        w: itemWidth + pad * 2,
        h: fontHeight + pad * 2,
        category: cat,
        snippet: snippet(str),
      });
    }
  }

  // Pass 2 — OCR for image-only pages, parallelised across a worker pool.
  // One worker per scan is wasteful (15 MB language data per init) and
  // serial OCR pins a 400-page scan for tens of minutes. Mirror the pool
  // pattern from ocr-pdf.ts.
  if (ocrPages.length > 0) {
    const { createWorker } = await importChunk(() => import("tesseract.js"));
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    const poolSize = Math.max(1, Math.min(4, Math.floor(hw / 2), ocrPages.length));
    const workers = await Promise.all(
      Array.from({ length: poolSize }, () => createWorker("eng")),
    );
    const idle = [...workers];
    const waiters: Array<(w: (typeof workers)[number]) => void> = [];
    const acquire = (): Promise<(typeof workers)[number]> =>
      new Promise((res) => {
        const w = idle.pop();
        if (w) return res(w);
        waiters.push(res);
      });
    const release = (w: (typeof workers)[number]) => {
      const next = waiters.shift();
      if (next) next(w);
      else idle.push(w);
    };

    let done = 0;
    try {
      await Promise.all(
        ocrPages.map(async (i) => {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
          } as Parameters<typeof page.render>[0]).promise;

          const worker = await acquire();
          let words: OcrWord[];
          try {
            const { data } = await worker.recognize(canvas, {}, { blocks: true });
            words = collectWords(data);
          } finally {
            release(worker);
          }
          done++;
          onProgress?.({ stage: "ocr", page: done, totalPages: ocrPages.length });

          for (const w of words) {
            if (!w.text || !w.text.trim()) continue;
            const cat = matchCategory(w.text);
            if (!cat) continue;
            const { x0, y0, x1, y1 } = w.bbox;
            const pad = Math.max(2, (y1 - y0) * 0.15);
            detections.push({
              id: `det-ocr-${i}-${detections.length}`,
              page: i,
              x: x0 - pad,
              y: y0 - pad,
              w: x1 - x0 + pad * 2,
              h: y1 - y0 + pad * 2,
              category: cat,
              snippet: snippet(w.text),
            });
          }
        }),
      );
    } finally {
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
    }
  }


  return { detections, usedOcr: ocrPages.length > 0 };
}

function matchCategory(str: string): PiiCategory | null {
  for (const { category, re } of PATTERNS) {
    if (re.test(str)) return category;
  }
  return null;
}

function snippet(s: string) {
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

type OcrWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
function collectWords(data: unknown): OcrWord[] {
  const out: OcrWord[] = [];
  const visit = (node: Record<string, unknown> | null | undefined) => {
    if (!node) return;
    const words = node.words as OcrWord[] | undefined;
    if (Array.isArray(words)) out.push(...words);
    for (const key of ["blocks", "paragraphs", "lines"]) {
      const arr = node[key] as Record<string, unknown>[] | undefined;
      if (Array.isArray(arr)) arr.forEach(visit);
    }
  };
  visit(data as Record<string, unknown>);
  return out;
}

export type KeywordMatch = {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  snippet: string;
};

// Find every text-layer item that contains `query` and return redaction-sized
// boxes in the same coordinate space the redact route uses (scale 1.5).
// When `ocr` is true, scanned pages (no text layer) are OCR'd and word boxes
// matched too — necessary for scanned PDFs where there's nothing to text-search.
export type KeywordScope = "word" | "line" | "sentence" | "page";

export async function findKeywordInPdf(
  file: File,
  query: string,
  opts: {
    matchCase?: boolean;
    wholeWord?: boolean;
    ocr?: boolean;
    scope?: KeywordScope;
    onProgress?: (p: { stage: "text" | "ocr"; page: number; totalPages: number }) => void;
    preloadedDoc?: { numPages: number; getPage: (n: number) => Promise<unknown> };
  } = {},
  scale = 1.5,
): Promise<KeywordMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const scope: KeywordScope = opts.scope ?? "word";
  const pdfjs = await getPdfjs();
  const doc =
    (opts.preloadedDoc as unknown as Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>) ??
    (await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise);

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
  const reGlobal = new RegExp(pattern, opts.matchCase ? "g" : "gi");
  const wordRe = new RegExp(
    opts.wholeWord ? `^${escaped}$` : escaped,
    opts.matchCase ? "" : "i",
  );

  const matches: KeywordMatch[] = [];
  const scannedPages: number[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    opts.onProgress?.({ stage: "text", page: i, totalPages: doc.numPages });
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const content = await page.getTextContent();
    const items = content.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;
    const totalChars = items.reduce((n, it) => n + (it.str?.length ?? 0), 0);
    if (totalChars < 20) {
      scannedPages.push(i);
      continue;
    }
    let pageHasHit = false;
    for (const raw of items) {
      if (!raw.str) continue;
      const str = raw.str;
      reGlobal.lastIndex = 0;
      let mt: RegExpExecArray | null;
      const m = pdfjs.Util.transform(viewport.transform, raw.transform);
      const fontHeight = Math.hypot(m[2], m[3]);
      const itemWidth = raw.width * scale;
      const baseX = m[4];
      const baseY = m[5] - fontHeight;
      const perChar = str.length > 0 ? itemWidth / str.length : 0;
      const pad = Math.max(2, fontHeight * 0.15);
      while ((mt = reGlobal.exec(str)) !== null) {
        const matchText = mt[0];
        if (matchText.length === 0) {
          reGlobal.lastIndex++;
          continue;
        }
        pageHasHit = true;
        if (scope === "page") continue; // emit one per-page box later

        let segStart = mt.index;
        let segEnd = mt.index + matchText.length;
        let segText = matchText;
        if (scope === "line") {
          segStart = 0;
          segEnd = str.length;
          segText = str;
        } else if (scope === "sentence") {
          // Expand to surrounding sentence within this text item.
          const before = str.slice(0, mt.index);
          const lastStop = Math.max(
            before.lastIndexOf(". "),
            before.lastIndexOf("? "),
            before.lastIndexOf("! "),
            before.lastIndexOf(". "),
          );
          segStart = lastStop >= 0 ? lastStop + 1 : 0;
          const after = str.slice(mt.index);
          const stops = [".", "?", "!"]
            .map((c) => after.indexOf(c))
            .filter((n) => n >= 0);
          segEnd = stops.length ? mt.index + Math.min(...stops) + 1 : str.length;
          segText = str.slice(segStart, segEnd);
        }
        const xStart = baseX + perChar * segStart;
        const wSeg = perChar * (segEnd - segStart);
        matches.push({
          id: `kw-${i}-${matches.length}-${Math.random().toString(36).slice(2, 7)}`,
          page: i,
          x: xStart - pad,
          y: baseY - pad,
          w: wSeg + pad * 2,
          h: fontHeight + pad * 2,
          snippet: snippet(segText),
        });
      }
    }
    if (scope === "page" && pageHasHit) {
      matches.push({
        id: `kw-page-${i}-${Math.random().toString(36).slice(2, 7)}`,
        page: i,
        x: 0,
        y: 0,
        w: viewport.width,
        h: viewport.height,
        snippet: `Whole page ${i}`,
      });
    }
  }


  if (opts.ocr && scannedPages.length > 0) {
    const { createWorker } = await importChunk(() => import("tesseract.js"));
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    const poolSize = Math.max(1, Math.min(4, Math.floor(hw / 2), scannedPages.length));
    const workers = await Promise.all(
      Array.from({ length: poolSize }, () => createWorker("eng")),
    );
    const idle = [...workers];
    const waiters: Array<(w: (typeof workers)[number]) => void> = [];
    const acquire = (): Promise<(typeof workers)[number]> =>
      new Promise((res) => {
        const w = idle.pop();
        if (w) return res(w);
        waiters.push(res);
      });
    const release = (w: (typeof workers)[number]) => {
      const next = waiters.shift();
      if (next) next(w);
      else idle.push(w);
    };

    let done = 0;
    try {
      await Promise.all(
        scannedPages.map(async (i) => {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
          } as Parameters<typeof page.render>[0]).promise;

          const worker = await acquire();
          let words: OcrWord[];
          try {
            const { data } = await worker.recognize(canvas, {}, { blocks: true });
            words = collectWords(data);
          } finally {
            release(worker);
          }
          done++;
          opts.onProgress?.({ stage: "ocr", page: done, totalPages: scannedPages.length });

          const hitWords = words.filter((w) => w.text && wordRe.test(w.text));
          if (hitWords.length === 0) return;

          if (scope === "page") {
            matches.push({
              id: `kw-page-${i}-${Math.random().toString(36).slice(2, 7)}`,
              page: i,
              x: 0,
              y: 0,
              w: viewport.width,
              h: viewport.height,
              snippet: `Whole page ${i}`,
            });
            return;
          }

          for (const w of hitWords) {
            const { x0, y0, x1, y1 } = w.bbox;
            const pad = Math.max(2, (y1 - y0) * 0.15);
            let bx = x0 - pad;
            let by = y0 - pad;
            let bw = x1 - x0 + pad * 2;
            let bh = y1 - y0 + pad * 2;
            if (scope === "line" || scope === "sentence") {
              // Approximate line as all words whose vertical center sits
              // within the match's band. Sentence falls back to line on
              // OCR'd pages (no reliable punctuation positions).
              const cy = (y0 + y1) / 2;
              const band = (y1 - y0) * 0.6;
              const sameLine = words.filter((o) => {
                const ocy = (o.bbox.y0 + o.bbox.y1) / 2;
                return Math.abs(ocy - cy) <= band;
              });
              if (sameLine.length > 0) {
                const lx0 = Math.min(...sameLine.map((o) => o.bbox.x0));
                const ly0 = Math.min(...sameLine.map((o) => o.bbox.y0));
                const lx1 = Math.max(...sameLine.map((o) => o.bbox.x1));
                const ly1 = Math.max(...sameLine.map((o) => o.bbox.y1));
                bx = lx0 - pad;
                by = ly0 - pad;
                bw = lx1 - lx0 + pad * 2;
                bh = ly1 - ly0 + pad * 2;
              }
            }
            matches.push({
              id: `kw-ocr-${i}-${matches.length}-${Math.random().toString(36).slice(2, 7)}`,
              page: i,
              x: bx,
              y: by,
              w: bw,
              h: bh,
              snippet: snippet(w.text),
            });
          }
        }),
      );
    } finally {
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
    }
  }

  return matches;
}





