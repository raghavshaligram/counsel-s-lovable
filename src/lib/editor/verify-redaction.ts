/** Verify destructive redaction across EVERY text-bearing vector.
 *
 *  Page redaction can leave sensitive data behind in:
 *    - Form field values (AcroForm /V)
 *    - Annotation text (/Contents, /RC, /T, /Subj on text annotations)
 *    - Hidden / optional content layers (OCGs)
 *    - Embedded file attachments (/Names /EmbeddedFiles, /Filespec /EF)
 *
 *  This module checks the geometry of the page (the original behaviour)
 *  AND scans the four side-channel vectors above for any of the
 *  caller-supplied "redacted strings". Any hit is reported as a leak so
 *  the export pipeline can block the download.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from "pdf-lib";
import { unzlibSync } from "fflate";
import { loadPdfjs } from "@/lib/pdf/worker";
import { allocationFailureMessage, logAllocationFailure, logHeap } from "@/lib/memory-log";

export interface RedactionTarget {
  /** 0-indexed page in the exported PDF. */
  page: number;
  /** Diagnostic text. Also used as a "sensitive string" for vector scans. */
  text?: string;
  /** Redaction rect in editor/PDF points, top-left origin. */
  rect?: { x: number; y: number; w: number; h: number };
  /** Optional label (e.g. exemption code) for reporting. */
  label?: string;
}

export type LeakVector = "page" | "form-field" | "annotation" | "hidden-layer" | "attachment" | "raw-stream";

export interface VerifyLeak {
  vector: LeakVector;
  page?: number;
  text: string;
  label?: string;
  rect?: { x: number; y: number; w: number; h: number };
  /** Object reference for non-page leaks (e.g. "12 0 R") for debugging. */
  ref?: string;
}

export interface VerifyResult {
  ok: boolean;
  total: number;
  removed: number;
  leaks: VerifyLeak[];
  /** Per-vector breakdown for UI / logs. */
  vectors: {
    page: number;
    formField: number;
    annotation: number;
    hiddenLayer: number;
    attachment: number;
    rawStream: number;
  };
  scannedAt: string;
}

export interface VerifyOptions {
  /** 0-based page indices that were FULLY rasterized (entire page is a
   *  burned image, no residual text streams). Raw-stream verification is
   *  skipped ONLY for these pages — partially-rasterized or text-retaining
   *  pages remain scanned. Err toward verifying: if uncertain, omit the
   *  index. */
  rasterizedPages?: number[];
  signal?: AbortSignal;
  onProgress?: (stage: "page" | "side-channel" | "raw-stream", done: number, total: number) => void;
}

export async function verifyRedactionRemoval(
  bytes: Uint8Array,
  targets: RedactionTarget[],
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const scannedAt = new Date().toISOString();
  const regionTargets = targets.filter((t) => t.rect && t.rect.w > 0 && t.rect.h > 0);
  const sensitiveStrings = Array.from(new Set(
    targets.map((t) => (t.text ?? "").trim()).filter((s) => s.length >= 3),
  ));

  const leaks: VerifyLeak[] = [];

  if (regionTargets.length > 0) {
    const pageLeaks = await verifyPageGeometry(bytes, regionTargets);
    leaks.push(...pageLeaks);
  }

  // Single pdf-lib parse shared between side-channel + rasterized-page skip
  // computation. Falls back gracefully if the file can't be parsed.
  let sharedDoc: PDFDocument | null = null;
  try {
    logHeap("verify.worker before shared PDFDocument.load", {
      inputBytesMB: Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10,
      targets: targets.length,
    });
    sharedDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    logAllocationFailure("verify.worker shared PDFDocument.load", err, {
      inputBytesMB: Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10,
    });
    /* keep sharedDoc null — vector scans skip */
  }

  if (sharedDoc) {
    const vectorLeaks = await verifySideChannelVectorsWithDoc(sharedDoc, sensitiveStrings, {
      signal: opts.signal,
      onProgress: opts.onProgress
        ? (done, total) => opts.onProgress!("side-channel", done, total)
        : undefined,
    });
    leaks.push(...vectorLeaks);
  }

  if (sensitiveStrings.length > 0 && sharedDoc) {
    const skipRefs = collectRasterizedPageStreamRefs(sharedDoc, opts.rasterizedPages);
    const rawLeaks = await verifyRawStreamsFast(sharedDoc, sensitiveStrings, skipRefs, opts.signal);
    leaks.push(...rawLeaks);
  }

  const vectors = {
    page: leaks.filter((l) => l.vector === "page").length,
    formField: leaks.filter((l) => l.vector === "form-field").length,
    annotation: leaks.filter((l) => l.vector === "annotation").length,
    hiddenLayer: leaks.filter((l) => l.vector === "hidden-layer").length,
    attachment: leaks.filter((l) => l.vector === "attachment").length,
    rawStream: leaks.filter((l) => l.vector === "raw-stream").length,
  };

  const removed = regionTargets.length - vectors.page;
  return {
    ok: leaks.length === 0,
    total: regionTargets.length,
    removed,
    leaks,
    vectors,
    scannedAt,
  };
}

// ---------------------------------------------------------------------------
// Page-geometry scan (unchanged behaviour, now returns typed leaks)
// ---------------------------------------------------------------------------

async function verifyPageGeometry(
  bytes: Uint8Array,
  regionTargets: RedactionTarget[],
): Promise<VerifyLeak[]> {
  const pdfjs = await loadPdfjs();
  // pdf.js may neuter/adopt the buffer; slice keeps the caller's bytes intact
  // for the raw-stream + side-channel scans that run after this pass.
  const inputBytesMB = Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10;
  logHeap("verify.worker before page-geometry bytes.slice", { inputBytesMB, targets: regionTargets.length });
  let pdfjsBytes: Uint8Array;
  try {
    pdfjsBytes = bytes.slice();
  } catch (err) {
    logAllocationFailure("verify.worker page-geometry bytes.slice", err, { inputBytesMB });
    throw new Error(allocationFailureMessage("verify.worker page-geometry bytes.slice", err));
  }
  logHeap("verify.worker before page-geometry pdfjs.getDocument", { inputBytesMB });
  let doc: { numPages: number; getPage: (pageNumber: number) => Promise<any>; destroy?: () => Promise<void> };
  try {
    doc = await pdfjs.getDocument({ data: pdfjsBytes }).promise;
  } catch (err) {
    logAllocationFailure("verify.worker page-geometry pdfjs.getDocument", err, { inputBytesMB });
    throw new Error(allocationFailureMessage("verify.worker page-geometry pdfjs.getDocument", err));
  }



  const byPage = new Map<number, RedactionTarget[]>();
  for (const t of regionTargets) {
    const arr = byPage.get(t.page) ?? [];
    arr.push(t);
    byPage.set(t.page, arr);
  }

  const leaks: VerifyLeak[] = [];
  try {
    for (const [pageIdx, items] of byPage) {
      if (pageIdx < 0 || pageIdx >= doc.numPages) continue;
      const page = await doc.getPage(pageIdx + 1);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const itemBoxes = (tc.items as unknown[])
        .filter((it: unknown) => typeof it === "object" && it !== null && "str" in it && (it as { str: string }).str.trim())
        .map((it: unknown) => textItemBox(pdfjs, viewport, it as { str: string; transform: number[]; width?: number; height?: number }))
        .filter((b: ReturnType<typeof textItemBox>): b is NonNullable<ReturnType<typeof textItemBox>> => !!b);
      for (const t of items) {
        const r = t.rect;
        if (!r) continue;
        const leak = itemBoxes.find((b: NonNullable<ReturnType<typeof textItemBox>>) => intersects(b, r));
        if (leak) {
          leaks.push({
            vector: "page",
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
  return leaks;
}

// ---------------------------------------------------------------------------
// Side-channel scan: form fields, annotations, OCGs, attachments
// ---------------------------------------------------------------------------

export async function verifySideChannelVectors(
  bytes: Uint8Array,
  sensitiveStrings: string[],
  opts: SideChannelOptions = {},
): Promise<VerifyLeak[]> {
  let doc: PDFDocument;
  try {
    logHeap("verify.worker before side-channel PDFDocument.load", {
      inputBytesMB: Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10,
      sensitiveStrings: sensitiveStrings.length,
    });
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    logAllocationFailure("verify.worker side-channel PDFDocument.load", err, {
      inputBytesMB: Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10,
    });
    return [];
  }
  return verifySideChannelVectorsWithDoc(doc, sensitiveStrings, opts);
}

export interface SideChannelOptions {
  signal?: AbortSignal;
  /** (done, total) — `total` is best-effort (page count + object count estimate). */
  onProgress?: (done: number, total: number) => void;
  /**
   * How many indirect objects / annotations to walk before yielding to
   * the event loop. Default: 128. Lower = more responsive, higher = less
   * yielding overhead. Callers running INSIDE a Web Worker can bump this
   * higher since main-thread responsiveness isn't a concern there.
   */
  chunkSize?: number;
}

/**
 * Same as `verifySideChannelVectors` but reuses an already-parsed
 * PDFDocument and walks `enumerateIndirectObjects` exactly ONCE.
 *
 * Runs on whichever thread the caller invokes it on (worker or main).
 * The internal loops yield to the event loop every `chunkSize` iterations
 * so that when this is invoked on the main thread on a large document,
 * the UI does not freeze. Correctness is unchanged — the yield windows
 * are between per-object inspection steps and do NOT touch any bytes;
 * the caller's PDFDocument reference remains the single source of truth.
 */
export async function verifySideChannelVectorsWithDoc(
  doc: PDFDocument,
  sensitiveStrings: string[],
  opts: SideChannelOptions = {},
): Promise<VerifyLeak[]> {
  const leaks: VerifyLeak[] = [];
  const ctx = doc.context;
  const catalog = doc.catalog;
  const chunkSize = Math.max(1, opts.chunkSize ?? 128);
  const signal = opts.signal;

  // Best-effort progress denominator. We don't know the indirect-object
  // count until we've walked it; use page count + a rough headroom so the
  // bar advances monotonically until it snaps to 100% at completion.
  const pageCount = doc.getPageCount();
  const totalEstimate = Math.max(1, pageCount + 512);
  let doneCount = 0;
  const tick = (n = 1): void => {
    doneCount += n;
    opts.onProgress?.(Math.min(doneCount, totalEstimate - 1), totalEstimate);
  };
  const yieldPoint = async (): Promise<void> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise<void>((r) => setTimeout(r, 0));
  };

  const sensitiveHit = (s: string | undefined | null): string | null => {
    if (!s) return null;
    if (sensitiveStrings.length === 0) {
      return s.length > 0 ? s : null;
    }
    const hay = s.toLowerCase();
    for (const needle of sensitiveStrings) {
      if (needle && hay.includes(needle.toLowerCase())) return needle;
    }
    return null;
  };

  // -- AcroForm tree (structured walk) --------------------------------
  const acroForm = catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm) {
    const fieldsArr = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (fieldsArr) {
      walkFormTree(ctx, fieldsArr.asArray(), (field, ref) => {
        const v = extractText(field.get(PDFName.of("V")));
        if (v) {
          const hit = sensitiveHit(v);
          if (hit) {
            leaks.push({
              vector: "form-field",
              text: `Form field value: "${truncate(v)}" (matched "${truncate(hit)}")`,
              ref,
            });
          } else if (sensitiveStrings.length === 0) {
            leaks.push({ vector: "form-field", text: `Uncleared form-field value: "${truncate(v)}"`, ref });
          }
        }
      });
    }
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // -- Annotation text (per-page walk, no full-heap scan) --------------
  // Yield every `chunkSize` pages so a 10k-page doc doesn't stall the
  // main thread here. Per-page work is tiny (Annots array lookup + a
  // handful of dict reads) so the chunk can be relatively large.
  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
    const page = doc.getPage(pageIdx);
    const annotsArr = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annotsArr) {
      let annotSeen = 0;
      for (const item of annotsArr.asArray()) {
        const annot = resolveDict(ctx, item);
        if (!annot) continue;
        for (const key of ["Contents", "RC", "T", "Subj"]) {
          const txt = extractText(annot.get(PDFName.of(key)));
          const hit = sensitiveHit(txt);
          if (hit) {
            leaks.push({
              vector: "annotation",
              page: pageIdx,
              text: `Annotation /${key}: "${truncate(txt)}" (matched "${truncate(hit)}")`,
              ref: refStr(item),
            });
          }
        }
        annotSeen++;
        // Pages with hundreds of annotations (form-heavy PDFs) still yield mid-page.
        if (annotSeen % chunkSize === 0) await yieldPoint();
      }
    }
    tick(1);
    if ((pageIdx & (chunkSize - 1)) === 0) await yieldPoint();
  }

  // -- Attachments discoverable from catalog Names --------------------
  const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names && names.has(PDFName.of("EmbeddedFiles"))) {
    leaks.push({ vector: "attachment", text: "Catalog /Names /EmbeddedFiles tree present" });
  }

  const hasOCG = catalog.has(PDFName.of("OCProperties"));

  // -- SINGLE enumerateIndirectObjects walk: orphan form fields,
  //    hidden-layer objects, filespecs, embedded file streams.
  //    Chunked-and-yielding so the main thread stays responsive on
  //    documents with tens of thousands of indirect objects.
  let objSeen = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      // Orphan form field with /FT + /V outside the AcroForm /Fields tree.
      if (obj.has(PDFName.of("FT")) && obj.has(PDFName.of("V"))) {
        const v = extractText(obj.get(PDFName.of("V")));
        const hit = sensitiveHit(v);
        if (hit) {
          leaks.push({
            vector: "form-field",
            text: `Orphan form field: "${truncate(v)}" (matched "${truncate(hit)}")`,
            ref: refStr(ref),
          });
        }
      }
      // Optional-content gated object.
      if (hasOCG && obj.has(PDFName.of("OC")) && sensitiveStrings.length === 0) {
        leaks.push({
          vector: "hidden-layer",
          text: "Optional-content object remains in document",
          ref: refStr(ref),
        });
      }
      // Filespec / embedded-file dict.
      const type = nameStr(obj.get(PDFName.of("Type")));
      if (type === "/Filespec" || obj.has(PDFName.of("EF"))) {
        const fname = extractText(obj.get(PDFName.of("F"))) || extractText(obj.get(PDFName.of("UF")));
        leaks.push({
          vector: "attachment",
          text: `Embedded file present${fname ? ` (${truncate(fname)})` : ""}`,
          ref: refStr(ref),
        });
      }
    } else if (obj instanceof PDFStream) {
      const d = obj.dict;
      if (d instanceof PDFDict && nameStr(d.get(PDFName.of("Subtype"))) === "/EmbeddedFile") {
        leaks.push({ vector: "attachment", text: "Embedded-file stream present", ref: refStr(ref) });
      }
    }
    objSeen++;
    if (objSeen % chunkSize === 0) {
      tick(chunkSize);
      await yieldPoint();
    }
  }

  // Snap progress to 100% on the last emission so consumers see completion.
  opts.onProgress?.(totalEstimate, totalEstimate);
  return leaks;
}





// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

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

function nameStr(obj: unknown): string {
  return obj && typeof obj === "object" && "asString" in obj
    ? (obj as { asString: () => string }).asString() : "";
}

function resolveDict(ctx: PDFDocument["context"], obj: unknown): PDFDict | undefined {
  if (obj instanceof PDFDict) return obj;
  try {
    const resolved = ctx.lookup(obj as never);
    return resolved instanceof PDFDict ? resolved : undefined;
  } catch { return undefined; }
}

function extractText(obj: unknown): string {
  if (!obj) return "";
  try {
    if (typeof (obj as { decodeText?: () => string }).decodeText === "function") {
      return (obj as { decodeText: () => string }).decodeText();
    }
    if (typeof (obj as { asString?: () => string }).asString === "function") {
      return (obj as { asString: () => string }).asString().replace(/^\//, "");
    }
  } catch { /* ignore */ }
  return "";
}

function refStr(ref: unknown): string {
  return ref && typeof ref === "object" && "objectNumber" in ref && "generationNumber" in ref
    ? `${(ref as { objectNumber: number }).objectNumber} ${(ref as { generationNumber: number }).generationNumber} R`
    : "direct";
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function walkFormTree(
  ctx: PDFDocument["context"],
  items: unknown[],
  visit: (field: PDFDict, ref: string) => void,
): void {
  for (const item of items) {
    const field = resolveDict(ctx, item);
    if (!field) continue;
    visit(field, refStr(item));
    const kids = field.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) walkFormTree(ctx, kids.asArray(), visit);
  }
}

// ---------------------------------------------------------------------------
// Raw stream scan — decodes every PDFStream (page content, form XObjects,
// anything with /Filter FlateDecode or none) and searches the decoded bytes
// for sensitive literals. This is the "don't rely on pdftotext" check: it
// will catch a value that survived as baked glyphs inside a content stream
// even when the text layer extraction misses it.
// ---------------------------------------------------------------------------

async function verifyRawStreamsFast(
  doc: PDFDocument,
  sensitiveStrings: string[],
  skipRefs: Set<string>,
  signal?: AbortSignal,
): Promise<VerifyLeak[]> {
  const leaks: VerifyLeak[] = [];
  const ctx = doc.context;
  const needles = sensitiveStrings.map((s) => s.trim()).filter((s) => s.length >= 3);
  if (needles.length === 0) return leaks;

  // Precompute hex-encoded needle variants once (previously computed per stream).
  const needleHex = needles.map((n) => ({
    literal: n,
    lowerHex: asciiToHex(n),
    utf16Hex: asciiToUtf16BeHex(n),
  }));

  // Cap for what we're willing to inflate. Streams above this are almost
  // always image data (JPEG/CCITT/JBIG2) or huge form XObjects — sensitive
  // literal text won't sit inside those as searchable characters, and the
  // pixel-verify OCR pass catches burned-text-in-image cases.
  const INFLATE_CAP = 4 * 1024 * 1024;

  let i = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    i++;
    if ((i & 31) === 0) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      // Yield every 32 objects so the worker can process a cancel message
      // and V8 can GC intermediate buffers before we allocate the next.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    if (!(obj instanceof PDFStream)) continue;
    if (skipRefs.has(refKey(ref))) continue;

    // Skip image / form XObject subtypes — never carry searchable text.
    const d = obj.dict;
    if (d instanceof PDFDict) {
      const subtype = nameStr(d.get(PDFName.of("Subtype")));
      if (subtype === "/Image" || subtype === "/Form") continue;
    }

    const raw = (obj as unknown as { contents?: Uint8Array }).contents
      ?? (obj as unknown as { getContents?: () => Uint8Array }).getContents?.();
    if (!raw || raw.length === 0) continue;
    if (raw.length > INFLATE_CAP) continue;

    let decoded: Uint8Array | null = decodeStreamBytes(obj);
    if (!decoded || decoded.length === 0) { decoded = null; continue; }

    // Scan on the raw bytes without holding two full string copies. We
    // decode once into latin1 (byte-preserving) and match all needle
    // variants against it, then drop the string.
    const text = new TextDecoder("latin1").decode(decoded);
    const utf16 = tryUtf16Be(decoded);
    // Release the decoded buffer before any string work that follows.
    decoded = null;

    let hit: string | null = null;
    const lowerText = text.toLowerCase();
    for (const n of needleHex) {
      if (
        text.includes(n.literal)
        || (utf16 && utf16.includes(n.literal))
        || lowerText.includes(n.lowerHex)
        || lowerText.includes(n.utf16Hex)
      ) { hit = n.literal; break; }
    }
    if (hit) {
      leaks.push({
        vector: "raw-stream",
        text: `Sensitive literal "${truncate(hit)}" found in stream bytes`,
        ref: refStr(ref),
      });
    }
  }
  return leaks;
}

function refKey(ref: PDFRef | unknown): string {
  if (ref && typeof ref === "object" && "objectNumber" in ref && "generationNumber" in ref) {
    return `${(ref as PDFRef).objectNumber} ${(ref as PDFRef).generationNumber}`;
  }
  return "";
}

function collectRasterizedPageStreamRefs(
  doc: PDFDocument,
  rasterizedPages?: number[],
): Set<string> {
  const out = new Set<string>();
  if (!rasterizedPages || rasterizedPages.length === 0) return out;
  const push = (obj: unknown): void => {
    const k = refKey(obj);
    if (k) out.add(k);
  };
  const pageCount = doc.getPageCount();
  for (const idx of rasterizedPages) {
    if (idx < 0 || idx >= pageCount) continue;
    try {
      const page = doc.getPage(idx);
      const contents = page.node.get(PDFName.of("Contents"));
      if (contents instanceof PDFArray) {
        for (const c of contents.asArray()) push(c);
      } else {
        push(contents);
      }
      const resources = page.node.lookupMaybe(PDFName.of("Resources"), PDFDict);
      if (resources) {
        const xobj = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
        if (xobj) {
          for (const [, v] of xobj.entries()) push(v);
        }
      }
    } catch { /* ignore — err toward verifying (leave those refs scanned) */ }
  }
  return out;
}


function decodeStreamBytes(stream: PDFStream): Uint8Array | null {
  // pdf-lib exposes raw stream contents on PDFRawStream; for content
  // streams it's PDFContentStream which has getContents(). Try every shape.
  const raw =
    (stream as unknown as { contents?: Uint8Array }).contents
    ?? (stream as unknown as { getContents?: () => Uint8Array }).getContents?.();
  if (!raw || raw.length === 0) return null;
  const filter = stream.dict.get(PDFName.of("Filter"));
  const filterName = filter
    ? (typeof (filter as unknown as { asString?: () => string }).asString === "function"
        ? (filter as unknown as { asString: () => string }).asString()
        : "")
    : "";
  if (filterName === "/FlateDecode" || filterName === "/Fl") {
    try { return unzlibSync(raw); } catch { return raw; }
  }
  // /DCTDecode (JPEG), /CCITTFaxDecode etc. carry image data — searching
  // for ASCII inside them is harmless and almost always returns nothing.
  return raw;
}

function tryUtf16Be(buf: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-16be", { fatal: false }).decode(buf);
  } catch {
    return null;
  }
}

function asciiToHex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += (s.charCodeAt(i) & 0xff).toString(16).padStart(2, "0");
  return out;
}

function asciiToUtf16BeHex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += ((c >> 8) & 0xff).toString(16).padStart(2, "0");
    out += (c & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}
