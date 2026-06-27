/**
 * Unlock — strip password encryption from a PDF you own.
 * On-device only. Mirrors the logic in /unlock route so the workspace
 * panel and standalone route share one implementation.
 */

import { importChunk } from "@/lib/chunk-import";

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
    this.name = "WrongPasswordError";
  }
}

export type UnlockResult = {
  blob: Blob;
  filename: string;
  /** True if the source PDF was actually encrypted. */
  wasEncrypted: boolean;
};

/**
 * Returns true if the file can be opened without a password.
 * Useful for the UI to decide whether to prompt.
 */
export async function isPdfEncrypted(file: File): Promise<boolean> {
  const { PDFDocument } = await importChunk(() => import("@cantoo/pdf-lib"));
  try {
    await PDFDocument.load(await file.arrayBuffer());
    return false;
  } catch {
    return true;
  }
}

export async function unlockPdf(
  file: File,
  password?: string,
): Promise<UnlockResult> {
  const { PDFDocument } = await importChunk(() => import("@cantoo/pdf-lib"));
  let src;
  let wasEncrypted = false;
  try {
    src = await PDFDocument.load(await file.arrayBuffer(), {
      password: password || undefined,
    } as any);
    if (password) wasEncrypted = true;
  } catch (err: any) {
    if (/password/i.test(String(err?.message ?? err))) {
      throw new WrongPasswordError();
    }
    throw err;
  }

  // Rebuild without encryption by copying pages into a fresh document.
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, src.getPageIndices());
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  const base = file.name.replace(/\.pdf$/i, "");
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    filename: `${base}-unlocked.pdf`,
    wasEncrypted,
  };
}
