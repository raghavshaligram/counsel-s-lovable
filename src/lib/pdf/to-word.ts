// PDF → Word (DOCX) conversion. Pure on-device: pdfjs reads the source,
// docx builds the output, everything stays in the browser.
//
// The logic was lifted verbatim from the standalone /to-word page so the
// workspace inspector can reuse it without re-implementing.

import { loadPdfjs } from "@/lib/pdf/worker";

export type ToWordMode = "flow" | "page";

export interface ToWordOptions {
  mode?: ToWordMode;
  onProgress?: (pct: number) => void;
}

// Group pdfjs text items into lines using their y-position.
function groupIntoLines(items: any[]): { text: string; size: number; y: number }[] {
  const rows: { y: number; size: number; parts: { x: number; str: string }[] }[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const tr = it.transform as number[];
    const x = tr[4];
    const y = tr[5];
    const size = Math.hypot(tr[2], tr[3]) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, size * 0.4));
    if (!row) {
      row = { y, size, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, str: it.str });
    if (it.hasEOL) {
      row.parts.push({ x: x + 9999, str: "\n__EOL__" });
    }
  }
  rows.sort((a, b) => b.y - a.y);
  const out: { text: string; size: number; y: number }[] = [];
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x);
    const raw = r.parts.map((p) => p.str).join(" ").replace(/\s*\n__EOL__\s*/g, "\n");
    for (const line of raw.split("\n")) {
      out.push({ text: line.replace(/\s+/g, " ").trim(), size: r.size, y: r.y });
    }
  }
  return out;
}

export async function convertPdfToWordBlob(
  file: File,
  options: ToWordOptions = {},
): Promise<Blob> {
  const mode: ToWordMode = options.mode ?? "flow";
  const onProgress = options.onProgress;

  const pdfjs = await loadPdfjs();
  const { Document, Packer, Paragraph, TextRun, PageBreak, HeadingLevel } = await import("docx");
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  const allChildren: any[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = groupIntoLines(content.items as any[]);

    if (mode === "page" && i > 1) {
      allChildren.push(new Paragraph({ children: [new PageBreak()] }));
    }

    if (mode === "page") {
      allChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: `Page ${i}`, bold: true, color: "888888" })],
        }),
      );
    }

    for (const ln of lines) {
      if (!ln.text.trim()) {
        allChildren.push(new Paragraph({ children: [new TextRun("")] }));
        continue;
      }
      allChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: ln.text,
              size: Math.max(16, Math.min(36, Math.round(ln.size * 2))),
            }),
          ],
        }),
      );
    }
    onProgress?.(Math.round((i / doc.numPages) * 100));
  }

  const docx = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [{ children: allChildren }],
  });

  return Packer.toBlob(docx);
}
