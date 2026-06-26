// Best-effort destructive content-stream rewriter.
//
// pdf-lib does not ship a public AST API for content streams, so we operate
// on the raw decoded bytes of each page's content stream. We treat the
// stream as latin1 text (operators are ASCII; non-ASCII bytes only appear
// inside Tj string operands and we re-emit them verbatim when they don't
// match an edit/redact target).
//
// Scope (intentional):
//   - Tj  (show string)
//   - '   (move next line and show string)
// Out of scope for v1: TJ array operands (arrays of string + kern numbers)
// and " operator. When a target string lives inside TJ we fall back to the
// existing visual whiteout — search/copy won't reflect it, but render does.
//
// Match strategy: exact string equality on the decoded literal. This is
// reliable for Standard 14 fonts and for any font whose encoding maps
// directly to latin1 codepoints (the common case for plain ASCII text). For
// CID fonts / custom CMaps the literal bytes won't match the user-visible
// string and the rewrite is silently skipped (visual overlay still hides it).

import type { PDFDocument } from "pdf-lib";
import type { TextEditAnno, RedactAnno } from "./types";

type Edit = { original: string; replacement: string };
type Redact = { original: string };

export interface PageRewrite {
  edits: Edit[];
  redacts: Redact[];
}

export async function rewriteDocument(
  out: PDFDocument,
  byPage: Map<number, PageRewrite>,
): Promise<void> {
  const pages = out.getPages();
  for (let i = 0; i < pages.length; i++) {
    const job = byPage.get(i);
    if (!job || (!job.edits.length && !job.redacts.length)) continue;
    try {
      rewritePage(pages[i], job);
    } catch {
      // Swallow — visual overlay still hides the original glyphs.
    }
  }
}

function rewritePage(page: import("pdf-lib").PDFPage, job: PageRewrite) {
  // Access the (possibly multi-part) content stream. We use the internal
  // PDFPageLeaf helpers exposed by pdf-lib at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node: any = page.node;
  if (typeof node.normalize === "function") {
    // Coalesce content stream array into a single stream where possible.
    try { node.normalize(); } catch { /* ignore */ }
  }

  const ctx = page.doc.context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents = node.Contents?.() ?? node.get?.(node.context?.obj?.("Contents"));
  if (!contents) return;

  const streams: import("pdf-lib").PDFRawStream[] = [];
  if ("asArray" in contents && typeof contents.asArray === "function") {
    for (const ref of contents.asArray()) {
      const obj = ctx.lookup(ref);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (obj && (obj as any).contents) streams.push(obj as import("pdf-lib").PDFRawStream);
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((contents as any).contents) streams.push(contents as import("pdf-lib").PDFRawStream);
  }

  for (const stream of streams) {
    rewriteStream(stream, job);
  }
}

function rewriteStream(
  stream: import("pdf-lib").PDFRawStream,
  job: PageRewrite,
) {
  // pdf-lib exposes the raw bytes as `contents` (Uint8Array). Most real-
  // world PDFs have FlateDecode'd content streams, so we decode-then-rewrite
  // -then-re-encode. Without this, destructive redaction would silently fall
  // back to visual whiteout on >90 % of documents.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = stream;
  const dict = s.dict;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (dict?.context ?? null) as any;

  // Read /Filter — may be a name or an array of names.
  let filterNames: string[] = [];
  try {
    const filter = dict?.get?.(ctx.obj("Filter"));
    if (filter) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f: any = filter;
      if (typeof f.asArray === "function") {
        filterNames = f.asArray().map((n: { toString: () => string }) => n.toString().replace(/^\//, ""));
      } else {
        filterNames = [String(f).replace(/^\//, "")];
      }
    }
  } catch { /* ignore */ }

  let bytes: Uint8Array = s.contents;
  if (!bytes || !bytes.length) return;

  const wasFlate = filterNames.length === 1 && (filterNames[0] === "FlateDecode" || filterNames[0] === "Fl");
  if (filterNames.length && !wasFlate) {
    // Other filters (ASCII85, LZW, RunLength, DCTDecode, etc.) — too risky
    // to round-trip. Visual overlay still hides the glyphs.
    return;
  }
  if (wasFlate) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { unzlibSync } = require("fflate") as typeof import("fflate");
      bytes = unzlibSync(bytes);
    } catch {
      return;
    }
  }

  // latin1 decode
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);

  const editMap = new Map(job.edits.map((e) => [e.original, e.replacement]));
  const redactSet = new Set(job.redacts.map((r) => r.original));

  // Walk Tj literal operands: `(...) Tj`  or  `(...) '`.
  // String literal supports escapes (\(, \), \\, \n, \r, \t, \b, \f, \ddd) and
  // balanced parens. We only need correct *bounds*; the operand bytes are
  // replaced wholesale by literal-encoded ASCII when we hit a match.
  let out = "";
  let i = 0;
  let mutated = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "(") { out += ch; i++; continue; }
    // find matching close paren respecting escapes + nesting
    let j = i + 1;
    let depth = 1;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === "\\") { j += 2; continue; }
      if (c === "(") { depth++; j++; continue; }
      if (c === ")") { depth--; j++; if (depth === 0) break; continue; }
      j++;
    }
    if (depth !== 0) { out += text.slice(i); break; }
    const literal = text.slice(i + 1, j - 1);
    // peek operator after optional whitespace
    let k = j;
    while (k < text.length && /\s/.test(text[k])) k++;
    const op = text[k];
    const op2 = text.slice(k, k + 2);
    const isTj = op === "'" || (op === "T" && text[k + 1] === "j");
    if (!isTj) { out += text.slice(i, j); i = j; continue; }
    const decoded = decodeLiteral(literal);
    if (redactSet.has(decoded)) {
      // erase the entire `( ... ) Tj` (or `'`) sequence
      const after = op === "'" ? k + 1 : k + 2;
      mutated = true;
      i = after;
      continue;
    }
    const repl = editMap.get(decoded);
    if (repl !== undefined) {
      out += "(" + encodeLiteral(repl) + ")";
      mutated = true;
      i = j;
      continue;
    }
    out += text.slice(i, j);
    i = j;
    // op chars handled in next iteration
    void op2;
  }

  if (!mutated) return;

  // re-encode latin1 back to bytes
  let newBytes = new Uint8Array(out.length);
  for (let n = 0; n < out.length; n++) newBytes[n] = out.charCodeAt(n) & 0xff;

  if (wasFlate) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { zlibSync } = require("fflate") as typeof import("fflate");
      newBytes = zlibSync(newBytes);
    } catch {
      return;
    }
  }
  s.contents = newBytes;
  // update /Length if pdf-lib stored one
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lenKey = (dict.context as any).obj("Length");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dict.set?.(lenKey, (dict.context as any).obj(newBytes.length));
  } catch { /* pdf-lib will recompute on save */ }
}

function decodeLiteral(s: string): string {
  // Decode PDF string-literal escapes into the raw byte string.
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
    const n = s[i + 1];
    if (n === undefined) break;
    if (n === "n") { out += "\n"; i++; continue; }
    if (n === "r") { out += "\r"; i++; continue; }
    if (n === "t") { out += "\t"; i++; continue; }
    if (n === "b") { out += "\b"; i++; continue; }
    if (n === "f") { out += "\f"; i++; continue; }
    if (n === "(" || n === ")" || n === "\\") { out += n; i++; continue; }
    if (n >= "0" && n <= "7") {
      let oct = n;
      if (s[i + 2] >= "0" && s[i + 2] <= "7") { oct += s[i + 2]; i++; }
      if (s[i + 2] >= "0" && s[i + 2] <= "7") { oct += s[i + 2]; i++; }
      out += String.fromCharCode(parseInt(oct, 8));
      i++;
      continue;
    }
    out += n;
    i++;
  }
  return out;
}

function encodeLiteral(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" || c === "(" || c === ")") out += "\\" + c;
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else {
      const code = c.charCodeAt(0);
      if (code < 0x20 || code > 0x7e) out += "\\" + code.toString(8).padStart(3, "0");
      else out += c;
    }
  }
  return out;
}
