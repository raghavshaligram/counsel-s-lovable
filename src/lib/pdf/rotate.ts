/**
 * Rotate — pure, on-device PDF page rotation.
 * Adds `angle` (mod 360) to each targeted page's current rotation.
 */
import { PDFDocument, degrees } from "pdf-lib";

export type RotateAngle = 90 | 180 | 270;
export type RotateScope = "all" | "odd" | "even" | "custom";

export type RotateOptions = {
  angle: RotateAngle;
  scope: RotateScope;
  /** Required when scope === "custom". Example: "1-3, 5, 8-10" (1-based). */
  custom?: string;
};

export type RotateResult = {
  blob: Blob;
  filename: string;
  rotatedCount: number;
};

export async function getRotatePageCount(file: File): Promise<number> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  return doc.getPageCount();
}

export function resolveRotateScope(
  scope: RotateScope,
  custom: string,
  total: number,
): { indices: number[]; error?: string } {
  if (scope === "all")
    return { indices: Array.from({ length: total }, (_, i) => i) };
  if (scope === "odd")
    return {
      indices: Array.from({ length: total }, (_, i) => i).filter(
        (i) => (i + 1) % 2 === 1,
      ),
    };
  if (scope === "even")
    return {
      indices: Array.from({ length: total }, (_, i) => i).filter(
        (i) => (i + 1) % 2 === 0,
      ),
    };
  const out = new Set<number>();
  for (const part of custom
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) return { indices: [], error: `"${part}" isn't valid` };
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end > total || end < start)
      return { indices: [], error: `"${part}" is out of bounds (1–${total})` };
    for (let i = start; i <= end; i++) out.add(i - 1);
  }
  if (out.size === 0) return { indices: [], error: "Enter at least one page" };
  return { indices: [...out].sort((a, b) => a - b) };
}

export async function rotatePdf(
  file: File,
  opts: RotateOptions,
): Promise<RotateResult> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const total = doc.getPageCount();
  const target = resolveRotateScope(opts.scope, opts.custom ?? "", total);
  if (target.error) throw new Error(target.error);
  const set = new Set(target.indices);
  doc.getPages().forEach((p, i) => {
    if (!set.has(i)) return;
    const current = p.getRotation().angle ?? 0;
    p.setRotation(degrees((current + opts.angle) % 360));
  });
  const bytes = await doc.save();
  const base = file.name.replace(/\.pdf$/i, "");
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    filename: `${base}-rotated.pdf`,
    rotatedCount: set.size,
  };
}
