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

  const vectorLeaks = await verifySideChannelVectors(bytes, sensitiveStrings);
  leaks.push(...vectorLeaks);

  if (sensitiveStrings.length > 0) {
    const rawLeaks = await verifyRawStreams(bytes, sensitiveStrings, opts.rasterizedPages, opts.signal);
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
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

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

async function verifySideChannelVectors(
  bytes: Uint8Array,
  sensitiveStrings: string[],
): Promise<VerifyLeak[]> {
  const leaks: VerifyLeak[] = [];
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return leaks; // can't introspect — page check still ran above
  }
  const ctx = doc.context;
  const catalog = doc.catalog;

  const sensitiveHit = (s: string | undefined | null): string | null => {
    if (!s) return null;
    if (sensitiveStrings.length === 0) {
      // No specific strings supplied — flag presence only (callers can
      // still pass these as leaks to refuse export).
      return s.length > 0 ? s : null;
    }
    const hay = s.toLowerCase();
    for (const needle of sensitiveStrings) {
      if (needle && hay.includes(needle.toLowerCase())) return needle;
    }
    return null;
  };

  // -- Form-field values (AcroForm tree + any orphaned /FT dict) -------
  const acroForm = catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm) {
    const fieldsArr = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (fieldsArr) {
      walkFormTree(ctx, fieldsArr.asArray(), (field, ref) => {
        const v = extractText(field.get(PDFName.of("V")));
        if (v) {
          // If sensitive strings supplied, only flag matches; otherwise
          // flag every non-empty form value — they should have been
          // cleared by sanitize/redaction.
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
  // Orphan field dicts (descendants not in /AcroForm /Fields).
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (!obj.has(PDFName.of("FT")) || !obj.has(PDFName.of("V"))) continue;
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

  // -- Annotation text on every page ----------------------------------
  for (let pageIdx = 0; pageIdx < doc.getPageCount(); pageIdx++) {
    const page = doc.getPage(pageIdx);
    const annotsArr = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotsArr) continue;
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
    }
  }

  // -- Hidden layer (OCG) content -------------------------------------
  if (catalog.has(PDFName.of("OCProperties"))) {
    // Presence of OCProperties means optional content layers exist.
    // Scan every XObject/annotation gated by /OC for the sensitive
    // strings — any hit means redacted content is hiding in a layer.
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.has(PDFName.of("OC"))) {
        if (sensitiveStrings.length === 0) {
          leaks.push({
            vector: "hidden-layer",
            text: "Optional-content object remains in document",
            ref: refStr(ref),
          });
        }
        // We can't decode arbitrary content streams cheaply here; the
        // export pipeline should have stripped OCG-gated content during
        // sanitize. Presence alone is reported above.
      }
    }
  }

  // -- Embedded file attachments --------------------------------------
  const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names && names.has(PDFName.of("EmbeddedFiles"))) {
    leaks.push({ vector: "attachment", text: "Catalog /Names /EmbeddedFiles tree present" });
  }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = nameStr(obj.get(PDFName.of("Type")));
    if (type === "/Filespec" || obj.has(PDFName.of("EF"))) {
      const fname = extractText(obj.get(PDFName.of("F"))) || extractText(obj.get(PDFName.of("UF")));
      leaks.push({
        vector: "attachment",
        text: `Embedded file present${fname ? ` (${truncate(fname)})` : ""}`,
        ref: refStr(ref),
      });
    }
  }
  // Stream objects whose /Subtype is /EmbeddedFile carry the bytes.
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue;
    const d = obj.dict;
    if (!(d instanceof PDFDict)) continue;
    if (nameStr(d.get(PDFName.of("Subtype"))) === "/EmbeddedFile") {
      leaks.push({ vector: "attachment", text: "Embedded-file stream present", ref: refStr(ref) });
    }
  }

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

async function verifyRawStreams(
  bytes: Uint8Array,
  sensitiveStrings: string[],
  rasterizedPages?: number[],
  signal?: AbortSignal,
): Promise<VerifyLeak[]> {
  const leaks: VerifyLeak[] = [];
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return leaks;
  }
  const ctx = doc.context;
  const needles = sensitiveStrings.map((s) => s.trim()).filter((s) => s.length >= 3);
  if (needles.length === 0) return leaks;

  // Collect refs reachable from FULLY rasterized pages — /Contents streams
  // and Resources/XObject entries (the burned JPEG). We skip ONLY these:
  // partially-rasterized or text-retaining pages are still scanned. Err
  // toward verifying — never skip on doubt.
  const skipRefs = collectRasterizedPageStreamRefs(doc, rasterizedPages);

  let i = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (i++ % 200 === 199) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      // Yield every 200 objects so the main thread stays responsive on
      // thousands-of-pages docs.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    if (!(obj instanceof PDFStream)) continue;
    if (skipRefs.has(refKey(ref))) continue;
    const decoded = decodeStreamBytes(obj);
    if (!decoded || decoded.length === 0) continue;
    const text = new TextDecoder("latin1").decode(decoded);
    const utf16 = tryUtf16Be(decoded);
    for (const needle of needles) {
      const hexAscii = asciiToHex(needle);
      const hexUtf16 = asciiToUtf16BeHex(needle);
      if (
        text.includes(needle)
        || (utf16 && utf16.includes(needle))
        || text.toLowerCase().includes(hexAscii)
        || text.toLowerCase().includes(hexUtf16)
      ) {
        leaks.push({
          vector: "raw-stream",
          text: `Sensitive literal "${truncate(needle)}" found in stream bytes`,
          ref: refStr(ref),
        });
        break;
      }
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
