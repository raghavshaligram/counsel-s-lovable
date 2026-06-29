/**
 * Sanitize — strip hidden data from a PDF on-device.
 *
 * Covers EVERY text-bearing vector, not just the visible page content stream:
 *  - Document metadata (Title, Author, Subject, Keywords, Producer, Creator,
 *    Creation/Modification dates) and the XMP /Metadata stream.
 *  - AcroForm tree (cleared values, then the whole /AcroForm dict deleted).
 *  - Annotations on every page: /Contents, /RC, /T, /Subj, /CA values wiped
 *    AND any annotation whose subtype carries text (Text/FreeText/Popup/
 *    Highlight/Underline/Squiggly/StrikeOut/Caret/Stamp/Ink/FileAttachment)
 *    is removed entirely so nothing remains for an extractor to scrape.
 *  - Optional Content Groups (OCGs / layers) — /OCProperties is deleted,
 *    annotations and XObjects gated by an OCG are removed.
 *  - Embedded files / file attachments — /Names → /EmbeddedFiles AND
 *    /Filespec objects with /EF entries are stripped wholesale.
 *  - JavaScript triggers — /Names /JavaScript, /OpenAction, /AA at catalog
 *    and per-page level.
 *
 * Visible page content streams are preserved. This is a "scrub before
 * sharing" pass; it complements (but does not replace) destructive
 * redaction, which burns regions of the page itself.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from "pdf-lib";

export interface SanitizeReport {
  documentInfo: number;        // count of doc-info fields that had a value
  xmpMetadata: number;         // 1 if XMP stream existed
  embeddedFiles: number;       // count of /Filespec /EF + /Names /EmbeddedFiles
  javascript: number;          // count of JS triggers found
  acroForm: number;            // 1 if /AcroForm existed
  acroFormFields: number;      // count of form fields whose /V was non-empty
  annotations: number;         // count of annotations removed or scrubbed
  hiddenLayers: number;        // count of OCGs detected
  hiddenLayerContent: number;  // count of OCG-gated annotations/XObjects removed
  additionalActions: number;   // catalog /AA + per-page /AA triggers
}

const TEXT_ANNOT_SUBTYPES = new Set([
  "/Text", "/FreeText", "/Popup", "/Highlight", "/Underline", "/Squiggly",
  "/StrikeOut", "/Caret", "/Stamp", "/Ink", "/FileAttachment", "/Sound",
  "/RichMedia", "/Movie",
]);

export async function sanitizePdfBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const { bytes: out } = await sanitizePdfBytesWithReport(bytes);
  return out;
}

export async function sanitizePdfBytesWithReport(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; report: SanitizeReport; pageCount: number }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

  const report: SanitizeReport = {
    documentInfo: 0, xmpMetadata: 0, embeddedFiles: 0, javascript: 0,
    acroForm: 0, acroFormFields: 0, annotations: 0,
    hiddenLayers: 0, hiddenLayerContent: 0, additionalActions: 0,
  };

  // 1) Document info ----------------------------------------------------
  const had = (v: string | undefined | string[]) =>
    Array.isArray(v) ? v.length > 0 : !!(v && v.trim());
  try { if (had(doc.getTitle())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getAuthor())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getSubject())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getKeywords())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getProducer())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getCreator())) report.documentInfo++; } catch { /* ignore */ }
  doc.setTitle(""); doc.setAuthor(""); doc.setSubject("");
  doc.setKeywords([]); doc.setProducer(""); doc.setCreator("");

  const ctx = doc.context;
  const catalog = doc.catalog;

  // 2) AcroForm field values — clear /V, /DV, /RV on every form field
  //    BEFORE deleting /AcroForm so descendants in the indirect-object
  //    graph also lose their cached values (some viewers still surface
  //    them via field refs from annotations).
  const acroForm = catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm) {
    report.acroForm = 1;
    const fieldsArr = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (fieldsArr) {
      for (const item of fieldsArr.asArray()) {
        const cleared = clearFormFieldTree(ctx, item);
        report.acroFormFields += cleared;
      }
    }
    catalog.delete(PDFName.of("AcroForm"));
  }
  // Belt and braces: even if /AcroForm was already missing, individual
  // field dicts can linger as orphans. Walk every indirect object and
  // clear any /FT /Tx-style field value we find.
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (!obj.has(PDFName.of("FT"))) continue;
    if (obj.has(PDFName.of("V"))) { obj.delete(PDFName.of("V")); report.acroFormFields++; }
    if (obj.has(PDFName.of("DV"))) obj.delete(PDFName.of("DV"));
    if (obj.has(PDFName.of("RV"))) obj.delete(PDFName.of("RV"));
    // /AP appearance streams cache the rendered glyphs of /V. Without
    // stripping them, the value can still be recovered from the widget
    // XObject and would be baked into the page by any downstream flatten.
    if (obj.has(PDFName.of("AP"))) obj.delete(PDFName.of("AP"));
  }
  // Also drop /Widget annotations on every page — the parent form fields
  // were just deleted, so the widgets are now orphans whose only purpose
  // would be to carry leftover /AP streams.
  for (const page of doc.getPages()) {
    const annotsArr2 = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotsArr2) continue;
    const keep2: unknown[] = [];
    for (const item of annotsArr2.asArray()) {
      const annot = resolveDict(ctx, item);
      if (!annot) { keep2.push(item); continue; }
      if (nameStr(annot.get(PDFName.of("Subtype"))) === "/Widget") {
        if (item && typeof item === "object" && "objectNumber" in item) {
          removeRef(ctx, item as PDFRef);
        }
        continue;
      }
      keep2.push(item);
    }
    if (keep2.length !== annotsArr2.size()) {
      const next = PDFArray.withContext(ctx);
      for (const k of keep2) next.push(k as never);
      page.node.set(PDFName.of("Annots"), next);
    }
  }
  // Purge orphaned widget appearance streams (/Form XObjects pdf-lib
  // tagged with /Tx BMC). Without this they survive in the saved file
  // even though nothing references them — and they still carry the
  // form-field glyph strings, which a raw-stream verifier rightly
  // flags as a leak.
  await purgeWidgetAppearanceStreams(ctx);

  // 3) Annotations — strip text from every annotation and remove
  //    text-bearing subtypes entirely so /Contents, /RC, /T, /Subj
  //    can't survive in a viewer's comment pane or extractor.
  for (const page of doc.getPages()) {
    const annotsArr = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotsArr) continue;
    const keep: unknown[] = [];
    for (const item of annotsArr.asArray()) {
      const annot = resolveDict(ctx, item);
      if (!annot) { keep.push(item); continue; }
      const subtype = nameStr(annot.get(PDFName.of("Subtype")));
      const isTextual = TEXT_ANNOT_SUBTYPES.has(subtype) ||
        annot.has(PDFName.of("Contents")) || annot.has(PDFName.of("RC"));
      if (isTextual) {
        report.annotations++;
        // Drop from /Annots AND delete the indirect object so its
        // /Contents bytes don't survive in the saved file.
        if (item && typeof item === "object" && "objectNumber" in item) {
          removeRef(ctx, item as PDFRef);
        } else {
          // Direct dict — wipe its text fields in place.
          for (const k of ["Contents", "RC", "T", "Subj", "CA", "NM"]) {
            if (annot.has(PDFName.of(k))) annot.delete(PDFName.of(k));
          }
        }
        continue;
      }
      // Non-text annotations (e.g. /Link, /Widget without /FT) — still
      // scrub any descriptive metadata fields they may carry.
      for (const k of ["Contents", "RC", "T", "Subj", "CA", "NM"]) {
        if (annot.has(PDFName.of(k))) annot.delete(PDFName.of(k));
      }
      keep.push(item);
    }
    if (keep.length) {
      const next = PDFArray.withContext(ctx);
      for (const k of keep) next.push(k as never);
      page.node.set(PDFName.of("Annots"), next);
    } else {
      page.node.delete(PDFName.of("Annots"));
    }
  }

  // 4) Optional Content Groups — every /OCG and the /OCProperties dict
  //    can hide content from view. Remove the catalog reference AND
  //    delete any annotation/XObject gated by an OCG so nothing remains
  //    in invisible layers.
  if (catalog.has(PDFName.of("OCProperties"))) {
    const ocp = catalog.lookupMaybe(PDFName.of("OCProperties"), PDFDict);
    if (ocp) {
      const ocgs = ocp.lookupMaybe(PDFName.of("OCGs"), PDFArray);
      if (ocgs) report.hiddenLayers = ocgs.size();
    }
    catalog.delete(PDFName.of("OCProperties"));
  }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    // Annotation with /OC dict → was layer-gated → drop the whole thing.
    if (obj instanceof PDFDict && obj.has(PDFName.of("OC")) && obj.has(PDFName.of("Subtype"))) {
      removeRef(ctx, ref);
      report.hiddenLayerContent++;
      continue;
    }
    // XObject with /OC → wipe its contents so any layer-hidden glyphs go.
    if (obj instanceof PDFStream) {
      const d = obj.dict;
      if (d instanceof PDFDict && d.has(PDFName.of("OC"))) {
        // Replace with an empty stream of the same kind.
        try {
          const empty = ctx.stream(new Uint8Array(0));
          ctx.assign(ref, empty);
          report.hiddenLayerContent++;
        } catch { /* ignore */ }
      }
    }
  }

  // 5) Embedded files — /Names /EmbeddedFiles, plus any /Filespec /EF
  //    that escaped the Names tree (e.g. attached to annotations).
  const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (names) {
    if (names.has(PDFName.of("EmbeddedFiles"))) {
      report.embeddedFiles++;
      names.delete(PDFName.of("EmbeddedFiles"));
    }
    if (names.has(PDFName.of("JavaScript"))) {
      report.javascript++;
      names.delete(PDFName.of("JavaScript"));
    }
  }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = nameStr(obj.get(PDFName.of("Type")));
    if (type === "/Filespec" || obj.has(PDFName.of("EF"))) {
      removeRef(ctx, ref);
      report.embeddedFiles++;
    }
  }

  // 6) JavaScript / triggers --------------------------------------------
  if (catalog.has(PDFName.of("OpenAction"))) {
    report.javascript++;
    catalog.delete(PDFName.of("OpenAction"));
  }
  if (catalog.has(PDFName.of("AA"))) {
    report.additionalActions++;
    catalog.delete(PDFName.of("AA"));
  }
  for (const page of doc.getPages()) {
    if (page.node.has(PDFName.of("AA"))) {
      report.additionalActions++;
      page.node.delete(PDFName.of("AA"));
    }
  }
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const s = nameStr(obj.get(PDFName.of("S")));
    if (s === "/JavaScript") {
      report.javascript++;
      obj.set(PDFName.of("S"), PDFName.of("GoTo"));
      for (const k of ["JS", "F"]) {
        if (obj.has(PDFName.of(k))) obj.delete(PDFName.of(k));
      }
    }
  }

  // 7) XMP metadata stream ---------------------------------------------
  if (catalog.has(PDFName.of("Metadata"))) {
    report.xmpMetadata = 1;
    catalog.delete(PDFName.of("Metadata"));
  }

  const pageCount = doc.getPageCount();
  const outBytes = await doc.save({ updateFieldAppearances: false });
  return { bytes: outBytes, report, pageCount };
}

// ----- helpers --------------------------------------------------------

function nameStr(obj: unknown): string {
  return obj && typeof obj === "object" && "asString" in obj
    ? (obj as { asString: () => string }).asString()
    : "";
}

function resolveDict(ctx: PDFDocument["context"], obj: unknown): PDFDict | undefined {
  if (obj instanceof PDFDict) return obj;
  try {
    const resolved = ctx.lookup(obj as never);
    return resolved instanceof PDFDict ? resolved : undefined;
  } catch { return undefined; }
}

function removeRef(ctx: PDFDocument["context"], ref: PDFRef): void {
  try { ctx.delete(ref); } catch { /* ignore */ }
}

/** Recursively clear /V (and /DV, /RV) on a form field tree.
 *  Returns the count of fields whose /V was non-empty before clearing. */
function clearFormFieldTree(ctx: PDFDocument["context"], item: unknown): number {
  const field = resolveDict(ctx, item);
  if (!field) return 0;
  let count = 0;
  if (field.has(PDFName.of("V"))) { field.delete(PDFName.of("V")); count++; }
  if (field.has(PDFName.of("DV"))) field.delete(PDFName.of("DV"));
  if (field.has(PDFName.of("RV"))) field.delete(PDFName.of("RV"));
  const kids = field.lookupMaybe(PDFName.of("Kids"), PDFArray);
  if (kids) {
    for (const k of kids.asArray()) count += clearFormFieldTree(ctx, k);
  }
  return count;
}
