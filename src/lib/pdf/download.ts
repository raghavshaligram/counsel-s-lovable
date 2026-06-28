/**
 * downloadPdf — single PDF download path that honors the user's preferred
 * export format (PDF or PDF/A-2b). When PDF/A is selected the bytes are
 * passed through the on-device conformer first; on failure we fall back to
 * a plain PDF download and surface a toast so nothing is silently dropped.
 */
import { toast } from "sonner";
import { downloadBytes } from "@/lib/batch/runner";
import {
  getExportFormat,
  type ExportFormat,
} from "@/lib/workspace/export-format-store";

function pdfaFilename(name: string): string {
  return name.replace(/\.pdf$/i, "") + "-pdfa.pdf";
}

export async function downloadPdf(
  bytes: Uint8Array,
  filename: string,
  opts: { format?: ExportFormat; verify?: boolean } = {},
): Promise<void> {
  const fmt = opts.format ?? getExportFormat();
  if (fmt !== "pdf-a") {
    downloadBytes(bytes, filename, "application/pdf");
    return;
  }
  const tid = `pdfa-${filename}`;
  toast.loading("Converting to PDF/A…", { id: tid });
  try {
    const { toPdfA, verifyPdfAStructural } = await import("@/lib/pdf/to-pdfa");
    const out = await toPdfA(bytes);
    const check = verifyPdfAStructural(out);
    if (opts.verify !== false && !check.ok) {
      toast.warning("PDF/A markers missing — saved as plain PDF", { id: tid });
      downloadBytes(bytes, filename, "application/pdf");
      return;
    }
    downloadBytes(out, pdfaFilename(filename), "application/pdf");
    toast.success("PDF/A-2b saved · fonts embedded · sRGB color profile", { id: tid });
  } catch (err) {
    console.error("[pdfa] conversion failed", err);
    toast.error("PDF/A conversion failed — saved as plain PDF", {
      id: tid,
      description: (err as Error).message,
    });
    downloadBytes(bytes, filename, "application/pdf");
  }
}
