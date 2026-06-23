// Word (.docx) → PDF conversion, on-device.
// Renders the document via mammoth + html2canvas, packs into PDF pages with pdf-lib.

import { PDFDocument } from "pdf-lib";

export type WordToPdfPageSize = "letter" | "a4";

export const WORD_TO_PDF_PAGE_SIZES: Record<
  WordToPdfPageSize,
  { w: number; h: number; label: string }
> = {
  letter: { w: 612, h: 792, label: "US Letter" },
  a4: { w: 595.28, h: 841.89, label: "A4" },
};

export type WordToPdfOptions = {
  pageSize?: WordToPdfPageSize;
  onProgress?: (status: string) => void;
};

export type WordToPdfResult = { blob: Blob; pages: number };

export async function convertWordToPdfBlob(
  file: File,
  opts: WordToPdfOptions = {},
): Promise<WordToPdfResult> {
  const pageSize = opts.pageSize ?? "letter";
  const onProgress = opts.onProgress ?? (() => {});

  onProgress("Reading document…");
  const mammoth: any = await import("mammoth/mammoth.browser.js" as any);
  const arr = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: arr });

  onProgress("Rendering pages…");
  const { w: pw, h: ph } = WORD_TO_PDF_PAGE_SIZES[pageSize];
  const SCALE = 2;
  const pxWidth = Math.round(pw * (96 / 72));
  const margin = 48;
  const contentPxWidth = pxWidth - margin * 2;

  const baseCss = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    `width:${contentPxWidth}px`,
    "padding:0",
    "margin:0",
    "background:#ffffff",
    "color:#111111",
    "font-family: 'Helvetica Neue', Arial, sans-serif",
    "font-size:12pt",
    "line-height:1.45",
    "box-sizing:content-box",
  ].join(";");

  const styleHtml = `
    <style>
      .vpdf-root h1{font-size:22pt;font-weight:700;margin:0 0 10pt}
      .vpdf-root h2{font-size:17pt;font-weight:700;margin:14pt 0 8pt}
      .vpdf-root h3{font-size:13pt;font-weight:700;margin:12pt 0 6pt}
      .vpdf-root p{margin:0 0 8pt}
      .vpdf-root ul,.vpdf-root ol{margin:0 0 8pt 20pt;padding:0}
      .vpdf-root li{margin:0 0 4pt}
      .vpdf-root table{border-collapse:collapse;width:100%;margin:8pt 0;font-size:11pt}
      .vpdf-root td,.vpdf-root th{border:1px solid #999;padding:4pt 6pt;vertical-align:top}
      .vpdf-root img{max-width:100%;height:auto;display:block;margin:6pt 0}
      .vpdf-root a{color:#0a58ca;text-decoration:underline}
      .vpdf-root strong{font-weight:700}
      .vpdf-root em{font-style:italic}
      .vpdf-root blockquote{border-left:3pt solid #ccc;padding:0 10pt;margin:8pt 0;color:#444}
      .vpdf-root pre{background:#f5f5f5;padding:8pt;font-family:monospace;font-size:10pt;white-space:pre-wrap}
    </style>
  `;

  const host = document.createElement("div");
  host.style.cssText = baseCss;
  host.innerHTML = `${styleHtml}<div class="vpdf-root">${html || "<p><em>(empty document)</em></p>"}</div>`;
  document.body.appendChild(host);
  const root = host.querySelector(".vpdf-root") as HTMLElement;

  const contentPxHeight = Math.round(ph * (96 / 72)) - margin * 2;

  const blocks = Array.from(root.children) as HTMLElement[];
  const pageDivs: HTMLElement[] = [];
  let current = document.createElement("div");
  current.className = "vpdf-page";
  current.style.cssText = `width:${contentPxWidth}px;`;
  let currentHeight = 0;
  const makePage = () => {
    if (current.childNodes.length > 0) pageDivs.push(current);
    current = document.createElement("div");
    current.className = "vpdf-page";
    current.style.cssText = `width:${contentPxWidth}px;`;
    currentHeight = 0;
  };

  const packHost = document.createElement("div");
  packHost.style.cssText = baseCss;
  packHost.innerHTML = styleHtml + `<div class="vpdf-root"></div>`;
  document.body.appendChild(packHost);
  const packRoot = packHost.querySelector(".vpdf-root") as HTMLElement;

  try {
    for (const block of blocks) {
      packRoot.appendChild(block);
      const h = block.getBoundingClientRect().height;
      packRoot.removeChild(block);

      if (h > contentPxHeight) {
        if (currentHeight > 0) makePage();
        current.appendChild(block);
        makePage();
        continue;
      }
      if (currentHeight + h > contentPxHeight) makePage();
      current.appendChild(block);
      currentHeight += h;
    }
    makePage();
  } finally {
    packHost.remove();
  }

  const html2canvas = (await import("html2canvas-pro")).default;
  const pdf = await PDFDocument.create();

  try {
    for (let i = 0; i < pageDivs.length; i++) {
      onProgress(`Rendering page ${i + 1} of ${pageDivs.length}…`);
      const pageWrap = document.createElement("div");
      pageWrap.style.cssText = [
        "position:fixed",
        "left:-99999px",
        "top:0",
        `width:${pxWidth}px`,
        `height:${Math.round(ph * (96 / 72))}px`,
        `padding:${margin}px`,
        "background:#ffffff",
        "color:#111111",
        "font-family: 'Helvetica Neue', Arial, sans-serif",
        "font-size:12pt",
        "line-height:1.45",
        "box-sizing:border-box",
      ].join(";");
      pageWrap.innerHTML = styleHtml;
      const wrapRoot = document.createElement("div");
      wrapRoot.className = "vpdf-root";
      wrapRoot.appendChild(pageDivs[i]);
      pageWrap.appendChild(wrapRoot);
      document.body.appendChild(pageWrap);

      const canvas = await html2canvas(pageWrap, {
        scale: SCALE,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
      });
      pageWrap.remove();

      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const jpgBytes = await (await fetch(dataUrl)).arrayBuffer();
      const img = await pdf.embedJpg(jpgBytes);
      const page = pdf.addPage([pw, ph]);
      page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    }
  } finally {
    host.remove();
  }

  onProgress("Finalizing…");
  const bytes = await pdf.save();
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    pages: pageDivs.length,
  };
}
