/**
 * Automation op registry — maps op names to bytes->bytes adapters around
 * the EXISTING tool functions. We never reimplement the underlying logic;
 * adapters only normalise the input/output shape (bytes in, bytes out).
 *
 * Worker-safety: every op listed here must run inside a Web Worker. That
 * means pdf-lib-only ops, or ops whose existing code path already tolerates
 * a Worker context (e.g. compressSmart gracefully falls back to structural
 * when pdf.js / `document` aren't available).
 *
 * OCR and image-rasterising ops that depend on the DOM live in a separate
 * main-thread registry (added when their UI lands). The engine is the same;
 * only the registry differs.
 */

import type { RegisteredOp } from "./types";

import { compressSmart, type CompressOpts } from "@/lib/batch/ops/compress";
import { addPageNumbers, type PageNumbersOpts } from "@/lib/batch/ops/page-numbers";
import { addHeaderFooter, type HeaderFooterOpts } from "@/lib/batch/ops/header-footer";
import { addBates, type BatesOpts } from "@/lib/batch/ops/bates";
import { flatten, type FlattenOpts } from "@/lib/batch/ops/flatten";
import { sanitizePdfBytes } from "@/lib/pdf/sanitize";
import { applyTextWatermark, type WatermarkOptions } from "@/lib/pdf/watermark";
import { rotatePdf, type RotateOptions } from "@/lib/pdf/rotate";
import { extractPages } from "@/lib/pdf/extract-pages";
import { toPdfA, verifyPdfAStructuralAsync } from "@/lib/pdf/to-pdfa";
import { unlockPdf } from "@/lib/pdf/unlock";
import { protectPdf, DEFAULT_PROTECT_PERMS, type ProtectOptions } from "@/lib/pdf/protect";

function bytesToFile(bytes: Uint8Array, name = "in.pdf"): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}
async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/* ---------- Adapters ---------- */

const compress: RegisteredOp<CompressOpts> = async (bytes, params) => {
  const res = await compressSmart(bytes, params);
  return res.bytes;
};

const watermark: RegisteredOp<WatermarkOptions> = async (bytes, params) => {
  const res = await applyTextWatermark(bytesToFile(bytes), params);
  return blobToBytes(res.blob);
};

const rotate: RegisteredOp<RotateOptions> = async (bytes, params) => {
  const res = await rotatePdf(bytesToFile(bytes), params);
  return blobToBytes(res.blob);
};

const pageNumbers: RegisteredOp<PageNumbersOpts> = (bytes, params) =>
  addPageNumbers(bytes, params);

const headerFooter: RegisteredOp<HeaderFooterOpts> = (bytes, params) =>
  addHeaderFooter(bytes, params);

const bates: RegisteredOp<BatesOpts> = (bytes, params) => addBates(bytes, params);

const flattenOp: RegisteredOp<FlattenOpts> = (bytes, params) =>
  flatten(bytes, params);

const sanitize: RegisteredOp<void> = (bytes) => sanitizePdfBytes(bytes);

const extract: RegisteredOp<{ ranges: string }> = async (bytes, params) => {
  const res = await extractPages(bytesToFile(bytes), params.ranges);
  return blobToBytes(res.blob);
};

const pdfA: RegisteredOp<void> = (bytes) => toPdfA(bytes);

const unlock: RegisteredOp<{ password?: string }> = async (bytes, params) => {
  const res = await unlockPdf(bytesToFile(bytes), params?.password);
  return blobToBytes(res.blob);
};

const protect: RegisteredOp<Partial<ProtectOptions> & { userPassword: string }> = async (
  bytes,
  params,
) => {
  const res = await protectPdf(bytesToFile(bytes), {
    userPassword: params.userPassword,
    ownerPassword: params.ownerPassword,
    permissions: { ...DEFAULT_PROTECT_PERMS, ...(params.permissions ?? {}) },
  });
  return blobToBytes(res.blob);
};

/* ---------- Registry ---------- */

export const OPS: Record<string, RegisteredOp<never>> = {
  compress: compress as RegisteredOp<never>,
  watermark: watermark as RegisteredOp<never>,
  rotate: rotate as RegisteredOp<never>,
  "page-numbers": pageNumbers as RegisteredOp<never>,
  "header-footer": headerFooter as RegisteredOp<never>,
  bates: bates as RegisteredOp<never>,
  flatten: flattenOp as RegisteredOp<never>,
  sanitize: sanitize as RegisteredOp<never>,
  "extract-pages": extract as RegisteredOp<never>,
  "to-pdfa": pdfA as RegisteredOp<never>,
  unlock: unlock as RegisteredOp<never>,
  protect: protect as RegisteredOp<never>,
};

export function getOp(name: string): RegisteredOp<unknown> | null {
  return (OPS[name] as RegisteredOp<unknown> | undefined) ?? null;
}

export function listOps(): string[] {
  return Object.keys(OPS);
}
