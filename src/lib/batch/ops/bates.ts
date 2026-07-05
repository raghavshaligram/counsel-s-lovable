/**
 * Bates op — pure pdf-lib. bytes -> bytes.
 *
 * Stamps a sequential Bates number on every page. Mirrors the standalone
 * /bates route logic so behaviour is identical wherever it's invoked.
 */
import { PDFDocument, rgb } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
import { maybeYield, throwIfAborted } from "@/lib/pdf/yield";

export type BatesPosition = "tl" | "tc" | "tr" | "bl" | "bc" | "br";
export type BatesColor = "black" | "red" | "blue";

export interface BatesOpts {
  prefix: string;
  suffix?: string;
  startAt: number;
  digits: number;
  position: BatesPosition;
  fontSize: number;
  color: BatesColor;
  margin?: number;
}

export interface BatesRunOpts {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export function formatBates(n: number, opts: Pick<BatesOpts, "prefix" | "suffix" | "digits">): string {
  return `${opts.prefix ?? ""}${String(n).padStart(opts.digits, "0")}${opts.suffix ?? ""}`;
}

export async function addBates(
  bytes: Uint8Array,
  opts: BatesOpts,
  run: BatesRunOpts = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await embedStandardFont(doc, "HelveticaBold");
  const fill =
    opts.color === "red" ? rgb(0.8, 0.05, 0.05)
      : opts.color === "blue" ? rgb(0.05, 0.15, 0.6)
        : rgb(0, 0, 0);
  const margin = opts.margin ?? 24;
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    throwIfAborted(run.signal);
    const page = pages[i];
    const { width, height } = page.getSize();
    const stamp = formatBates(opts.startAt + i, opts);
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
    // Subtle white halo for legibility over dark scans.
    page.drawRectangle({
      x: x - 4, y: y - 3, width: tw + 8, height: th + 6,
      color: rgb(1, 1, 1), opacity: 0.75,
    });
    page.drawText(stamp, { x, y, size: opts.fontSize, font, color: fill });
    run.onProgress?.(i + 1, pages.length);
    await maybeYield(i, 16);
  }
  return doc.save();
}
