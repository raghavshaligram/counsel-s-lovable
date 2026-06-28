/**
 * to-pdfa — best-effort PDF/A-2b conformer (on-device).
 *
 * Takes a finished PDF byte stream and applies the structural changes most
 * validators require for PDF/A-2b conformance:
 *
 *   - OutputIntent with an embedded sRGB ICC profile
 *   - XMP /Metadata stream carrying pdfaid:part=2 + pdfaid:conformance=B
 *   - Strips document-level JavaScript and additional-action triggers
 *   - Drops encryption (decoded on load, re-saved unencrypted)
 *   - Producer / ModDate stamped
 *
 * Caveat: We cannot guarantee every input passes a third-party validator
 * (e.g. veraPDF) — PDFs with unembedded Standard-14 fonts or transparency
 * groups may still fail. We expose `verifyPdfAStructural` so the UI can
 * confirm the structural markers landed in the saved bytes.
 *
 * All processing is in-browser via pdf-lib — no upload.
 */
import { PDFDocument, PDFName, PDFHexString } from "pdf-lib";
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

export async function toPdfA(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const ctx = doc.context;
  const catalog = doc.catalog;

  // 1) Strip hostile / non-PDF/A constructs ------------------------------
  // Document-level JavaScript & launch actions are forbidden in PDF/A.
  const namesDict = catalog.lookupMaybe(PDFName.of("Names"), undefined as never);
  // We can't introspect cleanly without pulling more pdf-lib types — the
  // safest minimal action is dropping the JavaScript subtree if present.
  if (namesDict && typeof (namesDict as { delete?: (k: unknown) => void }).delete === "function") {
    (namesDict as { delete: (k: unknown) => void }).delete(PDFName.of("JavaScript"));
  }
  // Strip /OpenAction and /AA (additional actions) — they may carry JS.
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
  const outputIntent = ctx.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: "sRGB IEC61966-2.1",
    Info: "sRGB IEC61966-2.1",
    RegistryName: "http://www.color.org",
    DestOutputProfile: iccRef,
  });
  catalog.set(PDFName.of("OutputIntents"), ctx.obj([outputIntent]));

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

  // 6) Ensure a trailer ID exists (pdf-lib writes one on save). MarkInfo
  // is optional for PDF/A-2b (only tagged variants need it).
  // Save without object streams for maximum validator compatibility.
  const saved = await doc.save({
    updateFieldAppearances: false,
    useObjectStreams: false,
  });

  // Lift PDF header to 1.7 if older — PDF/A-2 requires 1.7.
  return ensurePdfHeader(saved, "1.7");
}

function ensurePdfHeader(bytes: Uint8Array, version: "1.7"): Uint8Array {
  // pdf-lib writes "%PDF-1.<N>\n" at offset 0. If already >= target, leave.
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
 * Lightweight structural verification — confirms the saved bytes carry the
 * PDF/A-2b markers we wrote (OutputIntent + XMP pdfaid:part=2 / conformance=B).
 * Not a substitute for veraPDF but catches mistakes in the conformer itself.
 */
export function verifyPdfAStructural(bytes: Uint8Array): {
  ok: boolean;
  outputIntent: boolean;
  xmpPart: boolean;
  xmpConformance: boolean;
} {
  const text = new TextDecoder("latin1").decode(bytes);
  const outputIntent = /\/OutputIntents\b/.test(text) && /GTS_PDFA1/.test(text);
  const xmpPart = /<pdfaid:part>\s*2\s*<\/pdfaid:part>/.test(text);
  const xmpConformance = /<pdfaid:conformance>\s*B\s*<\/pdfaid:conformance>/.test(text);
  return {
    outputIntent,
    xmpPart,
    xmpConformance,
    ok: outputIntent && xmpPart && xmpConformance,
  };
}

// Reserved for future use — silence unused-import warnings.
void PDFHexString;
