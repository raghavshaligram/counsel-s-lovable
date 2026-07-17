/**
 * Central pdf.js document opener.
 *
 * Turns on XFA form rendering (`enableXfa`) so PDFs authored in
 * LiveCycle Designer render their real pages instead of the "Please
 * open in Adobe Acrobat Reader" static fallback page.
 *
 * Also enables `useSystemFonts` so form field labels rendered by the
 * XFA layer fall back to reasonable glyphs.
 *
 * Use this instead of calling `pdfjs.getDocument(...)` directly.
 */
import { getPdfjs, PDFJS_ASSET_DEFAULTS } from "@/lib/pdf/worker";

type DocSource =
  | Uint8Array
  | ArrayBuffer
  | { data: Uint8Array | ArrayBuffer; [k: string]: unknown }
  | { url: string; [k: string]: unknown };

export async function openPdfDoc(src: DocSource, extra: Record<string, unknown> = {}) {
  const pdfjs = await getPdfjs();
  const base: Record<string, unknown> = {
    ...PDFJS_ASSET_DEFAULTS,
    enableXfa: true,
    useSystemFonts: true,
    ...extra,
  };
  let params: Record<string, unknown>;
  if (src instanceof Uint8Array || src instanceof ArrayBuffer) {
    params = { data: src, ...base };
  } else {
    params = { ...src, ...base };
  }
  return pdfjs.getDocument(params as any).promise;
}

/** Same as openPdfDoc but returns the loading task (for progress / cancel). */
export async function openPdfDocTask(src: DocSource, extra: Record<string, unknown> = {}) {
  const pdfjs = await getPdfjs();
  const base: Record<string, unknown> = {
    ...PDFJS_ASSET_DEFAULTS,
    enableXfa: true,
    useSystemFonts: true,
    ...extra,
  };
  let params: Record<string, unknown>;
  if (src instanceof Uint8Array || src instanceof ArrayBuffer) {
    params = { data: src, ...base };
  } else {
    params = { ...src, ...base };
  }
  return pdfjs.getDocument(params as any);
}
