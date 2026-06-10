/**
 * Flatten op — bakes form fields (and optionally annotations) into static
 * page content. bytes -> bytes.
 *
 * pdf-lib supports form.flatten() which bakes AcroForm widgets. Annotation
 * flattening requires rasterizing per-page; for v1 we drop most annotations
 * via removing the page /Annots entries that aren't widgets, when toggled.
 */
import { PDFDocument, PDFName } from "pdf-lib";

export interface FlattenOpts {
  forms: boolean;
  annotations: boolean;
}

export async function flatten(bytes: Uint8Array, opts: FlattenOpts): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  if (opts.forms) {
    try {
      const form = doc.getForm();
      // updateFieldAppearances + flatten bakes current values into content stream.
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
