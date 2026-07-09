// Assemble the edited PDF using pdf-lib.
// - Reorders / deletes / inserts pages per PageOp list
// - Applies extra per-page rotation
// - Draws all annotations on top
//
// Coordinate convention in the editor: PDF points, top-left origin (matches
// pdf.js canvas coordinates). pdf-lib uses bottom-left origin, so each draw
// call converts: pdfY = pageHeight - (y + h).

import { PDFDocument, rgb, degrees } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
import fontkit from "@pdf-lib/fontkit";
import type { Anno, EditorDoc, ExportSettings, PageOp, RGB, WatermarkSettings } from "./types";
import { rewriteDocument, type PageRewrite } from "./text-rewrite";
import { FONT_META, loadFontBytes, type FontKey } from "./fonts";
import { importChunk } from "@/lib/chunk-import";
import { allocationFailureMessage, logAllocationFailure, logHeap } from "@/lib/memory-log";

const col = (c: RGB) => rgb(c.r, c.g, c.b);

export async function exportEditedPdf(doc: EditorDoc, settings?: ExportSettings): Promise<Uint8Array> {
  logHeap("export.worker before exportEditedPdf PDFDocument.load", {
    inputBytesMB: Math.round((doc.srcBytes.byteLength / 1024 / 1024) * 10) / 10,
    pages: doc.pages.length,
    annotations: doc.annotations.length,
  });
  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(doc.srcBytes);
  } catch (err) {
    logAllocationFailure("export.worker PDFDocument.load", err, {
      inputBytesMB: Math.round((doc.srcBytes.byteLength / 1024 / 1024) * 10) / 10,
    });
    throw new Error(allocationFailureMessage("export.worker PDFDocument.load", err));
  }
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const fonts = {
    sans: await embedStandardFont(out, "Helvetica"),
    sansBold: await embedStandardFont(out, "HelveticaBold"),
    sansItalic: await embedStandardFont(out, "HelveticaOblique"),
    sansBoldItalic: await embedStandardFont(out, "HelveticaBoldOblique"),
    serif: await embedStandardFont(out, "TimesRoman"),
    serifBold: await embedStandardFont(out, "TimesRomanBold"),
    serifItalic: await embedStandardFont(out, "TimesRomanItalic"),
    serifBoldItalic: await embedStandardFont(out, "TimesRomanBoldItalic"),
    mono: await embedStandardFont(out, "Courier"),
    monoBold: await embedStandardFont(out, "CourierBold"),
    monoItalic: await embedStandardFont(out, "CourierOblique"),
    monoBoldItalic: await embedStandardFont(out, "CourierBoldOblique"),
  };
  const font = fonts.sans;

  // Lazy-embed any bundled metric-compatible open fonts referenced by
  // text-edit annotations. Keyed by `${fontKey}|b|i` to dedupe per variant.
  const bundledFonts = new Map<string, import("pdf-lib").PDFFont>();
  const ensureBundled = async (key: FontKey, bold: boolean, italic: boolean) => {
    if (!FONT_META[key]) return undefined;
    const cacheKey = `${key}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
    let f = bundledFonts.get(cacheKey);
    if (f) return f;
    try {
      const bytes = await loadFontBytes(key, bold, italic);
      f = await out.embedFont(bytes, { subset: true });
      bundledFonts.set(cacheKey, f);
      return f;
    } catch {
      return undefined;
    }
  };
  for (const a of doc.annotations) {
    if (a.kind === "text-edit" && a.fontKey) {
      const numericWeight = typeof a.fontWeight === "number" ? a.fontWeight : Number.parseInt(`${a.fontWeight ?? ""}`, 10);
      await ensureBundled(a.fontKey as FontKey, !!a.bold || (Number.isFinite(numericWeight) && numericWeight >= 600), !!a.italic);
    }
  }

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

  // Batch-copy ALL source pages in a single copyPages() call.
  // pdf-lib only dedupes shared resources (fonts, images, XObjects) WITHIN
  // one call — calling copyPages once per page in a 3000-page loop
  // duplicates every shared resource 3000×, inflating an 18MB source to
  // 1.3GB. Batching keeps peak output size proportional to the source.
  const srcIndices: number[] = [];
  const srcSlot: number[] = []; // parallel array: doc.pages[i] -> position in copiedPages
  for (let i = 0; i < doc.pages.length; i++) {
    if (!doc.pages[i].blank) {
      srcSlot[i] = srcIndices.length;
      srcIndices.push(doc.pages[i].srcPage);
    } else {
      srcSlot[i] = -1;
    }
  }
  logHeap("export.worker before batch copyPages", {
    pagesToCopy: srcIndices.length,
    totalPages: doc.pages.length,
  });
  const copiedPages = srcIndices.length
    ? await out.copyPages(srcDoc, srcIndices)
    : [];

  // Add pages in working order
  for (let i = 0; i < doc.pages.length; i++) {
    // Yield to the event loop every 25 pages so a thousands-of-pages
    // export doesn't freeze the main thread while pdf-lib assembles pages.
    if (i > 0 && i % 25 === 0) await new Promise<void>((r) => setTimeout(r, 0));
    const op = doc.pages[i];
    let outPage;
    if (op.blank) {
      outPage = out.addPage([op.width, op.height]);
    } else {
      const copied = copiedPages[srcSlot[i]];
      // Apply additional rotation on top of any source rotation
      if (op.rotation !== 0) {
        const cur = copied.getRotation().angle;
        copied.setRotation(degrees((cur + op.rotation) % 360));
      }
      outPage = out.addPage(copied);
    }

    const { width: pw, height: ph } = outPage.getSize();
    const annos = doc.annotations.filter((a) => a.page === i);
    for (const a of annos) drawAnno(outPage, a, font, pw, ph, imageCache, fonts, bundledFonts);

    // Embed OCR sidecar tokens as invisible text (rendering mode 3 via
    // opacity:0). Tied to source page so reorder/rotate respects them.
    if (!op.blank && doc.ocrLayer) {
      const layer = doc.ocrLayer.find((p) => p.srcPage === op.srcPage);
      if (layer) {
        for (const t of layer.tokens) {
          if (!t.text || t.w <= 0 || t.h <= 0) continue;
          const size = Math.max(4, t.h * 0.95);
          const measured = font.widthOfTextAtSize(t.text, size) || t.w;
          const adj = measured > 0 ? size * Math.min(1.6, Math.max(0.4, t.w / measured)) : size;
          outPage.drawText(t.text, {
            x: t.x,
            y: ph - (t.y + t.h),
            size: adj,
            font,
            color: rgb(0, 0, 0),
            opacity: 0,
          });
        }
      }
    }

    // Watermark (drawn on top of annotations so it is visible)
    if (settings?.watermark && settings.watermark.text.trim()) {
      drawWatermark(outPage, settings.watermark, font, pw, ph);
    }

    // Page crop — convert top-left rect to PDF bottom-left, set CropBox + MediaBox.
    if (op.cropBox && !op.blank) {
      const r = op.cropBox;
      const x = Math.max(0, Math.min(r.x, pw));
      const w = Math.max(1, Math.min(r.w, pw - x));
      const yTop = Math.max(0, Math.min(r.y, ph));
      const h = Math.max(1, Math.min(r.h, ph - yTop));
      const y = ph - (yTop + h);
      outPage.setCropBox(x, y, w, h);
      outPage.setMediaBox(x, y, w, h);
    }

  }

  // Destructive content-stream surgery. For text-edit annotations we keep
  // string-equality replacement of Tj/' literals. For redact annotations we
  // pass the rectangle in PDF user-space (bottom-left origin) and delete
  // every text-show (Tj/TJ/'/") whose start position falls inside the box —
  // works for `(literal) Tj`, `<hex> Tj`, and `[...] TJ` uniformly because
  // the match is by glyph POSITION, not glyph bytes.
  const outPages = out.getPages();
  const rewrites = new Map<number, PageRewrite>();
  for (const a of doc.annotations) {
    if (a.kind === "text-edit" && a.source?.originalString) {
      const job = rewrites.get(a.page) ?? { edits: [], redacts: [], redactStrings: [], redactTargets: [] };
      job.edits.push({ original: a.source.originalString, replacement: a.text });
      rewrites.set(a.page, job);
    } else if (a.kind === "redact") {
      const job = rewrites.get(a.page) ?? { edits: [], redacts: [], redactStrings: [], redactTargets: [] };
      const outPage = outPages[a.page];
      if (outPage) {
        const ph = outPage.getSize().height;
        job.redacts.push({
          x1: a.x,
          y1: ph - (a.y + a.h),
          x2: a.x + a.w,
          y2: ph - a.y,
        });
      }
      if (a.sources?.length) {
        for (const s of a.sources) {
          const targetText = (s.redactText || s.originalString || "").trim();
          if (!targetText) continue;
          job.redactStrings!.push(targetText);
          if (s.originalString && s.originalString !== targetText) job.redactStrings!.push(s.originalString);
          job.redactTargets!.push({
            original: s.originalString || targetText,
            text: targetText,
            start: s.matchStart,
            length: s.matchLength,
          });
        }
      }
      rewrites.set(a.page, job);
    }
  }
  if (rewrites.size) {
    const stats = await rewriteDocument(out, rewrites);
    const expectedTargets = Array.from(rewrites.values()).reduce((n, job) => n + (job.redactTargets?.length ?? 0), 0);
    // eslint-disable-next-line no-console
    console.info("[redact] export rewrite summary", {
      pages: rewrites.size,
      boxes: doc.annotations.filter((a) => a.kind === "redact").length,
      expectedTargets,
      ...stats,
    });
  }


  logHeap("export.worker before exportEditedPdf out.save", {
    sourceBytesMB: Math.round((doc.srcBytes.byteLength / 1024 / 1024) * 10) / 10,
    outputPages: out.getPageCount(),
  });
  let bytes: Uint8Array;
  try {
    bytes = await out.save();
  } catch (err) {
    logAllocationFailure("export.worker out.save", err, {
      sourceBytesMB: Math.round((doc.srcBytes.byteLength / 1024 / 1024) * 10) / 10,
      outputPages: out.getPageCount(),
    });
    throw new Error(allocationFailureMessage("export.worker out.save", err));
  }

  // Optional encryption + permissions
  if (settings?.protect && settings.protect.userPassword) {
    const { PDFDocument: CantooPDFDocument } = await importChunk(() => import("@cantoo/pdf-lib"));
    const cantooDoc = await CantooPDFDocument.load(bytes, { ignoreEncryption: true });
    const p = settings.protect.permissions;
    await cantooDoc.encrypt({
      userPassword: settings.protect.userPassword,
      ownerPassword: settings.protect.ownerPassword || settings.protect.userPassword,
      permissions: {
        printing: p.printing ? "highResolution" : undefined,
        modifying: p.modifying,
        copying: p.copying,
        annotating: p.annotating,
        fillingForms: p.fillingForms,
        contentAccessibility: p.contentAccessibility,
        documentAssembly: p.documentAssembly,
      },
    });
    bytes = await cantooDoc.save();
  }

  return bytes;
}

function drawWatermark(
  page: import("pdf-lib").PDFPage,
  wm: WatermarkSettings,
  font: import("pdf-lib").PDFFont,
  pw: number,
  ph: number,
) {
  const tw = font.widthOfTextAtSize(wm.text, wm.size);
  const th = wm.size;
  if (wm.position === "diagonal") {
    const rot = Math.atan2(ph, pw) * (180 / Math.PI);
    page.drawText(wm.text, {
      x: pw / 2 - tw / 2, y: ph / 2 - th / 2,
      size: wm.size, font, color: col(wm.color), opacity: wm.opacity,
      rotate: degrees(rot),
    });
    return;
  }
  const x = pw / 2 - tw / 2;
  let y = ph / 2 - th / 2;
  if (wm.position === "top") y = ph - th - 36;
  else if (wm.position === "bottom") y = 36;
  page.drawText(wm.text, { x, y, size: wm.size, font, color: col(wm.color), opacity: wm.opacity });
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
  fonts: FontSet,
  bundled?: Map<string, import("pdf-lib").PDFFont>,
) {
  // Convert top-left bbox to bottom-left for pdf-lib
  const yFlip = (y: number, h: number) => ph - (y + h);

  switch (a.kind) {
    case "highlight": {
      const quads = a.quads?.length ? a.quads : [{ x: a.x, y: a.y, w: a.w, h: a.h }];
      for (const q of quads) {
        page.drawRectangle({
          x: q.x, y: yFlip(q.y, q.h), width: q.w, height: q.h,
          color: col(a.color), opacity: a.opacity,
        });
      }
      break;
    }
    case "underline": {
      const quads = a.quads?.length ? a.quads : [{ x: a.x, y: a.y, w: a.w, h: a.h }];
      for (const q of quads) {
        page.drawRectangle({
          x: q.x, y: yFlip(q.y, q.h), width: q.w, height: Math.max(0.5, a.stroke),
          color: col(a.color), opacity: a.opacity,
        });
      }
      break;
    }
    case "strikethrough": {
      const quads = a.quads?.length ? a.quads : [{ x: a.x, y: a.y, w: a.w, h: a.h }];
      for (const q of quads) {
        page.drawRectangle({
          x: q.x,
          y: yFlip(q.y, q.h) + q.h / 2 - Math.max(0.5, a.stroke) / 2,
          width: q.w, height: Math.max(0.5, a.stroke),
          color: col(a.color), opacity: a.opacity,
        });
      }
      break;
    }
    case "redact":
      page.drawRectangle({
        x: a.x, y: yFlip(a.y, a.h), width: a.w, height: a.h,
        color: rgb(0, 0, 0), opacity: 1,
      });
      break;
    case "line":
    case "arrow": {
      const sx = a.flipX ? a.x + a.w : a.x;
      const ex = a.flipX ? a.x : a.x + a.w;
      const sy = ph - a.y;
      const ey = ph - (a.y + a.h);
      page.drawLine({
        start: { x: sx, y: sy },
        end: { x: ex, y: ey },
        color: col(a.color),
        thickness: a.stroke,
        opacity: a.opacity,
      });
      if (a.kind === "arrow") {
        const ang = Math.atan2(ey - sy, ex - sx);
        const headLen = 10 + a.stroke * 1.5;
        const sp = Math.PI / 7;
        const hx1 = ex - headLen * Math.cos(ang - sp);
        const hy1 = ey - headLen * Math.sin(ang - sp);
        const hx2 = ex - headLen * Math.cos(ang + sp);
        const hy2 = ey - headLen * Math.sin(ang + sp);
        page.drawLine({ start: { x: ex, y: ey }, end: { x: hx1, y: hy1 }, color: col(a.color), thickness: a.stroke, opacity: a.opacity });
        page.drawLine({ start: { x: ex, y: ey }, end: { x: hx2, y: hy2 }, color: col(a.color), thickness: a.stroke, opacity: a.opacity });
      }
      break;
    }
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
    case "text": {
      const tFont = pickFont(fonts, a.family ?? "sans", a.bold, a.italic);
      const align = a.align ?? "left";
      const baselineY = yFlip(a.y, a.h) + a.h - a.fontSize * 0.85;
      const lines = (a.text || "").split("\n");
      const lineH = a.fontSize * 1.15;
      lines.forEach((line, i) => {
        const tw = tFont.widthOfTextAtSize(line, a.fontSize);
        let x = a.x;
        if (align === "center") x = a.x + (a.w - tw) / 2;
        else if (align === "right") x = a.x + (a.w - tw);
        const y = baselineY - i * lineH;
        page.drawText(line, { x, y, size: a.fontSize, font: tFont, color: col(a.color), opacity: a.opacity });
        if (a.underline) {
          page.drawLine({
            start: { x, y: y - a.fontSize * 0.12 },
            end: { x: x + tw, y: y - a.fontSize * 0.12 },
            thickness: Math.max(0.5, a.fontSize * 0.06),
            color: col(a.color), opacity: a.opacity,
          });
        }
      });
      break;
    }
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
      // Cover the ORIGINAL glyph area with the sampled local background.
      // Prefer the captured `cover` bbox (fixed at capture time) over the
      // editable text box so a shrinking replacement still hides the
      // original glyphs. Expand more for bold/heavy originals so thick
      // anti-aliased strokes don't leak through.
      const c = a.cover ?? { x: a.x, y: a.y, w: a.w, h: a.h };
      const pad = a.bold ? 2 : 1;
      page.drawRectangle({
        x: c.x - pad,
        y: yFlip(c.y, c.h) - pad,
        width: c.w + pad * 2,
        height: c.h + pad * 2,
        color: col(a.bg),
      });
      const numericWeight = typeof a.fontWeight === "number" ? a.fontWeight : Number.parseInt(`${a.fontWeight ?? ""}`, 10);
      const exportBold = a.bold || (Number.isFinite(numericWeight) && numericWeight >= 600);
      const bundledKey = a.fontKey ? `${a.fontKey}|${exportBold ? 1 : 0}|${a.italic ? 1 : 0}` : "";
      const useFont = (bundledKey && bundled?.get(bundledKey)) || pickFont(fonts, a.family ?? "sans", exportBold, a.italic);
      const align = a.align ?? "left";
      const padX = Math.max(2, a.fontSize * 0.15);
      const innerW = Math.max(0, a.w - padX * 2);
      const baselineY0 = yFlip(a.y, a.h) + a.h - (a.textOffsetY ?? 0) - a.fontSize * 0.85;
      const lineH = a.fontSize * (a.lineHeight ?? 1.15);
      const editLines = (a.text || "").split("\n");
      editLines.forEach((line, i) => {
        const tracking = a.letterSpacing ?? 0;
        const tw = useFont.widthOfTextAtSize(line, a.fontSize) + Math.max(0, line.length - 1) * tracking;
        let x = a.x + padX;
        if (align === "center") x = a.x + padX + (innerW - tw) / 2;
        else if (align === "right") x = a.x + padX + (innerW - tw);
        const y = baselineY0 - i * lineH;
        page.drawText(line, { x, y, size: a.fontSize, font: useFont, color: col(a.color) });
        if (a.underline) {
          page.drawLine({
            start: { x, y: y - a.fontSize * 0.12 },
            end: { x: x + tw, y: y - a.fontSize * 0.12 },
            thickness: Math.max(0.5, a.fontSize * 0.06),
            color: col(a.color),
          });
        }
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
