/**
 * On-device Privilege Scan.
 *
 * Distinct from PII redaction: this surfaces content that may be PRIVILEGED
 * or CONFIDENTIAL — items the user should consider WITHHOLDING (or logging
 * on a privilege log) before producing in discovery. It does NOT
 * auto-redact. Every finding is a SUGGESTION pending attorney judgment.
 *
 * Single-pass page walk that reuses the loaded pdfDoc when available and
 * also captures item-level positions so the panel can jump-to-location.
 */

import { getPdfjs } from "./worker";

export type PrivilegeFindingType =
  | "attorney-client"
  | "work-product"
  | "confidentiality-legend"
  | "litigation-anticipation"
  | "legal-advice"
  | "counsel-email"
  | "common-interest"
  | "settlement"
  | "other";

export interface PrivilegeFinding {
  id: string;
  /** 1-based page number. */
  page: number;
  type: PrivilegeFindingType;
  /** Human label, e.g. "Attorney–client". */
  typeLabel: string;
  /** Matched phrase or value. */
  term: string;
  /** ~140-char snippet of surrounding text. */
  snippet: string;
  /** Item-level bbox in PDF points (top-left origin) for jump-to-location. */
  pdfRect?: { x: number; y: number; w: number; h: number };
}

interface Rule {
  type: PrivilegeFindingType;
  typeLabel: string;
  re: RegExp;
}

const RULES: Rule[] = [
  {
    type: "attorney-client",
    typeLabel: "Attorney–client",
    re: /\battorney[\s-]*client(?:\s+(?:privilege|communication|privileged))?\b/gi,
  },
  {
    type: "work-product",
    typeLabel: "Work product",
    re: /\b(?:attorney\s+)?work[\s-]*product(?:\s+doctrine)?\b/gi,
  },
  {
    type: "litigation-anticipation",
    typeLabel: "Anticipation of litigation",
    re: /\bprepared\s+(?:in\s+)?(?:anticipation|contemplation)\s+of\s+(?:litigation|trial|legal\s+proceedings?)\b/gi,
  },
  {
    type: "legal-advice",
    typeLabel: "Legal advice",
    re: /\b(?:legal\s+advice|seeking\s+legal\s+counsel|request(?:ing)?\s+legal\s+advice|providing\s+legal\s+advice|for\s+the\s+purpose\s+of\s+(?:obtaining|providing)\s+legal\s+advice)\b/gi,
  },
  {
    type: "confidentiality-legend",
    typeLabel: "Confidentiality legend",
    re: /\b(?:privileged\s+and\s+confidential|confidential\s+and\s+privileged|strictly\s+confidential|confidential\s*[\-—:]\s*attorney|do\s+not\s+disclose|under\s+seal|for\s+(?:counsel'?s?\s+)?eyes\s+only|highly\s+confidential|attorneys?'?\s+eyes\s+only)\b/gi,
  },
  {
    type: "common-interest",
    typeLabel: "Common interest / joint defense",
    re: /\b(?:joint\s+defense(?:\s+agreement)?|common\s+interest(?:\s+(?:privilege|doctrine|agreement))?)\b/gi,
  },
  {
    type: "settlement",
    typeLabel: "Settlement / Rule 408",
    re: /\b(?:settlement\s+(?:communication|negotiation|discussion|offer|agreement)|for\s+settlement\s+purposes(?:\s+only)?|rule\s+408|fre\s+408|without\s+prejudice|mediation\s+(?:privilege|communication))\b/gi,
  },
  {
    type: "other",
    typeLabel: "Privilege marker",
    re: /\b(?:privileged|confidential|nda|non[\s-]?disclosure|in\s+camera|sealed)\b/gi,
  },
];

// Email + attorney/counsel context. Two emit paths:
//  - Any email whose local-part or surrounding text marks it as counsel
//    ("esq", "attorney", "counsel" within 40 chars).
//  - Emails on common law-firm style domains.
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LAWFIRM_DOMAIN_RE =
  /@(?:[a-z0-9-]+\.)*(?:law|lawfirm|attorneys?|attys?|counsel|legal|esq|llp)\.[a-z]{2,}$/i;
const COUNSEL_CONTEXT_RE =
  /\b(?:esq\.?|attorney|attorneys|counsel|counselor|partner|associate|of\s+counsel|general\s+counsel|in[\s-]?house\s+counsel|law\s+(?:firm|office))\b/i;

export interface ScanProgress {
  page: number;
  totalPages: number;
}

export interface PrivilegeScanResult {
  findings: PrivilegeFinding[];
  totalPages: number;
  /** 1-based pages that had no text layer — likely scanned. Run OCR first. */
  scannedPages: number[];
}

function clip(s: string, max = 140): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/**
 * Scan a PDF for privilege indicators using the text layer.
 *
 * Pages without a text layer (likely scanned) are returned in
 * `scannedPages` so the UI can prompt for OCR — privilege language on
 * those pages cannot be detected until OCR has been applied.
 */
export async function scanPrivilege(
  file: File,
  onProgress?: (p: ScanProgress) => void,
  opts?: { preloadedDoc?: { numPages: number; getPage: (n: number) => Promise<unknown> } },
): Promise<PrivilegeScanResult> {
  const pdfjs = await getPdfjs();
  const doc =
    (opts?.preloadedDoc as unknown as Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>) ??
    (await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise);

  const findings: PrivilegeFinding[] = [];
  const scannedPages: number[] = [];
  const seen = new Set<string>(); // de-dup by page|type|term lowercased

  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.({ page: i, totalPages: doc.numPages });
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
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
    // Build a flat page text + per-character map back to the source item /
    // local offset, so we can recover the bounding box of the matched span.
    let pageText = "";
    const charToItem: number[] = [];
    const charToLocal: number[] = [];
    for (let k = 0; k < items.length; k++) {
      const s = items[k].str ?? "";
      for (let j = 0; j < s.length; j++) {
        charToItem.push(k);
        charToLocal.push(j);
      }
      pageText += s;
      // Insert a space between items so words don't fuse across spans.
      pageText += " ";
      charToItem.push(-1);
      charToLocal.push(-1);
    }

    const rectForChar = (charIdx: number): PrivilegeFinding["pdfRect"] | undefined => {
      // Find first valid item-mapped char at or after charIdx.
      let k = charIdx;
      while (k < charToItem.length && charToItem[k] < 0) k++;
      if (k >= charToItem.length) return undefined;
      const itemIdx = charToItem[k];
      const item = items[itemIdx];
      if (!item) return undefined;
      const m = pdfjs.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(m[2], m[3]);
      const x = m[4];
      const yTop = m[5] - fontHeight;
      const w = Math.max(8, item.width);
      const h = Math.max(8, fontHeight);
      // Flip y to PDF-point top-left (viewport at scale 1 already gives points).
      return { x, y: yTop, w, h };
    };

    const emit = (
      type: PrivilegeFindingType,
      typeLabel: string,
      term: string,
      matchIdx: number,
    ) => {
      const key = `${i}|${type}|${term.toLowerCase()}|${matchIdx}`;
      if (seen.has(key)) return;
      // Dedup across slightly different positions of the same term on a page
      // — keep one per (page, type, term) to avoid noise; the user can jump
      // from the listed location.
      const condensedKey = `${i}|${type}|${term.toLowerCase()}`;
      if (seen.has(condensedKey)) return;
      seen.add(key);
      seen.add(condensedKey);
      const start = Math.max(0, matchIdx - 60);
      const end = Math.min(pageText.length, matchIdx + term.length + 60);
      findings.push({
        id: `pv-${i}-${findings.length}-${Math.random().toString(36).slice(2, 7)}`,
        page: i,
        type,
        typeLabel,
        term,
        snippet: clip(pageText.slice(start, end)),
        pdfRect: rectForChar(matchIdx),
      });
    };

    for (const rule of RULES) {
      const re = new RegExp(rule.re.source, rule.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(pageText)) !== null) {
        emit(rule.type, rule.typeLabel, m[0], m.index);
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    // Counsel emails — emit when the email sits in a law-firm-ish domain
    // OR has "esq"/"attorney"/"counsel" within ~40 chars.
    EMAIL_RE.lastIndex = 0;
    let em: RegExpExecArray | null;
    while ((em = EMAIL_RE.exec(pageText)) !== null) {
      const addr = em[0];
      const before = pageText.slice(Math.max(0, em.index - 40), em.index);
      const after = pageText.slice(
        em.index + addr.length,
        Math.min(pageText.length, em.index + addr.length + 40),
      );
      const lawDomain = LAWFIRM_DOMAIN_RE.test(addr);
      const contextHit = COUNSEL_CONTEXT_RE.test(before) || COUNSEL_CONTEXT_RE.test(after);
      if (lawDomain || contextHit) {
        emit("counsel-email", "Counsel email", addr, em.index);
      }
    }
  }

  return { findings, totalPages: doc.numPages, scannedPages };
}
