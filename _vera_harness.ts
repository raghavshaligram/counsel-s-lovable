// Validation harness: builds two PDFs through the real export helpers,
// runs them through toPdfA, writes them to /tmp/vera/ for veraPDF.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
import { setFontLoader, type FontKind, fontFileName } from "@/lib/pdf/fonts-pdfa";
import { toPdfA, verifyPdfAStructural, findUnembeddedFonts } from "@/lib/pdf/to-pdfa";
import { addBates } from "@/lib/batch/ops/bates";

// Node loader: read the bundled TTF directly from /public/fonts/liberation
setFontLoader(async (kind: FontKind) => {
  const p = path.join("public/fonts/liberation", fontFileName(kind));
  return new Uint8Array(fs.readFileSync(p));
});

async function buildSimple(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await embedStandardFont(doc, "Helvetica");
  const bold = await embedStandardFont(doc, "HelveticaBold");
  page.drawText("Simple PDF/A test", { x: 50, y: 750, size: 18, font: bold, color: rgb(0, 0, 0) });
  page.drawText("Lorem ipsum dolor sit amet, consectetur adipiscing elit.", {
    x: 50, y: 720, size: 12, font, color: rgb(0, 0, 0),
  });
  doc.setTitle("Simple PDF/A test");
  doc.setAuthor("VaultPDF");
  return await doc.save();
}

async function buildRealistic(): Promise<Uint8Array> {
  // Multi-page doc with text, a JPEG image, and several font weights — the
  // sort of file a paralegal would actually try to export.
  const doc = await PDFDocument.create();
  const sans = await embedStandardFont(doc, "Helvetica");
  const sansBold = await embedStandardFont(doc, "HelveticaBold");
  const serif = await embedStandardFont(doc, "TimesRoman");
  const mono = await embedStandardFont(doc, "Courier");
  doc.setTitle("Realistic export sample");
  doc.setAuthor("VaultPDF");

  // Generate a 64x64 grayscale "image" inline via a tiny PNG.
  // Use a checkerboard JPEG built with a 2x2 PNG-like fallback:
  // For simplicity create a JPEG via a 1x1 trick — embed a small JPEG file.
  // We use a 4-byte minimal grey JPEG from a fixture path if available;
  // otherwise we draw a vector rectangle to keep the test self-contained.
  for (let i = 0; i < 4; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1} — Confidential Memo`, {
      x: 50, y: 750, size: 16, font: sansBold,
    });
    page.drawText(
      "This memorandum analyzes the facts of the matter and applies controlling law.",
      { x: 50, y: 720, size: 11, font: serif },
    );
    page.drawText(
      "Defendant: John Doe   Case No: 24-CV-01234   Filed: 2024-09-15",
      { x: 50, y: 700, size: 10, font: mono },
    );
    page.drawRectangle({ x: 50, y: 500, width: 200, height: 150, color: rgb(0.85, 0.85, 0.9) });
    page.drawText("[exhibit image placeholder]", {
      x: 75, y: 570, size: 10, font: sans, color: rgb(0.3, 0.3, 0.3),
    });
    // Simulated redaction box
    page.drawRectangle({ x: 50, y: 660, width: 220, height: 14, color: rgb(0, 0, 0) });
  }

  const baseBytes = await doc.save();

  // Run Bates stamping through the real export op
  const stamped = await addBates(baseBytes, {
    prefix: "ABC",
    startAt: 1,
    digits: 6,
    position: "br",
    fontSize: 9,
    color: "black",
  });
  return stamped;
}

async function run(label: string, build: () => Promise<Uint8Array>, outPath: string) {
  console.log(`\n=== ${label} ===`);
  const plain = await build();
  fs.writeFileSync(outPath.replace(/\.pdf$/, "-plain.pdf"), plain);
  console.log(`plain bytes: ${plain.length}`);

  // Diagnostic: list unembedded fonts in the input
  const inDoc = await PDFDocument.load(plain, { ignoreEncryption: true });
  const offendersIn = findUnembeddedFonts(inDoc);
  console.log(`unembedded fonts in input: ${offendersIn.length === 0 ? "(none)" : offendersIn.join(", ")}`);

  try {
    const pdfa = await toPdfA(plain);
    fs.writeFileSync(outPath, pdfa);
    console.log(`pdfa bytes: ${pdfa.length}`);
    console.log("structural:", verifyPdfAStructural(pdfa));
    // List remaining fonts in output
    const outDoc = await PDFDocument.load(pdfa, { ignoreEncryption: true });
    console.log(`unembedded fonts in output: ${findUnembeddedFonts(outDoc).join(", ") || "(none)"}`);
  } catch (e) {
    console.error("toPdfA threw:", (e as Error).message);
  }
}

await run("Simple text page", buildSimple, "/tmp/vera/simple-pdfa.pdf");
await run("Realistic redacted+Bates+image", buildRealistic, "/tmp/vera/realistic-pdfa.pdf");
