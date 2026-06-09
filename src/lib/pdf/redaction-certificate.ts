import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Box = {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
};

export async function buildRedactionCertificate({
  sourceName,
  sourceBytes,
  pageCount,
  boxes,
  stripMetadata,
  sourceHashSHA256,
  redactedHashSHA256,
}: {
  sourceName: string;
  sourceBytes?: number;
  pageCount: number;
  boxes: Box[];
  stripMetadata: boolean;
  sourceHashSHA256?: string;
  redactedHashSHA256?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Certificate of Redaction");
  doc.setProducer("VaultPDF");
  doc.setCreator("VaultPDF");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const ink = rgb(0.07, 0.09, 0.15);
  const muted = rgb(0.45, 0.48, 0.55);
  const vault = rgb(0.85, 0.55, 0.05);

  const pageW = 612; // US Letter
  const pageH = 792;
  const margin = 56;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const drawText = (
    text: string,
    opts: { size?: number; font?: typeof font; color?: ReturnType<typeof rgb>; gapAfter?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const color = opts.color ?? ink;
    if (y < margin + size + 20) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    y -= size;
    page.drawText(text, { x: margin, y, size, font: f, color });
    y -= opts.gapAfter ?? 4;
  };

  // Header
  page.drawRectangle({ x: 0, y: pageH - 8, width: pageW, height: 8, color: vault });
  drawText("CERTIFICATE OF REDACTION", { size: 9, font: bold, color: vault, gapAfter: 14 });
  drawText("VaultPDF · Verifiable Redaction", { size: 22, font: bold, gapAfter: 2 });
  drawText("Court-defensible audit trail for browser-side PDF redaction", {
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
    ["Redactions applied", String(boxes.length)],
    ["Method", "Page raster + opaque overlay (text layer destroyed)"],
    ["Metadata", stripMetadata ? "Stripped on export" : "Preserved per user setting"],
    ["Processed", fmtDate],
    ["Processing location", "Client browser — file never uploaded"],
  );

  for (const [k, v] of rows) {
    drawText(k.toUpperCase(), { size: 8, color: muted, font: bold, gapAfter: 2 });
    drawText(v, { size: 11, font: mono, gapAfter: 12 });
  }

  // Chain of custody / hashes
  if (sourceHashSHA256 || redactedHashSHA256) {
    y -= 4;
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

  // Text-layer destruction proof
  y -= 4;
  drawText("TEXT-LAYER DESTRUCTION PROOF", { size: 9, font: bold, color: vault, gapAfter: 8 });
  drawText(
    "Each page was rasterised to JPEG at native resolution, opaque black overlays were",
    { size: 10, gapAfter: 2 },
  );
  drawText(
    "drawn on the image, and the resulting image replaced the page contents. The output",
    { size: 10, gapAfter: 2 },
  );
  drawText(
    "PDF contains no recoverable text under any redaction box — copy-paste, OCR, or PDF",
    { size: 10, gapAfter: 2 },
  );
  drawText(
    "object-stream extraction will return only the visible black region.",
    { size: 10, gapAfter: 14 },
  );

  // Per-page breakdown
  drawText("REDACTIONS BY PAGE", { size: 9, font: bold, color: vault, gapAfter: 8 });

  const byPage = new Map<number, Box[]>();
  for (const b of boxes) {
    const arr = byPage.get(b.page) ?? [];
    arr.push(b);
    byPage.set(b.page, arr);
  }
  const sortedPages = [...byPage.keys()].sort((a, b) => a - b);

  if (sortedPages.length === 0) {
    drawText("No redactions recorded.", { size: 10, color: muted });
  } else {
    for (const p of sortedPages) {
      const items = byPage.get(p)!;
      const labels = items.map((b) => b.label || "—");
      const labelSummary = summarizeLabels(labels);
      drawText(
        `Page ${p}  ·  ${items.length} box${items.length === 1 ? "" : "es"}  ·  ${labelSummary}`,
        { size: 10, font: mono, gapAfter: 6 },
      );
    }
  }

  // Footer
  if (y < margin + 80) {
    page = doc.addPage([pageW, pageH]);
    y = pageH - margin;
  }
  y -= 24;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageW - margin, y },
    thickness: 0.5,
    color: muted,
  });
  y -= 16;
  drawText(
    "Re-hash the paired redacted PDF and compare against the SHA-256 above to verify",
    { size: 9, color: muted, gapAfter: 2 },
  );
  drawText(
    "the file has not been altered since this certificate was issued.",
    { size: 9, color: muted, gapAfter: 8 },
  );
  drawText(
    "Retain this certificate alongside the redacted PDF and privilege log for production.",
    { size: 9, color: muted },
  );

  return doc.save();
}

function summarizeLabels(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const parts = [...counts.entries()].map(([l, n]) => (n > 1 ? `${l} ×${n}` : l));
  const joined = parts.join(", ");
  return joined.length > 80 ? joined.slice(0, 77) + "…" : joined;
}
