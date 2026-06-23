// PDF → Word (DOCX) conversion. Pure on-device: pdfjs reads the source,
// docx builds the output, everything stays in the browser.
//
// Three modes:
//   - "flow":     continuous text with bold/italic detection + inline images
//   - "page":     same as flow, plus page breaks + "Page N" labels
//   - "fidelity": render every page as a high-res image (preserves layout
//                 exactly — best for complex/visual PDFs, not editable text)

import { loadPdfjs } from "@/lib/pdf/worker";

export type ToWordMode = "flow" | "page" | "fidelity";

export interface ToWordOptions {
  mode?: ToWordMode;
  onProgress?: (pct: number) => void;
}

type StyledItem = {
  str: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  italic: boolean;
  hasEOL: boolean;
};

type StyledLine = {
  y: number;
  size: number;
  parts: { x: number; str: string; bold: boolean; italic: boolean; size: number }[];
};

function isBoldFont(name: string): boolean {
  return /bold|black|heavy|semibold|demibold/i.test(name);
}
function isItalicFont(name: string): boolean {
  return /italic|oblique/i.test(name);
}

function groupStyledLines(items: StyledItem[]): StyledLine[] {
  const rows: StyledLine[] = [];
  for (const it of items) {
    if (!it.str) continue;
    let row = rows.find((r) => Math.abs(r.y - it.y) < Math.max(2, it.size * 0.4));
    if (!row) {
      row = { y: it.y, size: it.size, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x: it.x, str: it.str, bold: it.bold, italic: it.italic, size: it.size });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.parts.sort((a, b) => a.x - b.x);
  return rows;
}

// Extract embedded raster images for a page. Returns PNG bytes + display size.
async function extractPageImages(
  page: any,
): Promise<{ data: Uint8Array; width: number; height: number }[]> {
  const out: { data: Uint8Array; width: number; height: number }[] = [];
  let ops: any;
  try {
    ops = await page.getOperatorList();
  } catch {
    return out;
  }
  const pdfjs = await loadPdfjs();
  const OPS = (pdfjs as any).OPS;
  const imageOps = new Set([
    OPS.paintImageXObject,
    OPS.paintJpegXObject,
    OPS.paintImageXObjectRepeat,
  ]);

  const names: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (imageOps.has(ops.fnArray[i])) {
      const name = ops.argsArray[i]?.[0];
      if (typeof name === "string" && !names.includes(name)) names.push(name);
    }
  }

  for (const name of names) {
    try {
      const img: any = await new Promise((resolve, reject) => {
        try {
          page.objs.get(name, (o: any) => resolve(o));
        } catch (e) {
          reject(e);
        }
      });
      if (!img) continue;
      const w = img.width;
      const h = img.height;
      if (!w || !h) continue;
      // img.bitmap (ImageBitmap) or img.data (raw bytes). Draw to canvas → PNG.
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      if (img.bitmap) {
        ctx.drawImage(img.bitmap, 0, 0);
      } else if (img.data) {
        const imageData = ctx.createImageData(w, h);
        const src = img.data as Uint8ClampedArray | Uint8Array;
        // pdfjs may return RGB; expand to RGBA.
        if (src.length === w * h * 4) {
          imageData.data.set(src);
        } else if (src.length === w * h * 3) {
          for (let p = 0, q = 0; p < src.length; p += 3, q += 4) {
            imageData.data[q] = src[p];
            imageData.data[q + 1] = src[p + 1];
            imageData.data[q + 2] = src[p + 2];
            imageData.data[q + 3] = 255;
          }
        } else {
          continue;
        }
        ctx.putImageData(imageData, 0, 0);
      } else {
        continue;
      }
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/png"),
      );
      if (!blob) continue;
      const buf = new Uint8Array(await blob.arrayBuffer());
      out.push({ data: buf, width: w, height: h });
    } catch {
      // skip unresolved/inline-mask images
    }
  }
  return out;
}

// Render the whole page to a PNG (used in "fidelity" mode).
async function renderPageToPng(
  page: any,
  scale = 2,
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/png"),
  );
  if (!blob) return null;
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function convertPdfToWordBlob(
  file: File,
  options: ToWordOptions = {},
): Promise<Blob> {
  const mode: ToWordMode = options.mode ?? "flow";
  const onProgress = options.onProgress;

  const pdfjs = await loadPdfjs();
  const { Document, Packer, Paragraph, TextRun, PageBreak, HeadingLevel, ImageRun, AlignmentType } =
    await import("docx");
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  const allChildren: any[] = [];

  // Target content width ≈ 6.5in = 624pt for default Letter w/ 1in margins.
  const MAX_IMG_W_PT = 468; // 6.5in × 72

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);

    if (i > 1 && (mode === "page" || mode === "fidelity")) {
      allChildren.push(new Paragraph({ children: [new PageBreak()] }));
    }

    if (mode === "page") {
      allChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: `Page ${i}`, bold: true, color: "888888" })],
        }),
      );
    }

    if (mode === "fidelity") {
      const png = await renderPageToPng(page, 2);
      if (png) {
        const viewport = page.getViewport({ scale: 1 });
        const ratio = png.height / png.width;
        const wPt = Math.min(MAX_IMG_W_PT, viewport.width);
        const hPt = wPt * ratio;
        allChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: "png",
                data: png.data,
                transformation: { width: wPt, height: hPt },
              } as any),
            ],
          }),
        );
      }
      onProgress?.(Math.round((i / doc.numPages) * 100));
      continue;
    }

    // Text + inline images for "flow" / "page" modes.
    const content = await page.getTextContent();
    const styles: Record<string, any> = (content as any).styles ?? {};
    const items: StyledItem[] = (content.items as any[])
      .filter((it) => it && typeof it.str === "string")
      .map((it) => {
        const tr = it.transform as number[];
        const fontName: string = it.fontName ?? "";
        const styleEntry = styles[fontName] ?? {};
        const familyName: string = styleEntry.fontFamily ?? "";
        const bold = isBoldFont(fontName) || isBoldFont(familyName);
        const italic = isItalicFont(fontName) || isItalicFont(familyName);
        return {
          str: it.str,
          x: tr[4],
          y: tr[5],
          size: Math.hypot(tr[2], tr[3]) || it.height || 10,
          bold,
          italic,
          hasEOL: !!it.hasEOL,
        };
      });

    const rows = groupStyledLines(items);
    for (const r of rows) {
      // Merge adjacent parts with identical style into single TextRuns.
      const runs: { text: string; bold: boolean; italic: boolean; size: number }[] = [];
      for (const p of r.parts) {
        const last = runs[runs.length - 1];
        const sized = Math.max(16, Math.min(36, Math.round(p.size * 2)));
        if (last && last.bold === p.bold && last.italic === p.italic && last.size === sized) {
          last.text += (last.text.endsWith(" ") ? "" : " ") + p.str;
        } else {
          runs.push({ text: p.str, bold: p.bold, italic: p.italic, size: sized });
        }
      }
      if (!runs.length || runs.every((r) => !r.text.trim())) {
        allChildren.push(new Paragraph({ children: [new TextRun("")] }));
        continue;
      }
      allChildren.push(
        new Paragraph({
          children: runs.map(
            (r) =>
              new TextRun({
                text: r.text.replace(/\s+/g, " "),
                bold: r.bold,
                italics: r.italic,
                size: r.size,
              }),
          ),
        }),
      );
    }

    // Append embedded images for this page (after its text).
    const images = await extractPageImages(page);
    if (images.length) {
      const viewport = page.getViewport({ scale: 1 });
      for (const img of images) {
        // Estimate display size: scale image to fit content width, preserve aspect.
        const aspect = img.height / img.width;
        // Heuristic: original size in pt ≈ image px (pdfjs returns pixel size).
        // Cap at content width.
        const wPt = Math.min(MAX_IMG_W_PT, Math.min(img.width, viewport.width));
        const hPt = wPt * aspect;
        allChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: "png",
                data: img.data,
                transformation: { width: wPt, height: hPt },
              } as any),
            ],
          }),
        );
      }
    }

    onProgress?.(Math.round((i / doc.numPages) * 100));
  }

  const docx = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [{ children: allChildren }],
  });

  return Packer.toBlob(docx);
}
