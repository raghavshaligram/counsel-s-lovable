/**
 * Locate — turn detected PII patterns into concrete page rectangles.
 *
 * Walks pdf.js text content, runs the same regex set as `insights.ts`,
 * and projects each match into the page viewport (scale=1.5, matching
 * `renderPage` in /workspace) so the result drops straight into the
 * canvas overlay as a pending redaction box.
 *
 * 100% client-side. No network. Single-run heuristic — multi-item spans
 * (a number split across two text runs) are skipped rather than
 * mis-located; the user's real "Redact" tool still handles those.
 */

import type { InsightKind } from "./insights";

type PageBoxSeed = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "pending";
  reason: string;
};

const RX: Partial<Record<InsightKind, RegExp>> = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  card: /\b(?:\d[ -]?){13,16}\b/g,
};

type TextItem = {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
};
type PdfPageLike = {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: TextItem[] }>;
};
type PdfLike = {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
};

export async function locatePII(
  pdf: PdfLike,
  kinds: InsightKind[],
  opts: { scale?: number; maxPages?: number } = {},
): Promise<PageBoxSeed[]> {
  const scale = opts.scale ?? 1.5;
  const maxPages = Math.min(opts.maxPages ?? 50, pdf.numPages);
  const out: PageBoxSeed[] = [];
  const active = kinds.filter((k) => RX[k]);
  if (active.length === 0) return out;

  for (let p = 1; p <= maxPages; p++) {
    let page: PdfPageLike;
    try {
      page = await pdf.getPage(p);
    } catch {
      continue;
    }
    const vp = page.getViewport({ scale });
    const content = await page.getTextContent().catch(() => ({ items: [] }));
    const items = content.items as TextItem[];

    for (const it of items) {
      if (!it.str || !it.transform || it.transform.length < 6) continue;
      const tx = it.transform;
      // pdfjs transform = [a, b, c, d, e, f]; for plain text a/d == fontSize, e/f == origin.
      const fontH = Math.hypot(tx[2], tx[3]) || tx[3] || 10;
      const widthUnits = it.width ?? 0;
      if (widthUnits <= 0) continue;
      const charW = widthUnits / Math.max(1, it.str.length);

      for (const kind of active) {
        const rx = RX[kind]!;
        rx.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rx.exec(it.str))) {
          const startUnits = m.index * charW;
          const widthMatchUnits = m[0].length * charW;
          // origin x,y in PDF user space (bottom-up)
          const ox = tx[4] + startUnits;
          const oy = tx[5];
          // Translate to viewport (top-down) — y origin is page top.
          const vx = ox * scale;
          const vw = widthMatchUnits * scale;
          const vh = fontH * scale * 1.1;
          const vy = vp.height - (oy * scale) - vh + (fontH * scale * 0.15);
          out.push({
            page: p - 1,
            x: vx,
            y: vy,
            w: vw,
            h: vh,
            kind: "pending",
            reason: kind,
          });
        }
      }
    }
  }
  return out;
}
