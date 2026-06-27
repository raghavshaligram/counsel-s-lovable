/**
 * Password-protect — on-device AES encryption via @cantoo/pdf-lib.
 * Extracted from /protect route so the workspace panel can reuse the
 * same logic. Pure: File in, encrypted bytes out.
 */

import { importChunk } from "@/lib/chunk-import";

export type ProtectPermissions = {
  printing: boolean;
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  contentAccessibility: boolean;
  documentAssembly: boolean;
};

export const DEFAULT_PROTECT_PERMS: ProtectPermissions = {
  printing: true,
  modifying: false,
  copying: false,
  annotating: true,
  fillingForms: true,
  contentAccessibility: true,
  documentAssembly: false,
};

export type ProtectOptions = {
  userPassword: string;
  /** When omitted, userPassword is reused as owner password. */
  ownerPassword?: string;
  permissions: ProtectPermissions;
};

export type ProtectResult = {
  blob: Blob;
  filename: string;
};

export async function protectPdf(
  file: File,
  opts: ProtectOptions,
): Promise<ProtectResult> {
  if (!opts.userPassword || opts.userPassword.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }
  const { PDFDocument } = await importChunk(() => import("@cantoo/pdf-lib"));
  const doc = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  await doc.encrypt({
    userPassword: opts.userPassword,
    ownerPassword: opts.ownerPassword || opts.userPassword,
    permissions: {
      printing: opts.permissions.printing ? "highResolution" : undefined,
      modifying: opts.permissions.modifying,
      copying: opts.permissions.copying,
      annotating: opts.permissions.annotating,
      fillingForms: opts.permissions.fillingForms,
      contentAccessibility: opts.permissions.contentAccessibility,
      documentAssembly: opts.permissions.documentAssembly,
    },
  });
  const bytes = await doc.save();
  const base = file.name.replace(/\.pdf$/i, "");
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    filename: `${base}-protected.pdf`,
  };
}

export function scorePasswordStrength(
  pw: string,
): { pct: number; label: string; color: string } {
  if (!pw) return { pct: 0, label: "", color: "bg-muted" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { pct: 15, label: "Very weak", color: "bg-destructive" },
    { pct: 30, label: "Weak", color: "bg-destructive" },
    { pct: 50, label: "Fair", color: "bg-amber-500" },
    { pct: 70, label: "Good", color: "bg-amber-400" },
    { pct: 85, label: "Strong", color: "bg-vault" },
    { pct: 100, label: "Very strong", color: "bg-vault" },
  ];
  return map[Math.min(s, 5)];
}
