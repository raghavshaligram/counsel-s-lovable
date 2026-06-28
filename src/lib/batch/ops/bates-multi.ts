/**
 * Multi-file Bates — applies ONE continuous Bates sequence across an
 * ordered list of PDFs. Reuses the single-doc `formatBates` helper for
 * the stamp string so output matches the single-file path exactly.
 *
 * Runs sequentially with a microtask yield between pages so a large set
 * (hundreds of pages) doesn't lock the main thread. Entirely on-device:
 * nothing leaves the browser.
 */
import { PDFDocument, rgb } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
import { formatBates, type BatesOpts } from "./bates";

export interface MultiFileInput {
  /** Source filename — preserved for "separate" output. */
  name: string;
  bytes: Uint8Array;
}

export interface FileBatesRange {
  name: string;
  pageCount: number;
  firstNumber: number;
  lastNumber: number;
  firstStamp: string;
  lastStamp: string;
}

export interface MultiBatesProgress {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  page: number;
  pageCount: number;
  totalPagesDone: number;
  totalPages: number;
}

export interface MultiBatesResult {
  /** Stamped per-file output. Always populated. */
  files: { name: string; bytes: Uint8Array }[];
  /** Merged single-file output (only when `merge: true`). */
  merged?: { name: string; bytes: Uint8Array };
  /** Final Bates ranges per file, in input order. */
  ranges: FileBatesRange[];
}

/**
 * Compute the per-file Bates ranges WITHOUT stamping. Used to render the
 * preview ("file 1: ABC000001–000010, file 2: ABC000011–000015…") before
 * the user commits.
 */
export async function planMultiFileBates(
  files: MultiFileInput[],
  opts: BatesOpts,
): Promise<FileBatesRange[]> {
  const ranges: FileBatesRange[] = [];
  let cursor = opts.startAt;
  for (const f of files) {
    // Cheap parse to get page count. ignoreEncryption mirrors addBates.
    const doc = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    const first = cursor;
    const last = cursor + pageCount - 1;
    ranges.push({
      name: f.name,
      pageCount,
      firstNumber: first,
      lastNumber: last,
      firstStamp: formatBates(first, opts),
      lastStamp: formatBates(last, opts),
    });
    cursor = last + 1;
  }
  return ranges;
}

const yieldToUi = () =>
  new Promise<void>((r) => {
    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      requestAnimationFrame(() => r());
    } else {
      setTimeout(r, 0);
    }
  });

/**
 * Stamp every file in order with a continuous Bates sequence. When
 * `merge` is true, the stamped files are also concatenated into a single
 * PDF (filenames preserved for "separate" download alongside).
 */
export async function stampMultiFileBates(
  files: MultiFileInput[],
  opts: BatesOpts,
  cfg: {
    merge?: boolean;
    mergedName?: string;
    onProgress?: (p: MultiBatesProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<MultiBatesResult> {
  const margin = opts.margin ?? 24;
  const fill =
    opts.color === "red"
      ? rgb(0.8, 0.05, 0.05)
      : opts.color === "blue"
        ? rgb(0.05, 0.15, 0.6)
        : rgb(0, 0, 0);

  // Pre-plan so onProgress can report totals up front.
  const plan = await planMultiFileBates(files, opts);
  const totalPages = plan.reduce((n, r) => n + r.pageCount, 0);

  const stamped: { name: string; bytes: Uint8Array; doc: PDFDocument }[] = [];
  let totalDone = 0;

  for (let fi = 0; fi < files.length; fi++) {
    if (cfg.signal?.aborted) throw new Error("aborted");
    const f = files[fi];
    const r = plan[fi];
    const doc = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
    const font = await embedStandardFont(doc, "HelveticaBold");
    const pages = doc.getPages();

    for (let i = 0; i < pages.length; i++) {
      if (cfg.signal?.aborted) throw new Error("aborted");
      const page = pages[i];
      const { width, height } = page.getSize();
      const stamp = formatBates(r.firstNumber + i, opts);
      const tw = font.widthOfTextAtSize(stamp, opts.fontSize);
      const th = opts.fontSize;
      let x = margin;
      let y = margin;
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
        color: rgb(1, 1, 1), opacity: 0.75,
      });
      page.drawText(stamp, { x, y, size: opts.fontSize, font, color: fill });

      totalDone++;
      cfg.onProgress?.({
        fileIndex: fi,
        fileCount: files.length,
        fileName: f.name,
        page: i + 1,
        pageCount: pages.length,
        totalPagesDone: totalDone,
        totalPages,
      });
      // Yield every few pages so the UI stays responsive on large sets.
      if (i % 4 === 3) await yieldToUi();
    }

    const bytes = await doc.save();
    stamped.push({ name: f.name, bytes, doc });
    await yieldToUi();
  }

  const result: MultiBatesResult = {
    files: stamped.map((s) => ({ name: s.name, bytes: s.bytes })),
    ranges: plan,
  };

  if (cfg.merge) {
    const merged = await PDFDocument.create();
    for (const s of stamped) {
      if (cfg.signal?.aborted) throw new Error("aborted");
      // Re-load from saved bytes so the merge uses the stamped content.
      const src = await PDFDocument.load(s.bytes, { ignoreEncryption: true });
      const copied = await merged.copyPages(src, src.getPageIndices());
      for (const p of copied) merged.addPage(p);
      await yieldToUi();
    }
    result.merged = {
      name: cfg.mergedName ?? "bates-merged.pdf",
      bytes: await merged.save(),
    };
  }

  return result;
}
