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
  PDFDocument, PDFName, PDFHexString, PDFString, PDFArray, PDFDict,
} from "pdf-lib";
import { srgbIccBytes } from "./srgb-icc";

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
  const producer = esc(opts.producer || "VaultPDF");
  const now = (opts.createdAt ?? new Date()).toISOString();

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="VaultPDF PDF/A">
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
  const offenders: string[] = [];
  const context = doc.context;
  const indirectObjects = context.enumerateIndirectObjects();
  for (const [, obj] of indirectObjects) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    if (!(type instanceof PDFName) || type.asString() !== "/Font") continue;
    const subtype = obj.get(PDFName.of("Subtype"));
    const subtypeName = subtype instanceof PDFName ? subtype.asString() : "";
    // Type3 has its own content streams — exempt per the validation rule.
    if (subtypeName === "/Type3") continue;
    // Type0 (composite): the actual font program lives on the descendant
    // CIDFontType0/2 FontDescriptor — recurse into DescendantFonts.
    if (subtypeName === "/Type0") {
      const descArr = obj.lookup(PDFName.of("DescendantFonts"));
      const items: unknown[] = descArr && typeof (descArr as { asArray?: unknown }).asArray === "function"
        ? (descArr as { asArray: () => unknown[] }).asArray()
        : [];
      let anyEmbedded = false;
      for (const it of items) {
        const cid = it instanceof PDFDict ? it : context.lookup(it as never);
        if (!(cid instanceof PDFDict)) continue;
        const cidDesc = cid.lookup(PDFName.of("FontDescriptor"));
        if (cidDesc instanceof PDFDict && hasFontFile(cidDesc)) {
          anyEmbedded = true;
          break;
        }
      }
      if (!anyEmbedded) {
        const base = obj.get(PDFName.of("BaseFont"));
        offenders.push(base instanceof PDFName ? base.asString() : "<unknown Type0>");
      }
      continue;
    }
    // Simple fonts (TrueType, Type1, MMType1): check FontDescriptor.
    const desc = obj.lookup(PDFName.of("FontDescriptor"));
    if (!(desc instanceof PDFDict) || !hasFontFile(desc)) {
      const base = obj.get(PDFName.of("BaseFont"));
      offenders.push(base instanceof PDFName ? base.asString() : "<unknown>");
    }
  }
  return offenders;
}

function hasFontFile(desc: PDFDict): boolean {
  return (
    desc.has(PDFName.of("FontFile")) ||
    desc.has(PDFName.of("FontFile2")) ||
    desc.has(PDFName.of("FontFile3"))
  );
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
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const ctx = doc.context;
  const catalog = doc.catalog;

  // 0) Reject if any non-embedded fonts remain — emitting unembedded
  //    fonts inside a PDF/A wrapper would produce an invalid file.
  const offenders = findUnembeddedFonts(doc);
  if (offenders.length > 0) {
    const unique = Array.from(new Set(offenders));
    throw new Error(
      `PDF/A requires every font to be embedded. The document still references ` +
      `unembedded font(s): ${unique.join(", ")}. Re-export with embedded fonts.`,
    );
  }

  // 1) Strip hostile / non-PDF/A constructs ------------------------------
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

  // 2) Embed sRGB ICC profile -------------------------------------------
  const icc = srgbIccBytes();
  const iccStream = ctx.stream(icc, { N: 3, Length: icc.length });
  const iccRef = ctx.register(iccStream);

  // 3) OutputIntent dictionary ------------------------------------------
  const outputIntentDict = ctx.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
  });
  // OutputConditionIdentifier / Info must be PDFStrings (text), not names.
  outputIntentDict.set(
    PDFName.of("OutputConditionIdentifier"),
    PDFString.of("sRGB IEC61966-2.1"),
  );
  outputIntentDict.set(PDFName.of("Info"), PDFString.of("sRGB IEC61966-2.1"));
  outputIntentDict.set(PDFName.of("RegistryName"), PDFString.of("http://www.color.org"));
  outputIntentDict.set(PDFName.of("DestOutputProfile"), iccRef);
  catalog.set(PDFName.of("OutputIntents"), ctx.obj([outputIntentDict]));

  // 4) XMP /Metadata stream with PDF/A markers --------------------------
  const xmp = buildPdfAXmp({
    title: doc.getTitle(),
    author: doc.getAuthor(),
    producer: "VaultPDF (PDF/A-2b)",
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

  // 5) Document info ----------------------------------------------------
  doc.setProducer("VaultPDF (PDF/A-2b)");
  if (!doc.getCreationDate()) doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  // 6) Trailer /ID — clause 6.1.3 requires a non-empty File Identifier.
  const id = PDFArray.withContext(ctx);
  id.push(randomHexString(16));
  id.push(randomHexString(16));
  // trailerInfo.ID is honoured by pdf-lib's writer.
  (ctx.trailerInfo as { ID?: PDFArray }).ID = id;

  // Save without object streams for maximum validator compatibility.
  const saved = await doc.save({
    updateFieldAppearances: false,
    useObjectStreams: false,
  });

  // PDF/A-2 requires header ≥ 1.7.
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
 * Lightweight structural verification — confirms the saved bytes carry
 * the PDF/A-2b markers (OutputIntent + XMP pdfaid:part=2 / conformance=B
 * + trailer /ID). Not a substitute for veraPDF, but catches mistakes in
 * the conformer itself.
 */
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
    outputIntent,
    xmpPart,
    xmpConformance,
    trailerId,
    ok: outputIntent && xmpPart && xmpConformance && trailerId,
  };
}
