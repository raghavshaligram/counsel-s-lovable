/**
 * Print the active PDF in place — without opening a new window or tab.
 *
 * Loads the bytes into a hidden same-origin iframe (created from a blob:
 * URL) and calls `print()` on its contentWindow. The browser shows the
 * native OS print dialog overlayed on the current page; the user stays in
 * the app. The iframe and blob URL are released after the dialog closes.
 *
 * Privacy: blob: URLs are entirely in-memory. Nothing is uploaded.
 */

export type PrintOptions = {
  /** Filename suggestion the browser may use as the print job title. */
  filename?: string;
};

export async function printPdfBytes(
  bytes: Uint8Array | ArrayBuffer,
  opts: PrintOptions = {},
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Printing is only available in the browser.");
  }
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  // Remove any previous print iframe before adding a new one so repeated
  // prints don't pile up DOM nodes.
  const prior = document.getElementById("vaultpdf-print-frame");
  if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

  const iframe = document.createElement("iframe");
  iframe.id = "vaultpdf-print-frame";
  iframe.title = opts.filename ?? "Print preview";
  // Keep it on-screen but invisible — display:none stops some browsers
  // from running the print pipeline on the iframe contents.
  iframe.setAttribute(
    "style",
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;",
  );
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = url;

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
      () => {
        try {
          const win = iframe.contentWindow;
          if (!win) throw new Error("Print frame has no contentWindow");

          // Clean up once the user dismisses the print dialog. `afterprint`
          // fires reliably in modern Chromium/Firefox/Safari for both
          // accept and cancel. We also schedule a long-fallback cleanup in
          // case the event never fires (very old engines or PDF plugins
          // that swallow it).
          const cleanup = () => {
            try {
              win.removeEventListener("afterprint", cleanup);
            } catch {
              /* cross-origin guard — won't happen for blob: URLs */
            }
            URL.revokeObjectURL(url);
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          };
          try {
            win.addEventListener("afterprint", cleanup, { once: true });
          } catch {
            /* ignore */
          }
          // 5-minute safety net.
          window.setTimeout(cleanup, 5 * 60 * 1000);

          // Focus is required by some browsers before print() works.
          try {
            win.focus();
          } catch {
            /* ignore */
          }
          win.print();
          finish();
        } catch (e) {
          URL.revokeObjectURL(url);
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      },
      { once: true },
    );

    iframe.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(url);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        finish(new Error("Could not load the document for printing."));
      },
      { once: true },
    );

    document.body.appendChild(iframe);
  });
}
