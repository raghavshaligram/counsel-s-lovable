/**
 * PDF/A-safe font embedder.
 *
 * pdf-lib's StandardFonts (Helvetica/Times-Roman/Courier/Symbol/ZapfDingbats)
 * are referenced by name only — the font program is never embedded, which
 * violates PDF/A clause 6.2.11.4.1. This module ships the metric-compatible
 * Liberation fonts (SIL OFL 1.1) under /public/fonts/liberation/ and embeds
 * them as subset TrueType programs so every PDF we export is PDF/A-eligible.
 *
 * Drop-in: `await embedStandardFont(doc, "Helvetica")` returns a PDFFont
 * with the same metrics as Helvetica, but embedded.
 */
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

export type FontKind =
  | "Helvetica" | "HelveticaBold" | "HelveticaOblique" | "HelveticaBoldOblique"
  | "TimesRoman" | "TimesRomanBold" | "TimesRomanItalic" | "TimesRomanBoldItalic"
  | "Courier" | "CourierBold" | "CourierOblique" | "CourierBoldOblique";

const FILE: Record<FontKind, string> = {
  Helvetica: "LiberationSans-Regular.ttf",
  HelveticaBold: "LiberationSans-Bold.ttf",
  HelveticaOblique: "LiberationSans-Italic.ttf",
  HelveticaBoldOblique: "LiberationSans-BoldItalic.ttf",
  TimesRoman: "LiberationSerif-Regular.ttf",
  TimesRomanBold: "LiberationSerif-Bold.ttf",
  TimesRomanItalic: "LiberationSerif-Italic.ttf",
  TimesRomanBoldItalic: "LiberationSerif-BoldItalic.ttf",
  Courier: "LiberationMono-Regular.ttf",
  CourierBold: "LiberationMono-Bold.ttf",
  CourierOblique: "LiberationMono-Italic.ttf",
  CourierBoldOblique: "LiberationMono-BoldItalic.ttf",
};

const bytesCache = new Map<FontKind, Promise<Uint8Array>>();

let loader: (kind: FontKind) => Promise<Uint8Array> = async (kind) => {
  const r = await fetch(`/fonts/liberation/${FILE[kind]}`);
  if (!r.ok) throw new Error(`Font fetch failed for ${kind}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

/** Test/Node entry point — override the default browser fetch loader. */
export function setFontLoader(fn: (kind: FontKind) => Promise<Uint8Array>) {
  loader = fn;
  bytesCache.clear();
}

export function fontFileName(kind: FontKind): string {
  return FILE[kind];
}

function loadBytes(kind: FontKind): Promise<Uint8Array> {
  let p = bytesCache.get(kind);
  if (!p) {
    p = loader(kind);
    bytesCache.set(kind, p);
  }
  return p;
}

const fontkitRegistered = new WeakSet<PDFDocument>();

export async function embedStandardFont(
  doc: PDFDocument,
  kind: FontKind,
): Promise<PDFFont> {
  if (!fontkitRegistered.has(doc)) {
    doc.registerFontkit(fontkit);
    fontkitRegistered.add(doc);
  }
  const bytes = await loadBytes(kind);
  return doc.embedFont(bytes, { subset: true });
}
