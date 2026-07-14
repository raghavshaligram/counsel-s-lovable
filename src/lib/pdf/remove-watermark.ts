/**
 * Remove watermark — on-device, lossless where possible.
 *
 * Strategy A (always safe): strip PDF annotations whose /Subtype is Watermark
 * or whose /Name/T mark them as a watermark stamp (Adobe / Foxit / iLovePDF /
 * SmallPDF all tag their output this way). Nothing else on the page changes.
 *
 * Strategy B (opt-in): detect Form XObjects that appear on nearly every page
 * — the classic "confidential" overlay stamp shape — and blank their content
 * stream. The XObject still exists (so every reference is still valid), but
 * it renders nothing.
 *
 * Painted-into-page raster watermarks CANNOT be removed cleanly; the panel
 * points those users to the Redact tool.
 */
import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFRawStream,
} from "pdf-lib";

/** Dict key CounselPDF's own watermark tool stamps onto its Form XObjects. */
export const WATERMARK_MARKER = "CounselPDFWatermark";

export interface WatermarkScan {
  annotationCount: number;
  repeatedXObjects: Array<{
    ref: string;         // PDFRef.toString(), used as a stable id in the UI
    pageCount: number;
    totalPages: number;
    percent: number;
  }>;
  totalPages: number;
}

export interface RemoveOptions {
  stripAnnotations: boolean;
  /** PDFRef strings (from `WatermarkScan.repeatedXObjects[].ref`) to blank. */
  blankXObjectRefs: string[];
}

export interface RemoveResult {
  bytes: Uint8Array;
  annotationsRemoved: number;
  xobjectsBlanked: number;
}

const WATERMARK_HINT = /watermark|confidential|draft|do\s*not|specimen/i;

function isWatermarkAnnot(dict: PDFDict): boolean {
  const sub = dict.get(PDFName.of("Subtype"));
  const subStr = sub ? sub.toString() : "";
  if (/\/Watermark\b/i.test(subStr)) return true;
  // Stamp annotations with a name/contents that reads like a watermark.
  if (/\/Stamp\b/i.test(subStr)) {
    const name = dict.get(PDFName.of("Name"));
    const t = dict.get(PDFName.of("T"));
    const contents = dict.get(PDFName.of("Contents"));
    const bag = [name, t, contents]
      .map((v) => (v ? v.toString() : ""))
      .join(" ");
    if (WATERMARK_HINT.test(bag)) return true;
  }
  return false;
}

/** Scan the PDF for watermark-shaped things. Never mutates the input. */
export async function scanForWatermarks(
  bytes: Uint8Array,
): Promise<WatermarkScan> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const totalPages = pages.length;

  // 1. Count annotation-based watermarks.
  let annotationCount = 0;
  for (const page of pages) {
    const annotsRaw = page.node.get(PDFName.of("Annots"));
    if (!annotsRaw) continue;
    const arr =
      annotsRaw instanceof PDFArray
        ? annotsRaw
        : (doc.context.lookup(annotsRaw) as PDFArray | undefined);
    if (!(arr instanceof PDFArray)) continue;
    for (let i = 0; i < arr.size(); i++) {
      const el = arr.get(i);
      const dict =
        el instanceof PDFRef
          ? (doc.context.lookup(el) as PDFDict | undefined)
          : (el as PDFDict | undefined);
      if (dict instanceof PDFDict && isWatermarkAnnot(dict)) annotationCount++;
    }
  }

  // 2. Count repeated Form XObject usage.
  const xoUsage = new Map<string, number>();
  for (const page of pages) {
    const resources = page.node.Resources();
    if (!resources) continue;
    const xobjRaw = resources.get(PDFName.of("XObject"));
    if (!xobjRaw) continue;
    const xobjDict =
      xobjRaw instanceof PDFDict
        ? xobjRaw
        : (doc.context.lookup(xobjRaw) as PDFDict | undefined);
    if (!(xobjDict instanceof PDFDict)) continue;
    const seenOnPage = new Set<string>();
    for (const [, value] of xobjDict.entries()) {
      if (!(value instanceof PDFRef)) continue;
      const target = doc.context.lookup(value);
      // Only Form XObjects — Images are almost always real content.
      if (!(target instanceof PDFRawStream)) continue;
      const sub = target.dict.get(PDFName.of("Subtype"));
      if (!sub || !/\/Form\b/i.test(sub.toString())) continue;
      const key = value.toString();
      if (seenOnPage.has(key)) continue;
      seenOnPage.add(key);
      xoUsage.set(key, (xoUsage.get(key) ?? 0) + 1);
    }
  }

  const repeated: WatermarkScan["repeatedXObjects"] = [];
  for (const [ref, count] of xoUsage.entries()) {
    const percent = totalPages > 0 ? count / totalPages : 0;
    if (percent >= 0.6 && totalPages >= 2) {
      repeated.push({ ref, pageCount: count, totalPages, percent });
    }
  }
  repeated.sort((a, b) => b.pageCount - a.pageCount);

  return { annotationCount, repeatedXObjects: repeated, totalPages };
}

/** Parse a PDFRef.toString() (e.g. "12 0 R") back into a PDFRef. */
function parseRef(s: string): PDFRef | null {
  const m = /^(\d+)\s+(\d+)\s+R$/.exec(s.trim());
  if (!m) return null;
  return PDFRef.of(parseInt(m[1], 10), parseInt(m[2], 10));
}

export async function removeWatermarks(
  bytes: Uint8Array,
  opts: RemoveOptions,
): Promise<RemoveResult> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let annotationsRemoved = 0;
  let xobjectsBlanked = 0;

  if (opts.stripAnnotations) {
    for (const page of doc.getPages()) {
      const annotsRaw = page.node.get(PDFName.of("Annots"));
      if (!annotsRaw) continue;
      const arr =
        annotsRaw instanceof PDFArray
          ? annotsRaw
          : (doc.context.lookup(annotsRaw) as PDFArray | undefined);
      if (!(arr instanceof PDFArray)) continue;
      const keep: unknown[] = [];
      for (let i = 0; i < arr.size(); i++) {
        const el = arr.get(i);
        const dict =
          el instanceof PDFRef
            ? (doc.context.lookup(el) as PDFDict | undefined)
            : (el as PDFDict | undefined);
        if (dict instanceof PDFDict && isWatermarkAnnot(dict)) {
          annotationsRemoved++;
          continue;
        }
        keep.push(el);
      }
      if (keep.length !== arr.size()) {
        page.node.set(
          PDFName.of("Annots"),
          doc.context.obj(keep as never[]),
        );
      }
    }
  }

  if (opts.blankXObjectRefs.length > 0) {
    // Replace each named Form XObject's content stream with a no-op ("q Q").
    // The dict (BBox, Matrix, Resources, /Length placeholder) is preserved so
    // every existing `/name Do` reference on every page stays valid but paints
    // nothing.
    for (const refStr of opts.blankXObjectRefs) {
      const ref = parseRef(refStr);
      if (!ref) continue;
      const obj = doc.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) continue;
      const sub = obj.dict.get(PDFName.of("Subtype"));
      if (!sub || !/\/Form\b/i.test(sub.toString())) continue;
      // "q\nQ" — push+pop graphics state, no drawing operators.
      const empty = new Uint8Array([0x71, 0x0a, 0x51]);
      // Drop any filter so serializer doesn't try to keep old compression.
      obj.dict.delete(PDFName.of("Filter"));
      obj.dict.delete(PDFName.of("DecodeParms"));
      const replacement = PDFRawStream.of(obj.dict, empty);
      doc.context.assign(ref, replacement);
      xobjectsBlanked++;
    }
  }

  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, annotationsRemoved, xobjectsBlanked };
}
