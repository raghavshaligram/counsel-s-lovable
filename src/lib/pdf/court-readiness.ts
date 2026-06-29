/**
 * Court Readiness — pre-flight scan over an exported PDF.
 *
 * Checks three things the courts most often choke on:
 *   1. File size vs. PACER/CM-ECF typical caps (35 MB).
 *   2. Font embedding (PDF/A-style requirement — every text font embedded).
 *   3. Hidden / non-visible content (XMP metadata, doc-info, JS triggers,
 *      embedded files, additional actions).
 *
 * The scan itself is FREE and runs entirely on-device. The "auto-fix"
 * action that hangs off this report is gated behind a free signup at the
 * call site — this module just reports findings; it does not gate.
 */
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef } from "pdf-lib";

export type CheckStatus = "ok" | "warn" | "info";

export interface CourtCheck {
  id: "size" | "fonts" | "hidden";
  label: string;
  status: CheckStatus;
  /** One short human sentence. Never includes file contents. */
  message: string;
  /** True only when this finding can be repaired by the auto-fix action. */
  fixable: boolean;
}

export interface CourtReadinessReport {
  byteSize: number;
  pageCount: number;
  checks: CourtCheck[];
  /** Any check is fixable → auto-fix button is meaningful. */
  anyFixable: boolean;
  /** Any check is "warn" → user should look before filing. */
  anyWarn: boolean;
}

/** PACER / CM-ECF default per-document cap. Many districts allow more, none allow less. */
const COURT_SIZE_CAP_MB = 35;

export async function scanCourtReadiness(bytes: Uint8Array): Promise<CourtReadinessReport> {
  const byteSize = bytes.byteLength;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pageCount = doc.getPageCount();

  const checks: CourtCheck[] = [];

  // 1. File size vs court cap
  const sizeMB = byteSize / (1024 * 1024);
  if (sizeMB > COURT_SIZE_CAP_MB) {
    checks.push({
      id: "size",
      label: "File size",
      status: "warn",
      message: `${sizeMB.toFixed(1)} MB — over the typical ${COURT_SIZE_CAP_MB} MB PACER per-document cap. Use Compress or split before filing.`,
      fixable: false,
    });
  } else {
    checks.push({
      id: "size",
      label: "File size",
      status: "ok",
      message: `${sizeMB.toFixed(1)} MB — within the typical ${COURT_SIZE_CAP_MB} MB PACER cap.`,
      fixable: false,
    });
  }

  // 2. Font embedding — walk every /Font dict and confirm /FontDescriptor has /FontFile*.
  const fontReport = inspectFonts(doc);
  if (fontReport.unembedded > 0) {
    checks.push({
      id: "fonts",
      label: "Font embedding",
      status: "warn",
      message: `${fontReport.unembedded} of ${fontReport.total} font${fontReport.total === 1 ? "" : "s"} not embedded. Some courts reject filings with unembedded fonts.`,
      fixable: false,
    });
  } else if (fontReport.total === 0) {
    checks.push({
      id: "fonts",
      label: "Font embedding",
      status: "info",
      message: "No text fonts in this document (image-only or empty).",
      fixable: false,
    });
  } else {
    checks.push({
      id: "fonts",
      label: "Font embedding",
      status: "ok",
      message: `${fontReport.total} font${fontReport.total === 1 ? "" : "s"} embedded.`,
      fixable: false,
    });
  }

  // 3. Hidden content — quick inspection (we don't mutate; sanitize.ts handles repair).
  const hidden = inspectHidden(doc);
  const totalHidden = hidden.docInfo + hidden.xmp + hidden.javascript + hidden.embeddedFiles + hidden.actions;
  if (totalHidden > 0) {
    const parts: string[] = [];
    if (hidden.docInfo) parts.push(`${hidden.docInfo} metadata field${hidden.docInfo === 1 ? "" : "s"}`);
    if (hidden.xmp) parts.push("XMP stream");
    if (hidden.javascript) parts.push(`${hidden.javascript} JS trigger${hidden.javascript === 1 ? "" : "s"}`);
    if (hidden.embeddedFiles) parts.push("embedded files");
    if (hidden.actions) parts.push(`${hidden.actions} action trigger${hidden.actions === 1 ? "" : "s"}`);
    checks.push({
      id: "hidden",
      label: "Hidden / metadata content",
      status: "warn",
      message: `Found ${parts.join(", ")}. Auto-Fix can remove these.`,
      fixable: true,
    });
  } else {
    checks.push({
      id: "hidden",
      label: "Hidden / metadata content",
      status: "ok",
      message: "No document metadata, XMP stream, JS triggers, or embedded files.",
      fixable: false,
    });
  }

  const anyFixable = checks.some((c) => c.fixable);
  const anyWarn = checks.some((c) => c.status === "warn");
  return { byteSize, pageCount, checks, anyFixable, anyWarn };
}

function inspectFonts(doc: PDFDocument): { total: number; unembedded: number } {
  let total = 0;
  let unembedded = 0;
  const seen = new Set<string>();

  const visitFontDict = (fontDict: PDFDict) => {
    const key = fontDict.toString();
    if (seen.has(key)) return;
    seen.add(key);
    total++;
    const subtype = fontDict.lookup(PDFName.of("Subtype"));
    // Type3 fonts embed glyphs inline — treat as embedded.
    if (subtype && subtype.toString() === "/Type3") return;
    const descriptor = fontDict.lookup(PDFName.of("FontDescriptor"), PDFDict);
    if (!descriptor) {
      // Standard 14 fonts have no descriptor; courts that demand full embed
      // reject these too. Count as unembedded.
      unembedded++;
      return;
    }
    const hasFile =
      descriptor.has(PDFName.of("FontFile")) ||
      descriptor.has(PDFName.of("FontFile2")) ||
      descriptor.has(PDFName.of("FontFile3"));
    if (!hasFile) unembedded++;
  };

  for (const page of doc.getPages()) {
    try {
      const resources = page.node.Resources();
      if (!resources || !resources.has(PDFName.of("Font"))) continue;
      let fonts: PDFDict | undefined;
      try {
        fonts = resources.lookup(PDFName.of("Font"), PDFDict);
      } catch {
        continue;
      }
      if (!fonts) continue;
      for (const [, value] of fonts.entries()) {
        const dict = value instanceof PDFRef ? doc.context.lookup(value, PDFDict) : (value as PDFDict);
        if (!dict || !(dict instanceof PDFDict)) continue;
        visitFontDict(dict);
        if (dict.has(PDFName.of("DescendantFonts"))) {
          try {
            const descendants = dict.lookup(PDFName.of("DescendantFonts"), PDFArray);
            if (descendants) {
              for (let i = 0; i < descendants.size(); i++) {
                const ref = descendants.get(i);
                const sub = ref instanceof PDFRef ? doc.context.lookup(ref, PDFDict) : (ref as PDFDict);
                if (sub instanceof PDFDict) visitFontDict(sub);
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      /* keep scanning other pages */
    }
  }
  return { total, unembedded };
}

function inspectHidden(doc: PDFDocument): {
  docInfo: number;
  xmp: number;
  javascript: number;
  embeddedFiles: number;
  actions: number;
} {
  let docInfo = 0;
  const had = (v: string | undefined | string[]) =>
    Array.isArray(v) ? v.length > 0 : !!(v && v.trim());
  try { if (had(doc.getTitle())) docInfo++; } catch { /* ignore */ }
  try { if (had(doc.getAuthor())) docInfo++; } catch { /* ignore */ }
  try { if (had(doc.getSubject())) docInfo++; } catch { /* ignore */ }
  try { if (had(doc.getKeywords())) docInfo++; } catch { /* ignore */ }
  try { if (had(doc.getProducer())) docInfo++; } catch { /* ignore */ }
  try { if (had(doc.getCreator())) docInfo++; } catch { /* ignore */ }

  const catalog = doc.catalog;
  const xmp = catalog.has(PDFName.of("Metadata")) ? 1 : 0;

  let javascript = 0;
  let embeddedFiles = 0;
  if (catalog.has(PDFName.of("Names"))) {
    try {
      const names = catalog.lookup(PDFName.of("Names"), PDFDict);
      if (names?.has(PDFName.of("JavaScript"))) javascript++;
      if (names?.has(PDFName.of("EmbeddedFiles"))) embeddedFiles++;
    } catch { /* not a dict */ }
  }
  if (catalog.has(PDFName.of("OpenAction"))) {
    try {
      const openAction = catalog.lookup(PDFName.of("OpenAction"), PDFDict);
      if (openAction && openAction.has(PDFName.of("JS"))) javascript++;
    } catch { /* OpenAction may be an array (destination), not a dict */ }
  }

  let actions = catalog.has(PDFName.of("AA")) ? 1 : 0;
  for (const page of doc.getPages()) {
    try {
      if (page.node.has(PDFName.of("AA"))) actions++;
    } catch {
      /* skip */
    }
  }

  return { docInfo, xmp, javascript, embeddedFiles, actions };
}
