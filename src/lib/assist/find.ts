/**
 * Literal in-document text search for AI Assist.
 *
 * Thin wrapper on top of `extractPdfChunks` that returns page + snippet
 * matches for a plain string (whole-word or substring) or a regex. Runs
 * fully in the browser — nothing leaves the device. No new PDF parse
 * beyond what pdf-extract already does per invocation; caller can gate
 * frequency at the UI level.
 */
import { extractPdfChunks, type PdfChunk } from "@/lib/chat/pdf-extract";

export interface FindMatch {
  page: number;
  snippet: string;
  index: number;
}

export interface FindOptions {
  wholeWord?: boolean;
  regex?: boolean;
  maxMatches?: number;
  contextChars?: number;
  signal?: AbortSignal;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeRegex(term: string, opts: FindOptions): RegExp {
  if (opts.regex) return new RegExp(term, "giu");
  const escaped = escapeRegex(term);
  const pattern = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, "giu");
}

function snippetAround(text: string, at: number, matchLen: number, ctx: number): string {
  const start = Math.max(0, at - ctx);
  const end = Math.min(text.length, at + matchLen + ctx);
  const before = start > 0 ? "…" : "";
  const after = end < text.length ? "…" : "";
  return `${before}${text.slice(start, end).replace(/\s+/g, " ").trim()}${after}`;
}

export async function findLiteralInPdf(
  file: File,
  term: string,
  opts: FindOptions = {},
): Promise<FindMatch[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const max = opts.maxMatches ?? 50;
  const ctx = opts.contextChars ?? 60;
  let re: RegExp;
  try {
    re = makeRegex(trimmed, opts);
  } catch {
    return [];
  }

  const chunks: PdfChunk[] = await extractPdfChunks(file, 1500, 0, undefined, { signal: opts.signal });
  const matches: FindMatch[] = [];
  const seenPerPage = new Map<number, Set<string>>();

  for (const chunk of chunks) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk.text)) !== null) {
      const snip = snippetAround(chunk.text, m.index, m[0].length, ctx);
      const key = snip.toLowerCase();
      const seen = seenPerPage.get(chunk.page) ?? new Set<string>();
      if (!seen.has(key)) {
        seen.add(key);
        seenPerPage.set(chunk.page, seen);
        matches.push({ page: chunk.page, snippet: snip, index: m.index });
        if (matches.length >= max) return matches;
      }
      // Guard against zero-width regex loops
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return matches;
}
