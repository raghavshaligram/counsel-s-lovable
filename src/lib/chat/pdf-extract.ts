import { loadPdfjs } from "@/lib/pdf/worker";

export interface PdfChunk {
  page: number;
  text: string;
}

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
