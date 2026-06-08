// Assemble the edited PDF using pdf-lib.
// - Reorders / deletes / inserts pages per PageOp list
// - Applies extra per-page rotation
// - Draws all annotations on top
//
// Coordinate convention in the editor: PDF points, top-left origin (matches
// pdf.js canvas coordinates). pdf-lib uses bottom-left origin, so each draw
// call converts: pdfY = pageHeight - (y + h).

import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import type { Anno, EditorDoc, PageOp, RGB } from "./types";

const col = (c: RGB) => rgb(c.r, c.g, c.b);

export async function exportEditedPdf(doc: EditorDoc): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(doc.srcBytes);
  const out = await PDFDocument.create();
  const fonts = {
    sans: await out.embedFont(StandardFonts.Helvetica),
    sansBold: await out.embedFont(StandardFonts.HelveticaBold),
    sansItalic: await out.embedFont(StandardFonts.HelveticaOblique),
    sansBoldItalic: await out.embedFont(StandardFonts.HelveticaBoldOblique),
    serif: await out.embedFont(StandardFonts.TimesRoman),
    serifBold: await out.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await out.embedFont(StandardFonts.TimesRomanItalic),
    serifBoldItalic: await out.embedFont(StandardFonts.TimesRomanBoldItalic),
    mono: await out.embedFont(StandardFonts.Courier),
    monoBold: await out.embedFont(StandardFonts.CourierBold),
    monoItalic: await out.embedFont(StandardFonts.CourierOblique),
    monoBoldItalic: await out.embedFont(StandardFonts.CourierBoldOblique),
  };
  const font = fonts.sans;

  // Pre-embed images once, dedupe by dataUrl
  const imageCache = new Map<string, import("pdf-lib").PDFImage>();
  for (const a of doc.annotations) {
    if (a.kind !== "image" || imageCache.has(a.dataUrl)) continue;
    const bytes = dataUrlToBytes(a.dataUrl);
    const img =
      a.mime === "image/png"
        ? await out.embedPng(bytes)
        : await out.embedJpg(bytes);
    imageCache.set(a.dataUrl, img);
  }

  // Add pages in working order
  for (let i = 0; i < doc.pages.length; i++) {
    const op = doc.pages[i];
    let outPage;
    if (op.blank) {
      outPage = out.addPage([op.width, op.height]);
    } else {
      const [copied] = await out.copyPages(srcDoc, [op.srcPage]);
      // Apply additional rotation on top of any source rotation
      if (op.rotation !== 0) {
        const cur = copied.getRotation().angle;
        copied.setRotation(degrees((cur + op.rotation) % 360));
      }
      outPage = out.addPage(copied);
    }

    const { width: pw, height: ph } = outPage.getSize();
    const annos = doc.annotations.filter((a) => a.page === i);
    for (const a of annos) drawAnno(outPage, a, font, pw, ph, imageCache, fonts);
  }

  return out.save();
}

type FontSet = {
  sans: import("pdf-lib").PDFFont; sansBold: import("pdf-lib").PDFFont; sansItalic: import("pdf-lib").PDFFont; sansBoldItalic: import("pdf-lib").PDFFont;
  serif: import("pdf-lib").PDFFont; serifBold: import("pdf-lib").PDFFont; serifItalic: import("pdf-lib").PDFFont; serifBoldItalic: import("pdf-lib").PDFFont;
  mono: import("pdf-lib").PDFFont; monoBold: import("pdf-lib").PDFFont; monoItalic: import("pdf-lib").PDFFont; monoBoldItalic: import("pdf-lib").PDFFont;
};

function pickFont(fonts: FontSet, family: "sans" | "serif" | "mono", bold?: boolean, italic?: boolean): import("pdf-lib").PDFFont {
  const k = family + (bold && italic ? "BoldItalic" : bold ? "Bold" : italic ? "Italic" : "");
  return (fonts as unknown as Record<string, import("pdf-lib").PDFFont>)[k] ?? fonts.sans;
}

function drawAnno(
  page: import("pdf-lib").PDFPage,
  a: Anno,
  font: import("pdf-lib").PDFFont,
  pw: number,
  ph: number,
  imgs: Map<string, import("pdf-lib").PDFImage>,
) {
  // Convert top-left bbox to bottom-left for pdf-lib
  const yFlip = (y: number, h: number) => ph - (y + h);

  switch (a.kind) {
    case "highlight":
      page.drawRectangle({
        x: a.x,
        y: yFlip(a.y, a.h),
        width: a.w,
        height: a.h,
        color: col(a.color),
        opacity: a.opacity,
      });
      break;
    case "rect":
      page.drawRectangle({
        x: a.x,
        y: yFlip(a.y, a.h),
        width: a.w,
        height: a.h,
        borderColor: col(a.color),
        borderWidth: a.stroke,
        color: a.fill ? col(a.color) : undefined,
        opacity: a.opacity,
        borderOpacity: a.opacity,
      });
      break;
    case "ellipse":
      page.drawEllipse({
        x: a.x + a.w / 2,
        y: yFlip(a.y, a.h) + a.h / 2,
        xScale: a.w / 2,
        yScale: a.h / 2,
        borderColor: col(a.color),
        borderWidth: a.stroke,
        color: a.fill ? col(a.color) : undefined,
        opacity: a.opacity,
        borderOpacity: a.opacity,
      });
      break;
    case "text":
      page.drawText(a.text, {
        x: a.x,
        // pdf-lib draws text from baseline; nudge so the bbox top aligns visually
        y: yFlip(a.y, a.h) + a.h - a.fontSize * 0.85,
        size: a.fontSize,
        font,
        color: col(a.color),
        opacity: a.opacity,
        maxWidth: a.w,
        lineHeight: a.fontSize * 1.15,
      });
      break;
    case "freehand": {
      const cmds: string[] = [];
      a.points.forEach((p, i) => {
        const x = a.x + p.x;
        const y = ph - (a.y + p.y); // top-left → bottom-left
        cmds.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
      });
      if (cmds.length > 1) {
        page.drawSvgPath(cmds.join(" "), {
          borderColor: col(a.color),
          borderWidth: a.stroke,
          borderOpacity: a.opacity,
        });
      }
      break;
    }
    case "note": {
      // Draw a small yellow square with a tooltip-style text bubble
      page.drawRectangle({
        x: a.x,
        y: yFlip(a.y, a.h),
        width: a.w,
        height: a.h,
        color: rgb(1, 0.9, 0.3),
        borderColor: rgb(0.6, 0.5, 0),
        borderWidth: 1,
        opacity: 0.95,
      });
      page.drawText(a.text, {
        x: a.x + 4,
        y: yFlip(a.y, a.h) + a.h - 10,
        size: 8,
        font,
        color: rgb(0, 0, 0),
        maxWidth: a.w - 8,
        lineHeight: 9,
      });
      break;
    }
    case "image": {
      const img = imgs.get(a.dataUrl);
      if (!img) break;
      page.drawImage(img, {
        x: a.x,
        y: yFlip(a.y, a.h),
        width: a.w,
        height: a.h,
        opacity: a.opacity,
      });
      break;
    }
    case "text-edit": {
      // White-out over the original glyph area
      page.drawRectangle({
        x: a.x,
        y: yFlip(a.y, a.h),
        width: a.w,
        height: a.h,
        color: col(a.bg),
      });
      page.drawText(a.text, {
        x: a.x,
        y: yFlip(a.y, a.h) + a.h - a.fontSize * 0.85,
        size: a.fontSize,
        font,
        color: col(a.color),
        maxWidth: a.w,
        lineHeight: a.fontSize * 1.15,
      });
      break;
    }
  }
}

function dataUrlToBytes(url: string): Uint8Array {
  const base64 = url.split(",")[1] ?? "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function makeBlankPageOp(
  srcDoc: PDFDocument,
  refPage: number,
): Promise<PageOp> {
  const ref = srcDoc.getPages()[Math.min(refPage, srcDoc.getPageCount() - 1)];
  const { width, height } = ref.getSize();
  return { srcPage: -1, rotation: 0, blank: true, width, height };
}
