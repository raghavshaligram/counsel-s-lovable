// Export annotations to PDF. Two modes:
//   - flatten: burn annotations into page content (pdf-lib draw ops)
//   - native: write real PDF annotation dictionaries (Highlight, Ink, Text,
//     FreeText, Square, Circle, Line) so other readers can edit them.
//
// We default to flatten + native together: drawn for display, with the native
// dict as the annotation object. This guarantees correct rendering everywhere
// and round-trips in Acrobat.

import {
  PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFString,
  PDFNumber, PDFHexString, PDFDict, PDFRef, degrees,
} from "pdf-lib";
import type { Annot, RGB } from "./types";

const col = (c: RGB) => rgb(c.r, c.g, c.b);

export interface ExportOpts {
  mode: "flatten" | "native" | "both";
}

export async function exportAnnotatedPdf(
  srcBytes: Uint8Array,
  annots: Annot[],
  opts: ExportOpts = { mode: "both" },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(srcBytes);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  const wantsFlatten = opts.mode === "flatten" || opts.mode === "both";
  const wantsNative = opts.mode === "native" || opts.mode === "both";

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const { width: pw, height: ph } = page.getSize();
    const ann = annots.filter((a) => a.page === pi);

    if (wantsFlatten) {
      for (const a of ann) drawAnnotation(page, a, helv, pw, ph);
    }

    if (wantsNative) {
      const annotArray = page.node.Annots()
        ?? pdf.context.obj([]) as PDFArray;
      for (const a of ann) {
        const ref = buildNativeAnnotation(pdf, a, pw, ph);
        if (ref) annotArray.push(ref);
      }
      page.node.set(PDFName.of("Annots"), annotArray);
    }
  }

  return pdf.save();
}

// ---------- flattened draw ----------

function drawAnnotation(
  page: import("pdf-lib").PDFPage,
  a: Annot,
  font: import("pdf-lib").PDFFont,
  _pw: number,
  ph: number,
) {
  const o = a.opacity;
  switch (a.kind) {
    case "highlight":
      for (const r of a.rects) {
        page.drawRectangle({
          x: r.x, y: ph - (r.y + r.h),
          width: r.w, height: r.h,
          color: col(a.color), opacity: o,
        });
      }
      return;
    case "underline":
      for (const r of a.rects) {
        page.drawRectangle({
          x: r.x, y: ph - (r.y + r.h) - 0.5,
          width: r.w, height: Math.max(1, r.h * 0.08),
          color: col(a.color), opacity: o,
        });
      }
      return;
    case "strikethrough":
      for (const r of a.rects) {
        page.drawRectangle({
          x: r.x, y: ph - (r.y + r.h / 2),
          width: r.w, height: Math.max(1, r.h * 0.08),
          color: col(a.color), opacity: o,
        });
      }
      return;
    case "rect":
      page.drawRectangle({
        x: a.x, y: ph - (a.y + a.h),
        width: a.w, height: a.h,
        borderColor: col(a.color), borderWidth: a.stroke,
        color: a.fill ? col(a.color) : undefined,
        opacity: a.fill ? o : 1,
        borderOpacity: 1,
      });
      return;
    case "ellipse":
      page.drawEllipse({
        x: a.x + a.w / 2, y: ph - (a.y + a.h / 2),
        xScale: a.w / 2, yScale: a.h / 2,
        borderColor: col(a.color), borderWidth: a.stroke,
        color: a.fill ? col(a.color) : undefined,
        opacity: a.fill ? o : 1,
      });
      return;
    case "line":
      page.drawLine({
        start: { x: a.x1, y: ph - a.y1 },
        end: { x: a.x2, y: ph - a.y2 },
        color: col(a.color), thickness: a.stroke, opacity: 1,
      });
      return;
    case "arrow": {
      page.drawLine({
        start: { x: a.x1, y: ph - a.y1 },
        end: { x: a.x2, y: ph - a.y2 },
        color: col(a.color), thickness: a.stroke,
      });
      // arrowhead
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const len = 10 + a.stroke * 2;
      const sp = Math.PI / 7;
      const tipX = a.x2, tipY = ph - a.y2;
      const lx = tipX - len * Math.cos(ang - sp);
      const ly = tipY + len * Math.sin(ang - sp);
      const rx = tipX - len * Math.cos(ang + sp);
      const ry = tipY + len * Math.sin(ang + sp);
      page.drawLine({ start: { x: tipX, y: tipY }, end: { x: lx, y: ly }, color: col(a.color), thickness: a.stroke });
      page.drawLine({ start: { x: tipX, y: tipY }, end: { x: rx, y: ry }, color: col(a.color), thickness: a.stroke });
      return;
    }
    case "ink":
      for (const stroke of a.strokes) {
        for (let i = 1; i < stroke.length; i++) {
          const p0 = stroke[i - 1], p1 = stroke[i];
          page.drawLine({
            start: { x: p0.x, y: ph - p0.y },
            end: { x: p1.x, y: ph - p1.y },
            color: col(a.color), thickness: a.stroke,
          });
        }
      }
      return;
    case "text": {
      // simple wrap
      const lines = wrapText(a.text, font, a.fontSize, a.w);
      let yy = a.y + a.fontSize;
      for (const line of lines) {
        page.drawText(line, {
          x: a.x + 2, y: ph - yy,
          size: a.fontSize, font, color: col(a.color),
        });
        yy += a.fontSize * 1.25;
        if (yy - a.y > a.h) break;
      }
      return;
    }
    case "note": {
      // sticky note icon — yellow square with corner fold
      const s = 18;
      page.drawRectangle({
        x: a.x, y: ph - (a.y + s),
        width: s, height: s,
        color: col(a.color), opacity: 0.9,
        borderColor: rgb(0, 0, 0), borderWidth: 0.5,
      });
      return;
    }
  }
}

function wrapText(text: string, font: import("pdf-lib").PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur + w;
    if (font.widthOfTextAtSize(test, size) > maxW - 4 && cur) {
      lines.push(cur);
      cur = w.replace(/^\s+/, "");
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.flatMap((l) => l.split("\n"));
}

// ---------- native PDF annotation dicts ----------

function rgbArray(pdf: PDFDocument, c: RGB): PDFArray {
  const a = pdf.context.obj([]) as PDFArray;
  a.push(PDFNumber.of(c.r));
  a.push(PDFNumber.of(c.g));
  a.push(PDFNumber.of(c.b));
  return a;
}

function buildNativeAnnotation(pdf: PDFDocument, a: Annot, _pw: number, ph: number): PDFRef | null {
  const ctx = pdf.context;
  const base: Record<string, any> = {
    Type: "Annot",
    CA: a.opacity,
    NM: PDFString.of(a.id),
    M: PDFString.of(new Date(a.createdAt).toISOString()),
    T: PDFString.of(a.author ?? "VaultPDF"),
  };
  if (a.contents) base.Contents = PDFHexString.fromText(a.contents);

  let dict: PDFDict | null = null;

  switch (a.kind) {
    case "highlight":
    case "underline":
    case "strikethrough": {
      if (!a.rects.length) return null;
      const subtype = a.kind === "highlight" ? "Highlight" : a.kind === "underline" ? "Underline" : "StrikeOut";
      // QuadPoints: each rect → 8 numbers (TL, TR, BL, BR) in PDF coords (bottom-left origin)
      const qp = ctx.obj([]) as PDFArray;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of a.rects) {
        const x1 = r.x, x2 = r.x + r.w;
        const y1 = ph - (r.y + r.h), y2 = ph - r.y;
        qp.push(PDFNumber.of(x1)); qp.push(PDFNumber.of(y2));
        qp.push(PDFNumber.of(x2)); qp.push(PDFNumber.of(y2));
        qp.push(PDFNumber.of(x1)); qp.push(PDFNumber.of(y1));
        qp.push(PDFNumber.of(x2)); qp.push(PDFNumber.of(y1));
        minX = Math.min(minX, x1); maxX = Math.max(maxX, x2);
        minY = Math.min(minY, y1); maxY = Math.max(maxY, y2);
      }
      const rect = ctx.obj([minX, minY, maxX, maxY]) as PDFArray;
      dict = ctx.obj({ ...base, Subtype: subtype, Rect: rect, QuadPoints: qp, C: rgbArray(pdf, a.color) }) as PDFDict;
      break;
    }
    case "rect":
    case "ellipse": {
      const x1 = a.x, x2 = a.x + a.w;
      const y1 = ph - (a.y + a.h), y2 = ph - a.y;
      const rect = ctx.obj([x1, y1, x2, y2]) as PDFArray;
      dict = ctx.obj({
        ...base,
        Subtype: a.kind === "rect" ? "Square" : "Circle",
        Rect: rect,
        C: rgbArray(pdf, a.color),
        BS: ctx.obj({ W: a.stroke }),
      }) as PDFDict;
      break;
    }
    case "line":
    case "arrow": {
      const ly1 = ph - a.y1, ly2 = ph - a.y2;
      const rect = ctx.obj([
        Math.min(a.x1, a.x2) - 10, Math.min(ly1, ly2) - 10,
        Math.max(a.x1, a.x2) + 10, Math.max(ly1, ly2) + 10,
      ]) as PDFArray;
      const fields: Record<string, any> = {
        ...base, Subtype: "Line", Rect: rect,
        L: ctx.obj([a.x1, ly1, a.x2, ly2]),
        C: rgbArray(pdf, a.color),
        BS: ctx.obj({ W: a.stroke }),
      };
      if (a.kind === "arrow") fields.LE = ctx.obj(["None", "ClosedArrow"]);
      dict = ctx.obj(fields) as PDFDict;
      break;
    }
    case "ink": {
      const inkList = ctx.obj([]) as PDFArray;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const stroke of a.strokes) {
        const arr = ctx.obj([]) as PDFArray;
        for (const p of stroke) {
          const py = ph - p.y;
          arr.push(PDFNumber.of(p.x));
          arr.push(PDFNumber.of(py));
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
        inkList.push(arr);
      }
      const rect = ctx.obj([minX - 5, minY - 5, maxX + 5, maxY + 5]) as PDFArray;
      dict = ctx.obj({
        ...base, Subtype: "Ink", Rect: rect, InkList: inkList,
        C: rgbArray(pdf, a.color),
        BS: ctx.obj({ W: a.stroke }),
      }) as PDFDict;
      break;
    }
    case "note": {
      const s = 18;
      const rect = ctx.obj([a.x, ph - (a.y + s), a.x + s, ph - a.y]) as PDFArray;
      dict = ctx.obj({
        ...base, Subtype: "Text", Rect: rect, Name: "Note",
        C: rgbArray(pdf, a.color), Open: false,
      }) as PDFDict;
      break;
    }
    case "text": {
      const rect = ctx.obj([a.x, ph - (a.y + a.h), a.x + a.w, ph - a.y]) as PDFArray;
      const da = `/Helv ${a.fontSize} Tf ${a.color.r} ${a.color.g} ${a.color.b} rg`;
      dict = ctx.obj({
        ...base, Subtype: "FreeText", Rect: rect,
        Contents: PDFHexString.fromText(a.text),
        DA: PDFString.of(da),
        Q: 0,
      }) as PDFDict;
      break;
    }
  }

  if (!dict) return null;
  return ctx.register(dict);
}

// ---------- export comments ----------

export function exportCommentsJson(annots: Annot[], fileName: string): string {
  const items = annots.map((a) => ({
    id: a.id,
    page: a.page + 1,
    type: a.kind,
    contents: a.contents ?? null,
    selectedText: "rects" in a ? a.selectedText ?? null : null,
    text: "text" in a ? a.text : null,
    color: a.color,
    createdAt: new Date(a.createdAt).toISOString(),
    author: a.author ?? "VaultPDF",
    replies: a.replies ?? [],
  }));
  return JSON.stringify({ file: fileName, exportedAt: new Date().toISOString(), comments: items }, null, 2);
}

// ---------- import existing annotations (best-effort) ----------

export async function importNativeAnnots(srcBytes: Uint8Array): Promise<Annot[]> {
  try {
    const pdf = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pages = pdf.getPages();
    const out: Annot[] = [];
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      const ph = page.getHeight();
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        const dict = pdf.context.lookup(ref) as PDFDict | undefined;
        if (!dict || !(dict instanceof PDFDict)) continue;
        const subtype = dict.lookup(PDFName.of("Subtype"));
        const st = subtype?.toString().replace("/", "");
        const id = (dict.lookup(PDFName.of("NM")) as PDFString | undefined)?.decodeText() ?? Math.random().toString(36).slice(2);
        const contents = (dict.lookup(PDFName.of("Contents")) as PDFString | undefined)?.decodeText?.();
        const cArr = dict.lookup(PDFName.of("C")) as PDFArray | undefined;
        const color = cArr && cArr.size() >= 3
          ? { r: (cArr.get(0) as PDFNumber).asNumber(), g: (cArr.get(1) as PDFNumber).asNumber(), b: (cArr.get(2) as PDFNumber).asNumber() }
          : { r: 1, g: 0.93, b: 0.27 };
        const base = { id, page: pi, color, opacity: 0.5, createdAt: Date.now(), contents };

        if (st === "Highlight" || st === "Underline" || st === "StrikeOut") {
          const qp = dict.lookup(PDFName.of("QuadPoints")) as PDFArray | undefined;
          if (!qp) continue;
          const rects: { x: number; y: number; w: number; h: number }[] = [];
          for (let q = 0; q < qp.size(); q += 8) {
            const x1 = (qp.get(q) as PDFNumber).asNumber();
            const y1 = (qp.get(q + 1) as PDFNumber).asNumber();
            const x4 = (qp.get(q + 6) as PDFNumber).asNumber();
            const y4 = (qp.get(q + 7) as PDFNumber).asNumber();
            rects.push({ x: Math.min(x1, x4), y: ph - Math.max(y1, y4), w: Math.abs(x4 - x1), h: Math.abs(y1 - y4) });
          }
          out.push({ ...base, kind: st === "Highlight" ? "highlight" : st === "Underline" ? "underline" : "strikethrough", rects });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
