/**
 * Page-numbers op — pure pdf-lib. bytes -> bytes.
 *
 * Adds a page number string to each page at a chosen anchor with
 * configurable format, font size, margin, and skip-first-N.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type PageNumberAnchor =
  | "top-left" | "top-center" | "top-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type PageNumberFormat = "n" | "page-n" | "n-of-m" | "roman";

export interface PageNumbersOpts {
  anchor: PageNumberAnchor;
  format: PageNumberFormat;
  startAt: number;        // first printed number
  skipFirst: number;      // first N pages get no number
  fontSize: number;
  margin: number;         // pt from edge
  prefix?: string;
}

function toRoman(num: number): string {
  const map: [number, string][] = [
    [1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],
    [100,"C"],[90,"XC"],[50,"L"],[40,"XL"],
    [10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"],
  ];
  let out = "";
  for (const [v, s] of map) {
    while (num >= v) { out += s; num -= v; }
  }
  return out.toLowerCase();
}

export function formatPageNumber(
  n: number, total: number, fmt: PageNumberFormat,
): string {
  switch (fmt) {
    case "n":       return String(n);
    case "page-n":  return `Page ${n}`;
    case "n-of-m":  return `${n} of ${total}`;
    case "roman":   return toRoman(n);
  }
}

export async function addPageNumbers(
  bytes: Uint8Array,
  opts: PageNumbersOpts,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const totalNumbered = Math.max(0, pages.length - opts.skipFirst);

  pages.forEach((page, i) => {
    if (i < opts.skipFirst) return;
    const n = opts.startAt + (i - opts.skipFirst);
    const text = (opts.prefix ?? "") + formatPageNumber(n, opts.startAt + totalNumbered - 1, opts.format);
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(text, opts.fontSize);
    const th = opts.fontSize;
    const m = opts.margin;

    let x = m, y = m;
    if (opts.anchor.endsWith("center")) x = (width - tw) / 2;
    if (opts.anchor.endsWith("right"))  x = width - m - tw;
    if (opts.anchor.startsWith("top"))  y = height - m - th;

    page.drawText(text, { x, y, size: opts.fontSize, font, color: rgb(0.1, 0.1, 0.1) });
  });

  return doc.save();
}
