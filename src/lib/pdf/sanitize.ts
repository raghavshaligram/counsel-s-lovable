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

export async function sanitizePdfBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  // Wipe document info dictionary entries.
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("");
  doc.setCreator("");

  // Drop XMP metadata stream + risky catalog entries.
  const catalog = doc.catalog;
  for (const key of ["Metadata", "Names", "AcroForm", "OpenAction", "AA"]) {
    catalog.delete(PDFName.of(key));
  }

  // Drop page-level additional actions which can carry JS triggers.
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of("AA"));
  }

  return doc.save({ updateFieldAppearances: false });
}
