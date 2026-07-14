/**
 * Remove baked-in Bates stamps.
 *
 * The Bates panel already stamps at export time — this is the reverse pass,
 * for PDFs that arrived from another tool with Bates already burned into the
 * page content. We:
 *
 *   1. Scan the pdf.js text layer of every page.
 *   2. Match short runs against the user-supplied format
 *      (prefix + digits + suffix), gated by the chosen corner region so we
 *      don't cover page numbers in the header.
 *   3. Cover each match with an opaque white rectangle via pdf-lib.
 *
 * Purely lossless for anything outside the stamp bbox.
 */
import { PDFDocument, rgb } from "pdf-lib";
import { openPdfjs } from "@/lib/pdf/pdf-open";

export type BatesCorner = "tl" | "tc" | "tr" | "bl" | "bc" | "br";

export interface BatesRemoveFormat {
  prefix: string;
  suffix: string;
  digits: number;
  corner: BatesCorner;
}

export interface BatesMatch {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(f: BatesRemoveFormat): RegExp {
  const min = Math.max(1, f.digits - 2);
  const max = f.digits + 2;
  return new RegExp(
    `^\\s*${escapeRegExp(f.prefix ?? "")}\\d{${min},${max}}${escapeRegExp(f.suffix ?? "")}\\s*$`,
  );
}

/** True when the glyph bbox falls in the chosen corner region of the page. */
function inCorner(
  corner: BatesCorner,
  x: number,
  y: number,
  pageW: number,
  pageH: number,
): boolean {
  const top = y >= pageH * 0.85;
  const bottom = y <= pageH * 0.15;
  const left = x <= pageW * 0.35;
  const right = x >= pageW * 0.55;
  const center = x > pageW * 0.25 && x < pageW * 0.75;
  switch (corner) {
    case "tl": return top && left;
    case "tc": return top && center;
    case "tr": return top && right;
    case "bl": return bottom && left;
    case "bc": return bottom && center;
    case "br": return bottom && right;
  }
}

export async function findBatesStamps(
  bytes: Uint8Array,
  format: BatesRemoveFormat,
): Promise<BatesMatch[]> {
  const pattern = buildPattern(format);
  const doc = await openPdfjs(bytes.slice(), {});
  const out: BatesMatch[] = [];
  try {
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      type Item = { str: string; transform: number[]; width: number; height: number };
      for (const raw of content.items as unknown[]) {
        const it = raw as Item;
        if (!it.str || !pattern.test(it.str)) continue;
        const t = it.transform;
        if (!Array.isArray(t) || t.length < 6) continue;
        const x = t[4];
        const y = t[5];
        const h = it.height || Math.abs(t[3]) || 10;
        const w = it.width || 0;
        if (!inCorner(format.corner, x, y, vp.width, vp.height)) continue;
        out.push({ pageIndex: i, x, y: y - h * 0.2, w, h: h * 1.4, text: it.str });
      }
      try { page.cleanup(); } catch { /* noop */ }
    }
  } finally {
    try { await doc.cleanup(); } catch { /* noop */ }
  }
  return out;
}

export async function removeBatesStamps(
  bytes: Uint8Array,
  matches: BatesMatch[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const m of matches) {
    const page = pages[m.pageIndex];
    if (!page) continue;
    page.drawRectangle({
      x: m.x - 1,
      y: m.y - 1,
      width: m.w + 2,
      height: m.h + 2,
      color: rgb(1, 1, 1),
    });
  }
  return await doc.save({ useObjectStreams: true });
}
