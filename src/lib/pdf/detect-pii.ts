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

export async function detectPiiInPdf(
  file: File,
  scale = 1.5,
): Promise<Detection[]> {
  const pdfjs = getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const detections: Detection[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const content = await page.getTextContent();

    for (const raw of content.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>) {
      const str = raw.str;
      if (!str || !str.trim()) continue;

      let hit: PiiCategory | null = null;
      for (const { category, re } of PATTERNS) {
        if (re.test(str)) {
          hit = category;
          break;
        }
      }
      if (!hit) continue;

      // Transform the text item's local matrix through the viewport to get
      // device-space coordinates. pdfjs.Util.transform multiplies matrices.
      // The resulting [a,b,c,d,e,f]: (e,f) is the baseline origin.
      const m = pdfjs.Util.transform(viewport.transform, raw.transform);
      const fontHeight = Math.hypot(m[2], m[3]);
      const itemWidth = raw.width * scale;
      // baseline (e,f) → top-left of bounding box
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
        category: hit,
        snippet: str.length > 60 ? str.slice(0, 57) + "…" : str,
      });
    }
  }

  return detections;
}
