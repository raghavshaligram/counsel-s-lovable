/**
 * to-pdfa — on-device PDF/A-2b conformer.
 *
 * Takes a finished PDF byte stream and applies the structural changes
 * veraPDF (and the ISO 19005-2 profile) require for PDF/A-2b conformance:
 *
 *   - OutputIntent dict with embedded sRGB ICC profile
 *   - XMP /Metadata stream carrying pdfaid:part=2 + pdfaid:conformance=B
 *   - Trailer /ID array (two 16-byte hex strings) — clause 6.1.3
 *   - Strips document-level JavaScript and additional-action triggers
 *   - Drops encryption (decoded on load, re-saved unencrypted)
 *   - Header lifted to PDF-1.7
 *   - Rejects (throws) if any font in the file is not embedded — the
 *     caller must re-embed via embedStandardFont() before claiming PDF/A.
 *
 * All processing is in-browser via pdf-lib — no upload.
 */
import {
  PDFDocument, PDFName, PDFHexString, PDFString, PDFArray, PDFDict, PDFStream, PDFNumber,
} from "pdf-lib";
import { srgbIccBytes } from "./srgb-icc";
import { embedStandard14Fallbacks } from "./embed-standard14";

const TAG = "[pdfa]";

type FontDiagnostic = {
  ref: string;
  baseFont: string;
  subtype: string;
  embedded: boolean;
  descriptor: boolean;
  fontFile: boolean;
  fontFile2: boolean;
  fontFile3: boolean;
  descendantFonts?: FontDiagnostic[];
};

type OutputIntentDiagnostic = {
  ref: string;
  subtype: string;
  hasDestOutputProfile: boolean;
  embeddedIccStream: boolean;
  iccBytes: number;
  n: number | null;
  outputConditionIdentifier: string;
};

type XmpDiagnostic = {
  present: boolean;
  bytes: number;
  part: string | null;
  conformance: string | null;
  producer: string | null;
  docInfoProducer: string | null;
  consistentWithDocInfo: boolean;
};

type ForbiddenConstructsDiagnostic = {
  encrypted: boolean;
  javaScriptActions: string[];
  launchActions: string[];
  externalRefs: string[];
};

type TransparencyDiagnostic = {
  groupsWithoutColorSpace: string[];
};

function buildPdfAXmp(opts: {
  title?: string;
  author?: string;
  producer?: string;
  createdAt?: Date;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const title = esc(opts.title || "Document");
  const author = esc(opts.author || "");
  const producer = esc(opts.producer || "CounselPDF");
  const now = (opts.createdAt ?? new Date()).toISOString();

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="CounselPDF PDF/A">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:dc="http://purl.org/dc/elements/1.1/">
      <pdfaid:part>2</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <pdf:Producer>${producer}</pdf:Producer>
      <xmp:CreatorTool>${producer}</xmp:CreatorTool>
      <xmp:CreateDate>${now}</xmp:CreateDate>
      <xmp:ModifyDate>${now}</xmp:ModifyDate>
      <xmp:MetadataDate>${now}</xmp:MetadataDate>
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
      ${author ? `<dc:creator><rdf:Seq><rdf:li>${author}</rdf:li></rdf:Seq></dc:creator>` : ""}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Walk every font dict in the PDF and confirm a font program is embedded.
 *  Returns the list of offenders (BaseFont names) — empty array means OK. */
export function findUnembeddedFonts(doc: PDFDocument): string[] {
  return inspectFonts(doc).filter((font) => !font.embedded).map((font) => font.baseFont);
}

function hasFontFile(desc: PDFDict): boolean {
  return (
    desc.has(PDFName.of("FontFile")) ||
    desc.has(PDFName.of("FontFile2")) ||
    desc.has(PDFName.of("FontFile3"))
  );
}

function pdfName(obj: unknown): string {
  return obj instanceof PDFName ? obj.asString() : "";
}

function pdfText(obj: unknown): string {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFName) return obj.asString().replace(/^\//, "");
  if (obj instanceof PDFNumber) return String(obj.asNumber());
  return "";
}

function objectRef(ref: unknown): string {
  return ref && typeof ref === "object" && "objectNumber" in ref && "generationNumber" in ref
    ? `${(ref as { objectNumber: number }).objectNumber} ${(ref as { generationNumber: number }).generationNumber} R`
    : "direct";
}

function resolveDict(doc: PDFDocument, obj: unknown): PDFDict | undefined {
  if (obj instanceof PDFDict) return obj;
  try {
    const resolved = doc.context.lookup(obj as never);
    return resolved instanceof PDFDict ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function resolveStream(doc: PDFDocument, obj: unknown): PDFStream | undefined {
  if (obj instanceof PDFStream) return obj;
  try {
    const resolved = doc.context.lookup(obj as never);
    return resolved instanceof PDFStream ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function descriptorFontFileFlags(desc: PDFDict | undefined) {
  return {
    descriptor: !!desc,
    fontFile: !!desc?.has(PDFName.of("FontFile")),
    fontFile2: !!desc?.has(PDFName.of("FontFile2")),
    fontFile3: !!desc?.has(PDFName.of("FontFile3")),
  };
}

function inspectFontDict(doc: PDFDocument, font: PDFDict, ref: unknown): FontDiagnostic {
  const subtype = pdfName(font.get(PDFName.of("Subtype"))) || "<unknown>";
  const baseFont = pdfName(font.get(PDFName.of("BaseFont"))) || "<unknown>";
  if (subtype === "/Type0") {
    const descArr = font.lookup(PDFName.of("DescendantFonts"));
    const items: unknown[] = descArr && typeof (descArr as { asArray?: unknown }).asArray === "function"
      ? (descArr as { asArray: () => unknown[] }).asArray()
      : [];
    const descendantFonts = items.flatMap((item) => {
      const cid = resolveDict(doc, item);
      return cid ? [inspectFontDict(doc, cid, item)] : [];
    });
    return {
      ref: objectRef(ref),
      baseFont,
      subtype,
      embedded: descendantFonts.some((child) => child.embedded),
      descriptor: descendantFonts.some((child) => child.descriptor),
      fontFile: descendantFonts.some((child) => child.fontFile),
      fontFile2: descendantFonts.some((child) => child.fontFile2),
      fontFile3: descendantFonts.some((child) => child.fontFile3),
      descendantFonts,
    };
  }
  if (subtype === "/Type3") {
    return {
      ref: objectRef(ref),
      baseFont,
      subtype,
      embedded: true,
      descriptor: true,
      fontFile: false,
      fontFile2: false,
      fontFile3: false,
    };
  }
  const desc = resolveDict(doc, font.get(PDFName.of("FontDescriptor")));
  const flags = descriptorFontFileFlags(desc);
  return {
    ref: objectRef(ref),
    baseFont,
    subtype,
    embedded: flags.fontFile || flags.fontFile2 || flags.fontFile3,
    ...flags,
  };
}

export function inspectFonts(doc: PDFDocument): FontDiagnostic[] {
  const fonts: FontDiagnostic[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    if (!(type instanceof PDFName) || type.asString() !== "/Font") continue;
    fonts.push(inspectFontDict(doc, obj, ref));
  }
  return fonts;
}

function inspectOutputIntents(doc: PDFDocument): OutputIntentDiagnostic[] {
  const arr = doc.catalog.lookupMaybe(PDFName.of("OutputIntents"), PDFArray);
  if (!arr) return [];
  const out: OutputIntentDiagnostic[] = [];
  for (const item of arr.asArray()) {
    const intent = resolveDict(doc, item);
    if (!intent) continue;
    const profileObj = intent.get(PDFName.of("DestOutputProfile"));
    const profile = resolveStream(doc, profileObj);
    const n = profile?.dict.lookupMaybe(PDFName.of("N"), PDFNumber)?.asNumber() ?? null;
    out.push({
      ref: objectRef(item),
      subtype: pdfName(intent.get(PDFName.of("S"))),
      hasDestOutputProfile: !!profileObj,
      embeddedIccStream: !!profile && profile.getContentsSize() > 0,
      iccBytes: profile?.getContentsSize() ?? 0,
      n,
      outputConditionIdentifier: pdfText(intent.get(PDFName.of("OutputConditionIdentifier"))),
    });
  }
  return out;
}

function inspectXmp(doc: PDFDocument): XmpDiagnostic {
  const metadata = resolveStream(doc, doc.catalog.get(PDFName.of("Metadata")));
  const xmp = metadata ? new TextDecoder().decode(metadata.getContents()) : "";
  const part = /<pdfaid:part>\s*([^<]+)\s*<\/pdfaid:part>/.exec(xmp)?.[1]?.trim() ?? null;
  const conformance = /<pdfaid:conformance>\s*([^<]+)\s*<\/pdfaid:conformance>/.exec(xmp)?.[1]?.trim() ?? null;
  const producer = /<pdf:Producer>\s*([^<]+)\s*<\/pdf:Producer>/.exec(xmp)?.[1]?.trim() ?? null;
  const docInfoProducer = doc.getProducer() ?? null;
  return {
    present: !!metadata,
    bytes: metadata?.getContentsSize() ?? 0,
    part,
    conformance,
    producer,
    docInfoProducer,
    consistentWithDocInfo: !!producer && !!docInfoProducer && producer === docInfoProducer,
  };
}

function inspectForbiddenConstructs(doc: PDFDocument, text: string): ForbiddenConstructsDiagnostic {
  const javaScriptActions: string[] = [];
  const launchActions: string[] = [];
  const externalRefs: string[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const s = pdfName(obj.get(PDFName.of("S")));
    if (s === "/JavaScript") javaScriptActions.push(objectRef(ref));
    if (s === "/Launch") launchActions.push(objectRef(ref));
    if (["/GoToR", "/GoToE", "/SubmitForm", "/ImportData", "/URI"].includes(s)) externalRefs.push(`${objectRef(ref)} ${s}`);
    const type = pdfName(obj.get(PDFName.of("Type")));
    if (["/Filespec"].includes(type) || obj.has(PDFName.of("EF"))) externalRefs.push(`${objectRef(ref)} ${type || "/EF"}`);
  }
  if (/\/EmbeddedFiles\b/.test(text)) externalRefs.push("/EmbeddedFiles name tree");
  return {
    encrypted: /\/Encrypt\b/.test(text),
    javaScriptActions: Array.from(new Set(javaScriptActions)),
    launchActions: Array.from(new Set(launchActions)),
    externalRefs: Array.from(new Set(externalRefs)),
  };
}

function inspectTransparency(doc: PDFDocument): TransparencyDiagnostic {
  const groupsWithoutColorSpace: string[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (pdfName(obj.get(PDFName.of("Type"))) === "/Group" && pdfName(obj.get(PDFName.of("S"))) === "/Transparency" && !obj.has(PDFName.of("CS"))) {
      groupsWithoutColorSpace.push(objectRef(ref));
    }
  }
  return { groupsWithoutColorSpace };
}

function randomHexString(byteLen: number): PDFHexString {
  const buf = new Uint8Array(byteLen);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < byteLen; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let hex = "";
  for (let i = 0; i < buf.length; i++) hex += buf[i].toString(16).padStart(2, "0");
  return PDFHexString.of(hex);
}

export async function toPdfA(bytes: Uint8Array): Promise<Uint8Array> {
  const step = async <T,>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    // eslint-disable-next-line no-console
    console.info(`${TAG} ${name}…`);
    try {
      return await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`${TAG} ${name} FAILED`, err);
      throw new Error(`PDF/A step "${name}" failed: ${(err as Error).message}`);
    }
  };

  const doc = await step("load source bytes", () =>
    PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }),
  );
  const ctx = doc.context;
  const catalog = doc.catalog;

  // 0a) Auto-embed Standard 14 font fallbacks (Liberation TTF) for any
  //     unembedded simple-font references inherited from the source PDF.
  const fallback = await step("embed standard-14 font fallbacks", () =>
    embedStandard14Fallbacks(doc),
  );
  if (fallback.fixed.length) {
    // eslint-disable-next-line no-console
    console.info(`${TAG} embedded fallbacks for:`, fallback.fixed);
  }

  // 0b) Final check — any remaining unembedded fonts (Type0/Type3, exotic
  //     non-Standard-14 references) are unfixable here and must block.
  const offenders = await step("verify all fonts are embedded", () =>
    findUnembeddedFonts(doc),
  );
  if (offenders.length > 0) {
    const unique = Array.from(new Set(offenders));
    throw new Error(
      `Cannot embed font(s): ${unique.join(", ")}. ` +
      `Re-export the document with embedded fonts or use a Standard 14 substitute.`,
    );
  }

  // 1) Strip hostile / non-PDF/A constructs ------------------------------
  await step("strip JavaScript / OpenAction / AA", () => {
    const namesAny = catalog.lookupMaybe(PDFName.of("Names"), undefined as never) as unknown;
    if (namesAny && typeof namesAny === "object" && "delete" in (namesAny as object)) {
      const d = (namesAny as { delete: (k: unknown) => void }).delete.bind(namesAny);
      try { d(PDFName.of("JavaScript")); } catch { /* not a dict — ignore */ }
    }
    catalog.delete(PDFName.of("OpenAction"));
    catalog.delete(PDFName.of("AA"));
    for (const page of doc.getPages()) {
      page.node.delete(PDFName.of("AA"));
    }
  });

  // 2) Embed sRGB ICC profile -------------------------------------------
  const iccRef = await step("embed sRGB ICC profile", () => {
    const icc = srgbIccBytes();
    const iccStream = ctx.stream(icc, { N: 3, Length: icc.length });
    return ctx.register(iccStream);
  });

  // 3) OutputIntent dictionary ------------------------------------------
  await step("attach OutputIntent", () => {
    const outputIntentDict = ctx.obj({
      Type: "OutputIntent",
      S: "GTS_PDFA1",
    });
    outputIntentDict.set(
      PDFName.of("OutputConditionIdentifier"),
      PDFString.of("sRGB IEC61966-2.1"),
    );
    outputIntentDict.set(PDFName.of("Info"), PDFString.of("sRGB IEC61966-2.1"));
    outputIntentDict.set(PDFName.of("RegistryName"), PDFString.of("http://www.color.org"));
    outputIntentDict.set(PDFName.of("DestOutputProfile"), iccRef);
    catalog.set(PDFName.of("OutputIntents"), ctx.obj([outputIntentDict]));
  });

  // 4) XMP /Metadata stream with PDF/A markers --------------------------
  await step("write XMP metadata (pdfaid part=2 conformance=B)", () => {
    const xmp = buildPdfAXmp({
      title: doc.getTitle(),
      author: doc.getAuthor(),
      producer: "CounselPDF (PDF/A-2b)",
      createdAt: doc.getCreationDate() ?? new Date(),
    });
    const xmpBytes = new TextEncoder().encode(xmp);
    const xmpStream = ctx.stream(xmpBytes, {
      Type: "Metadata",
      Subtype: "XML",
      Length: xmpBytes.length,
    });
    const xmpRef = ctx.register(xmpStream);
    catalog.set(PDFName.of("Metadata"), xmpRef);
  });

  // 5) Document info ----------------------------------------------------
  await step("update document info", () => {
    doc.setProducer("CounselPDF (PDF/A-2b)");
    if (!doc.getCreationDate()) doc.setCreationDate(new Date());
    doc.setModificationDate(new Date());
  });

  // 6) Trailer /ID — clause 6.1.3 requires a non-empty File Identifier.
  await step("write trailer /ID", () => {
    const id = PDFArray.withContext(ctx);
    id.push(randomHexString(16));
    id.push(randomHexString(16));
    (ctx.trailerInfo as { ID?: PDFArray }).ID = id;
  });

  const saved = await step("save (no object streams, header 1.7)", () =>
    doc.save({ updateFieldAppearances: false, useObjectStreams: false }),
  );

  return ensurePdfHeader(saved, "1.7");
}

function ensurePdfHeader(bytes: Uint8Array, version: "1.7"): Uint8Array {
  const head = new TextDecoder().decode(bytes.slice(0, 9));
  const m = /^%PDF-(\d)\.(\d)/.exec(head);
  if (m) {
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    if (major > 1 || (major === 1 && minor >= 7)) return bytes;
  }
  const newHead = new TextEncoder().encode(`%PDF-${version}`);
  const out = new Uint8Array(bytes.length);
  out.set(newHead, 0);
  out.set(bytes.slice(newHead.length), newHead.length);
  return out;
}

/**
 * Structural verification — confirms the saved bytes carry the PDF/A-2b
 * markers (OutputIntent + XMP pdfaid:part=2 / conformance=B + trailer /ID)
 * AND that every font in the document is embedded. Not a substitute for
 * veraPDF, but catches every PDF/A-breaking regression we've seen in
 * production. Returns per-requirement booleans + `missing` so callers can
 * log/toast exactly which clause failed.
 */
export interface PdfAStructuralReport {
  ok: boolean;
  outputIntent: boolean;
  xmpPart: boolean;
  xmpConformance: boolean;
  trailerId: boolean;
  fontsEmbedded: boolean;
  noEncryption: boolean;
  noJavaScript: boolean;
  /** Human-readable list of failed requirements, empty when ok. */
  missing: string[];
  /** Font BaseFont names still unembedded after conformance (should be []). */
  unembeddedFonts: string[];
  fonts: FontDiagnostic[];
  outputIntents: OutputIntentDiagnostic[];
  xmp: XmpDiagnostic;
  forbiddenConstructs: ForbiddenConstructsDiagnostic;
  transparency: TransparencyDiagnostic;
}

export async function verifyPdfAStructuralAsync(bytes: Uint8Array): Promise<PdfAStructuralReport> {
  const text = new TextDecoder("latin1").decode(bytes);
  const trailerId = /\/ID\s*\[\s*<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*\]/.test(text);

  let fonts: FontDiagnostic[] = [];
  let outputIntents: OutputIntentDiagnostic[] = [];
  let xmp: XmpDiagnostic = {
    present: false, bytes: 0, part: null, conformance: null, producer: null, docInfoProducer: null, consistentWithDocInfo: false,
  };
  let forbiddenConstructs: ForbiddenConstructsDiagnostic = {
    encrypted: /\/Encrypt\b/.test(text), javaScriptActions: [], launchActions: [], externalRefs: [],
  };
  let transparency: TransparencyDiagnostic = { groupsWithoutColorSpace: [] };
  let unembeddedFonts: string[] = [];
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    fonts = inspectFonts(doc);
    outputIntents = inspectOutputIntents(doc);
    xmp = inspectXmp(doc);
    forbiddenConstructs = inspectForbiddenConstructs(doc, text);
    transparency = inspectTransparency(doc);
    unembeddedFonts = fonts.filter((font) => !font.embedded).map((font) => font.baseFont);
  } catch {
    // Parse failure → treat as font check failed.
    unembeddedFonts = ["<parse-failed>"];
  }
  const fontsEmbedded = unembeddedFonts.length === 0;
  const outputIntent = outputIntents.some((intent) =>
    intent.subtype === "/GTS_PDFA1" && intent.embeddedIccStream && intent.iccBytes > 0 && intent.n === 3,
  );
  const xmpPart = xmp.part === "2";
  const xmpConformance = xmp.conformance === "B";
  const noEncryption = !forbiddenConstructs.encrypted;
  const noJavaScript = forbiddenConstructs.javaScriptActions.length === 0 && !/\/JavaScript\b/.test(text) && !/\/JS\s*[\(<]/.test(text);
  const noForbiddenActions = forbiddenConstructs.launchActions.length === 0 && forbiddenConstructs.externalRefs.length === 0;
  const transparencyOk = transparency.groupsWithoutColorSpace.length === 0;

  const missing: string[] = [];
  if (!outputIntent) missing.push("sRGB OutputIntent with embedded ICC stream (N=3)");
  if (!xmpPart) missing.push("XMP pdfaid:part=2");
  if (!xmpConformance) missing.push("XMP pdfaid:conformance=B");
  if (!xmp.consistentWithDocInfo) missing.push("XMP/docinfo producer consistency");
  if (!trailerId) missing.push("trailer /ID");
  if (!noEncryption) missing.push("no /Encrypt");
  if (!noJavaScript) missing.push("no JavaScript actions");
  if (!noForbiddenActions) missing.push("no Launch/external-reference actions");
  if (!transparencyOk) missing.push(`transparency group color spaces (${transparency.groupsWithoutColorSpace.join(", ")})`);
  if (!fontsEmbedded) missing.push(`embedded fonts (unembedded: ${unembeddedFonts.join(", ")})`);

  return {
    outputIntent, xmpPart, xmpConformance, trailerId,
    fontsEmbedded, noEncryption, noJavaScript,
    unembeddedFonts, missing, fonts, outputIntents, xmp, forbiddenConstructs, transparency,
    ok: missing.length === 0,
  };
}

export function logPdfAChecklist(report: PdfAStructuralReport, context = "post-conformance"): void {
  const checklist = {
    context,
    ok: report.ok,
    missing: report.missing,
    fonts: report.fonts.map((font) => ({
      ref: font.ref,
      baseFont: font.baseFont,
      subtype: font.subtype,
      embedded: font.embedded,
      FontFile: font.fontFile,
      FontFile2: font.fontFile2,
      FontFile3: font.fontFile3,
      descendantFonts: font.descendantFonts?.map((child) => ({
        ref: child.ref,
        baseFont: child.baseFont,
        subtype: child.subtype,
        embedded: child.embedded,
        FontFile: child.fontFile,
        FontFile2: child.fontFile2,
        FontFile3: child.fontFile3,
      })),
    })),
    outputIntent: {
      pass: report.outputIntent,
      intents: report.outputIntents,
    },
    xmp: {
      pass: report.xmpPart && report.xmpConformance && report.xmp.consistentWithDocInfo,
      ...report.xmp,
    },
    forbiddenConstructs: {
      pass: report.noEncryption && report.noJavaScript && report.forbiddenConstructs.launchActions.length === 0 && report.forbiddenConstructs.externalRefs.length === 0,
      ...report.forbiddenConstructs,
    },
    transparency: {
      pass: report.transparency.groupsWithoutColorSpace.length === 0,
      ...report.transparency,
    },
  };
  if (report.ok) {
    // eslint-disable-next-line no-console
    console.info("[pdfa] requirement checklist PASS", checklist);
  } else {
    // eslint-disable-next-line no-console
    console.error("[pdfa] requirement checklist FAIL", checklist);
  }
}

/** @deprecated synchronous shim — kept for callers that can't await. Skips font check. */
export function verifyPdfAStructural(bytes: Uint8Array): {
  ok: boolean;
  outputIntent: boolean;
  xmpPart: boolean;
  xmpConformance: boolean;
  trailerId: boolean;
} {
  const text = new TextDecoder("latin1").decode(bytes);
  const outputIntent = /\/OutputIntents\b/.test(text) && /GTS_PDFA1/.test(text);
  const xmpPart = /<pdfaid:part>\s*2\s*<\/pdfaid:part>/.test(text);
  const xmpConformance = /<pdfaid:conformance>\s*B\s*<\/pdfaid:conformance>/.test(text);
  const trailerId = /\/ID\s*\[\s*<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*\]/.test(text);
  return {
    outputIntent, xmpPart, xmpConformance, trailerId,
    ok: outputIntent && xmpPart && xmpConformance && trailerId,
  };
}
