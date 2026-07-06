// On-device PII detection. Extracts the text layer from each page with
// positions, runs regex patterns, returns redaction boxes in the same
// canvas coordinate space the redact page uses (scale = 1.5).
//
// We deliberately redact the ENTIRE text item that contains a match rather
// than trying to char-level position a substring — for a redaction tool,
// over-covering is correct behaviour (no half-visible account numbers).

import { getPdfjs } from "./worker";
import { importChunk } from "@/lib/chunk-import";
import { runNer, runNerBatch, PRIVILEGE_TERMS_RE, getNerStats, resetNerStats, type NerEntity } from "./ner";

/**
 * Create a canvas that works on both main thread (HTMLCanvasElement) AND
 * Web Worker (OffscreenCanvas). detect-pii runs inside a dedicated worker
 * for large-doc scans so the main thread stays free to render other tabs;
 * the OCR pipeline (pdf.js render → tesseract) needs a canvas primitive
 * available in both contexts.
 */
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }
  const c = new OffscreenCanvas(width, height);
  return c;
}
function freeCanvas(canvas: AnyCanvas | null): void {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch { /* noop */ }
}

export type PiiCategory =
  | "ssn"
  | "email"
  | "phone"
  | "creditCard"
  | "date"
  | "name"
  | "org"
  | "ipAddress"
  | "iban"
  | "privilegeContext"
  | "privilegeValue";


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
  /**
   * Where this finding lives. "page" = visible page text (default).
   * Other vectors come from non-page surfaces that page-redaction misses:
   * form-field values, annotation/comment text, and document metadata
   * (Info dict + XMP). Side-channel findings carry no page rect — they're
   * cleared by sanitize during export, not by drawing a black box.
   */
  vector?: "page" | "form-field" | "annotation" | "metadata";
  /** Human label of the source, e.g. "Form field: SSN" or "Metadata: Author". */
  sourceLabel?: string;
  /** Full sensitive value for non-page vectors. Snippet may be only the regex match. */
  sensitiveText?: string;
};

/**
 * Exported for regression tests in tests/detect-patterns.test.ts —
 * the structured detection regexes are part of the legal-critical
 * contract and must not silently drift. See CHANGELOG.md.
 */
export const PATTERNS: { category: PiiCategory; re: RegExp }[] = [
  { category: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { category: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  {
    category: "phone",
    re: /(?:\+?\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/,
  },
  // Cards: 13–19 digits, optionally split into groups by single spaces / dashes.
  { category: "creditCard", re: /\b(?:\d[ -]?){12,18}\d\b/ },
  { category: "date", re: /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/ },
  { category: "ipAddress", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  // IBAN: country + 2 check digits + 11–30 alnum chars, with optional
  // internal spaces every ~4 chars (the printed convention).
  { category: "iban", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4}){2,8}\b/ },
];

/**
 * Loose OCR substitutions for digit-heavy strings. Tesseract routinely
 * confuses O↔0, l/I↔1, S↔5, B↔8, Z↔2, G↔6 inside numeric runs. We build a
 * parallel "normalized" copy of the line text, run digit patterns against
 * BOTH, and keep the original span/snippet for the redaction box.
 */
function normalizeForDigits(s: string): string {
  return s
    .replace(/[OoQ]/g, "0")
    .replace(/[lI|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2")
    .replace(/G/g, "6")
    .replace(/[‐–—]/g, "-");
}

// Currency / amount values often paired with privilege/confidentiality
// language ("settlement of $4,750,000", "USD 250,000", "5 million dollars").
// We search NEAR a privilege term, not globally, to avoid flagging every
// number in the document.
const VALUE_NEAR_PRIVILEGE_RE =
  /(?:\$|€|£|¥|USD|EUR|GBP|JPY|CAD|AUD)\s?\d{1,3}(?:[,.\s]\d{3})*(?:\.\d+)?(?:\s*(?:million|billion|thousand|[mMkKbB]{1,2}\b))?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*(?:million|billion|thousand|dollars|euros|pounds))?\b|\b\d+(?:\.\d+)?\s*(?:million|billion|thousand)\s+(?:dollars|euros|pounds|USD|EUR|GBP)\b/gi;

/**
 * Given the text of a line and a privilege-term match span within it, return
 * non-overlapping value spans within ±radius chars of the term. Used to
 * surface the actual sensitive figure (e.g. "$4,750,000") next to a flag
 * like "settlement amount" as a one-click redaction suggestion.
 */
function findValuesNearPrivilege(
  text: string,
  termStart: number,
  termEnd: number,
  radius = 90,
): Array<{ start: number; end: number; text: string }> {
  const windowStart = Math.max(0, termStart - radius);
  const windowEnd = Math.min(text.length, termEnd + radius);
  const out: Array<{ start: number; end: number; text: string }> = [];
  const re = new RegExp(VALUE_NEAR_PRIVILEGE_RE.source, VALUE_NEAR_PRIVILEGE_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m.index;
    const e = s + m[0].length;
    if (e < windowStart || s > windowEnd) {
      if (m[0].length === 0) re.lastIndex++;
      continue;
    }
    // Don't return the term itself.
    if (!(e <= termStart || s >= termEnd)) {
      if (m[0].length === 0) re.lastIndex++;
      continue;
    }
    out.push({ start: s, end: e, text: m[0] });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}


/** Heuristic: line looks like it should contain structured PII. */
function looksStructured(text: string): boolean {
  if (/\d[\d\s\-]{6,}\d/.test(text)) return true; // long digit runs
  if (/@\w/.test(text)) return true;              // email
  if (/\b[A-Z]{2}\d{2}\b/.test(text)) return true; // IBAN prefix
  return false;
}

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
  name: { label: "Person name", hint: "People (NER + heuristic) — review before redacting" },
  org: { label: "Organization", hint: "Organizations / companies (NER) — review before redacting" },
  ipAddress: { label: "IP", hint: "IP addresses" },
  iban: { label: "IBAN", hint: "International bank account numbers" },
  privilegeContext: { label: "Context flags — review nearby content for privilege", hint: "Review signal: words like 'confidential', 'privileged', 'settlement', 'work product' nearby — not a value to redact itself" },
  privilegeValue: { label: "Value near privilege flag", hint: "Numbers/amounts found next to a privilege/confidentiality term — review and redact if sensitive" },
};




export type DetectProgress = {
  stage: "text" | "ocr";
  /** Which sub-pass emitted this progress tick. Absent = legacy (treat as "regex"). */
  pass?: "regex" | "ner" | "ocr";
  page: number;
  totalPages: number;
  /** Running detection count so callers can show a live "N findings" chip. */
  foundSoFar?: number;
};

export type DetectPiiOpts = {
  /**
   * Streamed detections. Called after each page's regex/privilege pass, and
   * after each NER batch, so the UI can show findings live instead of waiting
   * for the whole scan. `detections` is the delta for that emission (not the
   * running total).
   */
  onPartial?: (detections: Detection[], meta: { page: number; pass: "regex" | "ner" | "ocr" }) => void;
  /**
   * Cooperative cancellation. Checked at page and batch boundaries; when it
   * returns true, throws DOMException("Canceled", "AbortError") so the worker
   * / caller can react without waiting for the entire document to finish.
   */
  shouldAbort?: () => boolean;
};

export async function detectPiiInPdf(
  file: File,
  scale = 1.5,
  onProgress?: (p: DetectProgress) => void,
  preloadedDoc?: { numPages: number; getPage: (n: number) => Promise<unknown> },
  opts: DetectPiiOpts = {},
): Promise<{ detections: Detection[]; usedOcr: boolean; scannedPages: number[]; totalPages: number; lowConfidenceOcrPages: number[]; ocrPageConfidence: Record<number, number>; ocrUnderDetectedPages: number[] }> {
  const pdfjs = await getPdfjs();
  // Reuse the doc loaded by the caller (e.g. redact route already parsed the
  // file to render pages). Avoids a second arrayBuffer() + getDocument() on
  // large PDFs.
  const doc = (preloadedDoc as unknown as Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>) ??
    (await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise);
  const detections: Detection[] = [];
  const ocrPages: number[] = [];
  const onPartial = opts.onPartial;
  const shouldAbort = opts.shouldAbort ?? (() => false);
  const throwIfAborted = () => {
    if (shouldAbort()) throw new DOMException("Canceled", "AbortError");
  };

  // --- Profiling (always on; cheap and invaluable for regression triage). ---
  const t0 = performance.now();
  let tText = 0;      // ms in pdf.js getTextContent
  let tRegex = 0;     // ms in regex + heuristics + privilege
  let itemCount = 0;  // total text items across all pages
  // Reset per-scan NER stats so the profile line below reflects THIS scan only
  // (calls, batches, cache hits/misses, per-call timings, active device).
  resetNerStats();


  // NER work collected during Pass A, run in Pass B batched across pages.
  // Grouping by page lets us surface findings page-by-page as batches
  // complete, and keeps offset mapping simple (per-page joined string).
  type PageNerItem = {
    str: string;
    x0: number;
    y: number;
    fontHeight: number;
    pad: number;
    charW: number;
    fontName: string | undefined;
    transform: number[];
    joinedStart: number;
    joinedEnd: number;
    // Regex name hits within this item — used to dedupe against NER results
    // so a name caught by BOTH the "Mr. X" regex and the NER model doesn't
    // produce two redaction boxes on the same span.
    regexNameSpans: Array<{ start: number; end: number }>;
  };
  type PageNerWork = { page: number; joinedText: string; items: PageNerItem[] };
  const pageNerWork: PageNerWork[] = [];

  // Small helper: push a detection built from a per-item PageNerItem record.
  // Used from BOTH the regex pass and the NER-mapping pass so coordinates
  // are computed identically regardless of which pass surfaced the hit.
  const emitBoxFor = (
    pageIdx: number,
    item: PageNerItem | {
      str: string;
      x0: number; y: number; fontHeight: number; pad: number; charW: number;
      fontName: string | undefined; transform: number[];
    },
    spanStart: number,
    spanLen: number,
    category: PiiCategory,
    confidence: "high" | "low" | undefined,
    text: string,
  ): Detection => {
    const subX = item.x0 + item.charW * spanStart;
    const subW = Math.max(item.charW, item.charW * spanLen);
    const cx = subX - item.pad;
    const cy = item.y - item.pad;
    const cw = subW + item.pad * 2;
    const ch = item.fontHeight + item.pad * 2;
    const det: Detection = {
      id: `det-${pageIdx}-${detections.length}`,
      page: pageIdx,
      x: cx, y: cy, w: cw, h: ch,
      category,
      confidence,
      snippet: snippet(text),
      source: {
        originalString: item.str,
        redactText: text,
        matchStart: spanStart,
        matchLength: spanLen,
        transform: item.transform,
        fontName: item.fontName,
        bounds: { x: cx / scale, y: cy / scale, w: cw / scale, h: ch / scale },
      },
      pdfRect: { x: cx / scale, y: cy / scale, w: cw / scale, h: ch / scale },
    };
    detections.push(det);
    return det;
  };

  // ========== Pass A — regex + heuristics + privilege terms, all pages ==========
  // Regex-only, per-item — completes in seconds even on 300+ pages so the
  // UI can show findings live while the (much slower) NER pass runs.
  for (let i = 1; i <= doc.numPages; i++) {
    throwIfAborted();
    onProgress?.({
      stage: "text",
      pass: "regex",
      page: i,
      totalPages: doc.numPages,
      foundSoFar: detections.length,
    });
    const tp0 = performance.now();
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const content = await page.getTextContent();
    tText += performance.now() - tp0;
    const items = content.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;

    const totalChars = items.reduce((n, it) => n + (it.str?.length ?? 0), 0);
    if (totalChars < 20) {
      ocrPages.push(i);
      continue;
    }

    const detectionsBefore = detections.length;
    const nerItems: PageNerItem[] = [];
    let joinedText = "";
    const NER_SEP = "\n"; // 1 char — offsets in joined string map cleanly to items

    const tr0 = performance.now();
    for (const raw of items) {
      const str = raw.str;
      if (!str || !str.trim()) continue;
      itemCount++;
      const m = pdfjs.Util.transform(viewport.transform, raw.transform);
      const fontHeight = Math.hypot(m[2], m[3]);
      const itemWidth = raw.width * scale;
      const x0 = m[4];
      const y = m[5] - fontHeight;
      const pad = Math.max(2, fontHeight * 0.15);
      const fontName = (raw as { fontName?: string }).fontName;
      const charW = str.length > 0 ? itemWidth / str.length : itemWidth;

      const itemRecord = { str, x0, y, fontHeight, pad, charW, fontName, transform: raw.transform };

      // 1) Structured regex patterns + heuristic name match.
      const hits = matchAllCategories(str);
      for (const hit of hits) {
        emitBoxFor(i, itemRecord, hit.start, hit.length, hit.category, hit.confidence, hit.text);
      }
      const regexNameSpans = hits
        .filter((h) => h.category === "name")
        .map((h) => ({ start: h.start, end: h.start + h.length }));

      // 2) Privilege / confidentiality context.
      PRIVILEGE_TERMS_RE.lastIndex = 0;
      let pm: RegExpExecArray | null;
      while ((pm = PRIVILEGE_TERMS_RE.exec(str)) !== null) {
        emitBoxFor(i, itemRecord, pm.index, pm[0].length, "privilegeContext", "low", pm[0]);
        const values = findValuesNearPrivilege(str, pm.index, pm.index + pm[0].length);
        for (const v of values) {
          emitBoxFor(i, itemRecord, v.start, v.end - v.start, "privilegeValue", "low", v.text);
        }
        if (pm[0].length === 0) PRIVILEGE_TERMS_RE.lastIndex++;
      }

      // Stash NER work — do NOT run inference here. Items too short / with
      // no letters are excluded from the joined NER text but STILL contribute
      // to `joinedText` layout so their span math wouldn't shift the others;
      // we simply skip them from the map by giving them zero-length spans.
      const nerEligible = str.trim().length >= 8 && /[A-Za-z]/.test(str);
      if (nerEligible) {
        const joinedStart = joinedText.length;
        joinedText += str;
        const joinedEnd = joinedText.length;
        joinedText += NER_SEP;
        nerItems.push({
          str, x0, y, fontHeight, pad, charW, fontName,
          transform: raw.transform,
          joinedStart, joinedEnd,
          regexNameSpans,
        });
      }
    }
    tRegex += performance.now() - tr0;

    if (nerItems.length > 0) {
      pageNerWork.push({ page: i, joinedText, items: nerItems });
    }

    // Stream partial detections for this page's regex/privilege pass.
    if (onPartial && detections.length > detectionsBefore) {
      onPartial(detections.slice(detectionsBefore), { page: i, pass: "regex" });
    }
  }

  // ========== Pass B — batched NER across pages ==========
  // Transformer inference is dramatically more efficient when several
  // inputs go through the model in one call than when the model is invoked
  // once per input. Combined with per-page joining (Pass A collects ONE
  // string per page, not one per text-item), this cuts NER cost by ~2
  // orders of magnitude on real documents.
  //
  // Yielding rule: even though we're in a Web Worker, the browser still
  // schedules worker CPU time on a shared pool. Larger batches monopolize
  // the pool for longer and starve the viewer's pdf.js worker (grey
  // placeholders on scroll). On low-core devices (≤4 logical cores) we
  // shrink batches further so the OS scheduler has more preemption
  // opportunities. We also await a macrotask between batches so any
  // pending main-thread task (opening a new PDF, rendering a page in
  // another tab) can execute before the next inference call.
  // With header/footer dedup caching in ner.ts + optional WebGPU accel, each
  // batch is much cheaper AND many pages hit the cache without inference. That
  // shifts the trade-off back toward larger batches: fewer scheduler round
  // trips, better GPU/CPU utilization per call. Keep low-core devices a touch
  // more conservative so the viewer stays responsive.
  const hwCores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || 4) : 4;
  const NER_BATCH_PAGES = hwCores <= 4 ? 6 : 8;
  for (let b = 0; b < pageNerWork.length; b += NER_BATCH_PAGES) {
    throwIfAborted();
    const batch = pageNerWork.slice(b, b + NER_BATCH_PAGES);
    const texts = batch.map((w) => w.joinedText);
    onProgress?.({
      stage: "text",
      pass: "ner",
      page: Math.min(b + batch.length, pageNerWork.length),
      totalPages: pageNerWork.length,
      foundSoFar: detections.length,
    });
    const results = await runNerBatch(texts, "detect-pii:text-batch");
    for (let bi = 0; bi < batch.length; bi++) {
      const work = batch[bi];
      const ents = results[bi] || [];
      const detectionsBeforePage = detections.length;
      for (const e of ents) {
        if (e.type !== "PER" && e.type !== "ORG") continue;
        // Find the item(s) this entity's span sits in.
        // Binary-search would be nicer for very long pages but nerItems is
        // small (a page has O(hundreds) of items max) so a linear scan is
        // both simpler and fast enough. We over-cover if an entity spans
        // multiple items (rare — the PDF joins text runs with newlines).
        for (const item of work.items) {
          if (e.end <= item.joinedStart || e.start >= item.joinedEnd) continue;
          const localStart = Math.max(0, e.start - item.joinedStart);
          const localEnd = Math.min(item.str.length, e.end - item.joinedStart);
          if (localEnd <= localStart) continue;
          // Dedupe against the regex-name pass on the SAME item.
          const overlapsRegexName = item.regexNameSpans.some(
            (s) => !(localEnd <= s.start || localStart >= s.end),
          );
          if (overlapsRegexName) continue;
          emitBoxFor(
            work.page,
            item,
            localStart,
            localEnd - localStart,
            e.type === "PER" ? "name" : "org",
            "high",
            item.str.slice(localStart, localEnd),
          );
        }
      }
      if (onPartial && detections.length > detectionsBeforePage) {
        onPartial(detections.slice(detectionsBeforePage), { page: work.page, pass: "ner" });
      }
    }
    // Cooperative yield: give the scheduler a chance to run higher-priority
    // work (e.g. the main-thread "open a new PDF" pipeline, other tabs'
    // pdf.js render tasks) between NER inference calls. setTimeout(0)
    // enqueues a macrotask, which is the coarsest yield the browser
    // honors across worker + main threads.
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  // Emit final text-pass profile line even before OCR runs, so slow docs
  // that time out on OCR still leave useful timing behind. Includes:
  //   - device (webgpu/wasm) — which backend actually loaded
  //   - nerCalls / nerBatches — pipeline() invocations (post-cache)
  //   - cacheHits / cacheMisses + hit-rate — dedup effectiveness
  //   - meanMs / p95Ms — per-call inference latency
  const ns = getNerStats();
  const totalReq = ns.cacheHits + ns.cacheMisses;
  const hitRate = totalReq > 0 ? ((ns.cacheHits / totalReq) * 100).toFixed(1) : "0.0";
  const timings = ns.perCall.map((c) => c.ms).sort((a, b) => a - b);
  const mean = timings.length > 0 ? timings.reduce((s, v) => s + v, 0) / timings.length : 0;
  const p95 = timings.length > 0 ? timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))] : 0;
  // eslint-disable-next-line no-console
  console.info(
    `[detect-pii profile] text-pass: pages=${doc.numPages - ocrPages.length} items=${itemCount} ` +
    `text=${tText.toFixed(0)}ms regex=${tRegex.toFixed(0)}ms ner=${ns.totalMs.toFixed(0)}ms ` +
    `device=${ns.device} nerCalls=${ns.calls} nerBatches=${ns.batches} nerInputs=${ns.inputs} ` +
    `cacheHits=${ns.cacheHits} cacheMisses=${ns.cacheMisses} hitRate=${hitRate}% ` +
    `nerChars=${ns.totalChars} meanMs=${mean.toFixed(1)} p95Ms=${p95.toFixed(1)} ` +
    `total=${(performance.now() - t0).toFixed(0)}ms findings=${detections.length}`,
  );



  // Pass 2 — OCR for image-only pages. We render at a higher DPI than the
  // canvas scale (digit recognition is brittle below ~3x), then assemble
  // per-line text from word boxes and run pattern matching on the WHOLE
  // line — single-word matching can't see "4539 1488 0343 6467" as one card
  // number. Detection rectangles are emitted back at the legacy `scale`.
  const ocrUnderDetectedPages: number[] = [];
  if (ocrPages.length > 0) {
    const ocrScale = Math.max(scale, 3);
    const toCanvas = scale / ocrScale; // OCR-px → detection-canvas-px
    const { createWorker } = await importChunk(() => import("tesseract.js"));
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    // Leave 2 cores free for the viewer + main thread when possible so
    // scrolling other tabs doesn't grey out during scans. On ≤4-core
    // devices, cap the pool at 1 OCR worker to keep the UI responsive.
    const maxPool = hw <= 4 ? 1 : Math.min(3, Math.floor((hw - 2) / 2));
    const poolSize = Math.max(1, Math.min(maxPool, ocrPages.length));
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
    const ocrPageConfidence: Record<number, number> = {};
    // Bounded queue: exactly `poolSize` runners share a cursor over ocrPages.
    // Each runner acquires a worker FIRST, then creates the canvas, renders,
    // recognizes, and frees the canvas before releasing the worker. Peak
    // canvas count === poolSize (~4), not ocrPages.length. This is the fix
    // for the 3000-page OOM: memory scales with concurrency, not doc size.
    let cursor = 0;
    const runOne = async (i: number): Promise<void> => {
      const worker = await acquire();
      let canvas: AnyCanvas | null = null;
      try {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: ocrScale });
        canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!ctx) return;
        await page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        } as Parameters<typeof page.render>[0]).promise;

        let words: OcrWord[];
        const { data } = await worker.recognize(canvas as unknown as HTMLCanvasElement, {}, { blocks: true });
        words = collectWords(data);

        // Free the canvas bitmap before we do CPU work on the OCR words —
        // never hold more than `poolSize` canvases alive at once.
        freeCanvas(canvas);
        canvas = null;
        try { (page as unknown as { cleanup?: () => void }).cleanup?.(); } catch { /* ignore */ }

        done++;
        onProgress?.({ stage: "ocr", page: done, totalPages: ocrPages.length });

        const confs = words
          .filter((w) => w.text && w.text.trim())
          .map((w) => Math.max(0, w.confidence ?? 0));
        ocrPageConfidence[i] = confs.length
          ? confs.reduce((a, b) => a + b, 0) / confs.length
          : 0;

        // Group words into lines by vertical-center overlap.
        const sortedWords = words
          .filter((w) => w.text && w.text.trim())
          .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
        const lines: OcrWord[][] = [];
        for (const w of sortedWords) {
          const cy = (w.bbox.y0 + w.bbox.y1) / 2;
          const h = w.bbox.y1 - w.bbox.y0;
          const line = lines.find((ln) => {
            const ref = ln[0].bbox;
            const refCy = (ref.y0 + ref.y1) / 2;
            return Math.abs(refCy - cy) < Math.max(8, h * 0.6);
          });
          if (line) line.push(w);
          else lines.push([w]);
        }
        for (const ln of lines) ln.sort((a, b) => a.bbox.x0 - b.bbox.x0);

        // Build line text + per-character → word index map.
        const matchedSpans = new Set<string>();
        const pageDetectionCountBefore = detections.length;
        type LineInfo = { lineText: string; charToWord: number[]; ln: OcrWord[]; nerStart: number };
        const lineInfos: LineInfo[] = [];
        let pageRawText = "";
        let pageNerText = "";
        const OCR_NER_SEP = "\n";

        // Page-scoped helper: emit a detection box spanning one OCR line's
        // words. Lifted out of the line loop so both per-line regex and
        // (later) per-page NER can share it.
        const pushOcrSpan = (
          ln: OcrWord[],
          charToWord: number[],
          lineText: string,
          spanStart: number,
          spanEnd: number,
          category: PiiCategory,
          confidence: "high" | "low" | undefined,
          text: string,
        ) => {
          const covered = new Set<number>();
          for (let c = spanStart; c < spanEnd && c < charToWord.length; c++) {
            const wi = charToWord[c];
            if (wi >= 0) covered.add(wi);
          }
          if (covered.size === 0) return;
          const wordIdx = [...covered];
          const key = `${category}|${ln[wordIdx[0]].bbox.y0}|${wordIdx.join(",")}`;
          if (matchedSpans.has(key)) return;
          matchedSpans.add(key);
          const x0 = Math.min(...wordIdx.map((wi) => ln[wi].bbox.x0));
          const y0 = Math.min(...wordIdx.map((wi) => ln[wi].bbox.y0));
          const x1 = Math.max(...wordIdx.map((wi) => ln[wi].bbox.x1));
          const y1 = Math.max(...wordIdx.map((wi) => ln[wi].bbox.y1));
          const pad = Math.max(2, (y1 - y0) * 0.15);
          // Reference-only; keep lineText available for future snippet needs.
          void lineText;
          detections.push({
            id: `det-ocr-${i}-${detections.length}`,
            page: i,
            x: (x0 - pad) * toCanvas,
            y: (y0 - pad) * toCanvas,
            w: (x1 - x0 + pad * 2) * toCanvas,
            h: (y1 - y0 + pad * 2) * toCanvas,
            category,
            confidence,
            snippet: snippet(text),
          });
        };

        for (const ln of lines) {
          let lineText = "";
          const charToWord: number[] = [];
          ln.forEach((w, wi) => {
            if (lineText.length > 0) {
              lineText += " ";
              charToWord.push(-1);
            }
            for (let k = 0; k < w.text.length; k++) charToWord.push(wi);
            lineText += w.text;
          });
          pageRawText += lineText + "\n";
          const nerStart = pageNerText.length;
          pageNerText += lineText + OCR_NER_SEP;
          lineInfos.push({ lineText, charToWord, ln, nerStart });

          const variants: { text: string; normalized: boolean }[] = [
            { text: lineText, normalized: false },
            { text: normalizeForDigits(lineText), normalized: true },
          ];
          for (const { text, normalized } of variants) {
            const hits = matchAllCategories(text);
            for (const hit of hits) {
              if (normalized && hit.category === "name") continue;
              const snippetText = normalized ? lineText.slice(hit.start, hit.start + hit.length) : hit.text;
              pushOcrSpan(ln, charToWord, lineText, hit.start, hit.start + hit.length, hit.category, hit.confidence, snippetText);
            }
          }

          PRIVILEGE_TERMS_RE.lastIndex = 0;
          let pmOcr: RegExpExecArray | null;
          while ((pmOcr = PRIVILEGE_TERMS_RE.exec(lineText)) !== null) {
            const termStart = pmOcr.index;
            const termEnd = pmOcr.index + pmOcr[0].length;
            pushOcrSpan(ln, charToWord, lineText, termStart, termEnd, "privilegeContext", "low", pmOcr[0]);
            const values = findValuesNearPrivilege(lineText, termStart, termEnd);
            for (const v of values) {
              pushOcrSpan(ln, charToWord, lineText, v.start, v.end, "privilegeValue", "low", v.text);
            }
            if (pmOcr[0].length === 0) PRIVILEGE_TERMS_RE.lastIndex++;
          }
        }

        // Single NER call per PAGE (not per line) — the biggest single-page
        // speedup in the OCR path. Entities' offsets in the joined page text
        // are mapped back to their originating line via lineInfos[i].nerStart.
        if (pageNerText.trim().length >= 8 && /[A-Za-z]/.test(pageNerText)) {
          // runNer records its own timing + dedup-cache stats via ner.ts.
          const ents = await runNer(pageNerText, "detect-pii:ocr-scan");

          for (const e of ents) {
            if (e.type !== "PER" && e.type !== "ORG") continue;
            // Find the line whose nerStart..nerStart+len contains this entity.
            for (let li = 0; li < lineInfos.length; li++) {
              const info = lineInfos[li];
              const lineEndInNer = info.nerStart + info.lineText.length;
              if (e.end <= info.nerStart || e.start >= lineEndInNer) continue;
              const localStart = Math.max(0, e.start - info.nerStart);
              const localEnd = Math.min(info.lineText.length, e.end - info.nerStart);
              if (localEnd <= localStart) continue;
              pushOcrSpan(
                info.ln,
                info.charToWord,
                info.lineText,
                localStart,
                localEnd,
                e.type === "PER" ? "name" : "org",
                "high",
                info.lineText.slice(localStart, localEnd),
              );
              break; // one line per entity — the joined text uses a newline
                     // separator so entities don't legitimately span lines.
            }
          }
        }

        if (onPartial && detections.length > pageDetectionCountBefore) {
          onPartial(detections.slice(pageDetectionCountBefore), { page: i, pass: "ocr" });
        }


        // eslint-disable-next-line no-console
        console.info(
          `[detect-pii] OCR page ${i} (avg conf ${ocrPageConfidence[i].toFixed(0)}):\n${pageRawText.trim()}`,
        );

        const pageHits = detections.length - pageDetectionCountBefore;
        if (looksStructured(pageRawText) && pageHits < 2) {
          ocrUnderDetectedPages.push(i);
        }
      } finally {
        freeCanvas(canvas);
        release(worker);
      }
    };
    const runner = async (): Promise<void> => {
      while (true) {
        const idx = cursor++;
        if (idx >= ocrPages.length) return;
        await runOne(ocrPages[idx]);
      }
    };
    try {
      await Promise.all(Array.from({ length: poolSize }, () => runner()));
    } finally {
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
    }

    const lowConfidenceOcrPages = ocrPages.filter((p) => (ocrPageConfidence[p] ?? 0) < 60);
    return {
      detections,
      usedOcr: ocrPages.length > 0,
      scannedPages: ocrPages.slice(),
      totalPages: doc.numPages,
      lowConfidenceOcrPages,
      ocrPageConfidence,
      ocrUnderDetectedPages,
    };
  }


  return { detections, usedOcr: false, scannedPages: [], totalPages: doc.numPages, lowConfidenceOcrPages: [], ocrPageConfidence: {}, ocrUnderDetectedPages: [] };
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

export function matchAllCategories(str: string): CatHit[] {
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
  // Case caption "X v. Y" / "X vs. Y" — flag BOTH party names. Parties may
  // be people or organizations; we tag both as "name" so the redaction UI
  // groups them with the other person/party suggestions.
  const CAPTION_RE =
    /\b([A-Z][A-Za-z.&'’\-]+(?:\s+[A-Z][A-Za-z.&'’\-]+){0,4})\s+(?:v\.?|vs\.?)\s+([A-Z][A-Za-z.&'’\-]+(?:\s+[A-Z][A-Za-z.&'’\-]+){0,4})\b/g;
  let cm: RegExpExecArray | null;
  while ((cm = CAPTION_RE.exec(str)) !== null) {
    const left = cm[1];
    const right = cm[2];
    const leftStart = cm.index;
    const rightStart = cm.index + cm[0].lastIndexOf(right);
    for (const [text, start] of [
      [left, leftStart] as const,
      [right, rightStart] as const,
    ]) {
      // Skip if it's a known non-name heading word only.
      const tokens = text.split(/\s+/);
      const meaningful = tokens.filter((t) => t.replace(/[.,'’\-]/g, "").length > 1);
      const allNonName = meaningful.length > 0 && meaningful.every((t) =>
        NON_NAME_WORDS.has(t.replace(/[.,'’\-]/g, "").toLowerCase()),
      );
      if (allNonName) continue;
      hits.push({
        category: "name",
        confidence: "high",
        start,
        length: text.length,
        text,
      });
    }
    if (cm[0].length === 0) CAPTION_RE.lastIndex++;
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
          const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!ctx) return;
          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
          } as Parameters<typeof page.render>[0]).promise;

          const worker = await acquire();
          let words: OcrWord[];
          try {
            const { data } = await worker.recognize(canvas as unknown as HTMLCanvasElement, {}, { blocks: true });
            words = collectWords(data);
          } finally {
            release(worker);
            freeCanvas(canvas);
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


// ---------------------------------------------------------------------------
// Side-channel PII detection: form fields, annotations, document metadata.
//
// Page-text detection can't see these surfaces — but they routinely carry
// the same SSNs / emails / names / IBANs as the page body. Anything found
// here is cleared by sanitizePdfBytes during the redact export pipeline.
// ---------------------------------------------------------------------------

export type SideChannelFinding = Detection & {
  vector: "form-field" | "annotation" | "metadata";
  sourceLabel: string;
};

export async function detectPiiInSideChannels(file: File): Promise<SideChannelFinding[]> {
  const out: SideChannelFinding[] = [];
  let doc: import("pdf-lib").PDFDocument;
  try {
    const pdfLib = await import("pdf-lib");
    doc = await pdfLib.PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const { PDFArray, PDFDict, PDFName, PDFStream } = pdfLib;
    const ctx = doc.context;

    const scan = (
      text: string,
      vector: SideChannelFinding["vector"],
      sourceLabel: string,
      idSuffix: string,
    ): void => {
      const t = (text || "").trim();
      if (!t || t.length < 3) return;
      const hits = matchAllCategories(t);
      for (const h of hits) {
        out.push({
          id: `det-${vector}-${idSuffix}-${out.length}`,
          page: 0,
          x: 0, y: 0, w: 0, h: 0,
          category: h.category,
          confidence: h.confidence ?? "high",
          snippet: snippet(h.text),
          sensitiveText: t,
          vector,
          sourceLabel,
        });
      }
    };

    // ---- AcroForm field values ----
    const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
    if (acroForm) {
      const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
      const walk = (items: unknown[]): void => {
        for (const item of items) {
          const field = resolveDict(ctx, item, (v) => v instanceof PDFDict);
          if (!field) continue;
          const name = extractStr(field.get(PDFName.of("T"))) || "field";
          const v = extractStr(field.get(PDFName.of("V")));
          if (v) scan(v, "form-field", `Form field: ${truncate(name, 40)}`, name);
          const dv = extractStr(field.get(PDFName.of("DV")));
          if (dv && dv !== v) scan(dv, "form-field", `Form field default: ${truncate(name, 40)}`, name + "-dv");
          const kids = field.lookupMaybe(PDFName.of("Kids"), PDFArray);
          if (kids) walk(kids.asArray());
        }
      };
      if (fields) walk(fields.asArray());
    }
    // Orphan field dicts (descendants outside /AcroForm /Fields).
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      if (!obj.has(PDFName.of("FT")) || !obj.has(PDFName.of("V"))) continue;
      const name = extractStr(obj.get(PDFName.of("T"))) || "orphan";
      const v = extractStr(obj.get(PDFName.of("V")));
      if (v) scan(v, "form-field", `Form field: ${truncate(name, 40)}`, "orphan-" + name);
    }

    // ---- Annotations (comments, sticky notes, free text) ----
    const pageCount = doc.getPageCount();
    for (let p = 0; p < pageCount; p++) {
      const page = doc.getPage(p);
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      let idx = 0;
      for (const item of annots.asArray()) {
        const annot = resolveDict(ctx, item, (v) => v instanceof PDFDict);
        if (!annot) continue;
        const subtype = extractName(annot.get(PDFName.of("Subtype"))) || "Annot";
        const author = extractStr(annot.get(PDFName.of("T")));
        const subj = extractStr(annot.get(PDFName.of("Subj")));
        const contents = extractStr(annot.get(PDFName.of("Contents")));
        const rc = extractStr(annot.get(PDFName.of("RC")));
        const label = `Comment (${subtype}, page ${p + 1}${author ? `, by ${truncate(author, 24)}` : ""})`;
        for (const [key, txt] of [["Contents", contents], ["RC", rc], ["Subj", subj], ["T", author]] as const) {
          if (txt) scan(txt, "annotation", `${label} — /${key}`, `${p}-${idx}-${key}`);
        }
        idx++;
      }
    }

    // ---- Document metadata: Info dictionary ----
    const infoFields: Array<[string, string]> = [
      ["Title", doc.getTitle() || ""],
      ["Author", doc.getAuthor() || ""],
      ["Subject", doc.getSubject() || ""],
      ["Keywords", doc.getKeywords() || ""],
      ["Producer", doc.getProducer() || ""],
      ["Creator", doc.getCreator() || ""],
    ];
    for (const [key, val] of infoFields) {
      if (!val) continue;
      // For Title/Author/Subject/Keywords, the field is itself usually
      // sensitive — surface it even if no structured pattern matches.
      const matchedBefore = out.length;
      scan(val, "metadata", `Metadata: ${key}`, key);
      const sensitiveKey = key === "Title" || key === "Author" || key === "Subject" || key === "Keywords";
      if (sensitiveKey && out.length === matchedBefore) {
        out.push({
          id: `det-metadata-${key}-${out.length}`,
          page: 0,
          x: 0, y: 0, w: 0, h: 0,
          category: "name",
          confidence: "low",
          snippet: snippet(val),
          vector: "metadata",
          sourceLabel: `Metadata: ${key}`,
        });
      }
    }

    // ---- XMP metadata stream ----
    const xmpRef = doc.catalog.get(PDFName.of("Metadata"));
    const xmpObj = xmpRef ? ctx.lookup(xmpRef as never) : undefined;
    if (xmpObj instanceof PDFStream) {
      try {
        // pdf-lib doesn't expose decoded stream contents on every stream
        // type; fall back to raw bytes when available.
        const raw =
          (xmpObj as unknown as { contents?: Uint8Array }).contents ??
          (xmpObj as unknown as { getContents?: () => Uint8Array }).getContents?.();
        if (raw && raw.length > 0) {
          const txt = new TextDecoder("utf-8", { fatal: false }).decode(raw);
          // Pull values out of common XMP fields (rdf:li / xmp:CreatorTool /
          // dc:title / dc:creator / pdf:Keywords). Plain regex extraction
          // is enough — we just want the literals for pattern matching.
          const literals = Array.from(
            txt.matchAll(/<(?:rdf:li|dc:[a-zA-Z]+|xmp:[a-zA-Z]+|pdf:[a-zA-Z]+)[^>]*>([^<]+)</g),
          ).map((m) => m[1].trim()).filter(Boolean);
          for (const lit of literals) {
            scan(lit, "metadata", "Metadata: XMP", "xmp-" + lit.slice(0, 12));
          }
        }
      } catch { /* ignore — XMP is best-effort */ }
    }
  } catch {
    return out;
  }

  // De-duplicate by (vector, sourceLabel, snippet).
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.vector}|${f.sourceLabel}|${f.snippet}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function resolveDict(
  ctx: import("pdf-lib").PDFContext,
  obj: unknown,
  isInstance: (v: unknown) => boolean,
): import("pdf-lib").PDFDict | undefined {
  if (isInstance(obj)) return obj as import("pdf-lib").PDFDict;
  try {
    const r = ctx.lookup(obj as never);
    return isInstance(r) ? (r as import("pdf-lib").PDFDict) : undefined;
  } catch { return undefined; }
}



function extractStr(obj: unknown): string {
  if (!obj) return "";
  try {
    const o = obj as { decodeText?: () => string; asString?: () => string };
    if (typeof o.decodeText === "function") return o.decodeText();
    if (typeof o.asString === "function") return o.asString();
  } catch { /* ignore */ }
  return "";
}

function extractName(obj: unknown): string {
  if (!obj) return "";
  try {
    const s = (obj as { asString?: () => string }).asString?.() ?? "";
    return s.replace(/^\//, "");
  } catch { return ""; }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}






