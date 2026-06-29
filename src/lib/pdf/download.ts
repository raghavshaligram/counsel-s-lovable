/**
 * downloadPdf — single PDF download path that honors the user's preferred
 * export format (PDF or PDF/A-2b). When PDF/A is selected the bytes are
 * passed through the on-device conformer FIRST and then validated against
 * every core PDF/A-2b requirement (sRGB OutputIntent, pdfaid XMP, trailer
 * /ID, no encryption, no JS, all fonts embedded) before being handed to
 * the user. On failure we fall back to a plain PDF download and surface a
 * toast naming the exact requirement that failed so nothing is silently
 * dropped or mislabeled as court-ready.
 *
 * IMPORTANT — pipeline ordering invariant:
 *   PDF/A conformance MUST be the very last step. Any downstream pass
 *   (compress, flatten, page-numbers, metadata, redaction burn) that
 *   re-saves the bytes will strip the OutputIntent / XMP markers and
 *   silently break compliance. All such ops MUST run BEFORE downloadPdf.
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
    const { toPdfA, verifyPdfAStructuralAsync } = await import("@/lib/pdf/to-pdfa");
    const out = await toPdfA(bytes);
    const report = await verifyPdfAStructuralAsync(out);
    if (opts.verify !== false && !report.ok) {
      // Log the exact PDF/A clause(s) missing so regressions are debuggable.
      // eslint-disable-next-line no-console
      console.error("[pdfa] post-conformance verification FAILED", report);
      toast.warning("PDF/A check failed — saved as plain PDF", {
        id: tid,
        description: `Missing: ${report.missing.join("; ")}`,
      });
      downloadBytes(bytes, filename, "application/pdf");
      return;
    }
    // eslint-disable-next-line no-console
    console.info("[pdfa] verification ok", report);
    downloadBytes(out, pdfaFilename(filename), "application/pdf");
    toast.success("PDF/A-2b saved · fonts embedded · sRGB color profile", { id: tid });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[pdfa] conversion failed", err);
    toast.error("PDF/A conversion failed — saved as plain PDF", {
      id: tid,
      description: (err as Error).message,
    });
    downloadBytes(bytes, filename, "application/pdf");
  }
}
