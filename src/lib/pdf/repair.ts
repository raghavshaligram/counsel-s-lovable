/**
 * Repair — attempt to rebuild a damaged PDF on-device.
 *
 * Strategy (no network, no upload):
 *   1. Trim any garbage before the first "%PDF-" header.
 *   2. Lenient pdf-lib load (ignoreEncryption + throwOnInvalidObject:false +
 *      updateMetadata:false), then copy pages one at a time into a fresh
 *      document. Pages whose object graph is intact survive; pages that
 *      throw are skipped and counted as dropped.
 *   3. If lenient pdf-lib STILL throws on the document level (its strict
 *      tokenizer rejects malformed numbers, dictionaries, xref, etc.), fall
 *      back to pdf.js — a much more tolerant parser. Rasterise each
 *      recoverable page to JPEG and rebuild a clean PDF in pdf-lib. Pages
 *      that pdf.js can't render are skipped.
 *
 * Only when BOTH paths fail do we report "could not repair".
 *
 * Recovery is best-effort. Severely corrupted streams (e.g. truncated file,
 * encrypted body with no password) may not be recoverable — callers must
 * surface that honestly.
 */
import { PDFDocument } from "pdf-lib";
import { loadPdfjs } from "./worker";
import { importChunk } from "@/lib/chunk-import";

export type RepairOutcome = "full" | "partial" | "failed";

export type RepairResult = {
  bytes: Uint8Array;
  blob: Blob;
  filename: string;
  /** Pages in the rebuilt document. */
  pagesRecovered: number;
  /** Pages present in the source that could not be copied. */
  pagesDropped: number;
  /** Total pages expected from the source (recovered + dropped). */
  pagesExpected: number;
  /** 1-based indices (in the rebuilt PDF) of pages that lost their content. */
  pagesWithMissingContent: number[];
  /** Three-way outcome: full | partial | failed. */
  outcome: RepairOutcome;
  /** True when at least one page was recovered. */
  ok: boolean;
  /** Which parser succeeded — useful for the UI ("rasterised fallback"). */
  method: "pdf-lib" | "pdf.js-rasterise" | "qpdf-wasm";
};

export type RepairOptions = {
  filename?: string;
};

const PDF_HEADER = "%PDF-";

function findHeader(bytes: Uint8Array): number {
  // Some damaged files have garbage prepended before "%PDF-". Trim to the
  // first header occurrence within the first 1024 bytes (PDF spec allows
  // leading bytes; many real-world fixers do exactly this).
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i <= limit - 5; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return i;
    }
  }
  return -1;
}

/** Attempt #1 — lenient pdf-lib copy-pages rebuild. */
async function repairWithPdfLib(
  bytes: Uint8Array,
): Promise<{ out: PDFDocument; recovered: number; dropped: number; expected: number } | null> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
  } catch {
    return null;
  }

  let total = 0;
  try {
    total = src.getPageCount();
  } catch {
    return null;
  }
  const out = await PDFDocument.create();
  let dropped = 0;
  for (let i = 0; i < total; i++) {
    try {
      const [page] = await out.copyPages(src, [i]);
      out.addPage(page);
    } catch {
      dropped += 1;
    }
  }
  return { out, recovered: out.getPageCount(), dropped, expected: total };
}

/** Attempt #2 — pdf.js parses what it can, rasterise each page into a fresh PDF. */
async function repairWithPdfJs(
  bytes: Uint8Array,
): Promise<{ out: PDFDocument; recovered: number; dropped: number; expected: number } | null> {
  const pdfjs = await loadPdfjs();
  let srcDoc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    srcDoc = await pdfjs.getDocument({
      data: bytes.slice(),
      // Be as forgiving as possible.
      stopAtErrors: false,
      disableAutoFetch: true,
      disableStream: true, enableXfa: true, useSystemFonts: true }).promise;
  } catch {
    return null;
  }

  const total = srcDoc.numPages;
  const out = await PDFDocument.create();
  let dropped = 0;
  const SCALE = 2; // ~144 dpi — preserves readability without exploding size.

  for (let i = 1; i <= total; i++) {
    try {
      const page = await srcDoc.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const b64 = dataUrl.split(",")[1] ?? "";
      const bin = atob(b64);
      const jpgBytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) jpgBytes[k] = bin.charCodeAt(k);
      const jpg = await out.embedJpg(jpgBytes);
      const w = viewport.width / SCALE;
      const h = viewport.height / SCALE;
      const p = out.addPage([w, h]);
      p.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    } catch {
      dropped += 1;
    }
  }

  return { out, recovered: out.getPageCount(), dropped, expected: total };
}

/**
 * Attempt #3 — qpdf (compiled to WASM) rewrites the file. qpdf's parser
 * automatically reconstructs damaged cross-reference tables and recovers
 * from broken /ObjStm compressed object streams that defeat pdf.js
 * (which fails with "unable to find /Root"). We don't decode pages here;
 * we just hand the cleaned bytes back to the earlier attempts.
 *
 * Lazy-loaded: this only fetches /wasm/qpdf/qpdf.{js,wasm} (~1.3MB) the
 * first time a user runs Repair. Apache-2.0 — safe for commercial use.
 */
async function repairWithQpdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  // eslint-disable-next-line no-console
  console.info("[repair] qpdf fallback: starting", { inputBytes: bytes.length });
  let qpdf: Awaited<ReturnType<typeof import("./qpdf-loader").createQpdfModule>>;
  const stderrBuf: string[] = [];
  const stdoutBuf: string[] = [];
  try {
    const { createQpdfModule } = await importChunk(() => import("./qpdf-loader"));
    qpdf = await createQpdfModule({
      onStdout: (s) => stdoutBuf.push(s),
      onStderr: (s) => stderrBuf.push(s),
    });
    // eslint-disable-next-line no-console
    console.info("[repair] qpdf module loaded OK");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[repair] qpdf module FAILED to load", e);
    return null;
  }

  try {
    try {
      qpdf.FS.mkdir("/work");
    } catch {
      /* exists */
    }
    const inPath = "/work/in.pdf";
    const outPath = "/work/out.pdf";
    qpdf.FS.writeFile(inPath, bytes);
    // eslint-disable-next-line no-console
    console.info("[repair] qpdf: wrote input to MEMFS", { path: inPath, bytes: bytes.length });

    // qpdf recovers automatically when the xref is damaged (there is no
    // explicit --recover flag — recovery is built into the parser). We try
    // a sequence of write modes, from least to most aggressive. Every
    // attempt logs qpdf's own stdout/stderr so we can see what it reports.
    const argSets: { label: string; args: string[] }[] = [
      {
        label: "rewrite (object-streams disabled on write)",
        args: ["--object-streams=disable", inPath, outPath],
      },
      {
        label: "rewrite + ignore xref streams (force linear scan recovery)",
        args: ["--object-streams=disable", "--ignore-xref-streams", inPath, outPath],
      },
      {
        label: "QDF mode (maximum normalisation)",
        args: ["--qdf", "--object-streams=disable", inPath, outPath],
      },
    ];

    let out: Uint8Array | null = null;
    let winningLabel = "";
    for (const { label, args } of argSets) {
      stdoutBuf.length = 0;
      stderrBuf.length = 0;
      try {
        qpdf.FS.unlink(outPath);
      } catch {
        /* not present */
      }
      // eslint-disable-next-line no-console
      console.info(`[repair] qpdf RUN: ${label}`, { args });
      let exitCode: number | "threw" = "threw";
      try {
        exitCode = qpdf.callMain(args);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[repair] qpdf threw during '${label}'`, e);
      }
      const stderrText = stderrBuf.join("\n").trim();
      const stdoutText = stdoutBuf.join("\n").trim();
      // eslint-disable-next-line no-console
      console.info(`[repair] qpdf RESULT '${label}'`, {
        exitCode,
        stderr: stderrText || "(empty)",
        stdout: stdoutText || "(empty)",
      });
      let data: Uint8Array | null = null;
      try {
        const d = qpdf.FS.readFile(outPath);
        if (d && d.byteLength > 0) data = d;
      } catch {
        /* no output */
      }
      if (data) {
        // eslint-disable-next-line no-console
        console.info(`[repair] qpdf produced output: ${data.byteLength} bytes via '${label}'`);
        out = data;
        winningLabel = label;
        break;
      }
      // eslint-disable-next-line no-console
      console.warn(`[repair] qpdf attempt '${label}' produced no usable output file`);
    }

    if (!out) {
      // eslint-disable-next-line no-console
      console.error("[repair] qpdf: ALL recovery attempts failed — file is unrecoverable by qpdf", {
        lastStderr: stderrBuf.join("\n") || "(empty)",
      });
      return null;
    }
    // eslint-disable-next-line no-console
    console.info(`[repair] qpdf SUCCESS via '${winningLabel}' (${out.byteLength} bytes)`);
    try {
      qpdf.FS.unlink(inPath);
      qpdf.FS.unlink(outPath);
    } catch {
      /* best effort */
    }
    return out;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[repair] qpdf fallback crashed mid-run", e);
    return null;
  }
}



export async function repairPdfBytes(
  input: Uint8Array,
  opts: RepairOptions = {},
): Promise<RepairResult> {
  if (!input || input.length === 0) {
    throw new Error("Empty file — nothing to repair.");
  }

  // Trim leading garbage before %PDF- if present.
  let bytes = input;
  const headerOffset = findHeader(bytes);
  if (headerOffset > 0) {
    bytes = bytes.slice(headerOffset);
  } else if (headerOffset < 0) {
    // pdf.js can sometimes still parse files without a clean header in the
    // first 1KB, so don't bail yet — let the fallback try.
  }

  let recovered = 0;
  let dropped = 0;
  let expected = 0;
  let outDoc: PDFDocument | null = null;
  let method: RepairResult["method"] = "pdf-lib";

  // eslint-disable-next-line no-console
  console.info("[repair] === START ===", { inputBytes: input.length, trimmedBytes: bytes.length });

  // Attempt 1: lenient pdf-lib.
  // eslint-disable-next-line no-console
  console.info("[repair] step 1: lenient pdf-lib");
  const a = await repairWithPdfLib(bytes);
  // eslint-disable-next-line no-console
  console.info("[repair] step 1 result", a ? { recovered: a.recovered, dropped: a.dropped, expected: a.expected } : "null");
  if (a && a.recovered > 0) {
    outDoc = a.out;
    recovered = a.recovered;
    dropped = a.dropped;
    expected = a.expected;
    method = "pdf-lib";
  } else {
    // Attempt 2: pdf.js rasterise.
    // eslint-disable-next-line no-console
    console.info("[repair] step 2: pdf.js rasterise");
    const b = await repairWithPdfJs(bytes);
    // eslint-disable-next-line no-console
    console.info("[repair] step 2 result", b ? { recovered: b.recovered, dropped: b.dropped, expected: b.expected } : "null");
    if (b && b.recovered > 0) {
      outDoc = b.out;
      recovered = b.recovered;
      dropped = b.dropped;
      expected = b.expected;
      method = "pdf.js-rasterise";
    } else {
      // Attempt 3 (strong fallback): qpdf-wasm.
      // eslint-disable-next-line no-console
      console.info("[repair] step 3: qpdf-wasm (strong fallback)");
      const qpdfBytes = await repairWithQpdf(bytes);
      // eslint-disable-next-line no-console
      console.info("[repair] step 3 qpdf rebuild", qpdfBytes ? { rebuiltBytes: qpdfBytes.byteLength } : "null (qpdf could not rebuild)");
      if (qpdfBytes) {
        // eslint-disable-next-line no-console
        console.info("[repair] step 3a: re-feed qpdf output to pdf-lib");
        const a2 = await repairWithPdfLib(qpdfBytes);
        // eslint-disable-next-line no-console
        console.info("[repair] step 3a result", a2 ? { recovered: a2.recovered, dropped: a2.dropped, expected: a2.expected } : "null");
        if (a2 && a2.recovered > 0) {
          outDoc = a2.out;
          recovered = a2.recovered;
          dropped = a2.dropped;
          expected = a2.expected;
          method = "qpdf-wasm";
        } else {
          // eslint-disable-next-line no-console
          console.info("[repair] step 3b: re-feed qpdf output to pdf.js rasterise");
          const b2 = await repairWithPdfJs(qpdfBytes);
          // eslint-disable-next-line no-console
          console.info("[repair] step 3b result", b2 ? { recovered: b2.recovered, dropped: b2.dropped, expected: b2.expected } : "null");
          if (b2 && b2.recovered > 0) {
            outDoc = b2.out;
            recovered = b2.recovered;
            dropped = b2.dropped;
            expected = b2.expected;
            method = "qpdf-wasm";
          }
        }
      }
    }
  }

  // eslint-disable-next-line no-console
  console.info("[repair] === DONE ===", { method, recovered, dropped, expected, hasOutDoc: !!outDoc });

  if (!outDoc || recovered === 0) {
    throw new Error(
      "No recoverable pages — neither the lenient parser, the pdf.js fallback, nor the qpdf rebuild could read this file.",
    );
  }

  outDoc.setProducer("PDFMacro");
  outDoc.setCreator("PDFMacro");
  const repaired = await outDoc.save();

  // Audit the rebuilt PDF for pages that lost their drawable content.
  // The pdf.js-rasterise path always carries a full-page image, so every
  // page has content by construction. For the pdf-lib path, scan each page's
  // operator list for any text or image draws.
  const pagesWithMissingContent: number[] = [];
  if (method !== "pdf.js-rasterise") {
    try {
      const pdfjs = await loadPdfjs();
      const verify = await pdfjs.getDocument({
        data: repaired.slice(),
        stopAtErrors: false,
        disableAutoFetch: true,
        disableStream: true, enableXfa: true, useSystemFonts: true }).promise;
      for (let i = 1; i <= verify.numPages; i++) {
        let hasContent = false;
        try {
          const p = await verify.getPage(i);
          const txt = await p.getTextContent();
          if (txt.items.length > 0) {
            hasContent = true;
          } else {
            const ops = await p.getOperatorList();
            const OPS = pdfjs.OPS;
            const drawCodes = new Set<number>(
              [
                OPS?.paintImageXObject,
                OPS?.paintInlineImageXObject,
                OPS?.paintXObject,
                OPS?.paintImageMaskXObject,
                OPS?.showText,
                OPS?.showSpacedText,
                OPS?.nextLineShowText,
                OPS?.nextLineSetSpacingShowText,
              ].filter((v): v is number => typeof v === "number"),
            );
            for (const code of ops.fnArray) {
              if (drawCodes.has(code)) {
                hasContent = true;
                break;
              }
            }
          }
        } catch {
          hasContent = false;
        }
        if (!hasContent) pagesWithMissingContent.push(i);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[repair] content audit failed", e);
    }
  }

  const outcome: RepairOutcome =
    dropped === 0 && pagesWithMissingContent.length === 0 ? "full" : "partial";

  const base = (opts.filename ?? "document").replace(/\.pdf$/i, "");
  const filename = `${base}-repaired.pdf`;
  return {
    bytes: repaired,
    blob: new Blob([repaired as BlobPart], { type: "application/pdf" }),
    filename,
    pagesRecovered: recovered,
    pagesDropped: dropped,
    pagesExpected: expected || recovered + dropped,
    pagesWithMissingContent,
    outcome,
    ok: true,
    method,
  };
}

export async function repairPdfFile(file: File): Promise<RepairResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return repairPdfBytes(buf, { filename: file.name });
}

/**
 * Map any repair/parse error (or a Repair result snapshot) into a plain-
 * language reason. Internal parser strings ("Failed to parse number
 * line:50 col:3 offset=1076"), library names, and stack traces never reach
 * the user — they go to the console for debugging.
 */
export function friendlyRepairReason(
  err: unknown,
  ctx?: { fileSize?: number },
): string {
  // Log the raw technical detail for developers; never surface it.
  // eslint-disable-next-line no-console
  console.error("[repair] technical detail:", err);

  const raw = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  const size = ctx?.fileSize ?? -1;

  if (size === 0) {
    return "This file is empty — it may not have finished downloading. Try downloading it again, then run Repair.";
  }
  if (raw.includes("empty file")) {
    return "This file is empty — it may not have finished downloading. Try downloading it again, then run Repair.";
  }
  if (
    raw.includes("password") ||
    raw.includes("encrypted") ||
    raw.includes("encryption")
  ) {
    return "This file is password-protected. Unlock it first, then run Repair.";
  }
  if (
    raw.includes("no pdf header") ||
    raw.includes("not a pdf") ||
    raw.includes("invalid pdf") ||
    raw.includes("missing pdf")
  ) {
    return "This file doesn't look like a PDF. It may be a different file type, or only partially downloaded.";
  }
  if (
    raw.includes("no recoverable pages") ||
    raw.includes("could not read")
  ) {
    return "This file appears to be corrupted beyond recovery — its internal structure is too damaged to rebuild.";
  }
  if (
    raw.includes("unexpected end") ||
    raw.includes("eof") ||
    raw.includes("truncated")
  ) {
    return "This file looks truncated — it may not have finished downloading or saving.";
  }
  // Any other low-level parser noise.
  return "This file appears to be corrupted beyond recovery — its internal structure is too damaged to rebuild.";
}

