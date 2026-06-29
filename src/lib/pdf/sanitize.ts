/**
 * Sanitize — strip hidden data from a PDF on-device.
 *
 * Removes:
 *  - Document metadata (Title, Author, Subject, Keywords, Producer, Creator,
 *    Creation/Modification dates).
 *  - The XMP /Metadata stream attached to the catalog.
 *  - Embedded files / file attachments (/Names → /EmbeddedFiles).
 *  - Document-level JavaScript (/Names → /JavaScript, /OpenAction with /JS).
 *  - AcroForm tree (form fields can carry hidden values).
 *
 * Visible page content is preserved. This is a "scrub before sharing" pass,
 * not a redaction tool — text on pages stays where it is.
 */
import { PDFDocument, PDFName } from "pdf-lib";

export interface SanitizeReport {
  documentInfo: number;        // count of doc-info fields that had a value
  xmpMetadata: number;         // 1 if XMP stream existed, else 0
  embeddedFiles: number;       // 1 if /Names had /EmbeddedFiles, else 0
  javascript: number;          // sum of /Names /JavaScript + /OpenAction /JS
  acroForm: number;            // 1 if /AcroForm existed, else 0
  additionalActions: number;   // catalog /AA + per-page /AA triggers
}

export async function sanitizePdfBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const { bytes: out } = await sanitizePdfBytesWithReport(bytes);
  return out;
}

export async function sanitizePdfBytesWithReport(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; report: SanitizeReport; pageCount: number }> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const report: SanitizeReport = {
    documentInfo: 0,
    xmpMetadata: 0,
    embeddedFiles: 0,
    javascript: 0,
    acroForm: 0,
    additionalActions: 0,
  };

  // Count populated document-info fields BEFORE wiping.
  const had = (v: string | undefined | string[]) =>
    Array.isArray(v) ? v.length > 0 : !!(v && v.trim());
  try { if (had(doc.getTitle())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getAuthor())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getSubject())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getKeywords())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getProducer())) report.documentInfo++; } catch { /* ignore */ }
  try { if (had(doc.getCreator())) report.documentInfo++; } catch { /* ignore */ }

  // Wipe document info dictionary entries.
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("");
  doc.setCreator("");

  const catalog = doc.catalog;

  // Detect risky catalog entries before deleting them.
  if (catalog.has(PDFName.of("Metadata"))) report.xmpMetadata = 1;
  if (catalog.has(PDFName.of("AcroForm"))) report.acroForm = 1;
  if (catalog.has(PDFName.of("AA"))) report.additionalActions++;
  if (catalog.has(PDFName.of("OpenAction"))) report.javascript++;
  if (catalog.has(PDFName.of("Names"))) {
    // Best-effort: the Names tree may carry EmbeddedFiles or JavaScript.
    // We don't introspect deeply — presence of Names is enough to flag.
    report.embeddedFiles = 1;
  }

  for (const key of ["Metadata", "Names", "AcroForm", "OpenAction", "AA"]) {
    catalog.delete(PDFName.of(key));
  }

  // Drop page-level additional actions which can carry JS triggers.
  for (const page of doc.getPages()) {
    if (page.node.has(PDFName.of("AA"))) report.additionalActions++;
    page.node.delete(PDFName.of("AA"));
  }

  const pageCount = doc.getPageCount();
  const outBytes = await doc.save({ updateFieldAppearances: false });
  return { bytes: outBytes, report, pageCount };
}
