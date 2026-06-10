/**
 * Scan a single page's text layer with pdf.js and return URL link
 * annotations in PDF user space. The text-item transform tells us the
 * baseline origin and the rendered glyph height; from that we synthesize
 * a tight rectangle around each match.
 */
import { loadPdfjs } from "@/lib/pdf/worker";
import type { LinkAnnot } from "./types";
import { newId } from "./types";

const URL_REGEX = /\bhttps?:\/\/[^\s<>"')]+/gi;

export async function linkifyPage(
  bytes: Uint8Array,
  pageIndex: number,
  existing: LinkAnnot[],
): Promise<LinkAnnot[]> {
  const pdfjs = await loadPdfjs();
  // pdf.js mutates the underlying buffer; pass a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const page = await doc.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;

    const found: LinkAnnot[] = [];

    for (const item of content.items as any[]) {
      const str: string = item.str ?? "";
      if (!str) continue;
      const transform: number[] = item.transform;
      const x = transform[4];
      const y = transform[5];
      const height: number = item.height || Math.abs(transform[3]) || 10;
      const width: number = item.width || 0;
      const totalChars = str.length || 1;
      const charWidth = width / totalChars;

      let m: RegExpExecArray | null;
      URL_REGEX.lastIndex = 0;
      while ((m = URL_REGEX.exec(str)) !== null) {
        const startX = x + m.index * charWidth;
        const endX = x + (m.index + m[0].length) * charWidth;
        // pdf.js item y is the baseline in flipped coords; convert to PDF user space.
        const pdfYBottom = pageHeight - y - 0; // y already in PDF coords from pdf.js? Actually pdf.js
        // returns the transform of the text in viewport-space when no rotation transform applied;
        // with scale 1 and identity viewport rotation, item.transform[5] is already in PDF user space
        // measured from the bottom. We use it directly.
        const lly = y;
        const ury = y + height;
        const rect: [number, number, number, number] = [startX, lly, endX, ury];

        // Dedupe vs existing links on the same page that already overlap.
        const overlap = existing.some(
          (e) =>
            e.page === pageIndex &&
            rectsOverlap(e.rect, rect),
        );
        if (overlap) continue;
        // Also dedupe within the same scan.
        if (found.some((f) => rectsOverlap(f.rect, rect))) continue;

        found.push({
          id: newId("l"),
          page: pageIndex,
          rect,
          target: { kind: "url", url: m[0] },
        });
        // suppress unused-var warning for pdfYBottom in case linter is strict
        void pdfYBottom;
      }
    }
    return found;
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }
  }
}

function rectsOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}
