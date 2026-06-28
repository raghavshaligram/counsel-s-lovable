// Destructive content-stream surgery.
//
// For redaction, we DO NOT rely on string matching. Custom PDF fonts/CMaps
// routinely encode visible text as private glyph codes, so decoded Tj/TJ bytes
// cannot be trusted. We tokenize each page content stream, track graphics and
// text state, estimate the rendered bounding box of every text-show operator,
// and remove the operator solely when that box intersects a redaction region.
//
// In addition we:
//   - drop image `Do` operators whose CTM-mapped bounding box lies fully
//     inside a redact rectangle
//   - preserve the legacy text-edit string-replacement path used by Edit-text
//     annotations (handles only `(literal) Tj` / `'`, like before)
//
// The redact rectangles are passed in PDF user-space coordinates (origin at
// bottom-left, matching PDF native coordinates) — the caller is responsible
// for flipping the editor's top-left rects into user space.

import { PDFName, type PDFDocument } from "pdf-lib";
import { unzlibSync, zlibSync } from "fflate";

export interface RedactRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PageRewrite {
  /** Redact rectangles in PDF user-space (bottom-left origin). */
  redacts: RedactRect[];
  /** Best-effort string fallback for redaction (Tj/' literals). */
  redactStrings?: string[];
  /** Exact strings/spans that must be deleted from text-show operators. */
  redactTargets?: RedactTextTarget[];
  /** Text-edit string replacements (Tj/' literal equality). */
  edits: { original: string; replacement: string }[];
}

export interface RedactTextTarget {
  /** Full pdf.js text item, when known. */
  original: string;
  /** Exact sensitive value to remove. */
  text: string;
  /** Optional span in `original`. */
  start?: number;
  length?: number;
}

export interface RewriteStats {
  pagesVisited: number;
  streamsVisited: number;
  streamsMutated: number;
  textOpsDropped: number;
  textOperandsRewritten: number;
  imageOpsDropped: number;
  textTargetsMatched: number;
  skippedStreams: number;
}

type FontMetrics = {
  widths: Map<number, number>;
  defaultWidth: number;
  missingWidth: number;
  firstChar: number;
  codeSize: 1 | 2;
};

const DEFAULT_FONT: FontMetrics = {
  widths: new Map(),
  defaultWidth: 500,
  missingWidth: 500,
  firstChar: 0,
  codeSize: 1,
};

const emptyStats = (): RewriteStats => ({
  pagesVisited: 0,
  streamsVisited: 0,
  streamsMutated: 0,
  textOpsDropped: 0,
  textOperandsRewritten: 0,
  imageOpsDropped: 0,
  textTargetsMatched: 0,
  skippedStreams: 0,
});

function addStats(into: RewriteStats, next: Partial<RewriteStats>) {
  into.pagesVisited += next.pagesVisited ?? 0;
  into.streamsVisited += next.streamsVisited ?? 0;
  into.streamsMutated += next.streamsMutated ?? 0;
  into.textOpsDropped += next.textOpsDropped ?? 0;
  into.textOperandsRewritten += next.textOperandsRewritten ?? 0;
  into.imageOpsDropped += next.imageOpsDropped ?? 0;
  into.textTargetsMatched += next.textTargetsMatched ?? 0;
  into.skippedStreams += next.skippedStreams ?? 0;
}

export async function rewriteDocument(
  out: PDFDocument,
  byPage: Map<number, PageRewrite>,
): Promise<RewriteStats> {
  const pages = out.getPages();
  const stats = emptyStats();
  for (let i = 0; i < pages.length; i++) {
    const job = byPage.get(i);
    if (!job || (!job.edits.length && !job.redacts.length)) continue;
    addStats(stats, { pagesVisited: 1 });
    addStats(stats, rewritePage(pages[i], job));
  }
  // eslint-disable-next-line no-console
  console.info("[redact] rewriteDocument", stats);
  return stats;
}

function rewritePage(page: import("pdf-lib").PDFPage, job: PageRewrite): RewriteStats {
  const stats = emptyStats();
  // pdf-lib internals: coalesce a multi-stream Contents into a single stream
  // when possible so we only rewrite one buffer per page.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node: any = page.node;
  if (typeof node.normalize === "function") {
    try { node.normalize(); } catch { /* ignore */ }
  }

  const ctx = page.doc.context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents = node.Contents?.() ?? node.get?.(PDFName.of("Contents"));
  if (!contents) return stats;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streams: any[] = [];
  if ("asArray" in contents && typeof contents.asArray === "function") {
    for (const ref of contents.asArray()) {
      const obj = ctx.lookup(ref);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (obj && ((obj as any).contents || typeof (obj as any).getContents === "function")) streams.push(obj as any);
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((contents as any).contents || typeof (contents as any).getContents === "function") streams.push(contents as any);
  }

  for (const stream of streams) addStats(stats, rewriteStream(stream, job));
  return stats;
}

function rewriteStream(stream: import("pdf-lib").PDFRawStream, job: PageRewrite): RewriteStats {
  const stats = emptyStats();
  stats.streamsVisited = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = stream;
  const dict = s.dict;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (dict?.context ?? null) as any;

  // Read /Filter — may be a name or an array of names.
  let filterNames: string[] = [];
  try {
    const filter = dict?.get?.(PDFName.of("Filter"));
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

  let bytes: Uint8Array = s.contents ?? (typeof s.getContents === "function" ? s.getContents() : undefined);
  if (!bytes || !bytes.length) return stats;

  const wasFlate = filterNames.length === 1 && (filterNames[0] === "FlateDecode" || filterNames[0] === "Fl");
  if (filterNames.length && !wasFlate) {
    // Other filters (ASCII85, LZW, DCTDecode, etc.) — too risky to round-trip.
    stats.skippedStreams = 1;
    return stats;
  }
  if (wasFlate) {
    try { bytes = unzlibSync(bytes); } catch { stats.skippedStreams = 1; return stats; }
  }

  // latin1 decode — operators are ASCII; non-ASCII bytes only appear inside
  // string/hex operands and we treat operand bytes opaquely on rewrite.
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);

  const result = surgicalRewrite(text, job);
  if (!result.mutated) return stats;

  let newBytes = new Uint8Array(result.text.length);
  for (let n = 0; n < result.text.length; n++) newBytes[n] = result.text.charCodeAt(n) & 0xff;

  if (wasFlate) {
    try { newBytes = zlibSync(newBytes); } catch { stats.skippedStreams = 1; return stats; }
  }
  s.contents = newBytes;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lenKey = PDFName.of("Length");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dict.set?.(lenKey, (dict.context as any).obj(newBytes.length));
  } catch { /* pdf-lib will recompute on save */ }
  stats.streamsMutated = 1;
  addStats(stats, result.stats);
  return stats;
}

// ─── Tokenizer + content-stream walker ──────────────────────────────────────

type TokKind =
  | "num" | "name" | "op" | "str" | "hexstr"
  | "lbrack" | "rbrack" | "dict" | "other";
type Tok = { kind: TokKind; start: number; end: number };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\0") { i++; continue; }
    // comment
    if (c === "%") {
      while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
      continue;
    }
    const start = i;
    // string literal `(...)` with escapes and balanced parens
    if (c === "(") {
      let depth = 1; i++;
      while (i < n && depth > 0) {
        const ch = text[i];
        if (ch === "\\") { i += 2; continue; }
        if (ch === "(") { depth++; i++; continue; }
        if (ch === ")") { depth--; i++; continue; }
        i++;
      }
      out.push({ kind: "str", start, end: i });
      continue;
    }
    // dict `<<...>>` or hex string `<...>`
    if (c === "<") {
      if (text[i + 1] === "<") {
        let depth = 1; i += 2;
        while (i < n && depth > 0) {
          if (text[i] === "<" && text[i + 1] === "<") { depth++; i += 2; continue; }
          if (text[i] === ">" && text[i + 1] === ">") { depth--; i += 2; continue; }
          if (text[i] === "(") {
            let d = 1; i++;
            while (i < n && d > 0) {
              const ch = text[i];
              if (ch === "\\") { i += 2; continue; }
              if (ch === "(") d++;
              else if (ch === ")") d--;
              i++;
            }
            continue;
          }
          i++;
        }
        out.push({ kind: "dict", start, end: i });
        continue;
      }
      i++;
      while (i < n && text[i] !== ">") i++;
      if (i < n) i++;
      out.push({ kind: "hexstr", start, end: i });
      continue;
    }
    if (c === "[") { out.push({ kind: "lbrack", start, end: i + 1 }); i++; continue; }
    if (c === "]") { out.push({ kind: "rbrack", start, end: i + 1 }); i++; continue; }
    // name `/Foo`
    if (c === "/") {
      i++;
      while (i < n && !"()<>[]{}/% \t\n\r\f\0".includes(text[i])) i++;
      out.push({ kind: "name", start, end: i });
      continue;
    }
    // number
    if (c === "+" || c === "-" || c === "." || (c >= "0" && c <= "9")) {
      i++;
      while (i < n) {
        const ch = text[i];
        if ((ch >= "0" && ch <= "9") || ch === "." || ch === "-" || ch === "+" || ch === "e" || ch === "E") i++;
        else break;
      }
      out.push({ kind: "num", start, end: i });
      continue;
    }
    // bare-character operators `'` and `"`
    if (c === "'" || c === '"') {
      i++;
      out.push({ kind: "op", start, end: i });
      continue;
    }
    // alphabetic operator
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
      i++;
      while (i < n) {
        const ch = text[i];
        if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "*") i++;
        else break;
      }
      out.push({ kind: "op", start, end: i });
      // Inline image: ID … EI carries raw bytes that may look like operators.
      const op = text.slice(start, i);
      if (op === "ID") {
        if (i < n && (text[i] === " " || text[i] === "\n" || text[i] === "\r")) i++;
        let p = i;
        while (p < n - 1) {
          if (text[p] === "E" && text[p + 1] === "I") {
            const before = p === 0 ? " " : text[p - 1];
            const after = p + 2 >= n ? " " : text[p + 2];
            if (/\s/.test(before) && /\s/.test(after)) break;
          }
          p++;
        }
        i = Math.min(p, n);
      }
      continue;
    }
    // unknown byte — skip
    i++;
  }
  return out;
}

// 2×3 affine matrices as 6-tuples [a b c d e f] representing
//   [a b 0; c d 0; e f 1]
function identity(): number[] { return [1, 0, 0, 1, 0, 0]; }
function mul(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}
function txp(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function pointInRects(x: number, y: number, rects: RedactRect[]): boolean {
  for (const r of rects) {
    const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2);
    const y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2);
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return true;
  }
  return false;
}
function bboxInRects(minX: number, minY: number, maxX: number, maxY: number, rects: RedactRect[]): boolean {
  for (const r of rects) {
    const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2);
    const y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2);
    if (minX >= x1 && maxX <= x2 && minY >= y1 && maxY <= y2) return true;
  }
  return false;
}

function decodeLiteral(s: string): string {
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
      i++; continue;
    }
    out += n; i++;
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

const TEXT_SHOW_OPS = new Set(["Tj", "TJ", "'", '"']);

function surgicalRewrite(text: string, job: PageRewrite): { text: string; mutated: boolean; stats: Partial<RewriteStats> } {
  const tokens = tokenize(text);
  const editMap = new Map(job.edits.map((e) => [e.original, e.replacement]));
  const redactStrings = new Set(job.redactStrings ?? []);
  const redactTargets = job.redactTargets ?? [];
  const rects = job.redacts;
  const stats: Partial<RewriteStats> = {};

  let ctm = identity();
  const gStack: number[][] = [];

  let inText = false;
  let tm = identity();
  let tlm = identity();
  let tLeading = 0;

  let operands: Tok[] = [];
  let cursor = 0;
  let mutated = false;
  const chunks: string[] = [];

  const num = (t: Tok) => parseFloat(text.slice(t.start, t.end));

  for (const tk of tokens) {
    if (tk.kind !== "op") { operands.push(tk); continue; }
    const op = text.slice(tk.start, tk.end);

    // ── Decide drop / replace ──
    let drop = false;
    let replaceTjLiteral: string | null = null;
    let replaceOperand: { token: Tok; value: string } | null = null;
    let rewriteMatchedTarget = false;

    if (TEXT_SHOW_OPS.has(op) && inText) {
      const [ux, uy] = txp(ctm, tm[4], tm[5]);
      const inRect = rects.length ? pointInRects(ux, uy, rects) : false;

      let stringMatchRedact = false;
      if (!inRect && (redactStrings.size || redactTargets.length) && (op === "Tj" || op === "'")) {
        const last = operands[operands.length - 1];
        const decoded = decodeStringToken(text, last);
        if (last && decoded !== null) {
          const rewritten = redactTextValue(decoded, redactTargets, redactStrings);
          if (rewritten.matched) {
            rewriteMatchedTarget = true;
            if (rewritten.value.length === 0) {
              stringMatchRedact = true;
            } else if (rewritten.value !== decoded) {
              replaceOperand = { token: last, value: rewritten.value };
            }
          } else if (redactStrings.has(decoded)) {
            stringMatchRedact = true;
            rewriteMatchedTarget = true;
          }
        }
      }

      if (!inRect && !stringMatchRedact && !replaceOperand && redactTargets.length && op === "TJ") {
        const arr = collectArrayOperand(text, operands);
        if (arr) {
          const rewritten = redactTextValue(arr.value, redactTargets, redactStrings);
          if (rewritten.matched) {
            rewriteMatchedTarget = true;
            // TJ arrays interleave kerning adjustments, so preserve surrounding
            // text by replacing the whole array with one literal string. This
            // keeps the non-redacted words searchable instead of dropping the line.
            replaceOperand = { token: arr.token, value: rewritten.value };
          }
        }
      }

      if (inRect || stringMatchRedact) {
        drop = true;
      } else if ((op === "Tj" || op === "'") && editMap.size) {
        const last = operands[operands.length - 1];
        if (last?.kind === "str") {
          const lit = decodeLiteral(text.slice(last.start + 1, last.end - 1));
          const repl = editMap.get(lit);
          if (repl !== undefined) replaceTjLiteral = repl;
        }
      }
    }

    if (op === "Do" && operands.length >= 1 && operands[operands.length - 1].kind === "name" && rects.length) {
      // Unit-square corners through current CTM
      const corners: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const usrs = corners.map(([x, y]) => txp(ctm, x, y));
      const xs = usrs.map((u) => u[0]);
      const ys = usrs.map((u) => u[1]);
      if (bboxInRects(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), rects)) {
        drop = true;
        stats.imageOpsDropped = (stats.imageOpsDropped ?? 0) + 1;
      }
    }

    // ── Update graphics / text state (drops do not affect state) ──
    if (op === "q") gStack.push(ctm.slice());
    else if (op === "Q") ctm = gStack.pop() ?? identity();
    else if (op === "cm" && operands.length >= 6) {
      const k = operands.length - 6;
      const m = [num(operands[k]), num(operands[k + 1]), num(operands[k + 2]), num(operands[k + 3]), num(operands[k + 4]), num(operands[k + 5])];
      ctm = mul(m, ctm);
    } else if (op === "BT") {
      inText = true; tm = identity(); tlm = identity();
    } else if (op === "ET") {
      inText = false;
    } else if (inText) {
      if (op === "Tm" && operands.length >= 6) {
        const k = operands.length - 6;
        tm = [num(operands[k]), num(operands[k + 1]), num(operands[k + 2]), num(operands[k + 3]), num(operands[k + 4]), num(operands[k + 5])];
        tlm = tm.slice();
      } else if (op === "Td" && operands.length >= 2) {
        const k = operands.length - 2;
        const m = [1, 0, 0, 1, num(operands[k]), num(operands[k + 1])];
        tlm = mul(m, tlm);
        tm = tlm.slice();
      } else if (op === "TD" && operands.length >= 2) {
        const k = operands.length - 2;
        const tx2 = num(operands[k]), ty2 = num(operands[k + 1]);
        tLeading = -ty2;
        const m = [1, 0, 0, 1, tx2, ty2];
        tlm = mul(m, tlm);
        tm = tlm.slice();
      } else if (op === "T*") {
        const m = [1, 0, 0, 1, 0, -tLeading];
        tlm = mul(m, tlm);
        tm = tlm.slice();
      } else if (op === "TL" && operands.length >= 1) {
        tLeading = num(operands[operands.length - 1]);
      } else if (op === "'" || op === '"') {
        const m = [1, 0, 0, 1, 0, -tLeading];
        tlm = mul(m, tlm);
        tm = tlm.slice();
      }
    }

    // ── Emit ──
    const groupStart = operands.length ? operands[0].start : tk.start;
    const opEnd = tk.end;

    if (drop) {
      if (groupStart > cursor) chunks.push(text.slice(cursor, groupStart));
      cursor = opEnd;
      mutated = true;
      if (TEXT_SHOW_OPS.has(op)) {
        stats.textOpsDropped = (stats.textOpsDropped ?? 0) + 1;
        if (rewriteMatchedTarget) stats.textTargetsMatched = (stats.textTargetsMatched ?? 0) + 1;
      }
    } else if (replaceOperand) {
      const t = replaceOperand.token;
      if (t.start > cursor) chunks.push(text.slice(cursor, t.start));
      chunks.push("(" + encodeLiteral(replaceOperand.value) + ")");
      chunks.push(text.slice(t.end, opEnd));
      cursor = opEnd;
      mutated = true;
      stats.textOperandsRewritten = (stats.textOperandsRewritten ?? 0) + 1;
      if (rewriteMatchedTarget) stats.textTargetsMatched = (stats.textTargetsMatched ?? 0) + 1;
    } else if (replaceTjLiteral !== null) {
      const last = operands[operands.length - 1];
      if (last.start > cursor) chunks.push(text.slice(cursor, last.start));
      chunks.push("(" + encodeLiteral(replaceTjLiteral) + ")");
      chunks.push(text.slice(last.end, opEnd));
      cursor = opEnd;
      mutated = true;
    } else {
      chunks.push(text.slice(cursor, opEnd));
      cursor = opEnd;
    }
    operands = [];
  }
  if (cursor < text.length) chunks.push(text.slice(cursor));

  return { text: chunks.join(""), mutated, stats };
}

function decodeStringToken(text: string, tok: Tok | undefined): string | null {
  if (!tok) return null;
  if (tok.kind === "str") return decodeLiteral(text.slice(tok.start + 1, tok.end - 1));
  if (tok.kind === "hexstr") return decodeHexString(text.slice(tok.start + 1, tok.end - 1));
  return null;
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.slice(i, i + 2).padEnd(2, "0");
    const n = Number.parseInt(pair, 16);
    if (Number.isFinite(n)) bytes.push(n);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return out;
  }
  return bytes.map((b) => String.fromCharCode(b)).join("");
}

function collectArrayOperand(text: string, operands: Tok[]): { token: Tok; value: string } | null {
  let start = -1;
  for (let i = operands.length - 1; i >= 0; i--) {
    if (operands[i].kind === "lbrack") { start = i; break; }
  }
  if (start < 0 || operands[operands.length - 1]?.kind !== "rbrack") return null;
  let value = "";
  for (let i = start + 1; i < operands.length - 1; i++) {
    const decoded = decodeStringToken(text, operands[i]);
    if (decoded !== null) value += decoded;
  }
  return { token: { kind: "str", start: operands[start].start, end: operands[operands.length - 1].end }, value };
}

function redactTextValue(
  value: string,
  targets: RedactTextTarget[],
  fallback: Set<string>,
): { value: string; matched: boolean } {
  let next = value;
  let matched = false;
  for (const t of targets) {
    const sensitive = t.text || t.original;
    if (!sensitive) continue;
    if (next.includes(sensitive)) {
      next = next.split(sensitive).join("");
      matched = true;
      continue;
    }
    if (t.original && next === value && t.original === value && Number.isFinite(t.start) && Number.isFinite(t.length)) {
      const start = Math.max(0, Math.min(value.length, t.start ?? 0));
      const end = Math.max(start, Math.min(value.length, start + (t.length ?? sensitive.length)));
      next = next.slice(0, start) + next.slice(end);
      matched = true;
    }
  }
  for (const s of fallback) {
    if (!s) continue;
    if (next === s) { next = ""; matched = true; }
    else if (next.includes(s)) { next = next.split(s).join(""); matched = true; }
  }
  return { value: next, matched };
}
