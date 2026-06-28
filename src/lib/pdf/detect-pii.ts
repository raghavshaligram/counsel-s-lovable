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
    redactText?: string;
    matchStart?: number;
    matchLength?: number;
    transform?: number[];
    fontName?: string;
    bounds?: { x: number; y: number; w: number; h: number };
  };
  /**
   * Bounding box in PDF points, top-left origin — the coordinate space the
   * workspace editor uses for annotations. canvas_px / scale.
   */
  pdfRect?: { x: number; y: number; w: number; h: number };
  /**
   * "high" = strong signal this is a real person name / PII (e.g. preceded
   * by Mr/Dr/"signed by", or matched by a structured regex). "low" = weak
   * heuristic match; UI should leave these unchecked by default so the user
   * opts in. Absent on structured findings — treat as "high".
   */
  confidence?: "high" | "low";
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

// 2–4 capitalized tokens, allowing middle initials and name connectors
// (de / la / van / von / da / del / der / di / le). Used only as a coarse
// candidate filter — the real decision happens in `classifyName` below.
const NAME_CANDIDATE_RE =
  /\b[A-Z][a-z'’\-]{1,}(?:\s+(?:[A-Z]\.?|de|la|le|van|von|da|del|der|di|du|el|al|bin|ben|mc|mac|st\.?|[A-Z][a-z'’\-]{1,})){1,3}\b/;

// Strong "person follows" signals — when present, confidence is "high".
const NAME_PREFIX_RE =
  /(?:^|[\s(])(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Hon|Atty|Rev|Sir|Madam|Sen|Rep|Gov|Justice|Judge|Officer|Captain|Lt|Sgt|by|signed\s+by|prepared\s+by|authored\s+by|executed\s+by|attorney\s+for|counsel\s+for|witness|deponent|declarant|plaintiff|defendant|petitioner|respondent|affiant|notary|on\s+behalf\s+of|\/s\/)\.?\s*$/i;
const NAME_SUFFIX_RE =
  /^\s*,?\s*(?:Jr|Sr|Esq|Esquire|PhD|Ph\.D\.?|MD|M\.D\.?|JD|J\.D\.?|II|III|IV|CPA|RN|DDS|DO)\.?\b/i;

// Common nouns/adjectives that appear in headings, product names, and section
// labels. If a candidate's tokens are ALL from this set (ignoring connectors),
// we reject — "Executive Summary", "Data Architecture", "Cost & Revenue
// Settings", "AI Video Packages", etc. Lowercased for comparison.
const NON_NAME_WORDS = new Set([
  // structural / headings
  "summary","overview","introduction","abstract","conclusion","background",
  "objective","objectives","scope","approach","methodology","assumptions",
  "executive","contents","table","appendix","appendices","attachment","exhibit",
  "schedule","glossary","references","bibliography","acknowledgements","preface",
  "foreword","index","notes","disclaimer","chapter","section","article","part",
  "title","page","figure","table","item","items",
  // business / tech nouns
  "architecture","data","analytics","analysis","report","reports","plan","plans",
  "model","models","system","systems","platform","platforms","service","services",
  "solution","solutions","framework","frameworks","pipeline","dashboard","portal",
  "module","modules","package","packages","product","products","feature","features",
  "release","version","roadmap","backlog","sprint","milestone","deliverable",
  "deliverables","timeline","schedule","budget","forecast","projection","proposal",
  "estimate","quote","invoice","statement","ledger","balance","summary",
  "settings","configuration","preferences","options","setup","installation",
  "guide","tutorial","howto","faq","help","support","documentation","docs",
  "policy","policies","procedure","procedures","standard","standards","guideline",
  "guidelines","requirement","requirements","specification","specifications",
  "design","designs","wireframe","prototype","mockup",
  "cost","costs","revenue","revenues","profit","loss","margin","pricing","price",
  "tier","tiers","plan","plans","subscription","subscriptions","billing","payment",
  "payments","tax","taxes","fee","fees","discount","refund","invoice",
  "ai","ml","api","apis","sdk","ui","ux","cms","crm","erp","saas","paas","iaas",
  "video","videos","audio","image","images","photo","photos","file","files",
  "document","documents","template","templates","asset","assets","resource",
  "resources","content","contents","library","catalog","catalogue","collection",
  "marketing","sales","operations","engineering","product","finance","legal",
  "human","resources","support","customer","customers","client","clients",
  "user","users","member","members","admin","administrator","manager","managers",
  "team","teams","group","groups","department","departments","division",
  "company","companies","corporation","organization","organisation","enterprise",
  "business","industry","market","markets","sector","region","regions",
  "phase","step","steps","stage","stages","level","levels","tier","tiers",
  "high","medium","low","critical","major","minor","general","global","local",
  "internal","external","public","private","standard","custom","default",
  "north","south","east","west","central","upper","lower","inner","outer",
  // months & days are not names
  "january","february","march","april","may","june","july","august",
  "september","october","november","december",
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
  // legal boilerplate
  "case","court","district","county","united","states","department","commission",
  "agency","bureau","office","division","supreme","federal","state",
  "plaintiff","defendant","petitioner","respondent","appellant","appellee",
  "memorandum","motion","reply","brief","order","notice","subject","from","to",
  "date","re","attention","cc","bcc",
]);

const NAME_CONNECTORS = new Set([
  "de","la","le","van","von","da","del","der","di","du","el","al","bin","ben","mc","mac","st","st.",
]);

function isLikelyHeading(fullStr: string): boolean {
  const t = fullStr.trim();
  if (!t) return false;
  // ALL CAPS line (≥3 chars) — almost always a heading/label.
  if (/^[^a-z]+$/.test(t) && /[A-Z]/.test(t) && t.replace(/[^A-Za-z]/g, "").length >= 3) return true;
  // Contains "&" — typical of headings like "Cost & Revenue Settings".
  if (/&/.test(t)) return true;
  // Title-case line with no lowercase function word (of, the, and, for, in,
  // on, at, by, to, with, from): headings capitalize every word. Real
  // sentences containing a name almost always have lowercase glue words.
  const words = t.split(/\s+/);
  if (words.length >= 2 && words.length <= 8) {
    const allTitle = words.every((w) => /^[A-Z0-9][A-Za-z0-9'’\-/&.,:]*$/.test(w));
    const hasGlue = words.some((w) => /^(of|the|and|for|in|on|at|by|to|with|from|or|nor|but|a|an)$/.test(w));
    if (allTitle && !hasGlue) return true;
  }
  return false;
}

function classifyName(
  fullStr: string,
  matchText: string,
  matchIndex: number,
): { ok: boolean; confidence?: "high" | "low" } {
  const tokens = matchText.split(/\s+/);
  if (tokens.length < 2) return { ok: false };

  // Reject if every meaningful token is a known non-name word.
  const meaningful = tokens.filter((t) => {
    const lower = t.replace(/[.,'’\-]/g, "").toLowerCase();
    return lower.length > 1 && !NAME_CONNECTORS.has(lower);
  });
  if (meaningful.length === 0) return { ok: false };
  const allNonName = meaningful.every((t) => {
    const lower = t.replace(/[.,'’\-]/g, "").toLowerCase();
    return NON_NAME_WORDS.has(lower);
  });
  if (allNonName) return { ok: false };
  // Even one non-name word in a 2-token candidate is enough to kill it
  // ("Data Architecture", "Video Packages").
  if (tokens.length === 2) {
    const anyNonName = meaningful.some((t) => {
      const lower = t.replace(/[.,'’\-]/g, "").toLowerCase();
      return NON_NAME_WORDS.has(lower);
    });
    if (anyNonName) return { ok: false };
  }

  // Reject when the surrounding text item is structurally a heading and the
  // match basically IS the heading.
  if (isLikelyHeading(fullStr) && matchText.trim().length >= fullStr.trim().length * 0.8) {
    return { ok: false };
  }

  // Strong signal: title prefix, name suffix, middle initial, or apostrophe
  // / hyphen typical of surnames.
  const before = fullStr.slice(0, matchIndex);
  const after = fullStr.slice(matchIndex + matchText.length);
  const hasPrefix = NAME_PREFIX_RE.test(before);
  const hasSuffix = NAME_SUFFIX_RE.test(after);
  const hasMiddleInitial = /\b[A-Z]\.\s/.test(matchText);
  const hasNameMark = /['’]|(?:^|\s)(?:O['’]|D['’]|Mc|Mac|St\.)/.test(matchText);
  const confidence: "high" | "low" =
    hasPrefix || hasSuffix || hasMiddleInitial || hasNameMark ? "high" : "low";
  return { ok: true, confidence };
}


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
): Promise<{ detections: Detection[]; usedOcr: boolean; scannedPages: number[]; totalPages: number; lowConfidenceOcrPages: number[]; ocrPageConfidence: Record<number, number> }> {
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
      const hits = matchAllCategories(str);
      if (hits.length === 0) continue;
      const m = pdfjs.Util.transform(viewport.transform, raw.transform);
      const fontHeight = Math.hypot(m[2], m[3]);
      const itemWidth = raw.width * scale;
      const x0 = m[4];
      const y = m[5] - fontHeight;
      const pad = Math.max(2, fontHeight * 0.15);
      const fontName = (raw as { fontName?: string }).fontName;
      // Approximate per-character width across the text item. PDF.js doesn't
      // give us per-glyph positions for native text, but glyphs in a single
      // text-run are typeset in a continuous strip, so a uniform divide
      // produces a tight box around the matched substring rather than the
      // whole sentence/line.
      const charW = str.length > 0 ? itemWidth / str.length : itemWidth;
      for (const hit of hits) {
        const subX = x0 + charW * hit.start;
        const subW = Math.max(charW, charW * hit.length);
        const cx = subX - pad;
        const cy = y - pad;
        const cw = subW + pad * 2;
        const ch = fontHeight + pad * 2;
        detections.push({
          id: `det-${i}-${detections.length}`,
          page: i,
          x: cx,
          y: cy,
          w: cw,
          h: ch,
          category: hit.category,
          confidence: hit.confidence,
          snippet: snippet(hit.text),
          source: {
            originalString: str,
            redactText: hit.text,
            matchStart: hit.start,
            matchLength: hit.length,
            transform: raw.transform,
            fontName,
            bounds: { x: cx / scale, y: cy / scale, w: cw / scale, h: ch / scale },
          },
          pdfRect: { x: cx / scale, y: cy / scale, w: cw / scale, h: ch / scale },
        });
      }
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
            const hits = matchAllCategories(w.text);
            if (hits.length === 0) continue;
            const { x0, y0, x1, y1 } = w.bbox;
            const wWidth = x1 - x0;
            const pad = Math.max(2, (y1 - y0) * 0.15);
            const charW = w.text.length > 0 ? wWidth / w.text.length : wWidth;
            for (const hit of hits) {
              const subX = x0 + charW * hit.start;
              const subW = Math.max(charW, charW * hit.length);
              detections.push({
                id: `det-ocr-${i}-${detections.length}`,
                page: i,
                x: subX - pad,
                y: y0 - pad,
                w: subW + pad * 2,
                h: y1 - y0 + pad * 2,
                category: hit.category,
                confidence: hit.confidence,
                snippet: snippet(hit.text),
              });
            }
          }
        }),
      );
    } finally {
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
    }
  }


  return { detections, usedOcr: ocrPages.length > 0, scannedPages: ocrPages.slice(), totalPages: doc.numPages };
}

type CatHit = {
  category: PiiCategory;
  confidence?: "high" | "low";
  /** Substring span within the source text item. */
  start: number;
  length: number;
  /** The matched text itself (used for the snippet shown in the UI). */
  text: string;
};

function matchAllCategories(str: string): CatHit[] {
  const hits: CatHit[] = [];
  // Structured patterns — emit ONLY the value span, not the surrounding label
  // or line ("Client SSN: 123-45-6789" → just "123-45-6789").
  for (const { category, re } of PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = global.exec(str)) !== null) {
      hits.push({
        category,
        start: m.index,
        length: m[0].length,
        text: m[0],
      });
      if (m[0].length === 0) global.lastIndex++;
    }
  }
  // Names — only emit when we have a STRONG signal (title prefix like
  // Mr/Dr/Hon/"signed by", suffix like Jr/Esq/PhD, middle initial, or
  // surname marker like O'/Mc/Mac). The match span is the person name
  // ONLY — not the surrounding sentence ("signed by Mr. John Anderson"
  // → just "John Anderson" with optional honorific captured by regex).
  const nameGlobal = new RegExp(NAME_CANDIDATE_RE.source, "g");
  let nm: RegExpExecArray | null;
  while ((nm = nameGlobal.exec(str)) !== null) {
    const verdict = classifyName(str, nm[0], nm.index);
    if (verdict.ok && verdict.confidence === "high") {
      hits.push({
        category: "name",
        confidence: "high",
        start: nm.index,
        length: nm[0].length,
        text: nm[0],
      });
    }
    if (nm[0].length === 0) nameGlobal.lastIndex++;
  }
  return hits;
}



function snippet(s: string) {
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

type OcrWord = { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
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
  /** PDF-point rect (top-left origin) — what the workspace editor needs. */
  pdfRect?: { x: number; y: number; w: number; h: number };
  /**
   * Parent text-item metadata. Carried through to redact annotations so the
   * destructive content-stream rewriter (src/lib/editor/text-rewrite.ts) can
   * delete the underlying Tj operand — true deletion, not a black cover.
   * Absent for OCR-derived matches on scanned pages.
   */
  source?: {
    originalString: string;
    redactText?: string;
    matchStart?: number;
    matchLength?: number;
    transform?: number[];
    fontName?: string;
    bounds?: { x: number; y: number; w: number; h: number };
  };
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
    regex?: boolean;
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

  // When `regex` is on, treat the input as a raw pattern (the caller is
  // responsible for valid syntax). Otherwise escape and optionally wrap in
  // word boundaries.
  const pattern = opts.regex
    ? q
    : opts.wholeWord
    ? `\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
    : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = opts.matchCase ? "g" : "gi";
  let reGlobal: RegExp;
  let wordRe: RegExp;
  try {
    reGlobal = new RegExp(pattern, flags);
    wordRe = new RegExp(
      opts.regex ? pattern : opts.wholeWord ? `^${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      opts.matchCase ? "" : "i",
    );
  } catch (err) {
    throw new Error(`Invalid regular expression: ${(err as Error).message}`);
  }

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
        const bx = xStart - pad;
        const by = baseY - pad;
        const bw = wSeg + pad * 2;
        const bh = fontHeight + pad * 2;
        const fontName = (raw as { fontName?: string }).fontName;
        matches.push({
          id: `kw-${i}-${matches.length}-${Math.random().toString(36).slice(2, 7)}`,
          page: i,
          x: bx,
          y: by,
          w: bw,
          h: bh,
          snippet: snippet(segText),
          pdfRect: { x: bx / scale, y: by / scale, w: bw / scale, h: bh / scale },
          source: {
            originalString: str,
            redactText: segText,
            matchStart: segStart,
            matchLength: segEnd - segStart,
            transform: raw.transform,
            fontName,
            bounds: { x: bx / scale, y: by / scale, w: bw / scale, h: bh / scale },
          },
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





