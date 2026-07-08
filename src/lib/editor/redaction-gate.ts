/**
 * Unbypassable redaction verification gate.
 *
 * Every export path that has redaction targets MUST run its final bytes
 * through `enforceRedactionGate` before delivering the file. The gate:
 *
 *   1. Sanitizes side-channel vectors (form fields, annotations, metadata,
 *      attachments, OCGs, JavaScript) so the same sensitive value the user
 *      redacted on-page can't survive elsewhere in the file.
 *   2. Re-verifies removal across ALL vectors:
 *        - page geometry (text inside the redaction rect)
 *        - raw page content streams (Tj literal + hex strings, UTF-16BE)
 *        - form-field values (AcroForm /V)
 *        - annotation /Contents /RC /T /Subj
 *        - hidden / optional-content layers
 *        - embedded file attachments
 *        - document metadata (Info dict + XMP)
 *   3. If any page geometry leak remains, it forces full-page rasterization
 *      of just those pages and re-verifies.
 *   4. If ANY vector still leaks, it throws — the caller MUST NOT deliver
 *      the file. The error message names the vector(s) and count.
 *
 * This is the single chokepoint. Bug-fixes/improvements to redaction
 * verification belong here, not duplicated in each export path.
 */
import { importChunk } from "@/lib/chunk-import";
import type { VerifyLeak } from "./verify-redaction";
import type { RedactionTarget, VerifyResult } from "./verify-redaction";

export class RedactionGateError extends Error {
  readonly result: VerifyResult;
  constructor(message: string, result: VerifyResult) {
    super(message);
    this.name = "RedactionGateError";
    this.result = result;
  }
}

export interface EnforceOptions {
  /** Optional progress callback for toast/UI updates. */
  onProgress?: (step: "sanitize" | "verify" | "raster-fallback" | "verify-again") => void;
  /** If true, side-channels (form/annotation/metadata) have already been
   *  scrubbed by the caller — skip the sanitize pass.  Default: false. */
  alreadySanitized?: boolean;
  /** 0-based page indices that were FULLY rasterized before entering the
   *  gate. Raw-stream verification is skipped ONLY for these pages;
   *  partially-rasterized or text-retaining pages are still scanned. When
   *  in doubt, omit the index — err toward verifying. */
  rasterizedPages?: number[];
  /** Cancellation. Long redactions (thousands of pages) surface this so the
   *  UI can offer a Cancel button. */
  signal?: AbortSignal;
}

export interface EnforceResult {
  bytes: Uint8Array;
  verify: VerifyResult;
  /** Union of pages that ended up fully rasterized (input + fallback pass). */
  rasterizedPages: number[];
}

/** Cheap raw-byte scan for side-channel markers. If NONE appear, sanitize
 *  is a no-op — we can safely skip its full pdf-lib load+save. On big
 *  scanned-only PDFs this alone shaves 30–60 s of freeze time. */
function hasSideChannelMarkers(bytes: Uint8Array): boolean {
  // Only look at a bounded window — the trailer/xref/catalog are at the
  // tail; annotations/forms are referenced throughout but their marker
  // names ALWAYS appear at least once in the tail region as well.
  // Cheaper than TextDecoder over the whole file.
  const decoder = new TextDecoder("latin1");
  const stride = 512 * 1024;
  for (let off = 0; off < bytes.byteLength; off += stride) {
    const end = Math.min(off + stride, bytes.byteLength);
    const chunk = decoder.decode(bytes.subarray(off, end));
    if (
      chunk.includes("/AcroForm")
      || chunk.includes("/Annots")
      || chunk.includes("/EmbeddedFiles")
      || chunk.includes("/OCProperties")
      || chunk.includes("/JavaScript")
      || chunk.includes("/JS")
    ) return true;
  }
  return false;
}

export async function enforceRedactionGate(
  inputBytes: Uint8Array,
  targets: RedactionTarget[],
  opts: EnforceOptions = {},
): Promise<EnforceResult> {
  if (targets.length === 0) {
    return {
      bytes: inputBytes,
      rasterizedPages: opts.rasterizedPages ?? [],
      verify: {
        ok: true, total: 0, removed: 0, leaks: [],
        vectors: { page: 0, formField: 0, annotation: 0, hiddenLayer: 0, attachment: 0, rawStream: 0 },
        scannedAt: new Date().toISOString(),
      },
    };
  }

  let bytes: Uint8Array | null = inputBytes;
  const rasterizedPages = new Set<number>(opts.rasterizedPages ?? []);
  const workersAvailable = typeof Worker !== "undefined";

  // Each stage below runs in its OWN dedicated Web Worker. When a stage's
  // client resolves it terminates the worker, releasing that stage's heap
  // (pdf-lib indirect-object graph, pdf.js doc, canvas buffers) before the
  // next stage starts. This keeps peak memory bounded to one stage at a
  // time on 13k-rect / 5000-page redactions.
  //
  // Between stages we (a) transfer the buffer with { steal: true } so the
  // main thread's copy is neutered the moment postMessage fires, and (b)
  // null the local reference so V8 can free the outgoing bytes.
  if (!opts.alreadySanitized) {
    // Skip the sanitize worker entirely when the file has zero
    // sanitize-able side channels — 90% of scanned discovery PDFs.
    if (!hasSideChannelMarkers(bytes)) {
      opts.onProgress?.("sanitize");
    } else {
      opts.onProgress?.("sanitize");
      if (!workersAvailable) {
        const { sanitizePdfBytesWithReport } = await import("@/lib/pdf/sanitize");
        const sanitized = await sanitizePdfBytesWithReport(bytes, {
          shouldAbort: () => !!opts.signal?.aborted,
        });
        bytes = sanitized.bytes;
      } else {
        const { sanitizeInWorker } = await importChunk(() => import("@/lib/workers/sanitize-client"));
        const sanitized = await sanitizeInWorker(bytes, { signal: opts.signal, stealBytes: true });
        bytes = sanitized.bytes;
      }
      // Drop the pre-sanitize buffer immediately — worker owns its own copy now.
    }
  }
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  opts.onProgress?.("verify");
  let result: VerifyResult;
  if (!workersAvailable) {
    const { verifyRedactionRemoval } = await import("./verify-redaction");
    result = await verifyRedactionRemoval(bytes!, targets, {
      rasterizedPages: [...rasterizedPages],
      signal: opts.signal,
    });
  } else {
    const { verifyRedactionRemovalInWorker } = await importChunk(() => import("@/lib/workers/verify-client"));
    // First verify: DO NOT steal — if page leaks are found we need `bytes`
    // again to feed the raster-fallback stage.
    result = await verifyRedactionRemovalInWorker(bytes!, targets, {
      rasterizedPages: [...rasterizedPages],
      signal: opts.signal,
    });
  }

  const pageLeaks = result.leaks.filter((l: VerifyLeak) => l.vector === "page" && l.rect && l.page !== undefined);
  if (pageLeaks.length > 0) {
    if (!workersAvailable) {
      throw new RedactionGateError(
        `Redaction verification failed — ${result.leaks.length} item${result.leaks.length === 1 ? "" : "s"} still present (page), export blocked`,
        result,
      );
    }
    opts.onProgress?.("raster-fallback");
    const { rasterizeRedactedPagesInWorker } = await importChunk(() => import("@/lib/workers/rasterize-client"));
    const rectsByPage = new Map<number, { x: number; y: number; w: number; h: number }[]>();
    for (const t of targets) {
      if (!t.rect) continue;
      const arr = rectsByPage.get(t.page) ?? [];
      arr.push(t.rect);
      rectsByPage.set(t.page, arr);
    }
    const leakedPages = new Map<number, { x: number; y: number; w: number; h: number }[]>();
    for (const leak of pageLeaks) {
      const pageRects = rectsByPage.get(leak.page!) ?? [leak.rect!];
      leakedPages.set(leak.page!, pageRects);
    }
    const forced = await rasterizeRedactedPagesInWorker(bytes!, leakedPages, {
      mode: "always",
      scale: 2.5,
      signal: opts.signal,
      stealBytes: true,
    });
    bytes = forced.bytes;
    for (const p of forced.rasterizedPages) rasterizedPages.add(p);
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    opts.onProgress?.("verify-again");
    result = await verifyRedactionRemovalInWorker(bytes!, targets, {
      rasterizedPages: [...rasterizedPages],
      signal: opts.signal,
      stealBytes: true,
    });
  }

  if (!result.ok) {
    const byVector: Record<string, number> = {};
    for (const l of result.leaks) byVector[l.vector] = (byVector[l.vector] ?? 0) + 1;
    const summary = Object.entries(byVector).map(([v, n]) => `${n} ${v}`).join(", ");
    throw new RedactionGateError(
      `Redaction verification failed — ${result.leaks.length} item${result.leaks.length === 1 ? "" : "s"} still present (${summary}), export blocked`,
      result,
    );
  }

  return { bytes: bytes!, verify: result, rasterizedPages: [...rasterizedPages].sort((a, b) => a - b) };
}
