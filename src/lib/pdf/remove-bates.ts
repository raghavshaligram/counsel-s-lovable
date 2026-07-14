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
  // Global, case-insensitive — allow the stamp anywhere in the joined line
  // (pdf.js frequently splits "ABC000123" into "ABC" + "000123" items and
  // may include neighbouring page-number/header text on the same baseline).
  return new RegExp(
    `${escapeRegExp(f.prefix ?? "")}\\d{${min},${max}}${escapeRegExp(f.suffix ?? "")}`,
    "gi",
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
  // Widened bands — real stamps sometimes sit ~20% from the edge, not 15%.
  const top = y >= pageH * 0.78;
  const bottom = y <= pageH * 0.22;
  const left = x <= pageW * 0.45;
  const right = x >= pageW * 0.5;
  const center = x > pageW * 0.15 && x < pageW * 0.85;
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
      // Group items by baseline (rounded y) so split runs like ["ABC","000123"]
      // can be matched together.
      const lines = new Map<number, Array<Item & { x: number; y: number }>>();
      for (const raw of content.items as unknown[]) {
        const it = raw as Item;
        if (!it.str) continue;
        const t = it.transform;
        if (!Array.isArray(t) || t.length < 6) continue;
        const x = t[4];
        const y = t[5];
        // 3px tolerance — split runs can have tiny baseline drift.
        const key = Math.round(y / 3) * 3;
        const arr = lines.get(key) ?? [];
        arr.push({ ...it, x, y });
        lines.set(key, arr);
      }
      for (const items of lines.values()) {
        items.sort((a, b) => a.x - b.x);
        const joined = items.map((it) => it.str).join("");
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(joined)) !== null) {
          const start = m.index;
          const end = start + m[0].length;
          // Locate items covering [start, end)
          let cursor = 0;
          let bx = Infinity;
          let by = Infinity;
          let bxEnd = -Infinity;
          let bh = 0;
          for (const it of items) {
            const s = cursor;
            const e = cursor + it.str.length;
            cursor = e;
            if (e <= start || s >= end) continue;
            const iw = it.width || 0;
            const ih = it.height || Math.abs(it.transform[3]) || 10;
            bx = Math.min(bx, it.x);
            by = Math.min(by, it.y);
            bxEnd = Math.max(bxEnd, it.x + iw);
            bh = Math.max(bh, ih);
          }
          if (!isFinite(bx) || !isFinite(by)) continue;
          if (!inCorner(format.corner, bx, by, vp.width, vp.height)) continue;
          out.push({
            pageIndex: i,
            x: bx,
            y: by - bh * 0.2,
            w: Math.max(bxEnd - bx, bh * 0.5),
            h: bh * 1.4,
            text: m[0],
          });
        }
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
