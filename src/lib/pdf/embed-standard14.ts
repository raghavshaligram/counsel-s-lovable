/**
 * embed-standard14 — fixes the most common PDF/A failure: a copied source
 * page that still references one of the Standard 14 fonts (Helvetica,
 * Times-Roman, Courier, …) WITHOUT an embedded font program. PDF/A-2
 * forbids any unembedded font, including the legacy Standard 14.
 *
 * Strategy (per ISO 32000 / PDF Reference §5.5.5):
 *   - Find every simple-font dict (/Type /Font, /Subtype /Type1|/TrueType|
 *     /MMType1) whose FontDescriptor lacks FontFile/FontFile2/FontFile3.
 *   - If BaseFont (with any subset prefix stripped) maps to a Standard 14
 *     name, build a TrueType embedding from the bundled metric-compatible
 *     Liberation font that already ships in /public/fonts/liberation/.
 *   - Mutate the font dict in place: switch Subtype to /TrueType, attach
 *     /FontFile2 to the descriptor, synthesize /Encoding /WinAnsiEncoding,
 *     /FirstChar 32, /LastChar 255, /Widths from the embedded font's hmtx.
 *
 * Content streams continue to reference the same /F1, /F2 resource names
 * — only the indirect font dicts change. Because Liberation is metric-
 * compatible with the Standard 14 and WinAnsiEncoding is the most common
 * default for Latin text, glyphs render correctly.
 */
import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray, PDFDict, PDFName, PDFNumber, type PDFDocument,
} from "pdf-lib";
import { fontFileName, type FontKind } from "./fonts-pdfa";

const STD14: Record<string, FontKind> = {
  "Helvetica": "Helvetica",
  "Helvetica-Bold": "HelveticaBold",
  "Helvetica-Oblique": "HelveticaOblique",
  "Helvetica-BoldOblique": "HelveticaBoldOblique",
  "Times-Roman": "TimesRoman",
  "Times-Bold": "TimesRomanBold",
  "Times-Italic": "TimesRomanItalic",
  "Times-BoldItalic": "TimesRomanBoldItalic",
  "Courier": "Courier",
  "Courier-Bold": "CourierBold",
  "Courier-Oblique": "CourierOblique",
  "Courier-BoldOblique": "CourierBoldOblique",
  // Common Microsoft-equivalent names seen in copied content
  "Arial": "Helvetica",
  "Arial-Bold": "HelveticaBold",
  "ArialMT": "Helvetica",
  "Arial,Bold": "HelveticaBold",
  "Arial-Italic": "HelveticaOblique",
  "Arial-BoldItalic": "HelveticaBoldOblique",
  "TimesNewRoman": "TimesRoman",
  "TimesNewRomanPS": "TimesRoman",
  "TimesNewRomanPSMT": "TimesRoman",
  "TimesNewRoman-Bold": "TimesRomanBold",
  "TimesNewRoman-Italic": "TimesRomanItalic",
  "TimesNewRoman-BoldItalic": "TimesRomanBoldItalic",
  "CourierNew": "Courier",
  "CourierNewPS": "Courier",
  "CourierNewPSMT": "Courier",
  "CourierNew-Bold": "CourierBold",
  "CourierNew-Italic": "CourierOblique",
  "CourierNew-BoldItalic": "CourierBoldOblique",
};

// WinAnsiEncoding code → Unicode codepoint. Latin-1 in 0x20–0x7E and
// 0xA0–0xFF; the 0x80–0x9F band carries Windows-1252 punctuation.
const WIN_ANSI: number[] = (() => {
  const a = new Array(256).fill(0);
  for (let i = 0x20; i <= 0x7e; i++) a[i] = i;
  for (let i = 0xa0; i <= 0xff; i++) a[i] = i;
  const diffs: Record<number, number> = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E,
    0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6,
    0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152,
    0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
    0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
    0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
  };
  for (const k of Object.keys(diffs)) a[Number(k)] = diffs[Number(k)];
  return a;
})();

async function loadFontBytes(kind: FontKind): Promise<Uint8Array> {
  const r = await fetch(`/fonts/liberation/${fontFileName(kind)}`);
  if (!r.ok) throw new Error(`PDF/A font fetch failed (${kind}): ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

interface Metrics {
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  bbox: [number, number, number, number];
  widthFor: (codepoint: number) => number;
}

function readMetrics(bytes: Uint8Array): Metrics {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = (fontkit as unknown as { create: (b: Uint8Array) => unknown }).create(bytes);
  const upm = f.unitsPerEm || 1000;
  const scale = 1000 / upm;
  const bx = f.bbox ?? { minX: -200, minY: -200, maxX: 1000, maxY: 900 };
  return {
    ascent: Math.round((f.ascent ?? 700) * scale),
    descent: Math.round((f.descent ?? -200) * scale),
    capHeight: Math.round(((f.capHeight ?? f.ascent ?? 700) * scale)),
    italicAngle: f.italicAngle ?? 0,
    bbox: [
      Math.round((bx.minX ?? -200) * scale),
      Math.round((bx.minY ?? -200) * scale),
      Math.round((bx.maxX ?? 1000) * scale),
      Math.round((bx.maxY ?? 900) * scale),
    ],
    widthFor: (cp) => {
      try {
        const g = f.glyphForCodePoint(cp);
        const w = g?.advanceWidth ?? 500;
        return Math.round(w * scale);
      } catch {
        return 500;
      }
    },
  };
}

function hasFontFile(desc: PDFDict): boolean {
  return (
    desc.has(PDFName.of("FontFile")) ||
    desc.has(PDFName.of("FontFile2")) ||
    desc.has(PDFName.of("FontFile3"))
  );
}

function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

export interface FallbackResult {
  fixed: string[];
  unfixable: string[];
}

export async function embedStandard14Fallbacks(doc: PDFDocument): Promise<FallbackResult> {
  const ctx = doc.context;
  const fixed: string[] = [];
  const unfixable: string[] = [];
  const bytesCache = new Map<FontKind, Uint8Array>();
  const metricsCache = new Map<FontKind, Metrics>();
  const fileRefCache = new Map<FontKind, ReturnType<typeof ctx.register>>();

  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    if (!(type instanceof PDFName) || type.asString() !== "/Font") continue;
    const subtype = obj.get(PDFName.of("Subtype"));
    const st = subtype instanceof PDFName ? subtype.asString() : "";
    // Composite (Type0) and Type3 are out of scope — their embedding lives
    // elsewhere; the caller will surface them via findUnembeddedFonts.
    if (st === "/Type0" || st === "/Type3") continue;

    const descLookup = obj.lookup(PDFName.of("FontDescriptor"));
    const desc = descLookup instanceof PDFDict ? descLookup : null;
    if (desc && hasFontFile(desc)) continue;

    const base = obj.get(PDFName.of("BaseFont"));
    const baseRaw = base instanceof PDFName ? base.asString().replace(/^\//, "") : "";
    const baseClean = stripSubsetPrefix(baseRaw);
    const kind = STD14[baseClean];
    if (!kind) {
      if (baseRaw) unfixable.push(baseRaw);
      continue;
    }

    let bytes = bytesCache.get(kind);
    if (!bytes) {
      bytes = await loadFontBytes(kind);
      bytesCache.set(kind, bytes);
    }
    let metrics = metricsCache.get(kind);
    if (!metrics) {
      metrics = readMetrics(bytes);
      metricsCache.set(kind, metrics);
    }
    let fileRef = fileRefCache.get(kind);
    if (!fileRef) {
      const fileStream = ctx.flateStream(bytes, { Length1: bytes.length });
      fileRef = ctx.register(fileStream);
      fileRefCache.set(kind, fileRef);
    }

    // Flags: nonsymbolic (bit 6 = 32). Italic (bit 7 = 64). Fixed-pitch (bit 1 = 1).
    const isItalic = /Italic|Oblique/i.test(kind);
    const isFixed = /Courier/i.test(kind);
    const flags = 32 | (isItalic ? 64 : 0) | (isFixed ? 1 : 0);

    const fdLiteral = ctx.obj({
      Type: "FontDescriptor",
      FontName: PDFName.of(baseClean),
      Flags: flags,
      FontBBox: metrics.bbox,
      ItalicAngle: metrics.italicAngle,
      Ascent: metrics.ascent,
      Descent: metrics.descent,
      CapHeight: metrics.capHeight,
      StemV: 80,
    }) as PDFDict;
    fdLiteral.set(PDFName.of("FontFile2"), fileRef);

    if (desc) {
      // Mutate the existing FontDescriptor dict in place so any indirect
      // references still resolve.
      for (const k of Array.from(desc.keys())) desc.delete(k);
      for (const [k, v] of fdLiteral.entries()) desc.set(k, v);
    } else {
      const fdRef = ctx.register(fdLiteral);
      obj.set(PDFName.of("FontDescriptor"), fdRef);
    }

    // Synthesize /Widths for WinAnsi codes 32..255.
    const widthsArr = PDFArray.withContext(ctx);
    for (let code = 32; code <= 255; code++) {
      const cp = WIN_ANSI[code];
      const w = cp ? metrics.widthFor(cp) : 0;
      widthsArr.push(PDFNumber.of(w));
    }

    obj.set(PDFName.of("Subtype"), PDFName.of("TrueType"));
    obj.set(PDFName.of("BaseFont"), PDFName.of(baseClean));
    obj.set(PDFName.of("Encoding"), PDFName.of("WinAnsiEncoding"));
    obj.set(PDFName.of("FirstChar"), PDFNumber.of(32));
    obj.set(PDFName.of("LastChar"), PDFNumber.of(255));
    obj.set(PDFName.of("Widths"), widthsArr);

    fixed.push(baseClean);
  }

  return { fixed, unfixable };
}
