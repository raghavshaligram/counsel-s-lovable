/**
 * Header/footer op — pure pdf-lib. bytes -> bytes.
 *
 * Tokens supported in text: {page}, {pages}, {date}, {filename}.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type HFAlign = "left" | "center" | "right";

export interface HeaderFooterOpts {
  headerText?: string;
  footerText?: string;
  align: HFAlign;
  fontSize: number;
  margin: number;
  filename?: string;
  /** "all" | "even" | "odd" | "no-first" */
  rule: "all" | "even" | "odd" | "no-first";
}

function applyTokens(s: string, page: number, pages: number, filename: string) {
  const date = new Date().toISOString().slice(0, 10);
  return s
    .replace(/\{page\}/g, String(page))
    .replace(/\{pages\}/g, String(pages))
    .replace(/\{date\}/g, date)
    .replace(/\{filename\}/g, filename);
}

function shouldDraw(rule: HeaderFooterOpts["rule"], i: number): boolean {
  if (rule === "all") return true;
  if (rule === "no-first") return i > 0;
  const oneBased = i + 1;
  if (rule === "even") return oneBased % 2 === 0;
  if (rule === "odd") return oneBased % 2 === 1;
  return true;
}

export async function addHeaderFooter(
  bytes: Uint8Array,
  opts: HeaderFooterOpts,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const filename = opts.filename ?? "document.pdf";

  pages.forEach((page, i) => {
    if (!shouldDraw(opts.rule, i)) return;
    const { width, height } = page.getSize();
    const draw = (raw: string, y: number) => {
      const text = applyTokens(raw, i + 1, total, filename);
      const tw = font.widthOfTextAtSize(text, opts.fontSize);
      let x = opts.margin;
      if (opts.align === "center") x = (width - tw) / 2;
      if (opts.align === "right") x = width - opts.margin - tw;
      page.drawText(text, { x, y, size: opts.fontSize, font, color: rgb(0.15, 0.15, 0.15) });
    };
    if (opts.headerText) draw(opts.headerText, height - opts.margin - opts.fontSize);
    if (opts.footerText) draw(opts.footerText, opts.margin);
  });

  return doc.save();
}
