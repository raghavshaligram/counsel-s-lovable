/**
 * Flatten op — bakes form fields (and optionally annotations) into static
 * page content. bytes -> bytes.
 *
 * SAFETY INVARIANT (do not remove):
 *   Flattening an un-redacted form field BAKES the field /V into the page
 *   content stream as real glyphs. That's a leak: the value can no longer
 *   be cleared by sanitize (which only touches /V, not page content) and
 *   it survives every downstream pass — including PDF/A conversion. So
 *   before pdf-lib's form.flatten() runs we ALWAYS scan for sensitive PII
 *   in form-field values + text-bearing annotation contents. By default
 *   the op refuses to flatten if anything matches; with
 *   `clearSensitiveFirst: true` it clears them in place first and then
 *   flattens the (now-empty) widgets.
 *
 *   This is non-negotiable for any caller in a redaction or "court-ready"
 *   path. The legacy /flatten route can pass `clearSensitiveFirst: true`
 *   so users aren't surprised by a refusal.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { matchAllCategories } from "@/lib/pdf/detect-pii";

export interface FlattenOpts {
  forms: boolean;
  annotations: boolean;
  /** Default false. When true, sensitive form-field values and annotation
   *  text are wiped before flattening so nothing sensitive is baked into
   *  the page. When false, the op THROWS if it finds any PII. */
  clearSensitiveFirst?: boolean;
}

export class FlattenSensitiveDataError extends Error {
  readonly findings: { vector: "form-field" | "annotation"; label: string; snippet: string }[];
  constructor(findings: FlattenSensitiveDataError["findings"]) {
    super(
      `Refusing to flatten: ${findings.length} sensitive value${findings.length === 1 ? "" : "s"} ` +
      `would be baked into the page (${findings.slice(0, 3).map((f) => `${f.vector}: ${f.snippet}`).join("; ")}` +
      `${findings.length > 3 ? "…" : ""}). Clear them first, or call with clearSensitiveFirst: true.`,
    );
    this.name = "FlattenSensitiveDataError";
    this.findings = findings;
  }
}

export async function flatten(bytes: Uint8Array, opts: FlattenOpts): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  // ---- Safety gate: scan + (optionally) clear sensitive content -----
  const findings = scanFormAndAnnotationPii(doc);
  if (findings.length > 0) {
    if (!opts.clearSensitiveFirst) {
      throw new FlattenSensitiveDataError(findings);
    }
    clearSensitiveFormAndAnnotations(doc);
  }

  if (opts.forms) {
    try {
      const form = doc.getForm();
      // updateFieldAppearances + flatten bakes current values into content stream.
      // Because we cleared sensitive /V above, the baked glyphs cannot leak PII.
      form.flatten();
    } catch {
      // No form — ignore.
    }
  }

  if (opts.annotations) {
    // Drop /Annots from each page entirely (after form flatten removed widgets).
    for (const page of doc.getPages()) {
      page.node.delete(PDFName.of("Annots"));
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function scanFormAndAnnotationPii(
  doc: PDFDocument,
): FlattenSensitiveDataError["findings"] {
  const out: FlattenSensitiveDataError["findings"] = [];
  const ctx = doc.context;

  // Form fields (/V + /DV).
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm) {
    const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (fields) walkFields(ctx, fields.asArray(), (field) => {
      const name = extractStr(field.get(PDFName.of("T"))) || "field";
      for (const key of ["V", "DV"]) {
        const v = extractStr(field.get(PDFName.of(key)));
        if (v && matchAllCategories(v).length > 0) {
          out.push({ vector: "form-field", label: name, snippet: truncate(v) });
        }
      }
    });
  }
  // Orphan field dicts outside the AcroForm tree.
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (!obj.has(PDFName.of("FT")) || !obj.has(PDFName.of("V"))) continue;
    const v = extractStr(obj.get(PDFName.of("V")));
    if (v && matchAllCategories(v).length > 0) {
      out.push({ vector: "form-field", label: extractStr(obj.get(PDFName.of("T"))) || "orphan", snippet: truncate(v) });
    }
  }

  // Annotation text (will be baked into the page when annotations are
  // flattened or remain as a comment pane otherwise — both leak).
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (const item of annots.asArray()) {
      const a = resolveDict(ctx, item);
      if (!a) continue;
      for (const key of ["Contents", "RC", "Subj"]) {
        const t = extractStr(a.get(PDFName.of(key)));
        if (t && matchAllCategories(t).length > 0) {
          out.push({ vector: "annotation", label: `/${key}`, snippet: truncate(t) });
        }
      }
    }
  }
  return out;
}

function clearSensitiveFormAndAnnotations(doc: PDFDocument): void {
  const ctx = doc.context;
  const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm) {
    const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (fields) walkFields(ctx, fields.asArray(), (field) => {
      for (const key of ["V", "DV", "RV"]) {
        if (field.has(PDFName.of(key))) field.delete(PDFName.of(key));
      }
      // Strip widget appearance streams (/AP) on every Kid widget — they
      // hold the rendered glyphs and would otherwise be baked by flatten.
      const kids = field.lookupMaybe(PDFName.of("Kids"), PDFArray);
      if (kids) {
        for (const k of kids.asArray()) {
          const w = resolveDict(ctx, k);
          if (w && w.has(PDFName.of("AP"))) w.delete(PDFName.of("AP"));
        }
      }
      if (field.has(PDFName.of("AP"))) field.delete(PDFName.of("AP"));
    });
  }
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.has(PDFName.of("FT"))) {
      for (const key of ["V", "DV", "RV", "AP"]) {
        if (obj.has(PDFName.of(key))) obj.delete(PDFName.of(key));
      }
    }
  }
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (const item of annots.asArray()) {
      const a = resolveDict(ctx, item);
      if (!a) continue;
      for (const key of ["Contents", "RC", "Subj", "T", "CA", "AP"]) {
        if (a.has(PDFName.of(key))) a.delete(PDFName.of(key));
      }
    }
  }
}

function walkFields(
  ctx: PDFDocument["context"],
  items: unknown[],
  visit: (field: PDFDict) => void,
): void {
  for (const item of items) {
    const field = resolveDict(ctx, item);
    if (!field) continue;
    visit(field);
    const kids = field.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) walkFields(ctx, kids.asArray(), visit);
  }
}

function resolveDict(ctx: PDFDocument["context"], obj: unknown): PDFDict | undefined {
  if (obj instanceof PDFDict) return obj;
  try {
    const r = ctx.lookup(obj as never);
    return r instanceof PDFDict ? r : undefined;
  } catch { return undefined; }
}

function extractStr(obj: unknown): string {
  if (!obj) return "";
  try {
    const o = obj as { decodeText?: () => string; asString?: () => string };
    if (typeof o.decodeText === "function") return o.decodeText();
    if (typeof o.asString === "function") return o.asString();
  } catch { /* ignore */ }
  return "";
}

function truncate(s: string, n = 40): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
