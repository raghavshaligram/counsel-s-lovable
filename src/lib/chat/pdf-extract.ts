import { openPdfjs, EncryptedPdfError, MalformedPdfError, type PasswordPrompt } from "@/lib/pdf/pdf-open";
import { maybeYield, throwIfAborted } from "@/lib/pdf/yield";

export interface PdfChunk {
  page: number;
  text: string;
}

export interface ExtractOpts {
  signal?: AbortSignal;
  onPassword?: PasswordPrompt;
}

// Extract text per page, then break each page into ~chunkChars-sized
// passages on sentence/paragraph boundaries. Page number is preserved
// for citation. Yields on a bounded cadence so 3000-page docs don't lock
// the main thread. Encrypted / malformed PDFs surface as EncryptedPdfError
// / MalformedPdfError from `openPdfjs` — never an uncaught exception.
export async function extractPdfChunks(
  file: File,
  chunkChars = 1200,
  overlap = 150,
  onProgress?: (page: number, totalPages: number) => void,
  extract: ExtractOpts = {},
): Promise<PdfChunk[]> {
  const buf = await file.arrayBuffer();
  const doc = await openPdfjs(buf, { onPassword: extract.onPassword });
  const chunks: PdfChunk[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    throwIfAborted(extract.signal);
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: unknown) => (typeof it === "object" && it && "str" in it ? String((it as { str: string }).str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    try { page.cleanup(); } catch { /* noop */ }
    if (!text) {
      await maybeYield(p, 8);
      continue;
    }

    if (text.length <= chunkChars) {
      chunks.push({ page: p, text });
      await maybeYield(p, 8);
      continue;
    }

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
    await maybeYield(p, 8);
  }

  return chunks;
}

// Paragraph-level chunker for semantic search.
export async function extractPdfParagraphChunks(
  file: File,
  targetChars = 300,
  minChars = 120,
  onProgress?: (page: number, totalPages: number) => void,
  extract: ExtractOpts = {},
): Promise<PdfChunk[]> {
  const buf = await file.arrayBuffer();
  const doc = await openPdfjs(buf, { onPassword: extract.onPassword });
  const chunks: PdfChunk[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    throwIfAborted(extract.signal);
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    let buffer = "";
    const paragraphs: string[] = [];
    const flushPara = () => {
      const t = buffer.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
      if (t) paragraphs.push(t);
      buffer = "";
    };
    let prevEOL = false;
    for (const it of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      const str = typeof it.str === "string" ? it.str : "";
      const eol = !!it.hasEOL;
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
    try { page.cleanup(); } catch { /* noop */ }

    if (paragraphs.length === 0) {
      await maybeYield(p, 8);
      continue;
    }

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
    await maybeYield(p, 8);
  }

  return chunks;
}

// Re-export so callers can `try { … } catch (e) { if (e instanceof EncryptedPdfError) …}`
export { EncryptedPdfError, MalformedPdfError };
