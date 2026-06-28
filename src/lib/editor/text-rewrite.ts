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

  const fonts = collectPageFonts(page);
  for (const stream of streams) addStats(stats, rewriteStream(stream, job, fonts));
  return stats;
}

function rewriteStream(
  stream: import("pdf-lib").PDFRawStream,
  job: PageRewrite,
  fonts: Map<string, FontMetrics>,
): RewriteStats {
  const stats = emptyStats();
  stats.streamsVisited = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = stream;
  const dict = s.dict;
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

  try {
    bytes = decodeContentBytes(bytes, filterNames);
  } catch {
    stats.skippedStreams = 1;
    return stats;
  }

  // latin1 decode — operators are ASCII; non-ASCII bytes only appear inside
  // string/hex operands and we treat operand bytes opaquely on rewrite.
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);

  const result = surgicalRewrite(text, job, fonts);
  if (!result.mutated) return stats;

  let newBytes = new Uint8Array(result.text.length);
  for (let n = 0; n < result.text.length; n++) newBytes[n] = result.text.charCodeAt(n) & 0xff;

  // Normalize supported input filters to FlateDecode after mutation. This is
  // safe for content streams and avoids needing a binary-exact ASCII85 encoder.
  try { newBytes = zlibSync(newBytes); } catch { stats.skippedStreams = 1; return stats; }
  s.contents = newBytes;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lenKey = PDFName.of("Length");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dict.set?.(lenKey, (dict.context as any).obj(newBytes.length));
    dict.set?.(PDFName.of("Filter"), PDFName.of("FlateDecode"));
    dict.delete?.(PDFName.of("DecodeParms"));
  } catch { /* pdf-lib will recompute on save */ }
  stats.streamsMutated = 1;
  addStats(stats, result.stats);
  return stats;
}

function decodeContentBytes(bytes: Uint8Array, filters: string[]): Uint8Array {
  let out = bytes;
  for (const raw of filters) {
    const f = raw.replace(/^\//, "");
    if (f === "FlateDecode" || f === "Fl") {
      out = unzlibSync(out);
    } else if (f === "ASCII85Decode" || f === "A85") {
      out = ascii85Decode(out);
    } else if (!f) {
      continue;
    } else {
      throw new Error(`Unsupported content stream filter: ${f}`);
    }
  }
  return out;
}

function ascii85Decode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let tuple: number[] = [];
  const flush = (final = false) => {
    if (tuple.length === 0) return;
    const actual = tuple.length;
    if (final) while (tuple.length < 5) tuple.push(84); // 'u'
    if (tuple.length < 5) return;
    let value = 0;
    for (const n of tuple) value = value * 85 + n;
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    out.push(...bytes.slice(0, final ? Math.max(0, actual - 1) : 4));
    tuple = [];
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === 0x25) { while (i < input.length && input[i] !== 0x0a && input[i] !== 0x0d) i++; continue; }
    if (c <= 0x20) continue;
    if (c === 0x7e && input[i + 1] === 0x3e) { flush(true); break; }
    if (c === 0x7a && tuple.length === 0) { out.push(0, 0, 0, 0); continue; }
    if (c < 33 || c > 117) continue;
    tuple.push(c - 33);
    if (tuple.length === 5) flush(false);
  }
  flush(true);
  return new Uint8Array(out);
}

function collectPageFonts(page: import("pdf-lib").PDFPage): Map<string, FontMetrics> {
  const fonts = new Map<string, FontMetrics>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node: any = page.node;
    const entries = typeof node.normalizedEntries === "function" ? node.normalizedEntries() : null;
    const fontDict = entries?.Font ?? node.Resources?.()?.lookup?.(PDFName.of("Font"));
    if (!fontDict || typeof fontDict.entries !== "function") return fonts;
    for (const [name, obj] of fontDict.entries() as Array<[unknown, unknown]>) {
      const key = String(name).replace(/^\//, "");
      const dict = lookupDict(page.doc.context, obj);
      if (dict) fonts.set(key, readFontMetrics(page.doc.context, dict));
    }
  } catch {
    /* best effort; caller falls back to default metrics */
  }
  return fonts;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lookupDict(ctx: any, obj: unknown): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolved: any = obj && typeof (obj as any).entries === "function" ? obj : ctx.lookup(obj as never);
    return resolved && typeof resolved.entries === "function" ? resolved : null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readFontMetrics(ctx: any, font: any): FontMetrics {
  const subtype = nameValue(font.get?.(PDFName.of("Subtype")));
  if (subtype === "Type0") {
    const descendants = font.lookup?.(PDFName.of("DescendantFonts"));
    const cid = descendants?.lookup?.(0) ?? descendants?.asArray?.()[0];
    const cidDict = lookupDict(ctx, cid) ?? font;
    return readCidMetrics(cidDict);
  }
  return readSimpleMetrics(font);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readSimpleMetrics(font: any): FontMetrics {
  const firstChar = numObj(font.get?.(PDFName.of("FirstChar"))) ?? 0;
  const widths = new Map<number, number>();
  const arr = font.lookup?.(PDFName.of("Widths"));
  const values = typeof arr?.asArray === "function" ? arr.asArray() : [];
  for (let i = 0; i < values.length; i++) widths.set(firstChar + i, numObj(values[i]) ?? 500);
  const fd = lookupDict(font.context, font.get?.(PDFName.of("FontDescriptor")));
  const missingWidth = numObj(fd?.get?.(PDFName.of("MissingWidth"))) ?? 500;
  return { widths, defaultWidth: 500, missingWidth, firstChar, codeSize: 1 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readCidMetrics(font: any): FontMetrics {
  const widths = new Map<number, number>();
  const defaultWidth = numObj(font.get?.(PDFName.of("DW"))) ?? 1000;
  const wArr = font.lookup?.(PDFName.of("W"));
  const values = typeof wArr?.asArray === "function" ? wArr.asArray() : [];
  for (let i = 0; i < values.length;) {
    const first = numObj(values[i++]);
    if (first === undefined || i >= values.length) break;
    const next = values[i++];
    if (typeof next?.asArray === "function") {
      const ws = next.asArray();
      for (let j = 0; j < ws.length; j++) widths.set(first + j, numObj(ws[j]) ?? defaultWidth);
    } else {
      const last = numObj(next);
      const width = numObj(values[i++]);
      if (last === undefined || width === undefined) break;
      for (let c = first; c <= last; c++) widths.set(c, width);
    }
  }
  const fd = lookupDict(font.context, font.get?.(PDFName.of("FontDescriptor")));
  const missingWidth = numObj(fd?.get?.(PDFName.of("MissingWidth"))) ?? defaultWidth;
  return { widths, defaultWidth, missingWidth, firstChar: 0, codeSize: 2 };
}

function nameValue(v: unknown): string {
  return String(v ?? "").replace(/^\//, "");
}

function numObj(v: unknown): number | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any = v as any;
  const n = typeof any?.asNumber === "function" ? any.asNumber() : typeof any?.value === "function" ? any.value() : Number(String(v));
  return Number.isFinite(n) ? n : undefined;
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
function bboxIntersectsRects(minX: number, minY: number, maxX: number, maxY: number, rects: RedactRect[]): boolean {
  for (const r of rects) {
    const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2);
    const y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2);
    if (maxX >= x1 && minX <= x2 && maxY >= y1 && minY <= y2) return true;
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

function surgicalRewrite(
  text: string,
  job: PageRewrite,
  fonts: Map<string, FontMetrics>,
): { text: string; mutated: boolean; stats: Partial<RewriteStats> } {
  const tokens = tokenize(text);
  const editMap = new Map(job.edits.map((e) => [e.original, e.replacement]));
  const rects = job.redacts;
  const stats: Partial<RewriteStats> = {};

  let ctm = identity();
  const gStack: number[][] = [];

  let inText = false;
  let tm = identity();
  let tlm = identity();
  let tLeading = 0;
  let fontName = "";
  let fontSize = 12;
  let charSpacing = 0;
  let wordSpacing = 0;
  let hScale = 100;
  let textRise = 0;

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
    let dropReplacement: string | null = null;
    let replaceTjLiteral: string | null = null;
    let showAdvance: number | null = null;
    let showBaseTm: number[] | null = null;

    if (TEXT_SHOW_OPS.has(op) && inText) {
      const measured = measureTextShow(text, operands, op, {
        ctm,
        tm,
        tlm,
        leading: tLeading,
        font: fonts.get(fontName) ?? DEFAULT_FONT,
        fontSize,
        charSpacing,
        wordSpacing,
        hScale,
        textRise,
      });
      showAdvance = measured.advance;
      showBaseTm = measured.baseTm;
      if (rects.length && measured.bbox && bboxIntersectsRects(measured.bbox.minX, measured.bbox.minY, measured.bbox.maxX, measured.bbox.maxY, rects)) {
        drop = true;
        dropReplacement = textAdvanceReplacement(text, operands, op, showAdvance, fontSize, hScale);
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
      } else if (op === "Tf" && operands.length >= 2) {
        const nameTok = operands[operands.length - 2];
        fontName = nameTok?.kind === "name" ? text.slice(nameTok.start + 1, nameTok.end) : fontName;
        fontSize = num(operands[operands.length - 1]) || fontSize;
      } else if (op === "Tc" && operands.length >= 1) {
        charSpacing = num(operands[operands.length - 1]);
      } else if (op === "Tw" && operands.length >= 1) {
        wordSpacing = num(operands[operands.length - 1]);
      } else if (op === "Tz" && operands.length >= 1) {
        hScale = num(operands[operands.length - 1]) || 100;
      } else if (op === "Ts" && operands.length >= 1) {
        textRise = num(operands[operands.length - 1]);
      } else if (op === "'" || op === '"') {
        if (op === '"' && operands.length >= 3) {
          wordSpacing = num(operands[operands.length - 3]);
          charSpacing = num(operands[operands.length - 2]);
        }
        const m = [1, 0, 0, 1, 0, -tLeading];
        tlm = mul(m, tlm);
        tm = tlm.slice();
        if (showAdvance !== null) tm = mul([1, 0, 0, 1, showAdvance, 0], tm);
      } else if ((op === "Tj" || op === "TJ") && showAdvance !== null) {
        tm = mul([1, 0, 0, 1, showAdvance, 0], showBaseTm ?? tm);
      }
    }

    // ── Emit ──
    const groupStart = operands.length ? operands[0].start : tk.start;
    const opEnd = tk.end;

    if (drop) {
      if (groupStart > cursor) chunks.push(text.slice(cursor, groupStart));
      if (dropReplacement) chunks.push(dropReplacement);
      cursor = opEnd;
      mutated = true;
      if (TEXT_SHOW_OPS.has(op)) {
        stats.textOpsDropped = (stats.textOpsDropped ?? 0) + 1;
        stats.textTargetsMatched = (stats.textTargetsMatched ?? 0) + 1;
      }
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

function measureTextShow(
  text: string,
  operands: Tok[],
  op: string,
  state: {
    ctm: number[];
    tm: number[];
    tlm: number[];
    leading: number;
    font: FontMetrics;
    fontSize: number;
    charSpacing: number;
    wordSpacing: number;
    hScale: number;
    textRise: number;
  },
): { advance: number; baseTm: number[]; bbox: { minX: number; minY: number; maxX: number; maxY: number } | null } {
  let baseTm = state.tm.slice();
  let charSpacing = state.charSpacing;
  let wordSpacing = state.wordSpacing;
  let tokens: Tok[] = [];
  let tjAdjust = 0;

  if (op === "'" || op === '"') {
    baseTm = mul([1, 0, 0, 1, 0, -state.leading], state.tlm);
    if (op === '"' && operands.length >= 3) {
      wordSpacing = parseFloat(text.slice(operands[operands.length - 3].start, operands[operands.length - 3].end)) || 0;
      charSpacing = parseFloat(text.slice(operands[operands.length - 2].start, operands[operands.length - 2].end)) || 0;
    }
    tokens = operands.length ? [operands[operands.length - 1]] : [];
  } else if (op === "Tj") {
    tokens = operands.length ? [operands[operands.length - 1]] : [];
  } else if (op === "TJ") {
    const arr = arrayOperandTokens(operands);
    tokens = arr.filter((t) => t.kind === "str" || t.kind === "hexstr");
    for (const t of arr) if (t.kind === "num") tjAdjust += parseFloat(text.slice(t.start, t.end)) || 0;
  }

  const bytes = tokens.flatMap((t) => stringTokenBytes(text, t));
  if (bytes.length === 0) return { advance: 0, baseTm, bbox: null };
  const fontSize = Math.max(Math.abs(state.fontSize) || 12, 0.1);
  const scale = (state.hScale || 100) / 100;
  const design = glyphDesignWidth(bytes, state.font);
  const codeCount = Math.max(1, countGlyphCodes(bytes, state.font));
  const spaces = countSpaceCodes(bytes, state.font);
  const spacing = codeCount * charSpacing + spaces * wordSpacing;
  const advance = ((design / 1000) * fontSize + spacing - (tjAdjust / 1000) * fontSize) * scale;
  const widthEm = Math.max(Math.abs(advance) / Math.max(fontSize * Math.abs(scale), 0.1), design / 1000, 0.05);
  const heightEm = 1.2;
  const riseEm = state.textRise / fontSize;
  const trm = mul([fontSize * scale, 0, 0, fontSize, 0, state.textRise], mul(baseTm, state.ctm));
  const corners: Array<[number, number]> = [
    [0, -0.25 + riseEm],
    [widthEm, -0.25 + riseEm],
    [widthEm, heightEm - 0.25 + riseEm],
    [0, heightEm - 0.25 + riseEm],
  ].map(([x, y]) => txp(trm, x, y));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return {
    advance,
    baseTm,
    bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}

function textAdvanceReplacement(
  text: string,
  operands: Tok[],
  op: string,
  advance: number | null,
  fontSize: number,
  hScale: number,
): string | null {
  if (advance === null || !Number.isFinite(advance)) return null;
  const denom = (Math.abs(fontSize) || 12) * ((hScale || 100) / 100);
  if (!Number.isFinite(denom) || Math.abs(denom) < 0.001) return null;
  const adjust = -advance * 1000 / denom;
  const tj = `[${fmtNum(adjust)}] TJ`;
  if (op === "Tj" || op === "TJ") return tj;
  if (op === "'") return `T* ${tj}`;
  if (op === '"' && operands.length >= 3) {
    const word = text.slice(operands[operands.length - 3].start, operands[operands.length - 3].end);
    const char = text.slice(operands[operands.length - 2].start, operands[operands.length - 2].end);
    return `${word} Tw ${char} Tc T* ${tj}`;
  }
  return null;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return s === "-0" ? "0" : s;
}

function arrayOperandTokens(operands: Tok[]): Tok[] {
  let start = -1;
  for (let i = operands.length - 1; i >= 0; i--) {
    if (operands[i].kind === "lbrack") { start = i; break; }
  }
  if (start < 0 || operands[operands.length - 1]?.kind !== "rbrack") return [];
  return operands.slice(start + 1, -1);
}

function stringTokenBytes(text: string, tok: Tok | undefined): number[] {
  if (!tok) return [];
  if (tok.kind === "str") return literalBytes(text.slice(tok.start + 1, tok.end - 1));
  if (tok.kind === "hexstr") return hexBytes(text.slice(tok.start + 1, tok.end - 1));
  return [];
}

function literalBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) & 0xff;
    if (s[i] !== "\\") { out.push(c); continue; }
    const n = s[i + 1];
    if (n === undefined) break;
    if (n === "n") { out.push(0x0a); i++; continue; }
    if (n === "r") { out.push(0x0d); i++; continue; }
    if (n === "t") { out.push(0x09); i++; continue; }
    if (n === "b") { out.push(0x08); i++; continue; }
    if (n === "f") { out.push(0x0c); i++; continue; }
    if (n >= "0" && n <= "7") {
      let oct = n;
      if (s[i + 2] >= "0" && s[i + 2] <= "7") { oct += s[i + 2]; i++; }
      if (s[i + 2] >= "0" && s[i + 2] <= "7") { oct += s[i + 2]; i++; }
      out.push(parseInt(oct, 8) & 0xff);
      i++; continue;
    }
    out.push(n.charCodeAt(0) & 0xff); i++;
  }
  return out;
}

function hexBytes(hex: string): number[] {
  const clean = hex.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const n = Number.parseInt(clean.slice(i, i + 2).padEnd(2, "0"), 16);
    if (Number.isFinite(n)) out.push(n & 0xff);
  }
  return out;
}

function glyphDesignWidth(bytes: number[], font: FontMetrics): number {
  let width = 0;
  for (const code of iterCodes(bytes, font)) width += font.widths.get(code) ?? font.missingWidth ?? font.defaultWidth;
  return width || font.defaultWidth;
}

function countGlyphCodes(bytes: number[], font: FontMetrics): number {
  let n = 0;
  for (const _ of iterCodes(bytes, font)) n++;
  return n;
}

function countSpaceCodes(bytes: number[], font: FontMetrics): number {
  let n = 0;
  for (const code of iterCodes(bytes, font)) if (code === 32) n++;
  return n;
}

function* iterCodes(bytes: number[], font: FontMetrics): Generator<number> {
  if (font.codeSize === 2) {
    for (let i = 0; i < bytes.length; i += 2) yield ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
  } else {
    for (const b of bytes) yield b;
  }
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
