import { loadPdfjs } from "@/lib/pdf/worker";

export interface PdfChunk {
  page: number;
  text: string;
}

export type PdfJsLikeDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getTextContent: () => Promise<{ items: unknown[] }>;
  }>;
};

// Extract text per page, then break each page into ~chunkChars-sized
// passages on sentence/paragraph boundaries. Page number is preserved
// for citation.
export async function extractPdfChunks(
  file: File,
  chunkChars = 1200,
  overlap = 150,
  onProgress?: (page: number, totalPages: number) => void,
): Promise<PdfChunk[]> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const chunks: PdfChunk[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    if (text.length <= chunkChars) {
      chunks.push({ page: p, text });
      continue;
    }

    // Sliding window with sentence-aware boundary
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + chunkChars, text.length);
      if (end < text.length) {
        const slice = text.slice(start, end);
        const lastStop = Math.max(
          slice.lastIndexOf(". "),
          slice.lastIndexOf("? "),
          slice.lastIndexOf("! "),
        );
        if (lastStop > chunkChars * 0.6) end = start + lastStop + 1;
      }
      chunks.push({ page: p, text: text.slice(start, end).trim() });
      if (end >= text.length) break;
      start = end - overlap;
    }
  }

  return chunks;
}

// Paragraph-level chunker for semantic search. Produces smaller, focused
// passages (~targetChars) split on paragraph → sentence boundaries so
// embedding scores separate cleanly across a doc of any size. Never
// splits mid-word. Preserves the source page.
export async function extractPdfParagraphChunks(
  file: File,
  targetChars = 300,
  minChars = 120,
  onProgress?: (page: number, totalPages: number) => void,
): Promise<PdfChunk[]> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  return extractPdfParagraphChunksFromDocument(doc as PdfJsLikeDocument, targetChars, minChars, onProgress);
}

export async function extractPdfParagraphChunksFromDocument(
  doc: PdfJsLikeDocument,
  targetChars = 300,
  minChars = 120,
  onProgress?: (page: number, totalPages: number) => void,
): Promise<PdfChunk[]> {
  const chunks: PdfChunk[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // Reconstruct paragraphs using pdf.js hasEOL. Two consecutive EOLs
    // (or an EOL after a blank item) mark a paragraph break.
    let buffer = "";
    const paragraphs: string[] = [];
    const flushPara = () => {
      const t = buffer.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
      if (t) paragraphs.push(t);
      buffer = "";
    };
    let prevEOL = false;
    for (const it of content.items) {
      const item = it as { str?: unknown; hasEOL?: unknown };
      const str = typeof item.str === "string" ? item.str : "";
      const eol = !!item.hasEOL;
      if (str) buffer += str;
      if (eol) {
        if (prevEOL || /\.\s*$/.test(buffer)) {
          flushPara();
          prevEOL = false;
        } else {
          buffer += " ";
          prevEOL = true;
        }
      } else if (str) {
        prevEOL = false;
      }
    }
    flushPara();

    if (paragraphs.length === 0) continue;

    // Split any paragraph longer than targetChars on sentence boundaries.
    const pieces: string[] = [];
    for (const para of paragraphs) {
      if (para.length <= targetChars) {
        pieces.push(para);
        continue;
      }
      const sentences = para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [para];
      let acc = "";
      for (const s of sentences) {
        const sTrim = s.trim();
        if (!sTrim) continue;
        if (acc.length + sTrim.length + 1 <= targetChars) {
          acc = acc ? `${acc} ${sTrim}` : sTrim;
        } else {
          if (acc) pieces.push(acc);
          if (sTrim.length <= targetChars) {
            acc = sTrim;
          } else {
            // Sentence itself too long — hard-split on word boundaries.
            let i = 0;
            while (i < sTrim.length) {
              let end = Math.min(i + targetChars, sTrim.length);
              if (end < sTrim.length) {
                const back = sTrim.lastIndexOf(" ", end);
                if (back > i + targetChars * 0.5) end = back;
              }
              pieces.push(sTrim.slice(i, end).trim());
              i = end;
            }
            acc = "";
          }
        }
      }
      if (acc) pieces.push(acc);
    }

    // Merge very small adjacent pieces so single-line fragments don't
    // pollute rankings.
    let merged = "";
    for (const piece of pieces) {
      if (!merged) {
        merged = piece;
      } else if (merged.length < minChars) {
        merged = `${merged} ${piece}`;
      } else {
        chunks.push({ page: p, text: merged });
        merged = piece;
      }
    }
    if (merged) chunks.push({ page: p, text: merged });
  }

  return chunks;
}

