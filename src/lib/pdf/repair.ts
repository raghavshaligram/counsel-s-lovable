/**
 * Repair — attempt to rebuild a damaged PDF on-device.
 *
 * Strategy (no network, no upload):
 *   1. Load the source bytes with pdf-lib in lenient mode
 *      (ignoreEncryption + throwOnInvalidObject:false) so a busted xref or
 *      odd object doesn't abort the whole parse.
 *   2. Copy each page into a fresh PDFDocument. copyPages walks references
 *      per page, so pages whose object graph is intact survive; pages that
 *      throw are skipped and reported as dropped.
 *   3. Save the new document — pdf-lib writes a clean xref table and a
 *      well-formed trailer, which fixes most "won't open" PDFs.
 *
 * Recovery is best-effort. Severely corrupted streams (e.g. truncated file,
 * encrypted body with no password) may not be recoverable — callers must
 * surface that honestly.
 */
import { PDFDocument } from "pdf-lib";

export type RepairResult = {
  bytes: Uint8Array;
  blob: Blob;
  filename: string;
  /** Pages in the rebuilt document. */
  pagesRecovered: number;
  /** Pages present in the source that could not be copied. */
  pagesDropped: number;
  /** True when at least one page was recovered. */
  ok: boolean;
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
    // No header at all in the first 1KB — this isn't a PDF we can rebuild.
    throw new Error(
      `No PDF header found. This file doesn't look like a PDF (${PDF_HEADER}…).`,
    );
  }

  let src: PDFDocument;
  try {
    src = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
  } catch (err) {
    throw new Error(
      `Could not parse the document: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const total = src.getPageCount();
  const out = await PDFDocument.create();

  let pagesDropped = 0;
  // Copy one page at a time so a single bad page can't kill the whole job.
  for (let i = 0; i < total; i++) {
    try {
      const [page] = await out.copyPages(src, [i]);
      out.addPage(page);
    } catch {
      pagesDropped += 1;
    }
  }

  const pagesRecovered = out.getPageCount();
  if (pagesRecovered === 0) {
    throw new Error(
      "No recoverable pages — the document's content streams appear too damaged.",
    );
  }

  out.setProducer("VaultPDF");
  out.setCreator("VaultPDF");
  const repaired = await out.save();

  const base = (opts.filename ?? "document").replace(/\.pdf$/i, "");
  const filename = `${base}-repaired.pdf`;
  return {
    bytes: repaired,
    blob: new Blob([repaired as BlobPart], { type: "application/pdf" }),
    filename,
    pagesRecovered,
    pagesDropped,
    ok: true,
  };
}

export async function repairPdfFile(
  file: File,
): Promise<RepairResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return repairPdfBytes(buf, { filename: file.name });
}
