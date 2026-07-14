/**
 * Print the active PDF in place — without opening a new window or tab.
 *
 * Chromium's built-in PDF viewer loads blob: PDFs inside a cross-origin
 * child frame, so `iframe.contentWindow.print()` on a PDF iframe throws
 * `Blocked a frame with origin "…" from accessing a cross-origin frame`.
 * To avoid that, we rasterise the flattened pages with pdf.js into JPEG
 * data URLs, build a same-origin HTML document with one <img> per page,
 * load it into a hidden iframe via `srcdoc`, and call print() there. The
 * native OS print dialog appears in-place — no new window, no new tab.
 *
 * Print fidelity: the input is the already-baked PDF (edits, annotations
 * and redactions flattened by exportEditedPdf). Rasterising at print DPI
 * preserves the destroyed-content guarantee — there is no original layer
 * to leak.
 *
 * Privacy: rendering is entirely in-page. Nothing is uploaded.
 */

import { loadPdfjs } from "@/lib/pdf/worker";

export type PrintOptions = {
  /** Filename suggestion the browser may use as the print job title. */
  filename?: string;
  /** Render DPI. 150 is a good print-quality default; 96 for fast drafts. */
  dpi?: number;
};

const PT_PER_INCH = 72;

export async function printPdfBytes(
  bytes: Uint8Array | ArrayBuffer,
  opts: PrintOptions = {},
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Printing is only available in the browser.");
  }
  const dpi = Math.max(72, Math.min(300, opts.dpi ?? 150));
  const scale = dpi / PT_PER_INCH;

  // 1. Rasterise the baked PDF page-by-page.
  const pdfjs = await loadPdfjs();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const doc = await pdfjs.getDocument({ data, enableXfa: true, useSystemFonts: true }).promise;

  const pages: Array<{ dataUrl: string; widthPt: number; heightPt: number }> = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale });
      const naturalVp = page.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D unavailable for print rendering");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      pages.push({
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        widthPt: naturalVp.width,
        heightPt: naturalVp.height,
      });
      page.cleanup();
    }
  } finally {
    try {
      await doc.cleanup();
    } catch {
      /* ignore */
    }
  }

  if (pages.length === 0) {
    throw new Error("Nothing to print — the document has no pages.");
  }

  // 2. Build a same-origin HTML doc. @page must be one size, so use the
  //    first page's dimensions; mixed-size pages are object-fit:contain'd
  //    into that paper — a reasonable compromise that the browser still
  //    handles via the print dialog's "Fit to page" controls.
  const first = pages[0];
  const sizeRule = `${first.widthPt}pt ${first.heightPt}pt`;
  const title = (opts.filename ?? "Document").replace(/</g, "&lt;");
  const imgs = pages
    .map(
      (p, idx) =>
        `<div class="pg${idx < pages.length - 1 ? " brk" : ""}"><img src="${p.dataUrl}" alt="Page ${idx + 1}"/></div>`,
    )
    .join("");
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: ${sizeRule}; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  /* Each .pg is exactly one printed page. Fixed pt dimensions + overflow:hidden
     prevent sub-pixel rounding of the rasterised JPEG from spilling onto a
     blank trailing page (which doubled the page count). */
  .pg {
    width: ${first.widthPt}pt;
    height: ${first.heightPt}pt;
    overflow: hidden;
    display: block;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pg.brk { page-break-after: always; break-after: page; }
  .pg img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
</head>
<body>${imgs}</body>
</html>`;

  // 3. Inject hidden iframe, wait for images to decode, then print.
  const prior = document.getElementById("counselpdf-print-frame");
  if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

  const iframe = document.createElement("iframe");
  iframe.id = "counselpdf-print-frame";
  iframe.title = title;
  iframe.setAttribute(
    "style",
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;",
  );
  iframe.setAttribute("aria-hidden", "true");
  // srcdoc keeps the iframe same-origin to the parent — no cross-origin
  // frame restrictions when we call contentWindow.print().
  iframe.srcdoc = html;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    iframe.addEventListener(
      "load",
      async () => {
        try {
          const win = iframe.contentWindow;
          const idoc = iframe.contentDocument;
          if (!win || !idoc) throw new Error("Print frame did not initialise");

          // Wait for every image to be decoded before printing — otherwise
          // some browsers print blank pages.
          const imgEls = Array.from(idoc.images);
          await Promise.all(
            imgEls.map(
              (img) =>
                new Promise<void>((res) => {
                  if (img.complete && img.naturalWidth > 0) return res();
                  img.addEventListener("load", () => res(), { once: true });
                  img.addEventListener("error", () => res(), { once: true });
                }),
            ),
          );

          const cleanup = () => {
            try {
              win.removeEventListener("afterprint", cleanup);
            } catch {
              /* ignore */
            }
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          };
          try {
            win.addEventListener("afterprint", cleanup, { once: true });
          } catch {
            /* ignore */
          }
          // Safety net in case afterprint never fires.
          window.setTimeout(cleanup, 5 * 60 * 1000);

          try {
            win.focus();
          } catch {
            /* ignore */
          }
          win.print();
          finish();
        } catch (e) {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      },
      { once: true },
    );

    iframe.addEventListener(
      "error",
      () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        finish(new Error("Could not load the document for printing."));
      },
      { once: true },
    );

    document.body.appendChild(iframe);
  });
}
