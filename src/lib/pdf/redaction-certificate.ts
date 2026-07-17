import { PDFDocument, rgb } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";

export type CertificateVerification = {
  ok: boolean;
  total: number;
  removed: number;
  scannedAt: string;
  leaks: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  name: "Names",
  ssn: "Social security numbers",
  email: "Email addresses",
  phone: "Phone numbers",
  creditCard: "Card numbers",
  date: "Dates",
  ipAddress: "IP addresses",
  iban: "IBAN / bank numbers",
  pattern: "Pattern matches",
  manual: "Manually drawn",
};

function labelFor(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

export async function buildRedactionCertificate({
  sourceName,
  sourceBytes,
  pageCount,
  totalRedactions,
  categoryCounts,
  perPageCounts,
  verification,
  sourceHashSHA256,
  redactedHashSHA256,
}: {
  sourceName: string;
  sourceBytes?: number;
  pageCount: number;
  totalRedactions: number;
  /** Map of category key → count. Never the actual values. */
  categoryCounts: Record<string, number>;
  /** Map of 1-based page number → count of redactions on that page. */
  perPageCounts: Record<number, number>;
  verification: CertificateVerification | null;
  sourceHashSHA256?: string;
  redactedHashSHA256?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Certificate of Redaction");
  doc.setProducer("CounselPDF");
  doc.setCreator("CounselPDF");

  const font = await embedStandardFont(doc, "Helvetica");
  const bold = await embedStandardFont(doc, "HelveticaBold");
  const mono = await embedStandardFont(doc, "Courier");

  const ink = rgb(0.07, 0.09, 0.15);
  const muted = rgb(0.45, 0.48, 0.55);
  const vault = rgb(0.298, 0.498, 0.722); // #4C7FB8

  const pageW = 612;
  const pageH = 792;
  const margin = 56;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const ensureSpace = (needed: number) => {
    if (y < margin + needed) {
      page = doc.addPage([pageW, pageH]);
      page.drawRectangle({ x: 0, y: pageH - 4, width: pageW, height: 4, color: vault });
      y = pageH - margin;
    }
  };

  const drawText = (
    text: string,
    opts: { size?: number; font?: typeof font; color?: ReturnType<typeof rgb>; gapAfter?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const color = opts.color ?? ink;
    ensureSpace(size + 8);
    y -= size;
    page.drawText(text, { x: margin, y, size, font: f, color });
    y -= opts.gapAfter ?? 4;
  };

  const drawWrapped = (
    text: string,
    opts: { size?: number; color?: ReturnType<typeof rgb>; gapAfter?: number; maxWidth?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const maxW = opts.maxWidth ?? pageW - margin * 2;
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

  // Header
  page.drawRectangle({ x: 0, y: pageH - 8, width: pageW, height: 8, color: vault });
  drawText("CERTIFICATE OF REDACTION", { size: 9, font: bold, color: vault, gapAfter: 14 });
  drawText("CounselPDF · Verifiable Redaction", { size: 22, font: bold, gapAfter: 2 });
  drawText("On-device audit trail for content-stream redaction", {
    size: 10,
    color: muted,
    gapAfter: 22,
  });

  // Summary block
  const now = new Date();
  const fmtDate = now.toISOString().replace("T", " ").replace(/\..+/, " UTC");

  const rows: Array<[string, string]> = [
    ["Source document", sourceName],
  ];
  if (typeof sourceBytes === "number") {
    rows.push(["Source size", `${sourceBytes.toLocaleString()} bytes`]);
  }
  rows.push(
    ["Total pages", String(pageCount)],
    ["Redactions applied", String(totalRedactions)],
    ["Method", "Content-stream surgery (text operators deleted)"],
    ["Issued", fmtDate],
    ["Processing", "Entirely on-device — file never uploaded"],
  );

  for (const [k, v] of rows) {
    drawText(k.toUpperCase(), { size: 8, color: muted, font: bold, gapAfter: 2 });
    drawText(v, { size: 11, font: mono, gapAfter: 12 });
  }

  // Breakdown by type — counts only, never values.
  ensureSpace(40);
  y -= 4;
  drawText("REDACTIONS BY TYPE", { size: 9, font: bold, color: vault, gapAfter: 8 });
  const catEntries = Object.entries(categoryCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (catEntries.length === 0) {
    drawText("No categorised redactions recorded.", { size: 10, color: muted, gapAfter: 12 });
  } else {
    for (const [cat, n] of catEntries) {
      const line = `${labelFor(cat).padEnd(28, " ")} ${String(n).padStart(4, " ")}`;
      drawText(line, { size: 10, font: mono, gapAfter: 4 });
    }
    y -= 6;
    drawText(
      "Counts only — the actual redacted values are not recorded on this certificate.",
      { size: 8.5, color: muted, gapAfter: 12 },
    );
  }

  // Per-page breakdown
  ensureSpace(40);
  drawText("REDACTIONS BY PAGE", { size: 9, font: bold, color: vault, gapAfter: 8 });
  const pageNums = Object.keys(perPageCounts).map(Number).sort((a, b) => a - b);
  if (pageNums.length === 0) {
    drawText("No redactions recorded.", { size: 10, color: muted, gapAfter: 12 });
  } else {
    for (const p of pageNums) {
      const n = perPageCounts[p];
      drawText(
        `Page ${String(p).padStart(4, " ")}   ${String(n).padStart(4, " ")} redaction${n === 1 ? "" : "s"}`,
        { size: 10, font: mono, gapAfter: 4 },
      );
    }
    y -= 8;
  }

  // Verification statement
  ensureSpace(80);
  drawText("VERIFICATION", { size: 9, font: bold, color: vault, gapAfter: 8 });
  if (verification && verification.ok && verification.total > 0) {
    drawWrapped(
      "The content beneath each redaction has been permanently removed from the document. Verified: no extractable text remains inside the redaction regions in the exported document's text layer.",
      { size: 10, gapAfter: 4 },
    );
    drawText(
      `Result: ${verification.removed} of ${verification.total} redaction regions confirmed clear — 0 leaks.`,
      { size: 10, font: mono, color: vault, gapAfter: 4 },
    );
    drawText(`Scanned: ${new Date(verification.scannedAt).toISOString().replace("T", " ").replace(/\..+/, " UTC")}`, {
      size: 9,
      color: muted,
      gapAfter: 12,
    });
  } else if (verification && verification.total === 0) {
    drawWrapped(
      "The content beneath each redaction has been permanently removed from the document. No text-layer fragments were captured for verification (the redaction covers image regions or untextured content); the visual cover remains opaque.",
      { size: 10, gapAfter: 12 },
    );
  } else if (verification && !verification.ok) {
    drawWrapped(
      `Partial verification: ${verification.removed} of ${verification.total} redaction regions confirmed clear; ${verification.leaks} region(s) may still contain extractable text. Review the verification report in the workspace before relying on this output.`,
      { size: 10, gapAfter: 12 },
    );
  } else {
    drawWrapped(
      "Verification did not run for this export.",
      { size: 10, color: muted, gapAfter: 12 },
    );
  }

  // Chain of custody / hashes
  if (sourceHashSHA256 || redactedHashSHA256) {
    ensureSpace(80);
    drawText("CHAIN OF CUSTODY — SHA-256", { size: 9, font: bold, color: vault, gapAfter: 8 });
    if (sourceHashSHA256) {
      drawText("Source document", { size: 8, color: muted, font: bold, gapAfter: 2 });
      drawText(sourceHashSHA256.slice(0, 32), { size: 9, font: mono, gapAfter: 1 });
      drawText(sourceHashSHA256.slice(32), { size: 9, font: mono, gapAfter: 10 });
    }
    if (redactedHashSHA256) {
      drawText("Redacted output", { size: 8, color: muted, font: bold, gapAfter: 2 });
      drawText(redactedHashSHA256.slice(0, 32), { size: 9, font: mono, gapAfter: 1 });
      drawText(redactedHashSHA256.slice(32), { size: 9, font: mono, gapAfter: 12 });
    }
  }

  // Footer
  ensureSpace(60);
  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageW - margin, y },
    thickness: 0.5,
    color: muted,
  });
  y -= 16;
  drawText("Processed entirely on-device.", { size: 9, font: bold, color: vault, gapAfter: 4 });
  drawText(
    "Re-hash the paired redacted PDF and compare against the SHA-256 above to verify",
    { size: 9, color: muted, gapAfter: 2 },
  );
  drawText("the file has not been altered since this certificate was issued.", {
    size: 9,
    color: muted,
    gapAfter: 10,
  });
  drawText("CounselPDF · Verifiable Redaction", { size: 8, color: muted, font: bold });

  return doc.save();
}
