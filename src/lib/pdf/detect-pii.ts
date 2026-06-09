// On-device PII detection. Extracts the text layer from each page with
// positions, runs regex patterns, returns redaction boxes in the same
// canvas coordinate space the redact page uses (scale = 1.5).
//
// We deliberately redact the ENTIRE text item that contains a match rather
// than trying to char-level position a substring — for a redaction tool,
// over-covering is correct behaviour (no half-visible account numbers).

import { getPdfjs } from "./worker";

export type PiiCategory =
  | "ssn"
  | "email"
  | "phone"
  | "creditCard"
  | "date"
  | "ipAddress"
  | "iban";

export type Detection = {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  category: PiiCategory;
  snippet: string;
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
];

export const CATEGORY_META: Record<PiiCategory, { label: string; hint: string }> = {
  ssn: { label: "SSN", hint: "Social security numbers" },
  email: { label: "Email", hint: "Email addresses" },
  phone: { label: "Phone", hint: "Phone numbers" },
  creditCard: { label: "Card #", hint: "Long digit sequences (cards / accounts)" },
  date: { label: "Date", hint: "Dates (DOB / issued / expiry)" },
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

  // Pass 2 — OCR for image-only pages
  if (ocrPages.length > 0) {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      for (const i of ocrPages) {
        onProgress?.({ stage: "ocr", page: i, totalPages: doc.numPages });
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        } as Parameters<typeof page.render>[0]).promise;

        const { data } = await worker.recognize(canvas, {}, { blocks: true });
        const words = collectWords(data);
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
      }
    } finally {
      await worker.terminate();
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
// Skips scanned pages (no text layer) silently — keyword search is text-only.
export async function findKeywordInPdf(
  file: File,
  query: string,
  opts: { matchCase?: boolean; wholeWord?: boolean } = {},
  scale = 1.5,
): Promise<KeywordMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
  const re = new RegExp(pattern, opts.matchCase ? "" : "i");

  const matches: KeywordMatch[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const content = await page.getTextContent();
    const items = content.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;
    for (const raw of items) {
      if (!raw.str || !re.test(raw.str)) continue;
      const m = pdfjs.Util.transform(viewport.transform, raw.transform);
      const fontHeight = Math.hypot(m[2], m[3]);
      const itemWidth = raw.width * scale;
      const x = m[4];
      const y = m[5] - fontHeight;
      const pad = Math.max(2, fontHeight * 0.15);
      matches.push({
        id: `kw-${i}-${matches.length}-${Math.random().toString(36).slice(2, 7)}`,
        page: i,
        x: x - pad,
        y: y - pad,
        w: itemWidth + pad * 2,
        h: fontHeight + pad * 2,
        snippet: snippet(raw.str),
      });
    }
  }
  return matches;
}



