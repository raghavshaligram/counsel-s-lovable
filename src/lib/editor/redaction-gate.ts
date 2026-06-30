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
}

export interface EnforceResult {
  bytes: Uint8Array;
  verify: VerifyResult;
}

/**
 * Run the unbypassable verification gate. Returns the (possibly re-burned)
 * bytes that are safe to deliver. Throws `RedactionGateError` if any
 * redacted value still appears anywhere in the output.
 */
export async function enforceRedactionGate(
  inputBytes: Uint8Array,
  targets: RedactionTarget[],
  opts: EnforceOptions = {},
): Promise<EnforceResult> {
  if (targets.length === 0) {
    // No redactions to verify — nothing for the gate to do. Return as-is.
    return {
      bytes: inputBytes,
      verify: {
        ok: true, total: 0, removed: 0, leaks: [],
        vectors: { page: 0, formField: 0, annotation: 0, hiddenLayer: 0, attachment: 0, rawStream: 0 },
        scannedAt: new Date().toISOString(),
      },
    };
  }

  let bytes = inputBytes;

  if (!opts.alreadySanitized) {
    opts.onProgress?.("sanitize");
    const { sanitizePdfBytes } = await importChunk(() => import("@/lib/pdf/sanitize"));
    bytes = await sanitizePdfBytes(bytes);
  }

  opts.onProgress?.("verify");
  const { verifyRedactionRemoval } = await importChunk(() => import("./verify-redaction"));
  let result = await verifyRedactionRemoval(bytes, targets);

  // If only page-geometry leaks remain, try forced rasterization on the
  // offending pages and re-verify. Side-channel leaks cannot be fixed by
  // rasterizing, so any of those fail immediately below.
  const pageLeaks = result.leaks.filter((l: VerifyLeak) => l.vector === "page" && l.rect && l.page !== undefined);
  if (pageLeaks.length > 0) {
    opts.onProgress?.("raster-fallback");
    const { rasterizeRedactedPages } = await importChunk(() => import("./rasterize-redacted-pages"));
    const leakedPages = new Map<number, { x: number; y: number; w: number; h: number }[]>();
    // Re-burn ALL redaction rects on every leaking page (not just the
    // ones flagged) so the geometry can't slip through a second time.
    const rectsByPage = new Map<number, { x: number; y: number; w: number; h: number }[]>();
    for (const t of targets) {
      if (!t.rect) continue;
      const arr = rectsByPage.get(t.page) ?? [];
      arr.push(t.rect);
      rectsByPage.set(t.page, arr);
    }
    for (const leak of pageLeaks) {
      const pageRects = rectsByPage.get(leak.page!) ?? [leak.rect!];
      leakedPages.set(leak.page!, pageRects);
    }
    const forced = await rasterizeRedactedPages(bytes, leakedPages, { mode: "always", scale: 2.5 });
    bytes = forced.bytes;
    opts.onProgress?.("verify-again");
    result = await verifyRedactionRemoval(bytes, targets);
  }

  if (!result.ok) {
    const byVector: Record<string, number> = {};
    for (const l of result.leaks) byVector[l.vector] = (byVector[l.vector] ?? 0) + 1;
    const summary = Object.entries(byVector).map(([v, n]) => `${n} ${v}`).join(", ");

    // Build a per-value × per-vector breakdown so the user (and we, in
    // DevTools) can see EXACTLY which redacted string survived in which
    // vector. Most “2 still recoverable” cases are one value that lives
    // in both /V and /AP, or in both an annotation /Contents and a
    // baked content stream — the table makes that visible.
    const valueToVectors = new Map<string, Set<string>>();
    const rows: { value: string; vector: string; page?: number; ref?: string; detail: string }[] = [];
    for (const l of result.leaks) {
      // Pull the actual matched substring out of the leak text when the
      // verifier appended it as (matched "…"). Fall back to the leak text.
      const m = /matched "([^"]+)"/.exec(l.text);
      const value = m?.[1] ?? l.text;
      if (!valueToVectors.has(value)) valueToVectors.set(value, new Set());
      valueToVectors.get(value)!.add(l.vector);
      rows.push({ value, vector: l.vector, page: l.page, ref: l.ref, detail: l.text });
    }
    // eslint-disable-next-line no-console
    console.group("[redact:gate] export BLOCKED — recoverable values remain");
    console.table(rows);
    for (const [value, vectors] of valueToVectors) {
      // eslint-disable-next-line no-console
      console.warn(
        `[redact:gate] "${value}" survives in: ${Array.from(vectors).join(", ")} — ` +
        `removal must clear every vector, not just the first`,
      );
    }
    // eslint-disable-next-line no-console
    console.groupEnd();

    throw new RedactionGateError(
      `Redaction verification failed — ${result.leaks.length} item${result.leaks.length === 1 ? "" : "s"} still present (${summary}), export blocked. ` +
      `Surviving: ${Array.from(valueToVectors.entries()).map(([v, vec]) => `"${v}" in [${Array.from(vec).join(", ")}]`).join("; ")}`,
      result,
    );
  }


  return { bytes, verify: result };
}
