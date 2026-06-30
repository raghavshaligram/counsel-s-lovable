/**
 * cleanupWorkspaceState — preventative lifecycle cleanup run before a
 * new PDF is loaded into the active tab.
 *
 * Synchronous return: every teardown is fire-and-forget so the open path
 * is never blocked by a stale worker that refuses to drain.
 *
 *   a) pdfDoc.destroy() — never awaited (pdf.js waits for pending getPage
 *      tasks to settle, which can hang after lazy IntersectionObserver
 *      page jobs were queued).
 *   b) canvas wipe — width/height = 0 to drop the GPU-side backing store.
 *   c) blob URL revoke — registry-based; the active document's object URL
 *      is registered once and revoked when the next file takes over.
 *   d) worker terminate — caller-supplied (e.g. NER, automation).
 */

type PdfLike = { destroy?: () => Promise<unknown> };

export interface CleanupTargets {
  pdfDoc?: PdfLike | null;
  canvases?: Iterable<HTMLCanvasElement> | (() => Iterable<HTMLCanvasElement> | null | undefined);
  blobUrls?: Iterable<string>;
  workers?: Iterable<Worker>;
}

export function cleanupWorkspaceState(t: CleanupTargets): void {
  // a) pdf.js destroy — fire-and-forget
  if (t.pdfDoc && typeof t.pdfDoc.destroy === "function") {
    try {
      const p = t.pdfDoc.destroy();
      if (p && typeof (p as Promise<unknown>).catch === "function") {
        (p as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }

  // b) Canvas wipe — release GPU backing store and 2D context memory.
  try {
    const iter =
      typeof t.canvases === "function" ? t.canvases() : t.canvases;
    if (iter) {
      for (const canvas of iter) {
        if (!canvas) continue;
        try {
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
        } catch {
          /* ignore */
        }
        try {
          // Setting dims to 0 forces browsers to drop the backing store.
          canvas.width = 0;
          canvas.height = 0;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  // c) Blob URL revoke
  if (t.blobUrls) {
    for (const url of t.blobUrls) {
      if (!url) continue;
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  }

  // d) Worker terminate
  if (t.workers) {
    for (const w of t.workers) {
      if (!w) continue;
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Document-scoped blob URL registry. Call sites that hold a long-lived blob
// URL for "the active document" (compress preview, OCR preview, editor save)
// can register here so the next open swap revokes the prior pointer.
// ---------------------------------------------------------------------------

const tracked = new Set<string>();

export function trackBlobUrl(url: string | null | undefined): void {
  if (!url) return;
  tracked.add(url);
}

export function releaseBlobUrl(url: string | null | undefined): void {
  if (!url) return;
  tracked.delete(url);
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

export function releaseAllTrackedBlobUrls(): void {
  for (const url of tracked) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  tracked.clear();
}
