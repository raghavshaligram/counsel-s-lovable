/** Verify destructive redaction by geometry, not decoded strings. */
import { loadPdfjs } from "@/lib/pdf/worker";

export interface RedactionTarget {
  /** 0-indexed page in the exported PDF. */
  page: number;
  /** Optional diagnostic text only — success is never based on string matching. */
  text?: string;
  /** Redaction rect in editor/PDF points, top-left origin. */
  rect?: { x: number; y: number; w: number; h: number };
  /** Optional label (e.g. exemption code) for reporting. */
  label?: string;
}

export interface VerifyResult {
  ok: boolean;
  total: number;
  removed: number;
  leaks: Array<{ page: number; text: string; label?: string; rect?: { x: number; y: number; w: number; h: number } }>;
  scannedAt: string;
}

export async function verifyRedactionRemoval(
  bytes: Uint8Array,
  targets: RedactionTarget[],
): Promise<VerifyResult> {
  const scannedAt = new Date().toISOString();
  const regionTargets = targets.filter((t) => t.rect && t.rect.w > 0 && t.rect.h > 0);
  if (regionTargets.length === 0) {
    return { ok: true, total: 0, removed: 0, leaks: [], scannedAt };
  }

  const pdfjs = await loadPdfjs();
  // Fresh parse: this is the EXPORTED file, not the open document, so the
  // workspace's cached pdfDoc doesn't apply here. Worker handles parsing.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  // Bucket targets by page so we only extract each page once.
  const byPage = new Map<number, RedactionTarget[]>();
  for (const t of regionTargets) {
    const arr = byPage.get(t.page) ?? [];
    arr.push(t);
    byPage.set(t.page, arr);
  }

  const leaks: VerifyResult["leaks"] = [];
  try {
    for (const [pageIdx, items] of byPage) {
      if (pageIdx < 0 || pageIdx >= doc.numPages) continue;
      const page = await doc.getPage(pageIdx + 1);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const itemBoxes = tc.items
        .filter((it) => "str" in it && (it as { str: string }).str.trim())
        .map((it) => textItemBox(pdfjs, viewport, it as { str: string; transform: number[]; width?: number; height?: number }))
        .filter((b): b is NonNullable<typeof b> => !!b);
      for (const t of items) {
        const r = t.rect;
        if (!r) continue;
        const leak = itemBoxes.find((b) => intersects(b, r));
        if (leak) {
          leaks.push({
            page: pageIdx,
            text: leak.text || t.text || "Text remains inside redaction region",
            label: t.label,
            rect: r,
          });
        }
      }
      page.cleanup();
    }
  } finally {
    try { (doc as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
  }

  const removed = regionTargets.length - leaks.length;
  return {
    ok: leaks.length === 0,
    total: regionTargets.length,
    removed,
    leaks,
    scannedAt,
  };
}

function textItemBox(
  pdfjs: Awaited<ReturnType<typeof loadPdfjs>>,
  viewport: { transform: number[] },
  item: { str: string; transform: number[]; width?: number; height?: number },
): { x: number; y: number; w: number; h: number; text: string } | null {
  if (!item.transform) return null;
  const m = pdfjs.Util.transform(viewport.transform, item.transform);
  const fontHeight = Math.max(Math.hypot(m[2], m[3]), item.height ?? 1, 1);
  const width = Math.max(Math.abs(item.width ?? 0), item.str.length ? fontHeight * 0.35 * item.str.length : fontHeight * 0.5, 0.5);
  const x = m[4];
  const y = m[5] - fontHeight;
  return { x, y, w: width, h: fontHeight, text: item.str };
}

function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  return ax2 >= b.x && a.x <= bx2 && ay2 >= b.y && a.y <= by2;
}
