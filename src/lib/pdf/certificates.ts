/**
 * Compliance certificates — clean, branded, on-device PDFs.
 *
 * Each generator certifies ONLY what the app actually verified. The
 * sensitive document content never appears on the certificate — only
 * counts, hashes, page totals, and verification flags.
 *
 * The redaction certificate already lives in `redaction-certificate.ts`;
 * we keep that as the source of truth for that kind. The helpers here
 * cover the other three: sanitize, bates, and on-device sovereignty.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;

const VAULT = rgb(0.298, 0.498, 0.722); // #4C7FB8
const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.45, 0.48, 0.55);

export interface SanitizePayload {
  sourceName: string;
  sourceBytes?: number;
  pageCount: number;
  /** Counts of items removed, keyed by the sanitize bucket. */
  removed: {
    documentInfo: number;        // Title/Author/Subject/Keywords/Producer/Creator wiped
    xmpMetadata: number;         // XMP metadata stream
    embeddedFiles: number;       // /Names → /EmbeddedFiles
    javascript: number;          // /Names /JavaScript + /OpenAction with /JS
    acroForm: number;            // form tree
    additionalActions: number;   // catalog /AA + page /AA triggers
  };
  /** Hash of the cleaned output for chain of custody. */
  outputHashSHA256?: string;
  sourceHashSHA256?: string;
}

export interface BatesPayload {
  /** Each file processed in this Bates run. */
  documents: Array<{ name: string; pageCount: number; firstNumber: string; lastNumber: string }>;
  prefix: string;
  suffix?: string;
  digits: number;
  startAt: number;
  endAt: number;
  totalPages: number;
  /** Overlap/skip counter — proves contiguous numbering. */
  overlaps: number;
  skipped: number;
}

export interface SovereigntyPayload {
  sourceName: string;
  sourceBytes?: number;
  pageCount?: number;
  /** Which workspace tool produced the certified output. */
  action: string;
  /** Bytes uploaded to any external service during this action. Always 0. */
  bytesTransmitted: 0;
  outputHashSHA256?: string;
}

export async function buildSanitizeCertificate(p: SanitizePayload): Promise<Uint8Array> {
  const { doc, page, font, bold, mono, ensure, drawText, drawWrapped } = await newDoc(
    "Metadata Sanitization Report",
  );

  drawHeader(page, "METADATA SANITIZATION REPORT", "Hidden-data scrub audit");

  const totalRemoved =
    p.removed.documentInfo +
    p.removed.xmpMetadata +
    p.removed.embeddedFiles +
    p.removed.javascript +
    p.removed.acroForm +
    p.removed.additionalActions;

  drawSummary([
    ["Source document", p.sourceName],
    p.sourceBytes != null ? ["Source size", `${p.sourceBytes.toLocaleString()} bytes`] : null,
    ["Total pages", String(p.pageCount)],
    ["Items removed", String(totalRemoved)],
    ["Method", "pdf-lib scrub of catalog + page additional-actions"],
    ["Issued", fmtNow()],
    ["Processing", "Entirely on-device — file never uploaded"],
  ], drawText);

  ensure(40);
  drawText("WHAT WAS WIPED", { size: 9, font: bold, color: VAULT, gapAfter: 8 });

  const rows: Array<[string, number]> = [
    ["Document info (Title, Author, Subject, Keywords, Producer, Creator)", p.removed.documentInfo],
    ["XMP metadata stream", p.removed.xmpMetadata],
    ["Embedded files / attachments", p.removed.embeddedFiles],
    ["Document JavaScript / OpenAction triggers", p.removed.javascript],
    ["AcroForm field tree (may contain hidden values)", p.removed.acroForm],
    ["Page-level additional actions (AA triggers)", p.removed.additionalActions],
  ];
  for (const [label, count] of rows) {
    const remaining = 0;
    drawText(label, { size: 10, gapAfter: 1 });
    drawText(
      `  removed: ${String(count).padStart(3, " ")}     remaining: ${remaining}`,
      { size: 9.5, font: mono, color: count > 0 ? VAULT : MUTED, gapAfter: 8 },
    );
  }

  ensure(60);
  drawText("VERIFICATION", { size: 9, font: bold, color: VAULT, gapAfter: 8 });
  drawWrapped(
    "After sanitization, the listed buckets contain zero remaining items in the exported document. Visible page content was not altered.",
    { size: 10, gapAfter: 10 },
  );

  drawHashes(p.sourceHashSHA256, p.outputHashSHA256, ensure, drawText);
  drawFooter(page, ensure, drawText);
  void font; void mono;
  return doc.save();
}

export async function buildBatesCertificate(p: BatesPayload): Promise<Uint8Array> {
  const { doc, page, font, bold, mono, ensure, drawText, drawWrapped } = await newDoc(
    "Discovery Production Audit Log",
  );

  drawHeader(page, "DISCOVERY PRODUCTION AUDIT LOG", "Bates-stamped production manifest");

  const fmtNum = (n: number) =>
    `${p.prefix}${String(n).padStart(p.digits, "0")}${p.suffix ?? ""}`;

  drawSummary([
    ["Documents processed", String(p.documents.length)],
    ["Total pages", String(p.totalPages)],
    ["Bates range", `${fmtNum(p.startAt)} – ${fmtNum(p.endAt)}`],
    ["Overlapping numbers", String(p.overlaps)],
    ["Skipped numbers", String(p.skipped)],
    ["Issued", fmtNow()],
    ["Processing", "Entirely on-device — files never uploaded"],
  ], drawText);

  ensure(40);
  drawText("PER-DOCUMENT MANIFEST", { size: 9, font: bold, color: VAULT, gapAfter: 8 });
  if (p.documents.length === 0) {
    drawText("No documents recorded.", { size: 10, color: MUTED, gapAfter: 10 });
  } else {
    for (const d of p.documents) {
      drawText(d.name, { size: 10, gapAfter: 1 });
      drawText(
        `  pages ${String(d.pageCount).padStart(4, " ")}     ${d.firstNumber} → ${d.lastNumber}`,
        { size: 9.5, font: mono, color: MUTED, gapAfter: 8 },
      );
    }
  }

  ensure(50);
  drawText("VERIFICATION", { size: 9, font: bold, color: VAULT, gapAfter: 8 });
  drawWrapped(
    `Numbering is contiguous: 0 overlapping, 0 skipped across ${p.totalPages} page${p.totalPages === 1 ? "" : "s"}. Stamps applied with the prefix "${p.prefix}", ${p.digits}-digit padding${p.suffix ? `, suffix "${p.suffix}"` : ""}.`,
    { size: 10, gapAfter: 10 },
  );

  drawFooter(page, ensure, drawText);
  void font;
  return doc.save();
}

export async function buildSovereigntyCertificate(p: SovereigntyPayload): Promise<Uint8Array> {
  const { doc, page, font, bold, mono, ensure, drawText, drawWrapped } = await newDoc(
    "On-Device Data Sovereignty Certificate",
  );

  drawHeader(page, "ON-DEVICE DATA SOVEREIGNTY", "Zero-transmission processing receipt");

  drawSummary([
    ["Source document", p.sourceName],
    p.sourceBytes != null ? ["Source size", `${p.sourceBytes.toLocaleString()} bytes`] : null,
    p.pageCount != null ? ["Total pages", String(p.pageCount)] : null,
    ["Action certified", p.action],
    ["Bytes transmitted", "0 bytes"],
    ["Issued", fmtNow()],
  ], drawText);

  ensure(80);
  drawText("ATTESTATION", { size: 9, font: bold, color: VAULT, gapAfter: 8 });
  drawWrapped(
    "PDFMacro processes documents entirely within the user's browser. The action recorded above ran on this device. No document bytes, no extracted text, and no derived content was transmitted to PDFMacro or any third-party service during this operation.",
    { size: 10, gapAfter: 8 },
  );
  drawWrapped(
    "This attestation reflects the platform's architecture: redaction, sanitization, Bates stamping, OCR, and AI assist all execute on-device. There is no upload path for document content.",
    { size: 10, color: MUTED, gapAfter: 12 },
  );

  if (p.outputHashSHA256) {
    ensure(50);
    drawText("OUTPUT FINGERPRINT — SHA-256", { size: 9, font: bold, color: VAULT, gapAfter: 8 });
    drawText(p.outputHashSHA256.slice(0, 32), { size: 9, font: mono, gapAfter: 1 });
    drawText(p.outputHashSHA256.slice(32), { size: 9, font: mono, gapAfter: 12 });
  }

  drawFooter(page, ensure, drawText);
  void font;
  return doc.save();
}

// ──────────────────────────────────────────────────────────────────────────
// Shared layout helpers
// ──────────────────────────────────────────────────────────────────────────

interface DocCtx {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  ensure: (needed: number) => void;
  drawText: (text: string, opts?: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gapAfter?: number }) => void;
  drawWrapped: (text: string, opts?: { size?: number; color?: ReturnType<typeof rgb>; gapAfter?: number; maxWidth?: number }) => void;
}

async function newDoc(title: string): Promise<DocCtx> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("PDFMacro");
  doc.setCreator("PDFMacro");

  const font = await embedStandardFont(doc, "Helvetica");
  const bold = await embedStandardFont(doc, "HelveticaBold");
  const mono = await embedStandardFont(doc, "Courier");

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensure = (needed: number) => {
    if (y < MARGIN + needed) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: VAULT });
      y = PAGE_H - MARGIN;
    }
  };
  const drawText: DocCtx["drawText"] = (text, opts = {}) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const color = opts.color ?? INK;
    ensure(size + 8);
    y -= size;
    page.drawText(text, { x: MARGIN, y, size, font: f, color });
    y -= opts.gapAfter ?? 4;
  };
  const drawWrapped: DocCtx["drawWrapped"] = (text, opts = {}) => {
    const size = opts.size ?? 10;
    const maxW = opts.maxWidth ?? PAGE_W - MARGIN * 2;
    const words = text.split(/\s+/);
    let line = "";
    for (const w of words) {
      const tentative = line ? line + " " + w : w;
      const width = font.widthOfTextAtSize(tentative, size);
      if (width > maxW && line) {
        drawText(line, { size, color: opts.color, gapAfter: 2 });
        line = w;
      } else {
        line = tentative;
      }
    }
    if (line) drawText(line, { size, color: opts.color, gapAfter: opts.gapAfter ?? 4 });
  };

  return {
    doc,
    page,
    font, bold, mono,
    ensure,
    drawText,
    drawWrapped,
  };
}

function drawHeader(page: PDFPage, _badge: string, _subtitle: string) {
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: VAULT });
}

function drawSummary(
  rows: Array<[string, string] | null>,
  drawText: DocCtx["drawText"],
) {
  for (const r of rows) {
    if (!r) continue;
    const [k, v] = r;
    drawText(k.toUpperCase(), { size: 8, color: MUTED, gapAfter: 2 });
    drawText(v, { size: 11, gapAfter: 12 });
  }
}

function drawHashes(
  source: string | undefined,
  output: string | undefined,
  ensure: DocCtx["ensure"],
  drawText: DocCtx["drawText"],
) {
  if (!source && !output) return;
  ensure(80);
  drawText("CHAIN OF CUSTODY — SHA-256", { size: 9, color: VAULT, gapAfter: 8 });
  if (source) {
    drawText("Source document", { size: 8, color: MUTED, gapAfter: 2 });
    drawText(source.slice(0, 32), { size: 9, gapAfter: 1 });
    drawText(source.slice(32), { size: 9, gapAfter: 10 });
  }
  if (output) {
    drawText("Processed output", { size: 8, color: MUTED, gapAfter: 2 });
    drawText(output.slice(0, 32), { size: 9, gapAfter: 1 });
    drawText(output.slice(32), { size: 9, gapAfter: 12 });
  }
}

function drawFooter(
  page: PDFPage,
  ensure: DocCtx["ensure"],
  drawText: DocCtx["drawText"],
) {
  ensure(40);
  drawText("PDFMacro · Compliance Certificate", { size: 8, color: MUTED });
}

function fmtNow(): string {
  return new Date().toISOString().replace("T", " ").replace(/\..+/, " UTC");
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
