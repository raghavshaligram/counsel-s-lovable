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
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFForm } from "pdf-lib";
import { unzlibSync } from "fflate";
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

  // ---- Safety gate: scan + (optionally) remove sensitive content ----
  const findings = scanFormAndAnnotationPii(doc);
  console.log("[flatten-debug] findings:", findings.length, "opts.clearSensitiveFirst:", opts.clearSensitiveFirst);
  if (findings.length > 0) {
    if (!opts.clearSensitiveFirst) {
      throw new FlattenSensitiveDataError(findings);
    }
    if (!opts.clearSensitiveFirst) {
      throw new FlattenSensitiveDataError(findings);
    }
    // Use pdf-lib's form API so the wrapped PDFTextField cache (which
    // form.flatten() consults to regenerate /AP appearance streams) is
    // also cleared. Then remove the field outright AND drop every
    // indirect object the field touched — pdf-lib does not garbage-
    // collect orphan refs on save, so leftover /AP appearance streams
    // would otherwise still carry the SSN in the output file.
    try {
      const form = doc.getForm();
      const ctx = doc.context;
      const refsToKill: PDFRef[] = [];
      for (const field of form.getFields()) {
        // Empty the value first so any re-render produces nothing.
        const anyField = field as unknown as { setText?: (s: string) => void };
        try { anyField.setText?.(""); } catch { /* ignore non-text fields */ }
        refsToKill.push(...collectFieldRefs(ctx, field));
        try { form.removeField(field); } catch { /* ignore */ }
      }
      // Walk the document one more time and queue any indirect object
      // whose decoded contents still carry text-show operators tagged
      // /Tx BMC (the marker pdf-lib emits for form appearance streams).
      // Walk the document one more time and queue any Form XObject whose
      // decoded contents carry the /Tx BMC marker — that's pdf-lib's
      // signature for a form-field appearance stream, so anything still
      // matching belongs to a field we just removed.
      for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFStream)) continue;
        const dict = obj.dict;
        const subtype = (dict.get(PDFName.of("Subtype")) as unknown as { asString?: () => string } | undefined)?.asString?.() ?? "";
        if (subtype !== "/Form") continue;
        const raw = (obj as unknown as { contents?: Uint8Array; getContents?: () => Uint8Array }).contents
          ?? (obj as unknown as { getContents?: () => Uint8Array }).getContents?.();
        if (!raw) continue;
        let decoded: Uint8Array = raw;
        const filt = (dict.get(PDFName.of("Filter")) as unknown as { asString?: () => string } | undefined)?.asString?.() ?? "";
        if (filt === "/FlateDecode") {
          try { decoded = unzlibSync(raw); } catch { /* keep raw */ }
        }
        const txt = new TextDecoder("latin1").decode(decoded);
        if (txt.includes("/Tx BMC")) refsToKill.push(ref);
      }
      console.log("[flatten-debug] refsToKill:", refsToKill.map((r) => r.objectNumber));
      for (const r of refsToKill) {
        try { ctx.delete(r); } catch { /* ignore */ }
      }
      console.log("[flatten-debug] remaining objs after delete:", Array.from(ctx.enumerateIndirectObjects()).map(([r]) => r.objectNumber));
      doc.catalog.delete(PDFName.of("AcroForm"));
      // Also drop /Widget annotations from every page — their parents
      // are gone and they can only carry leftover /AP refs.
      for (const page of doc.getPages()) {
        const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
        if (!annots) continue;
        const keep: unknown[] = [];
        for (const item of annots.asArray()) {
          const a = resolveDict(ctx, item);
          if (!a) { keep.push(item); continue; }
          const st = (a.get(PDFName.of("Subtype")) as unknown as { asString?: () => string } | undefined)?.asString?.() ?? "";
          if (st === "/Widget") {
            if (item && typeof item === "object" && "objectNumber" in item) {
              try { ctx.delete(item as PDFRef); } catch { /* ignore */ }
            }
            continue;
          }
          keep.push(item);
        }
        const next = PDFArray.withContext(ctx);
        for (const k of keep) next.push(k as never);
        page.node.set(PDFName.of("Annots"), next);
      }
    } catch { /* no form */ }
    // Also strip text from any sensitive annotation /Contents so a
    // subsequent annotation flatten (if a future caller adds one) can't
    // bake it either.
    scrubAnnotationText(doc);
  }

  if (opts.forms) {
    try {
      const form = doc.getForm();
      // form.flatten() bakes /V → /AP → page. We've removed every sensitive
      // field above, so any remaining fields are safe to flatten.
      form.flatten();
    } catch {
      // No form — ignore.
    }
  }

  if (opts.annotations) {
    for (const page of doc.getPages()) {
      page.node.delete(PDFName.of("Annots"));
    }
  }

  return doc.save();
}

function scrubAnnotationText(doc: PDFDocument): void {
  const ctx = doc.context;
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (const item of annots.asArray()) {
      const a = resolveDict(ctx, item);
      if (!a) continue;
      for (const k of ["Contents", "RC", "Subj", "T"]) {
        if (a.has(PDFName.of(k))) a.delete(PDFName.of(k));
      }
    }
  }
}

/** Gather every indirect ref reachable from a form field's wrapper: the
 *  field's own ref, its widget annotations, and every appearance stream
 *  (/AP/N/D/R) so they can be ctx.delete()'d after removeField. pdf-lib
 *  does not garbage-collect orphan objects on save. */
function collectFieldRefs(ctx: PDFDocument["context"], field: ReturnType<PDFForm["getFields"]>[number]): PDFRef[] {
  const refs: PDFRef[] = [];
  const seen = new Set<string>();
  const push = (r: unknown): void => {
    if (!r || typeof r !== "object" || !("objectNumber" in r)) return;
    const key = `${(r as PDFRef).objectNumber} ${(r as PDFRef).generationNumber}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(r as PDFRef);
  };
  const acroField = (field as unknown as { acroField?: { ref?: PDFRef; dict?: PDFDict } }).acroField;
  push(acroField?.ref);
  const dict = acroField?.dict;
  if (dict instanceof PDFDict) {
    const kids = dict.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) {
      for (const k of kids.asArray()) {
        push(k);
        const w = resolveDict(ctx, k);
        if (w) collectAppearanceRefs(w, push);
      }
    }
    collectAppearanceRefs(dict, push);
  }
  return refs;
}

function collectAppearanceRefs(dict: PDFDict, push: (r: unknown) => void): void {
  const ap = dict.lookupMaybe(PDFName.of("AP"), PDFDict);
  if (!ap) return;
  for (const key of ["N", "D", "R"]) {
    const v = ap.get(PDFName.of(key));
    push(v);
    // /N may also be a dict mapping states → refs.
    const asDict = ap.lookupMaybe(PDFName.of(key), PDFDict);
    if (asDict) for (const e of asDict.entries()) push(e[1]);
  }
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
