/**
 * Exhibit Binder — assemble a court-ready bundle from a brief + multiple
 * exhibits. Produces a single PDF with:
 *
 *   - A hyperlinked Table of Contents at the front
 *   - A labeled slip-sheet ("Exhibit A", "Exhibit B", …) before each exhibit
 *   - All source PDFs merged in order
 *   - Optional continuous page or Bates numbering across the bundle
 *
 * Pure pdf-lib, on-device. Yields between heavy steps so the UI stays
 * responsive on large sets. Reuses `addBates` for numbering parity with
 * the rest of the app.
 */
import { PDFDocument, PDFName, PDFArray, rgb } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
import { addBates, type BatesOpts } from "./bates";

export type ExhibitLabelScheme = "letters" | "numbers";
export type BinderNumbering = "none" | "page" | "bates";

export interface ExhibitInput {
  /** Original filename. */
  name: string;
  /** Optional display title shown in ToC + slip-sheet. Falls back to name. */
  title?: string;
  /** Optional explicit label override (e.g. "Exhibit A"). When provided,
   *  this exact string is used on the slip-sheet AND ToC — no recomputation
   *  from index. Pass this when the user has confirmed letters per row. */
  label?: string;
  bytes: Uint8Array;
}

export interface BinderOpts {
  /** Primary brief — placed first, no slip-sheet, not listed in ToC. */
  brief?: ExhibitInput | null;
  /** Ordered exhibits. Each gets a slip-sheet + ToC entry. */
  exhibits: ExhibitInput[];
  /** Label scheme for exhibits ("Exhibit A" vs "Exhibit 1"). */
  labelScheme: ExhibitLabelScheme;
  /** Prefix in front of the label index. Default "Exhibit ". */
  labelPrefix?: string;
  /** Whether to prepend a hyperlinked Table of Contents. */
  includeToc: boolean;
  /** Heading on the ToC page. Default "Table of Contents". */
  tocTitle?: string;
  /** Continuous numbering applied to the assembled bundle. */
  numbering: BinderNumbering;
  /** Required when `numbering === "bates"`. */
  bates?: BatesOpts;
  /** When numbering is on, skip the ToC pages. Default true. */
  skipNumberingOnToc?: boolean;
}

export interface BinderEntry {
  label: string;
  title: string;
  /** 1-indexed page number where the slip-sheet appears in the final PDF. */
  pageNumber: number;
}

export interface BinderProgress {
  phase: "brief" | "exhibits" | "toc" | "numbering" | "save";
  current: number;
  total: number;
  label?: string;
}

export interface BinderResult {
  bytes: Uint8Array;
  entries: BinderEntry[];
  totalPages: number;
}

/** Spreadsheet-style letters: A, B, … Z, AA, AB, …  */
export function exhibitLabel(index: number, scheme: ExhibitLabelScheme): string {
  if (scheme === "numbers") return String(index + 1);
  let n = index;
  let s = "";
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

const yieldUi = () =>
  new Promise<void>((r) => {
    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      requestAnimationFrame(() => r());
    } else {
      setTimeout(r, 0);
    }
  });

function truncateToWidth(
  text: string,
  font: { widthOfTextAtSize: (s: string, n: number) => number },
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/**
 * Build the binder. Steps:
 *   1. Copy brief pages.
 *   2. For each exhibit: append slip-sheet, then exhibit pages; record
 *      slip-sheet index (BEFORE ToC pages are prepended).
 *   3. Insert N blank ToC pages at the front, shift recorded indexes.
 *   4. Draw ToC text + GoTo link annotations to each slip-sheet.
 *   5. Save, then optionally re-open and apply Bates / page numbers.
 */
export async function buildExhibitBinder(
  opts: BinderOpts,
  onProgress?: (p: BinderProgress) => void,
): Promise<BinderResult> {
  const out = await PDFDocument.create();
  const helv = await embedStandardFont(out, "Helvetica");
  const helvBold = await embedStandardFont(out, "HelveticaBold");
  const labelPrefix = opts.labelPrefix ?? "Exhibit ";

  // 1. Brief
  if (opts.brief) {
    onProgress?.({ phase: "brief", current: 0, total: 1, label: opts.brief.name });
    const briefDoc = await PDFDocument.load(opts.brief.bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(briefDoc, briefDoc.getPageIndices());
    for (const p of copied) out.addPage(p);
    onProgress?.({ phase: "brief", current: 1, total: 1, label: opts.brief.name });
    await yieldUi();
  }

  // 2. Exhibits with slip-sheets
  type Tracked = { label: string; title: string; slipIndex: number };
  const tracked: Tracked[] = [];

  // ORDER GUARANTEE: iterate the caller's array in-place by index.
  // Slip-sheet, ToC entry, and merged pages for position `i` all come from
  // opts.exhibits[i] in the same iteration — there is no second pass that
  // could re-order them. The label is either the caller's explicit override
  // (e.g. user-confirmed "Exhibit A") or computed from this same index `i`.
  for (let i = 0; i < opts.exhibits.length; i++) {
    const ex = opts.exhibits[i];
    const label = ex.label?.trim()
      ? ex.label.trim()
      : `${labelPrefix}${exhibitLabel(i, opts.labelScheme)}`;
    const title = (ex.title ?? ex.name.replace(/\.pdf$/i, "")).trim() || ex.name;
    onProgress?.({ phase: "exhibits", current: i + 1, total: opts.exhibits.length, label });

    const slip = out.addPage([612, 792]); // US Letter
    drawSlipSheet(slip, label, title, helv, helvBold);
    const slipIndex = out.getPageCount() - 1;

    const exDoc = await PDFDocument.load(ex.bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(exDoc, exDoc.getPageIndices());
    for (const p of copied) out.addPage(p);

    tracked.push({ label, title, slipIndex });
    await yieldUi();
  }

  // 3. Insert ToC pages at the front (in increasing index so they end up
  //    in order at positions 0..N-1).
  let tocPageCount = 0;
  const ENTRIES_PER_PAGE = 28;
  if (opts.includeToc && tracked.length > 0) {
    tocPageCount = Math.max(1, Math.ceil(tracked.length / ENTRIES_PER_PAGE));
    const tocPages = [];
    for (let i = 0; i < tocPageCount; i++) {
      tocPages.push(out.insertPage(i, [612, 792]));
    }
    // Body pages have shifted by tocPageCount.
    for (const t of tracked) t.slipIndex += tocPageCount;

    onProgress?.({ phase: "toc", current: 0, total: tracked.length });
    drawToc({
      doc: out,
      tocPages,
      entries: tracked.map((t) => ({
        label: t.label,
        title: t.title,
        targetPage: out.getPage(t.slipIndex),
        targetPageNumber: t.slipIndex + 1,
      })),
      title: opts.tocTitle ?? "Table of Contents",
      font: helv,
      fontBold: helvBold,
      entriesPerPage: ENTRIES_PER_PAGE,
    });
    onProgress?.({ phase: "toc", current: tracked.length, total: tracked.length });
    await yieldUi();
  }

  let bytes = await out.save();

  // 4. Continuous numbering across the whole bundle (optional).
  if (opts.numbering === "bates" && opts.bates) {
    onProgress?.({ phase: "numbering", current: 0, total: 1 });
    const skip = opts.skipNumberingOnToc !== false ? tocPageCount : 0;
    bytes = await applyBatesSkippingToc(bytes, opts.bates, skip);
    onProgress?.({ phase: "numbering", current: 1, total: 1 });
  } else if (opts.numbering === "page") {
    onProgress?.({ phase: "numbering", current: 0, total: 1 });
    const skip = opts.skipNumberingOnToc !== false ? tocPageCount : 0;
    bytes = await addPageNumbers(bytes, { skipFirstN: skip });
    onProgress?.({ phase: "numbering", current: 1, total: 1 });
  }

  onProgress?.({ phase: "save", current: 1, total: 1 });

  return {
    bytes,
    entries: tracked.map((t) => ({
      label: t.label,
      title: t.title,
      pageNumber: t.slipIndex + 1,
    })),
    totalPages:
      (opts.brief ? 0 : 0) +
      tocPageCount +
      (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount(),
  };
}

/* ───────────────────── Slip-sheet ───────────────────── */

function drawSlipSheet(
  page: ReturnType<PDFDocument["addPage"]>,
  label: string,
  title: string,
  font: Awaited<ReturnType<typeof embedStandardFont>>,
  fontBold: Awaited<ReturnType<typeof embedStandardFont>>,
) {
  const { width, height } = page.getSize();
  const labelSize = 52;
  const titleSize = 16;

  const lw = fontBold.widthOfTextAtSize(label, labelSize);
  page.drawText(label, {
    x: (width - lw) / 2,
    y: height / 2 + 30,
    size: labelSize,
    font: fontBold,
    color: rgb(0.09, 0.12, 0.19),
  });

  page.drawLine({
    start: { x: width / 2 - 90, y: height / 2 + 14 },
    end: { x: width / 2 + 90, y: height / 2 + 14 },
    thickness: 1,
    color: rgb(0.3, 0.5, 0.72),
  });

  const t = truncateToWidth(title, font, titleSize, width - 144);
  const tw = font.widthOfTextAtSize(t, titleSize);
  page.drawText(t, {
    x: (width - tw) / 2,
    y: height / 2 - 18,
    size: titleSize,
    font,
    color: rgb(0.32, 0.37, 0.46),
  });
}

/* ───────────────────── ToC + link annotations ───────────────────── */

interface TocEntryDraw {
  label: string;
  title: string;
  targetPage: ReturnType<PDFDocument["getPage"]>;
  targetPageNumber: number;
}

function drawToc(args: {
  doc: PDFDocument;
  tocPages: ReturnType<PDFDocument["insertPage"]>[];
  entries: TocEntryDraw[];
  title: string;
  font: Awaited<ReturnType<typeof embedStandardFont>>;
  fontBold: Awaited<ReturnType<typeof embedStandardFont>>;
  entriesPerPage: number;
}) {
  const { doc, tocPages, entries, title, font, fontBold, entriesPerPage } = args;
  const titleSize = 22;
  const itemSize = 12;
  const rowHeight = 22;
  const linkColor = rgb(0.09, 0.12, 0.19);

  for (let pi = 0; pi < tocPages.length; pi++) {
    const page = tocPages[pi];
    const { width, height } = page.getSize();
    let y = height - 72;

    if (pi === 0) {
      page.drawText(title, {
        x: 72, y, size: titleSize, font: fontBold, color: linkColor,
      });
      y -= 14;
      page.drawLine({
        start: { x: 72, y },
        end: { x: width - 72, y },
        thickness: 0.75,
        color: rgb(0.78, 0.82, 0.88),
      });
      y -= 24;
    } else {
      page.drawText(`${title} (cont.)`, {
        x: 72, y, size: 14, font: fontBold, color: rgb(0.32, 0.4, 0.55),
      });
      y -= 24;
    }

    const start = pi * entriesPerPage;
    const slice = entries.slice(start, start + entriesPerPage);

    for (const e of slice) {
      const right = String(e.targetPageNumber);
      const rw = font.widthOfTextAtSize(right, itemSize);
      const sep = " — ";
      const labelWithSep = e.label + sep;
      const labelW = fontBold.widthOfTextAtSize(labelWithSep, itemSize);
      const titleX = 72 + labelW;
      const titleMax = width - 72 - rw - 18 - titleX;
      const titleTxt = truncateToWidth(e.title, font, itemSize, Math.max(40, titleMax));

      page.drawText(labelWithSep, { x: 72, y, size: itemSize, font: fontBold, color: linkColor });
      page.drawText(titleTxt, { x: titleX, y, size: itemSize, font, color: linkColor });
      page.drawText(right, { x: width - 72 - rw, y, size: itemSize, font, color: linkColor });

      // Hit-area covers the full row.
      const rect: [number, number, number, number] = [60, y - 5, width - 60, y + itemSize + 5];
      const annot = doc.context.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of("Link"),
        Rect: rect,
        Border: [0, 0, 0],
        A: doc.context.obj({
          Type: PDFName.of("Action"),
          S: PDFName.of("GoTo"),
          D: [e.targetPage.ref, PDFName.of("XYZ"), null, null, null],
        }),
      });
      const annotRef = doc.context.register(annot);

      const existing = page.node.lookup(PDFName.of("Annots"));
      const arr = existing instanceof PDFArray ? existing : doc.context.obj([]);
      arr.push(annotRef);
      page.node.set(PDFName.of("Annots"), arr);

      y -= rowHeight;
    }
  }
}

/* ───────────────────── Numbering helpers ───────────────────── */

/**
 * Stamp Bates across the bundle, optionally skipping the first `skip`
 * pages (ToC). Mirrors `addBates` but with a skip window so ToC pages
 * remain unmarked. The starting number applies to the FIRST stamped page,
 * matching how the standalone Bates tool behaves on the body content.
 */
async function applyBatesSkippingToc(
  bytes: Uint8Array,
  opts: BatesOpts,
  skip: number,
): Promise<Uint8Array> {
  if (skip <= 0) return addBates(bytes, opts);
  const { PDFDocument: PD, rgb: rgbF } = await import("pdf-lib");
  const doc = await PD.load(bytes, { ignoreEncryption: true });
  const font = await embedStandardFont(doc, "HelveticaBold");
  const { formatBates } = await import("./bates");
  const fill =
    opts.color === "red"
      ? rgbF(0.8, 0.05, 0.05)
      : opts.color === "blue"
        ? rgbF(0.05, 0.15, 0.6)
        : rgbF(0, 0, 0);
  const margin = opts.margin ?? 24;
  const pages = doc.getPages();
  for (let i = skip; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const stamp = formatBates(opts.startAt + (i - skip), opts);
    const tw = font.widthOfTextAtSize(stamp, opts.fontSize);
    const th = opts.fontSize;
    let x = margin, y = margin;
    switch (opts.position) {
      case "tl": x = margin; y = height - margin - th; break;
      case "tc": x = (width - tw) / 2; y = height - margin - th; break;
      case "tr": x = width - margin - tw; y = height - margin - th; break;
      case "bl": x = margin; y = margin; break;
      case "bc": x = (width - tw) / 2; y = margin; break;
      case "br": x = width - margin - tw; y = margin; break;
    }
    page.drawRectangle({
      x: x - 4, y: y - 3, width: tw + 8, height: th + 6,
      color: rgbF(1, 1, 1), opacity: 0.75,
    });
    page.drawText(stamp, { x, y, size: opts.fontSize, font, color: fill });
  }
  return doc.save();
}

async function addPageNumbers(
  bytes: Uint8Array,
  opts: { skipFirstN?: number; fontSize?: number } = {},
): Promise<Uint8Array> {
  const skip = opts.skipFirstN ?? 0;
  const size = opts.fontSize ?? 10;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await embedStandardFont(doc, "Helvetica");
  const pages = doc.getPages();
  const total = pages.length - skip;
  for (let i = skip; i < pages.length; i++) {
    const page = pages[i];
    const { width } = page.getSize();
    const n = i - skip + 1;
    const txt = `${n} of ${total}`;
    const tw = font.widthOfTextAtSize(txt, size);
    page.drawRectangle({
      x: (width - tw) / 2 - 4, y: 18, width: tw + 8, height: size + 6,
      color: rgb(1, 1, 1), opacity: 0.75,
    });
    page.drawText(txt, {
      x: (width - tw) / 2, y: 22, size, font, color: rgb(0.1, 0.13, 0.2),
    });
  }
  return doc.save();
}
