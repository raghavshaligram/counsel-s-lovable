/**
 * Workspace EditorCanvas — native canvas mount for the workspace shell.
 *
 * Port (Option A) of /editor's PageCanvas. Reuses:
 *   - the shared editor reducer (src/lib/editor/state.ts)
 *   - computeQuads (src/lib/editor/quad-capture.ts)
 *   - FONT_META / mapPdfFontToKey (src/lib/editor/fonts.ts)
 *   - exportEditedPdf (src/lib/editor/export.ts) — used by the shell
 *
 * Does NOT import /editor route — only its functions, per Ground Rules.
 * Editor tools live in the floating toolbar; controls live in the right
 * inspector; this file is just the page surface + pointer logic.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadPdfjs } from "@/lib/pdf/worker";
import { computeQuads } from "@/lib/editor/quad-capture";
import { FONT_KEYS, FONT_META, detectFontKey, type FontKey } from "@/lib/editor/fonts";
import { rgbCss, uid, type State, type Action } from "@/lib/editor/state";
import type { Anno, PageOp, RGB, TextAnno, TextSource } from "@/lib/editor/types";
import { useGoogleFontLoader } from "@/hooks/useGoogleFontLoader";
import { matchPdfFont } from "@/lib/utils/fontMatcher";

interface TextItem {
  x: number;
  y: number;
  w: number;
  h: number;
  str: string;
  family: "sans" | "serif" | "mono";
  bold: boolean;
  italic: boolean;
  transform: number[];
  fontName?: string;
  /** Resolved CSS family from pdf.js `styles` map — richer than the raw
   *  PostScript fontName and used as a secondary signal for matchPdfFont. */
  cssFamily?: string;
  fontKey?: FontKey;
  fontApprox?: boolean;
  fontWeight?: number | string;
  lineHeight?: number;
  letterSpacing?: number;
  color: RGB;
  bg: RGB;
}

function cssFontFamilyName(stack: string | undefined): string {
  return (stack ?? "")
    .split(",")[0]
    ?.replace(/['"]/g, "")
    .trim() ?? "";
}

function numericFontWeight(weight: number | string | undefined, bold: boolean): number {
  if (typeof weight === "number") return weight;
  if (typeof weight === "string") {
    const n = Number.parseInt(weight, 10);
    if (Number.isFinite(n)) return n;
    if (/bold/i.test(weight)) return 700;
  }
  return bold ? 700 : 400;
}

function resolveTextFontFamily(a: Anno & { kind: "text" | "text-edit" }): string {
  const editFontKey = a.kind === "text-edit" ? (a.fontKey as FontKey | undefined) : undefined;
  const famOverride = (a as { fontFamilyOverride?: string }).fontFamilyOverride;
  return famOverride
    ? famOverride
    : editFontKey && FONT_META[editFontKey]
    ? FONT_META[editFontKey].cssFamily
    : (a.family === "serif" ? `'Times New Roman', Times, serif`
      : a.family === "mono" ? `'Courier New', Courier, monospace`
      : `Helvetica, Arial, sans-serif`);
}

function estimateLetterSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  widthPdf: number,
  fontSizePx: number,
  fontFamily: string,
  fontWeight: number | string,
  fontStyle: string,
  scaleFactor: number,
): number {
  const slots = Math.max(0, text.length - 1);
  if (!text.trim() || slots === 0 || widthPdf <= 0) return 0;
  try {
    ctx.save();
    ctx.font = `${fontStyle} ${fontWeight} ${fontSizePx}px ${fontFamily || "sans-serif"}`;
    const measuredPdf = ctx.measureText(text).width / scaleFactor;
    ctx.restore();
    const spacing = (widthPdf - measuredPdf) / slots;
    return Number.isFinite(spacing) && Math.abs(spacing) <= fontSizePx / scaleFactor * 0.4 ? spacing : 0;
  } catch {
    try { ctx.restore(); } catch { /* ignore */ }
    return 0;
  }
}

function sampleTextColor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): RGB {
  try {
    const x = Math.max(0, Math.floor(sx));
    const y = Math.max(0, Math.floor(sy));
    const w = Math.max(1, Math.floor(sw));
    const h = Math.max(1, Math.floor(sh));
    const data = ctx.getImageData(x, y, w, h).data;
    const pixels: { r: number; g: number; b: number; lum: number }[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 230) continue;
      pixels.push({ r, g, b, lum });
    }
    if (pixels.length < 4) return { r: 0, g: 0, b: 0 };
    pixels.sort((p, q) => p.lum - q.lum);
    const take = Math.max(2, Math.floor(pixels.length * 0.25));
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < take; i++) { r += pixels[i].r; g += pixels[i].g; b += pixels[i].b; }
    return { r: r / take / 255, g: g / take / 255, b: b / take / 255 };
  } catch {
    return { r: 0, g: 0, b: 0 };
  }
}

// Sample the page background by reading a RING just outside the glyph bbox
// and returning the MODAL (most frequent) color quantized to 8-step bins per
// channel. This handles any page color (white, cream, gray, dark) without
// being fooled by adjacent glyphs that sneak into the strips, and avoids any
// hardcoded white fallback.
function samplePageBg(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): RGB {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const bx = Math.max(0, Math.floor(sx));
  const by = Math.max(0, Math.floor(sy));
  const bw = Math.max(1, Math.floor(sw));
  const bh = Math.max(1, Math.floor(sh));

  // Try progressively larger rings if the first pass yields too few opaque
  // pixels (small glyph in a busy line). Reading further out also dodges
  // adjacent baselines that would skew the mode toward ink.
  const rings = [
    Math.max(4, Math.floor(sh * 0.6)),
    Math.max(8, Math.floor(sh * 1.4)),
    Math.max(16, Math.floor(sh * 2.5)),
  ];

  const read = (x: number, y: number, w: number, h: number, into: ImageData[]) => {
    const cx = Math.max(0, Math.min(x, cw - 1));
    const cy = Math.max(0, Math.min(y, ch - 1));
    const ww = Math.max(1, Math.min(w, cw - cx));
    const hh = Math.max(1, Math.min(h, ch - cy));
    if (ww < 1 || hh < 1) return;
    try { into.push(ctx.getImageData(cx, cy, ww, hh)); } catch { /* tainted */ }
  };

  for (const band of rings) {
    const strips: ImageData[] = [];
    read(bx, by - band, bw, band, strips);
    read(bx, by + bh, bw, band, strips);
    read(bx - band, by, band, bh, strips);
    read(bx + bw, by, band, bh, strips);

    // Mode by 8-step quantization (32 buckets per channel = 32768 keys).
    const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
    let total = 0;
    for (const img of strips) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const c = counts.get(key);
        if (c) { c.n++; c.r += r; c.g += g; c.b += b; }
        else counts.set(key, { n: 1, r, g, b });
        total++;
      }
    }
    if (total < 20) continue;
    // Find the brightest CLUSTER that is also well-represented. Pages are
    // overwhelmingly lighter than ink, but a tight ring around a glyph can
    // be dominated by anti-aliased mid-grays — taking the plain mode then
    // yields e.g. rgb(241,241,241) instead of the real page white. We
    // pick the cluster with the highest luminance among those that hold
    // at least 15% of sampled pixels (≥3% if nothing qualifies).
    const clusters = [...counts.values()].sort((a, b) => b.n - a.n);
    const minShareStrong = total * 0.15;
    const minShareWeak = total * 0.03;
    const lum = (c: { r: number; g: number; b: number; n: number }) =>
      (0.299 * (c.r / c.n) + 0.587 * (c.g / c.n) + 0.114 * (c.b / c.n));
    let best: { n: number; r: number; g: number; b: number } | null = null;
    for (const c of clusters) {
      if (c.n < minShareStrong) break;
      if (!best || lum(c) > lum(best)) best = c;
    }
    if (!best) {
      for (const c of clusters) {
        if (c.n < minShareWeak) break;
        if (!best || lum(c) > lum(best)) best = c;
      }
    }
    if (!best) best = clusters[0] ?? null;
    if (!best) continue;
    return { r: best.r / best.n / 255, g: best.g / best.n / 255, b: best.b / best.n / 255 };
  }
  // Last resort: sample a single pixel far above the bbox. Avoids hardcoded white.
  try {
    const fx = Math.max(0, Math.min(cw - 1, bx + (bw >> 1)));
    const fy = Math.max(0, by - Math.max(20, sh * 3));
    const d = ctx.getImageData(fx, fy, 1, 1).data;
    return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255 };
  } catch {
    return { r: 1, g: 1, b: 1 };
  }
}

export interface EditorCanvasProps {
  pageIndex: number;
  op: PageOp;
  srcBytes: Uint8Array;
  annos: Anno[];
  state: State;
  dispatch: React.Dispatch<Action>;
  /** Display scale relative to PDF points. 1 = 100%. */
  scale: number;
  /** Shared pdf.js document (avoids re-parsing per page). */
  pdfDoc?: any;
  /** Owner runs OCR on the whole document and replaces the tab file. */
  onRequestOcr?: () => void;
  /** When true, the OCR offer renders a "Running OCR…" disabled state. */
  ocrRunning?: boolean;
  /** Reports whether this page has no real text layer. Shell shows the
   * single floating OCR offer when at least one visible page is scanned. */
  onScannedChange?: (pageIndex: number, isScanned: boolean) => void;
  /** This page has had on-device OCR applied. Used to default new text /
   * text-edit boxes to a serif (Tinos), matching the visible scan. */
  isOcrPage?: boolean;
}

export function EditorCanvas({
  pageIndex, op, srcBytes, annos, state, dispatch, scale, pdfDoc,
  onRequestOcr, ocrRunning, onScannedChange, isOcrPage,
}: EditorCanvasProps) {

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Tracks the in-flight pdf.js RenderTask for this canvas so we can cancel
  // it before starting a new render. pdf.js throws "Cannot use the same
  // canvas during multiple render() operations" if we don't serialize these.
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<unknown> } | null>(null);
  const canvasIdRef = useRef<string>(`ec-${Math.random().toString(36).slice(2, 9)}`);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  // Tracks whether pdf.js getTextContent has resolved for this page. Until
  // it has, we don't know if the page is scanned, so the banner stays hidden
  // (avoids a flash on every page mount).
  const [textLoaded, setTextLoaded] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [drawing, setDrawing] = useState<
    | null
    | { x0: number; y0: number; x: number; y: number; points?: { x: number; y: number }[] }
  >(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Render this page. Reuses a shared pdf.js doc when provided so we don't
  // re-parse the file per page. DPR capped at 2 to limit memory.
  useEffect(() => {
    let cancelled = false;
    setTextLoaded(false);
    setBannerDismissed(false);
    (async () => {
      const canvas = canvasRef.current; if (!canvas) return;
      const cid = canvasIdRef.current;
      // Cancel any in-flight render targeting this canvas before touching it.
      if (renderTaskRef.current) {
        try {
          console.debug("[pdf-render] cancel", { canvasId: cid, page: op.srcPage });
          renderTaskRef.current.cancel();
          await renderTaskRef.current.promise.catch(() => {});
        } catch { /* noop */ }
        renderTaskRef.current = null;
      }
      if (cancelled) return;
      if (op.blank) {
        const w = op.width * scale, h = op.height * scale;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        setTextItems([]);
        setTextLoaded(true);
        return;
      }
      try {
        const pdfjs = await loadPdfjs();
        const doc = pdfDoc ?? (await pdfjs.getDocument({ data: srcBytes.slice() }).promise);
        if (cancelled) return;
        const page = await doc.getPage(op.srcPage + 1);
        if (cancelled) return;
        const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
        const vp = page.getViewport({ scale: scale * dpr, rotation: op.rotation });
        const cssVp = page.getViewport({ scale, rotation: op.rotation });
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        canvas.style.width = `${Math.ceil(cssVp.width)}px`;
        canvas.style.height = `${Math.ceil(cssVp.height)}px`;
        const ctx = canvas.getContext("2d"); if (!ctx) return;
        console.debug("[pdf-render] start", { canvasId: cid, page: op.srcPage, scale });
        const task = page.render({ canvasContext: ctx, viewport: vp, canvas } as Parameters<typeof page.render>[0]);
        renderTaskRef.current = task as unknown as { cancel: () => void; promise: Promise<unknown> };
        try {
          await task.promise;
          console.debug("[pdf-render] complete", { canvasId: cid, page: op.srcPage });
        } catch (e) {
          const name = (e as { name?: string } | null)?.name;
          if (name === "RenderingCancelledException" || cancelled) {
            console.debug("[pdf-render] cancelled", { canvasId: cid, page: op.srcPage });
            return;
          }
          throw e;
        } finally {
          if (renderTaskRef.current === (task as unknown)) renderTaskRef.current = null;
        }
        if (cancelled) return;

        const baseVp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        if (cancelled) return;
        const styles = (content as unknown as { styles: Record<string, { fontFamily?: string }> }).styles ?? {};
        type Raw = { str: string; transform: number[]; width: number; height: number; fontName?: string };
        const items: TextItem[] = (content.items as Raw[]).flatMap((it) => {
          if (!it.str || !it.str.trim()) return [];
          const m = pdfjs.Util.transform(baseVp.transform, it.transform);
          const fh = Math.hypot(m[2], m[3]);
          const ff = (it.fontName && styles[it.fontName]?.fontFamily) || it.fontName || "";
          const ffl = `${(it.fontName ?? "").toLowerCase()} ${ff.toLowerCase()}`;
          const family: "sans" | "serif" | "mono" =
            /mono|courier|consol|typewriter/.test(ffl) ? "mono" :
            /serif|times|roman|garamond|georgia|cambria|book|caslon|didot|bodoni|minion|baskerville/.test(ffl) ? "serif" :
            "sans";
          const bold = /bold|black|heavy|semibold|demibold|extrabold|ultrabold|800|900/.test(ffl);
          const italic = /italic|oblique/.test(ffl);
          const det = detectFontKey(it.fontName ?? ff, family, ff);
          const matchedFont = matchPdfFont(it.fontName || ff || "");
          const fontWeight = numericFontWeight(matchedFont.fontWeight, bold);
          const fontKey = det.key;
          const fontApprox = det.approximate;
          const x = m[4], y = m[5] - fh;
          const color = sampleTextColor(ctx, x * scale * dpr, y * scale * dpr, it.width * scale * dpr, fh * scale * dpr);
          const bg = samplePageBg(ctx, x * scale * dpr, y * scale * dpr, it.width * scale * dpr, fh * scale * dpr);
          const letterSpacing = estimateLetterSpacing(
            ctx,
            it.str,
            it.width,
            fh * scale * dpr,
            matchedFont.fontFamily,
            fontWeight,
            matchedFont.fontStyle ?? (italic ? "italic" : "normal"),
            scale * dpr,
          );
          return [{ x, y, w: it.width, h: fh, str: it.str, family, bold, italic, transform: it.transform, fontName: it.fontName, cssFamily: ff, fontKey, fontApprox, fontWeight, lineHeight: 1, letterSpacing, color, bg }];
        });

        // Merge sidecar OCR tokens for this SOURCE page (top-left PDF
        // points). These are rendered as synthetic TextItems so the
        // Edit-text tool can target them — the underlying srcBytes is
        // never modified.
        const ocrPage = state.doc?.ocrLayer?.find((p) => p.srcPage === op.srcPage);
        if (ocrPage && ocrPage.tokens.length) {
          const det = detectFontKey("Helvetica", "sans", "Helvetica");
          const ocrItems: TextItem[] = ocrPage.tokens.map((t) => ({
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            str: t.text,
            family: "sans",
            bold: false,
            italic: false,
            transform: [t.h, 0, 0, t.h, t.x, t.y + t.h],
            fontName: "Helvetica",
            fontKey: det.key,
            fontApprox: det.approximate,
            color: { r: 0, g: 0, b: 0 },
            bg: { r: 1, g: 1, b: 1 },
          }));
          items.push(...ocrItems);
        }

        setTextItems(items);
        setTextLoaded(true);

      } catch (err) {
        console.error("[workspace EditorCanvas] page render failed", err);
        setTextLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      // Cancel any in-flight render so the canvas isn't touched after teardown.
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* noop */ }
        renderTaskRef.current = null;
      }
      // Free the canvas backing store on unmount (virtualization tear-down).
      const c = canvasRef.current;
      if (c) { c.width = 0; c.height = 0; }
    };
  }, [op, srcBytes, scale, pdfDoc, state.doc?.ocrLayer]);


  // Coord helpers (no rotation in workspace — page renders unrotated for now).
  const toPdf = useCallback((sx: number, sy: number) => ({ x: sx / scale, y: sy / scale }), [scale]);
  const toScreen = useCallback((x: number, y: number) => ({ x: x * scale, y: y * scale }), [scale]);

  const getXY = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (state.tool === "select" || state.tool === "edit-text") return;
    e.preventDefault();
    overlayRef.current?.setPointerCapture(e.pointerId);
    const { x, y } = getXY(e);

    if (state.tool === "image" && state.pendingImage) {
      const { x: px, y: py } = toPdf(x, y);
      const targetW = Math.min(180, state.pendingImage.w * 0.5);
      const ratio = state.pendingImage.h / state.pendingImage.w;
      dispatch({ type: "ADD_ANNO", a: {
        id: uid(), kind: "image", page: pageIndex, x: px, y: py,
        w: targetW, h: targetW * ratio, color: { r: 0, g: 0, b: 0 }, opacity: state.opacity,
        dataUrl: state.pendingImage.dataUrl, mime: state.pendingImage.mime,
      } });
      dispatch({ type: "SET_PENDING_IMAGE", img: null });
      dispatch({ type: "SET_TOOL", t: "select" });
      return;
    }

    if (state.tool === "text") {
      const { x: px, y: py } = toPdf(x, y);
      const w = Math.max(160, state.fontSize * 10);
      const id = uid();
      dispatch({ type: "ADD_ANNO", a: {
        id, kind: "text", page: pageIndex,
        x: px, y: py, w, h: Math.max(state.fontSize * 1.6, 22),
        color: state.color, opacity: state.opacity, text: "", fontSize: state.fontSize,
      } });
      setEditingId(id);
      dispatch({ type: "SET_TOOL", t: "select" });
      dispatch({ type: "SELECT_ANNO", id });
      return;
    }

    if (state.tool === "note") {
      const { x: px, y: py } = toPdf(x, y);
      const id = uid();
      dispatch({ type: "ADD_ANNO", a: {
        id, kind: "note", page: pageIndex,
        x: px, y: py, w: 140, h: 70,
        color: state.color, opacity: state.opacity, text: "",
      } });
      setEditingId(id);
      dispatch({ type: "SET_TOOL", t: "select" });
      dispatch({ type: "SELECT_ANNO", id });
      return;
    }

    if (state.tool === "freehand") {
      setDrawing({ x0: x, y0: y, x, y, points: [{ x, y }] });
      return;
    }
    setDrawing({ x0: x, y0: y, x, y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing) return;
    const { x, y } = getXY(e);
    if (state.tool === "freehand") {
      setDrawing((d) => d && { ...d, x, y, points: [...(d.points ?? []), { x, y }] });
    } else {
      setDrawing((d) => d && { ...d, x, y });
    }
  };

  const onPointerUp = () => {
    if (!drawing) return;
    const { x0, y0, x, y, points } = drawing;
    setDrawing(null);
    if (state.tool === "freehand" && points && points.length > 1) {
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      const maxX = Math.max(...xs), maxY = Math.max(...ys);
      const tl = toPdf(minX, minY); const br = toPdf(maxX, maxY);
      const ax = Math.min(tl.x, br.x), ay = Math.min(tl.y, br.y);
      const aw = Math.abs(br.x - tl.x), ah = Math.abs(br.y - tl.y);
      const pdfPoints = points.map((p) => {
        const q = toPdf(p.x, p.y); return { x: q.x - ax, y: q.y - ay };
      });
      dispatch({ type: "ADD_ANNO", a: {
        id: uid(), kind: "freehand", page: pageIndex,
        x: ax, y: ay, w: aw || 1, h: ah || 1,
        color: state.color, opacity: state.opacity, stroke: state.stroke, points: pdfPoints,
      } });
      return;
    }
    const a = toPdf(Math.min(x0, x), Math.min(y0, y));
    const b = toPdf(Math.max(x0, x), Math.max(y0, y));
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w < 3 || h < 3) return;
    if (state.tool === "highlight") {
      const quads = computeQuads({ x: a.x, y: a.y, w, h }, textItems);
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "highlight", page: pageIndex, x: a.x, y: a.y, w, h, color: state.color, opacity: Math.min(state.opacity, 0.5), quads: quads.length ? quads : undefined } });
    } else if (state.tool === "underline") {
      const quads = computeQuads({ x: a.x, y: a.y, w, h }, textItems);
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "underline", page: pageIndex, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, quads: quads.length ? quads : undefined } });
    } else if (state.tool === "strikethrough") {
      const quads = computeQuads({ x: a.x, y: a.y, w, h }, textItems);
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "strikethrough", page: pageIndex, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, quads: quads.length ? quads : undefined } });
    } else if (state.tool === "rect") {
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "rect", page: pageIndex, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, fill: state.fillShape } });
    } else if (state.tool === "ellipse") {
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "ellipse", page: pageIndex, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, fill: state.fillShape } });
    } else if (state.tool === "line" || state.tool === "arrow") {
      const start = toPdf(x0, y0); const end = toPdf(x, y);
      const flipX = start.x > end.x;
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: state.tool, page: pageIndex, x: a.x, y: a.y, w, h, color: state.color, opacity: state.opacity, stroke: state.stroke, flipX } });
    } else if (state.tool === "redact") {
      const sources: TextSource[] = [];
      for (const it of textItems) {
        const ix2 = it.x + it.w, iy2 = it.y + it.h;
        const ox = Math.max(0, Math.min(a.x + w, ix2) - Math.max(a.x, it.x));
        const oy = Math.max(0, Math.min(a.y + h, iy2) - Math.max(a.y, it.y));
        if (ox > 1 && oy > it.h * 0.35) {
          sources.push({ originalString: it.str, transform: it.transform, fontName: it.fontName });
        }
      }
      dispatch({ type: "ADD_ANNO", a: { id: uid(), kind: "redact", page: pageIndex, x: a.x, y: a.y, w, h, color: { r: 0, g: 0, b: 0 }, opacity: 1, sources: sources.length ? sources : undefined } });
    } else if (state.tool === "page-crop") {
      // Clamp to page bounds (PDF points, top-left origin).
      const cx = Math.max(0, Math.min(a.x, op.width));
      const cy = Math.max(0, Math.min(a.y, op.height));
      const cw = Math.max(8, Math.min(w, op.width - cx));
      const ch = Math.max(8, Math.min(h, op.height - cy));
      dispatch({ type: "SET_PAGE_CROP", n: pageIndex, rect: { x: cx, y: cy, w: cw, h: ch } });
    }
  };

  /* ----------------------- annotation overlays ----------------------- */

  const renderAnno = (a: Anno) => {
    const selected = state.selectedAnnoId === a.id;
    const pts = [
      toScreen(a.x, a.y), toScreen(a.x + a.w, a.y),
      toScreen(a.x, a.y + a.h), toScreen(a.x + a.w, a.y + a.h),
    ];
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    const w = maxX - minX, h = maxY - minY;

    const isEditingThis = editingId === a.id;
    const interactive = state.tool === "select" || isEditingThis || selected;

    const onDownAnno = (e: React.MouseEvent) => {
      if (!(state.tool === "select" || selected)) return;
      if (isEditingThis) return;
      e.stopPropagation();
      dispatch({ type: "SELECT_ANNO", id: a.id });
      // text-edit replacements are LOCKED to the original glyph position —
      // they replace existing text in place and must never drift. Click only
      // selects / enters edit mode; no drag.
      if (a.kind === "text-edit") {
        const downX = e.clientX, downY = e.clientY;
        const up = (ev: MouseEvent) => {
          window.removeEventListener("mouseup", up);
          if (Math.hypot(ev.clientX - downX, ev.clientY - downY) < 3 && selected) {
            setEditingId(a.id);
          }
        };
        window.addEventListener("mouseup", up);
        return;
      }
      const startX = e.clientX, startY = e.clientY;
      const origX = a.x, origY = a.y;
      let moved = false;
      const move = (ev: MouseEvent) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { x: origX + dx / scale, y: origY + dy / scale } as Partial<Anno> });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (!moved && selected && (a.kind === "text" || a.kind === "note")) setEditingId(a.id);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };

    const onResize = (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const origW = a.w, origH = a.h;
      const move = (ev: MouseEvent) => {
        const dw = (ev.clientX - startX) / scale, dh = (ev.clientY - startY) / scale;
        dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { w: Math.max(8, origW + dw), h: Math.max(8, origH + dh) } as Partial<Anno> });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };

    const isLocked = a.kind === "text-edit";
    const baseStyle: React.CSSProperties = {
      position: "absolute", left: minX, top: minY, width: w, height: h,
      pointerEvents: interactive ? "auto" : "none",
      cursor: isEditingThis ? "text" : isLocked ? "text" : interactive ? "move" : "default",
      zIndex: a.kind === "text-edit" ? 2 : undefined,
    };


    let inner: React.ReactNode = null;
    switch (a.kind) {
      case "highlight":
        if (a.quads?.length) {
          inner = (
            <div style={{ position: "absolute", inset: 0 }}>
              {a.quads.map((q, qi) => (
                <div key={qi} style={{ position: "absolute",
                  left: (q.x - a.x) * scale, top: (q.y - a.y) * scale,
                  width: q.w * scale, height: q.h * scale,
                  background: rgbCss(a.color, a.opacity), mixBlendMode: "multiply" }} />
              ))}
            </div>
          );
        } else {
          inner = <div style={{ width: "100%", height: "100%", background: rgbCss(a.color, a.opacity), mixBlendMode: "multiply" }} />;
        }
        break;
      case "underline": {
        const sw = Math.max(1, a.stroke * scale);
        inner = a.quads?.length ? (
          <div style={{ position: "absolute", inset: 0 }}>
            {a.quads.map((q, qi) => (
              <div key={qi} style={{ position: "absolute",
                left: (q.x - a.x) * scale,
                top: (q.y - a.y + q.h) * scale - sw,
                width: q.w * scale, height: sw,
                background: rgbCss(a.color, a.opacity) }} />
            ))}
          </div>
        ) : (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: sw, background: rgbCss(a.color, a.opacity) }} />
        );
        break;
      }
      case "strikethrough": {
        const sw = Math.max(1, a.stroke * scale);
        inner = a.quads?.length ? (
          <div style={{ position: "absolute", inset: 0 }}>
            {a.quads.map((q, qi) => (
              <div key={qi} style={{ position: "absolute",
                left: (q.x - a.x) * scale,
                top: (q.y - a.y + q.h / 2) * scale - sw / 2,
                width: q.w * scale, height: sw,
                background: rgbCss(a.color, a.opacity) }} />
            ))}
          </div>
        ) : (
          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: sw, background: rgbCss(a.color, a.opacity), transform: "translateY(-50%)" }} />
        );
        break;
      }
      case "redact":
        inner = <div style={{ width: "100%", height: "100%", background: "#000" }} />;
        break;
      case "line":
      case "arrow": {
        const sw = a.w, sh = a.h;
        const x1 = a.flipX ? sw : 0, y1 = 0, x2 = a.flipX ? 0 : sw, y2 = sh;
        const stroke = rgbCss(a.color, a.opacity);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 10 + a.stroke * 1.5;
        const sp = Math.PI / 7;
        const hx1 = x2 - headLen * Math.cos(ang - sp);
        const hy1 = y2 - headLen * Math.sin(ang - sp);
        const hx2 = x2 - headLen * Math.cos(ang + sp);
        const hy2 = y2 - headLen * Math.sin(ang + sp);
        inner = (
          <svg width="100%" height="100%" viewBox={`0 0 ${sw} ${sh}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={a.stroke} strokeLinecap="round" />
            {a.kind === "arrow" && (
              <>
                <line x1={x2} y1={y2} x2={hx1} y2={hy1} stroke={stroke} strokeWidth={a.stroke} strokeLinecap="round" />
                <line x1={x2} y1={y2} x2={hx2} y2={hy2} stroke={stroke} strokeWidth={a.stroke} strokeLinecap="round" />
              </>
            )}
          </svg>
        );
        break;
      }
      case "rect":
        inner = <div style={{ width: "100%", height: "100%", border: `${a.stroke * scale}px solid ${rgbCss(a.color, a.opacity)}`, background: a.fill ? rgbCss(a.color, a.opacity) : "transparent" }} />;
        break;
      case "ellipse":
        inner = <div style={{ width: "100%", height: "100%", borderRadius: "50%", border: `${a.stroke * scale}px solid ${rgbCss(a.color, a.opacity)}`, background: a.fill ? rgbCss(a.color, a.opacity) : "transparent" }} />;
        break;
      case "text":
      case "text-edit": {
        const isEditing = editingId === a.id;
        // Cover is rendered as a separate fixed-position layer (see below);
        // the text box itself stays transparent so it can grow without
        // changing the cover area.
        const bg = "transparent";
        const fam = resolveTextFontFamily(a);
        const padTop = a.kind === "text-edit" && a.textOffsetY ? a.textOffsetY * scale : 0;
        const padX = a.kind === "text-edit" ? (a.textOffsetX ?? Math.max(2, a.fontSize * 0.18)) * scale : 0;
        const padBottom = a.kind === "text-edit" && a.textPadBottom ? a.textPadBottom * scale : 0;
        const align = a.align ?? "left";
        const fontWeight = a.fontWeight ?? (a.bold ? 700 : 400);
        const isItalic = !!a.italic;
        const isUnderline = !!a.underline;
        // While editing a freshly-added text box, give it visible chrome so the
        // user can see where they're typing. text-edit (replacing existing PDF
        // text) keeps the transparent skin so it blends with surrounding glyphs.
        const showEditChrome = isEditing && a.kind === "text";
        const textColor = rgbCss(a.color, a.opacity);
        const textStyle: React.CSSProperties = {
          width: "100%", height: "100%",
          background: showEditChrome ? "rgba(255,255,255,0.96)" : bg,
          color: textColor,
          WebkitTextFillColor: textColor,
          fontSize: a.fontSize * scale,
          fontFamily: fam,
          fontWeight,
          fontStyle: isItalic ? "italic" : "normal",
          textDecoration: isUnderline ? "underline" : "none",
          textAlign: align,
          lineHeight: a.lineHeight ?? 1.15,
          letterSpacing: a.letterSpacing != null ? `${a.letterSpacing * scale}px` : undefined,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "hidden",
          padding: 0,
          paddingTop: padTop,
          paddingLeft: padX,
          paddingRight: padX,
          paddingBottom: padBottom,
          boxSizing: "border-box",
          margin: 0,
          border: showEditChrome ? "1.5px solid var(--vault)" : "none",
          outline: "none",
          resize: "none",
          borderRadius: showEditChrome ? 3 : 0,
          boxShadow: showEditChrome ? "0 0 0 3px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.25)" : "none",
          caretColor: rgbCss(a.color),
        };
        const onTextChange = (text: string) =>
          dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { text } as Partial<Anno> });
        inner = isEditing ? (
          <textarea
            autoFocus
            value={a.text}
            placeholder={a.kind === "text" ? "Type here…" : ""}
            onChange={(e) => onTextChange(e.target.value)}
            onBlur={(e) => {
              // If focus is moving to the floating mini-toolbar (or anything
              // inside the same page wrapper), keep editing alive — the user
              // is just nudging a control. Only collapse / auto-delete when
              // focus truly leaves the text box context.
              const next = e.relatedTarget as HTMLElement | null;
              if (next && next.closest('[data-text-toolbar="1"]')) return;
              // Read the textarea's value directly to avoid a stale closure on
              // `a.text` when blur fires before React flushes the last keystroke.
              const finalText = e.currentTarget.value;
              if (finalText !== a.text) {
                dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { text: finalText } as Partial<Anno> });
              }
              if (!finalText.trim() && a.kind === "text") {
                dispatch({ type: "DELETE_ANNO", id: a.id });
              }
              setEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            data-text-edit-id={a.id}
            data-raw-pdf-font={a.kind === "text-edit" ? a.source?.fontName ?? "" : ""}
            style={textStyle}
          />
        ) : (
          <div style={textStyle}>{a.text || (a.kind === "text" ? "Type here…" : "")}</div>
        );
        break;
      }
      case "note": {
        const isEditing = editingId === a.id;
        const noteStyle: React.CSSProperties = {
          width: "100%", height: "100%",
          background: "rgba(255,229,77,0.95)",
          border: "1px solid #b89800",
          color: "#000",
          fontSize: 9 * scale,
          padding: 4 * scale,
          overflow: "hidden",
          fontFamily: "Helvetica, Arial, sans-serif",
          lineHeight: 1.2, margin: 0, outline: "none", resize: "none",
        };
        inner = isEditing ? (
          <textarea
            autoFocus
            value={a.text}
            onChange={(e) => dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { text: e.target.value } as Partial<Anno> })}
            onBlur={() => {
              if (!a.text.trim()) dispatch({ type: "DELETE_ANNO", id: a.id });
              setEditingId(null);
            }}
            onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={noteStyle}
          />
        ) : (
          <div style={noteStyle}>{a.text || "Note…"}</div>
        );
        break;
      }
      case "image":
        inner = <img src={a.dataUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", opacity: a.opacity }} />;
        break;
      case "freehand": {
        const sw = a.w, sh = a.h;
        const d = a.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        inner = (
          <svg width="100%" height="100%" viewBox={`0 0 ${sw} ${sh}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
            <path d={d} stroke={rgbCss(a.color, a.opacity)} strokeWidth={a.stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
        break;
      }
    }

    return (
      <div
        key={a.id}
        style={baseStyle}
        onMouseDown={onDownAnno}
        onDoubleClick={(e) => {
          if (a.kind === "text" || a.kind === "note" || a.kind === "text-edit") {
            e.stopPropagation(); setEditingId(a.id);
          }
        }}
      >
        {inner}
        {selected && (
          <>
            {/* Dark outer halo for contrast on any background */}
            <div style={{ position: "absolute", inset: -4, border: "1px solid rgba(0,0,0,0.55)", borderRadius: 2, pointerEvents: "none" }} />
            {/* Solid amber selection ring */}
            <div style={{ position: "absolute", inset: -2, border: "2px solid var(--vault)", borderRadius: 2, boxShadow: "0 0 0 1px rgba(255,255,255,0.9)", pointerEvents: "none" }} />
            {!isLocked && <div onMouseDown={onResize} style={{ position: "absolute", right: -7, bottom: -7, width: 14, height: 14, background: "var(--vault)", border: "2px solid white", borderRadius: 3, cursor: "nwse-resize", boxShadow: "0 1px 3px rgba(0,0,0,0.5)" }} />}
            <button
              onClick={(e) => { e.stopPropagation(); dispatch({ type: "DELETE_ANNO", id: a.id }); }}
              style={{ position: "absolute", top: -10, right: -10, background: "#dc2626", color: "white", borderRadius: 999, width: 18, height: 18, fontSize: 10, lineHeight: 1, display: "grid", placeItems: "center", border: "none", cursor: "pointer" }}
            >×</button>
          </>
        )}
      </div>
    );
  };

  /* ----------------------- edit-text hits ----------------------- */

  const editTextOverlays = state.tool === "edit-text" ? textItems : [];
  const onClickEditHit = (it: TextItem) => {
    // Workspace native: place a text-edit overlay pre-filled with the original
    // string. The user edits inline; double-click switches modes.
    // Cover bbox: expand generously around the captured glyph bounds so
    // anti-aliased thick strokes, italic skew, and ascenders/descenders
    // never leak through. Pad more vertically because pdf.js' glyph bbox
    // hugs cap-height; descenders ("y", "g") sit a few px below.
    const coverPadX = Math.max(2, it.h * (it.italic ? 0.28 : 0.18));
    const coverPadTop = Math.max(2, it.h * (it.bold ? 0.30 : 0.22));
    const coverPadBottom = Math.max(2, it.h * 0.40);
    const cover = {
      x: it.x - coverPadX,
      y: it.y - coverPadTop,
      w: it.w + coverPadX * 2,
      h: it.h + coverPadTop + coverPadBottom,
    };
    const originalGlyph = { x: it.x, y: it.y, w: it.w, h: it.h };
    const id = uid();
    // Preserve the detected run font from the underlying text layer so
    // editing a scanned word doesn't suddenly swap families on the user.
    const fontKey = it.fontKey;
    const family: TextAnno["family"] = it.family;
    // Translate the PDF's internal PostScript name (e.g. "Inter-Bold",
    // "TimesNewRomanPSMT") into a real CSS font stack. When the match
    // resolves to a Google Font, the toolbar's useGoogleFontLoader picks
    // it up and injects the stylesheet — so the editable overlay renders
    // in the document's actual typeface, not a generic substitute.
    // Try the PostScript name first (richest signal), then fall back to the
    // CSS family pdf.js resolved from the embedded font dictionary. The
    // matcher already strips `AAAAAA+` subset prefixes internally.
    const tryNames = [it.fontName, it.cssFamily].filter(Boolean) as string[];
    let matched: ReturnType<typeof matchPdfFont> | null = null;
    for (const n of tryNames) {
      const r = matchPdfFont(n);
      matched = r;
      if (r.matched) break;
    }
    const fontFamilyOverride = matched?.fontFamily;
    const fontWeight = numericFontWeight(matched?.fontWeight, it.bold);
    console.log("[text-edit-font] extraction", {
      rawPdfFontName: it.fontName,
      pdfCssFamily: it.cssFamily,
      matchedFontName: matched?.matched ? cssFontFamilyName(matched.fontFamily) : "(unmatched — preserving raw name)",
      fontFamilyOverride: fontFamilyOverride ?? "",
      fontKey,
      fontApproximate: !!it.fontApprox,
      fontSize: it.h,
      fontWeight,
      lineHeight: it.lineHeight ?? 1,
      letterSpacing: it.letterSpacing ?? 0,
    });
    dispatch({ type: "ADD_ANNO", a: {
      id, kind: "text-edit", page: pageIndex,
      x: cover.x, y: cover.y,
      w: cover.w, h: cover.h,
      color: it.color, opacity: 1,
      text: it.str,
      fontSize: it.h,
      bg: it.bg,
      family,
      fontKey,
      fontFamilyOverride,
      fontApproximate: !!it.fontApprox,
      bold: it.bold, italic: it.italic,
      fontWeight,
      lineHeight: it.lineHeight ?? 1,
      letterSpacing: it.letterSpacing ?? 0,
      textOffsetX: it.x - cover.x,
      textOffsetY: it.y - cover.y,
      textPadBottom: cover.y + cover.h - (it.y + it.h),
      cover,
      source: { originalString: it.str, transform: it.transform, fontName: it.fontName, cssFamily: it.cssFamily },
    } });
    console.log("[text-edit-bounds-init]", {
      id,
      originalGlyphPdf: originalGlyph,
      coverPdf: cover,
      annoPdf: cover,
      pads: { coverPadX, coverPadTop, coverPadBottom },
      sampledBg: it.bg,
      intendedCoverBackground: `rgba(${Math.round(it.bg.r*255)},${Math.round(it.bg.g*255)},${Math.round(it.bg.b*255)},1)`,
    });
    dispatch({ type: "SELECT_ANNO", id });
    dispatch({ type: "SET_TOOL", t: "select" });
    setEditingId(id);
  };

  const cursorByTool: Record<string, string> = {
    select: "default", text: "text", highlight: "crosshair",
    underline: "crosshair", strikethrough: "crosshair",
    rect: "crosshair", ellipse: "crosshair", line: "crosshair", arrow: "crosshair",
    freehand: "crosshair", note: "copy", image: "copy", "edit-text": "pointer",
    "page-crop": "crosshair", redact: "crosshair",
  };

  const screenW = canvasRef.current?.width ?? Math.ceil(op.width * scale);
  const screenH = canvasRef.current?.height ?? Math.ceil(op.height * scale);

  // The currently active text box (editing OR selected). Used to drive the
  // floating mini-toolbar and the auto-grow measurement loop.
  const activeText = annos.find(
    (a) =>
      (a.id === editingId || a.id === state.selectedAnnoId) &&
      (a.kind === "text" || a.kind === "text-edit"),
  ) as (typeof annos[number] & { kind: "text" | "text-edit" }) | undefined;

  useEffect(() => {
    if (!activeText || activeText.kind !== "text-edit") return;
    const frame = window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-text-edit-id="${activeText.id}"]`);
      if (!el) return;
      const computed = window.getComputedStyle(el);
      const override = activeText.fontFamilyOverride ?? "";
      console.log("[text-edit-font] dom", {
        rawPdfFontName: activeText.source?.fontName ?? "",
        matchedFontName: override
          ? cssFontFamilyName(override)
          : activeText.fontKey && FONT_META[activeText.fontKey as FontKey]
          ? FONT_META[activeText.fontKey as FontKey].label
          : "",
        fontFamilyOverride: override,
        computedDomFontFamily: computed.fontFamily,
        computedFontWeight: computed.fontWeight,
        computedLineHeight: computed.lineHeight,
        computedLetterSpacing: computed.letterSpacing,
      });
      // Layout audit: compare the original extracted text bbox (in PDF
      // points, captured at click time) to the live textarea geometry
      // (screen pixels, converted back to PDF points via `scale`).
      const rect = el.getBoundingClientRect();
      const wrap = el.closest<HTMLElement>("[data-vault-element='page-wrap']")
        ?? el.offsetParent as HTMLElement | null;
      const wrapRect = wrap?.getBoundingClientRect();
      const cover = activeText.cover;
      console.log("[text-edit-layout]", {
        id: activeText.id,
        // Original extracted bbox (PDF points)
        extractedLeft: cover?.x ?? null,
        extractedTop: cover?.y ?? null,
        extractedWidth: cover?.w ?? null,
        extractedHeight: cover?.h ?? null,
        // Annotation box (PDF points) — what the textarea is anchored to
        annoLeft: activeText.x,
        annoTop: activeText.y,
        annoWidth: activeText.w,
        annoHeight: activeText.h,
        // Live textarea (screen px and PDF-point equivalent)
        textareaLeftPx: wrapRect ? rect.left - wrapRect.left : rect.left,
        textareaTopPx: wrapRect ? rect.top - wrapRect.top : rect.top,
        textareaWidthPx: rect.width,
        textareaHeightPx: rect.height,
        textareaLeftPt: (wrapRect ? rect.left - wrapRect.left : rect.left) / scale,
        textareaTopPt: (wrapRect ? rect.top - wrapRect.top : rect.top) / scale,
        textareaWidthPt: rect.width / scale,
        textareaHeightPt: rect.height / scale,
        scale,
        text: activeText.text,
      });
      // Bounds audit — query the cover DOM and compare screen rects of
      // original glyphs vs cover vs textarea. Also surface intended vs
      // computed background so we can prove whether the transparent branch
      // ran and whether another rule overrides it.
      const coverEl = document.querySelector<HTMLElement>(
        `[data-vault-element='text-edit-cover'][data-anno-id='${activeText.id}']`,
      );
      const coverRect = coverEl?.getBoundingClientRect();
      const coverComputed = coverEl ? window.getComputedStyle(coverEl) : null;
      const intendedBackground = `rgba(${Math.round(activeText.bg.r*255)},${Math.round(activeText.bg.g*255)},${Math.round(activeText.bg.b*255)},1)`;
      // Textarea visibility audit — computed paint properties that can hide
      // glyphs (color match, opacity, -webkit-text-fill-color, visibility).
      console.log("[text-edit-style]", {
        id: activeText.id,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        opacity: computed.opacity,
        visibility: computed.visibility,
        display: computed.display,
        zIndex: computed.zIndex,
        webkitTextFillColor:
          (computed as any).webkitTextFillColor ??
          computed.getPropertyValue("-webkit-text-fill-color"),
        caretColor:
          (computed as any).caretColor ?? computed.getPropertyValue("caret-color"),
        textareaInlineColor: (el as HTMLElement).style.color,
        expectedTextColor: rgbCss(activeText.color, activeText.opacity),
        originalString: activeText.source?.originalString ?? "",
        currentText: activeText.text,
      });
      console.log("[text-edit-layers]", {
        id: activeText.id,
        coverZIndex: coverComputed?.zIndex ?? "(no cover)",
        textareaZIndex: computed.zIndex,
        // The cover is fixed below the editable annotation wrapper so it can
        // hide the PDF canvas glyphs without covering the live textarea text.
        coverDomIndex: coverEl
          ? Array.from(coverEl.parentElement?.children ?? []).indexOf(coverEl)
          : -1,
        textareaWrapperDomIndex: (() => {
          const wrapAnno = el.parentElement; // baseStyle wrapper for the anno
          const parent = wrapAnno?.parentElement;
          return parent && wrapAnno
            ? Array.from(parent.children).indexOf(wrapAnno)
            : -1;
        })(),
      });
      console.log("[text-edit-width-explain]", {
        id: activeText.id,
        extractedWidthPt: activeText.cover?.w ?? null,
        textareaWidthPt: rect.width / scale,
        annoWidthPt: activeText.w,
        deltaPt: (activeText.cover?.w ?? 0) - rect.width / scale,
        coverPadXApproxPt:
          ((activeText.cover?.w ?? 0) - activeText.w) / 2,
        note:
          "The textarea wrapper now uses the same PDF rectangle as the cover; any small remaining delta is DOM pixel rounding at the current zoom.",
      });
      console.log("[text-edit-bounds]", {
        id: activeText.id,
        intendedBackground,
        computedBackground: coverComputed?.backgroundColor ?? "(no cover element)",
        coverInlineStyle: coverEl?.style.background ?? "(no cover element)",
        coverScreen: coverRect && wrapRect
          ? { x: coverRect.left - wrapRect.left, y: coverRect.top - wrapRect.top, w: coverRect.width, h: coverRect.height }
          : null,
        textareaScreen: wrapRect
          ? { x: rect.left - wrapRect.left, y: rect.top - wrapRect.top, w: rect.width, h: rect.height }
          : null,
        coverPdf: activeText.cover,
        annoPdf: { x: activeText.x, y: activeText.y, w: activeText.w, h: activeText.h },
        editing: editingId === activeText.id,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeText, scale, editingId]);

  // Auto-grow the active text box to fit its content. Position stays locked
  // at (a.x, a.y); only width/height grow from the anchored origin.
  useEffect(() => {
    if (!activeText) return;
    const el = measureRef.current;
    if (!el) return;
    const a = activeText;
    const fam = resolveTextFontFamily(a);
    const padTop = a.kind === "text-edit" && a.textOffsetY ? a.textOffsetY : 0;
    const padX = a.kind === "text-edit" ? (a.textOffsetX ?? Math.max(2, a.fontSize * 0.18)) : 0;
    const padBottom = a.kind === "text-edit" ? (a.textPadBottom ?? Math.max(2, a.fontSize * 0.4)) : 0;
    el.style.fontSize = `${a.fontSize * scale}px`;
    el.style.fontFamily = fam;
    el.style.fontWeight = `${a.fontWeight ?? (a.bold ? 700 : 400)}`;
    el.style.fontStyle = a.italic ? "italic" : "normal";
    el.style.lineHeight = `${a.lineHeight ?? 1.15}`;
    el.style.letterSpacing = a.letterSpacing != null ? `${a.letterSpacing * scale}px` : "normal";
    el.style.whiteSpace = "pre";
    el.textContent = a.text && a.text.length > 0 ? a.text : " ";
    // Measure widest line + total height; convert px → PDF points.
    const measuredW = el.offsetWidth / scale + padX * 2 + 1;
    const measuredH = el.offsetHeight / scale + padTop + padBottom + 1;
    const minW = a.kind === "text" ? Math.max(40, a.fontSize * 2) : 8;
    const minH = a.fontSize * 1.15 + padTop + padBottom;
    const lockedW = a.kind === "text-edit" && a.cover ? a.cover.w : null;
    const lockedH = a.kind === "text-edit" && a.cover ? a.cover.h : null;
    const newW = lockedW ?? Math.max(minW, measuredW);
    const newH = lockedH ?? Math.max(minH, measuredH);
    if (Math.abs(newW - a.w) > 0.5 || Math.abs(newH - a.h) > 0.5) {
      dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { w: newW, h: newH } as Partial<Anno> });
    }
  }, [activeText, scale, dispatch]);

  // Scanned-page detection: text content has resolved but pdf.js found
  // essentially no real glyphs. Independent of the active tool — the shell
  // decides when to actually show the OCR offer (only in edit-text mode).
  const looksScanned = textLoaded && !op.blank && textItems.length < 3;
  useEffect(() => {
    onScannedChange?.(pageIndex, looksScanned);
    return () => { onScannedChange?.(pageIndex, false); };
  }, [pageIndex, looksScanned, onScannedChange]);
  void bannerDismissed; // legacy — now owned by the shell-level banner
  void ocrRunning;
  void onRequestOcr;

  return (
    <div className="relative inline-block" style={{ background: "transparent", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", borderRadius: 6 }}>
      <canvas ref={canvasRef} className="block" />


      <div
        ref={overlayRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => {
          if (state.tool === "select" && e.target === e.currentTarget)
            dispatch({ type: "SELECT_ANNO", id: null });
        }}
        style={{ position: "absolute", inset: 0, width: screenW, height: screenH, cursor: cursorByTool[state.tool] ?? "default" }}
      >
        {/* Fixed cover rectangles for text-edit annotations — drawn FIRST so
            they sit beneath the editable text box but always hide the
            original glyphs at their captured bounds (independent of the
            auto-grown text box size). */}
        {(() => {
          // Count rendered text-edit overlays per annotation id for the
          // duplicate-text audit.
          const textEditCounts = new Map<string, number>();
          for (const a of annos) {
            if (a.kind === "text-edit") {
              textEditCounts.set(a.id, (textEditCounts.get(a.id) ?? 0) + 1);
            }
          }
          for (const [id, n] of textEditCounts) {
            console.log("[text-edit-render]", {
              annotationId: id,
              renderCount: n,
              editingId,
              expected: 1,
            });
          }
          return null;
        })()}
        {annos.map((a) => {
          if (a.kind !== "text-edit" || !a.cover) return null;
          // A text-edit annotation is a PERMANENT replacement of the
          // underlying PDF glyphs. The cover must always be painted —
          // even when the typed text still matches the original — or the
          // PDF canvas glyphs will show through and double up with the
          // overlay textarea on top, producing duplicate text.
          const isEditing = editingId === a.id;
          const tl = toScreen(a.cover.x, a.cover.y);
          const br = toScreen(a.cover.x + a.cover.w, a.cover.y + a.cover.h);
          const bgCss = rgbCss(a.bg);
          if (isEditing) {
            console.log("[text-edit-cover]", {
              id: a.id,
              editing: true,
              background: bgCss,
              sampledBg: a.bg,
              coverPdf: a.cover,
              coverScreen: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
            });
          }
          return (
            <div
              key={`cover-${a.id}`}
              data-vault-element="text-edit-cover"
              data-anno-id={a.id}
              style={{
                position: "absolute",
                left: tl.x, top: tl.y,
                width: br.x - tl.x, height: br.y - tl.y,
                background: bgCss,
                pointerEvents: "none",
                zIndex: 1,
              }}
            />
          );
        })}
        {annos.map(renderAnno)}
        {editTextOverlays.map((it, i) => {
          const tl = toScreen(it.x, it.y);
          const br = toScreen(it.x + it.w, it.y + it.h);
          return (
            <div
              key={i}
              onClick={(e) => { e.stopPropagation(); onClickEditHit(it); }}
              title={it.str}
              style={{
                position: "absolute", left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y,
                background: "rgba(0,128,255,0.08)", border: "1px dashed rgba(0,128,255,0.5)",
                cursor: "text", pointerEvents: "auto",
              }}
            />
          );
        })}
        {op.cropBox && (() => {
          const tl = toScreen(op.cropBox.x, op.cropBox.y);
          const br = toScreen(op.cropBox.x + op.cropBox.w, op.cropBox.y + op.cropBox.h);
          const cw = br.x - tl.x, ch = br.y - tl.y;
          const showHandles = state.tool === "page-crop";
          return (
            <>
              {/* dim outside the crop */}
              <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: tl.y, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: 0, top: br.y, right: 0, bottom: 0, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: 0, top: tl.y, width: tl.x, height: ch, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: br.x, top: tl.y, right: 0, height: ch, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
              {/* crop rect outline */}
              <div style={{ position: "absolute", left: tl.x, top: tl.y, width: cw, height: ch, border: "1.5px dashed var(--vault)", boxShadow: "0 0 0 1px rgba(0,0,0,0.4) inset", pointerEvents: "none" }} />
              {showHandles && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: "SET_PAGE_CROP", n: pageIndex, rect: null }); }}
                  title="Clear crop on this page"
                  style={{ position: "absolute", left: br.x - 12, top: tl.y - 12, width: 22, height: 22, borderRadius: 999, background: "#dc2626", color: "white", border: "2px solid white", fontSize: 12, lineHeight: 1, display: "grid", placeItems: "center", cursor: "pointer", zIndex: 2 }}
                >×</button>
              )}
            </>
          );
        })()}
        {drawing && state.tool !== "select" && (
          <DrawingPreview drawing={drawing} state={state} />
        )}
      </div>
      {/* Floating mini-toolbar rendered OUTSIDE the overlay so it never
          blocks pointer events on the text box beneath it. */}
      {activeText && (
        <TextMiniToolbar
          anno={activeText}
          scale={scale}
          pageW={screenW}
          pageH={screenH}
          dispatch={dispatch}
        />
      )}
      {/* Off-screen measurement node for auto-grow. Positioned far off-canvas
          and read via offsetWidth/offsetHeight to size the active text box. */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute", left: -99999, top: -99999, visibility: "hidden",
          whiteSpace: "pre", display: "inline-block", padding: 0, margin: 0,
        }}
      />
    </div>
  );
}

function DrawingPreview({
  drawing, state,
}: {
  drawing: { x0: number; y0: number; x: number; y: number; points?: { x: number; y: number }[] };
  state: State;
}) {
  if (state.tool === "freehand" && drawing.points) {
    const d = drawing.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    return (
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
        <path d={d} stroke={rgbCss(state.color, state.opacity)} strokeWidth={state.stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  const x = Math.min(drawing.x0, drawing.x), y = Math.min(drawing.y0, drawing.y);
  const w = Math.abs(drawing.x - drawing.x0), h = Math.abs(drawing.y - drawing.y0);
  const style: React.CSSProperties = { position: "absolute", left: x, top: y, width: w, height: h, pointerEvents: "none" };
  if (state.tool === "highlight") return <div style={{ ...style, background: rgbCss(state.color, Math.min(state.opacity, 0.5)), mixBlendMode: "multiply" }} />;
  if (state.tool === "underline") return <div style={{ ...style, borderBottom: `${state.stroke}px solid ${rgbCss(state.color, state.opacity)}` }} />;
  if (state.tool === "strikethrough") return <div style={{ ...style, borderTop: `${state.stroke}px solid ${rgbCss(state.color, state.opacity)}`, marginTop: h / 2 }} />;
  if (state.tool === "ellipse") return <div style={{ ...style, border: `${state.stroke}px solid ${rgbCss(state.color, state.opacity)}`, borderRadius: "50%", background: state.fillShape ? rgbCss(state.color, state.opacity) : "transparent" }} />;
  if (state.tool === "rect") return <div style={{ ...style, border: `${state.stroke}px solid ${rgbCss(state.color, state.opacity)}`, background: state.fillShape ? rgbCss(state.color, state.opacity) : "transparent" }} />;
  if (state.tool === "redact") return <div style={{ ...style, background: "#000" }} />;
  if (state.tool === "page-crop") return <div style={{ ...style, border: "1.5px dashed var(--vault)", background: "rgba(245, 158, 11, 0.08)" }} />;
  if (state.tool === "line" || state.tool === "arrow") {
    return (
      <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
        <line x1={drawing.x0} y1={drawing.y0} x2={drawing.x} y2={drawing.y} stroke={rgbCss(state.color, state.opacity)} strokeWidth={state.stroke} strokeLinecap="round" />
      </svg>
    );
  }
  return null;
}

/* ---------------- Floating mini-toolbar for active text boxes ---------------- */

const TOOLBAR_COLORS: RGB[] = [
  { r: 0,    g: 0,    b: 0    },
  { r: 1,    g: 1,    b: 1    },
  { r: 0.95, g: 0.2,  b: 0.2  },
  { r: 0.95, g: 0.65, b: 0.1  },
  { r: 0.15, g: 0.55, b: 0.95 },
  { r: 0.15, g: 0.65, b: 0.35 },
];

// All bundled metric-compatible open fonts. These are the only families we
// can embed into the exported PDF, so the toolbar lists every one of them
// with both its name and the proprietary face it stands in for.
const TOOLBAR_FONTS: { key: FontKey; label: string }[] = FONT_KEYS.map((k) => ({
  key: k,
  label: `${FONT_META[k].label} — ${FONT_META[k].matches}`,
}));


function TextMiniToolbar({
  anno, scale, pageW, pageH, dispatch,
}: {
  anno: Anno & { kind: "text" | "text-edit" };
  scale: number;
  pageW: number;
  pageH: number;
  dispatch: React.Dispatch<Action>;
}) {
  const update = (patch: Partial<Anno>) =>
    dispatch({ type: "UPDATE_ANNO", id: anno.id, patch });
  const a = anno;
  const margin = 10;
  const tbRef = useRef<HTMLDivElement>(null);
  const [tbSize, setTbSize] = useState({ w: 460, h: 80 });
  const [placeBelow, setPlaceBelow] = useState(false);

  const screenLeft = a.x * scale;
  const screenTop = a.y * scale;
  const screenW = a.w * scale;
  const screenH = a.h * scale;

  // Measure the actual toolbar size, then decide above vs below based on the
  // text box's position in the VIEWPORT (not just the page). This ensures the
  // toolbar never covers the text being edited regardless of scroll position.
  useEffect(() => {
    const el = tbRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setTbSize({ w: r.width, h: r.height });
      // Find the text box on screen via the page wrapper coords.
      const page = el.parentElement;
      if (!page) return;
      const pageRect = page.getBoundingClientRect();
      const textTopVp = pageRect.top + screenTop;
      const textBottomVp = pageRect.top + screenTop + screenH;
      const roomAbove = textTopVp;
      const roomBelow = window.innerHeight - textBottomVp;
      const needed = r.height + margin;
      // Prefer above; flip below only if there's not enough room above AND
      // there IS room below.
      if (roomAbove < needed && roomBelow >= needed) setPlaceBelow(true);
      else if (roomAbove >= needed) setPlaceBelow(false);
      else setPlaceBelow(roomBelow > roomAbove); // both tight — pick the larger gap
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [screenTop, screenH, a.id]);

  const top = placeBelow
    ? screenTop + screenH + margin
    : screenTop - tbSize.h - margin;
  let left = screenLeft + screenW / 2 - tbSize.w / 2;
  left = Math.max(4, Math.min(left, pageW - tbSize.w - 4));

  const btn: React.CSSProperties = {
    height: 26, minWidth: 26, padding: "0 6px",
    background: "transparent", color: "#fff",
    border: "none", borderRadius: 4, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontFamily: "Helvetica, Arial, sans-serif",
  };
  const activeBtn: React.CSSProperties = { ...btn, background: "rgba(245,158,11,0.25)", color: "#fbbf24" };
  const sep: React.CSSProperties = { width: 1, height: 18, background: "rgba(255,255,255,0.12)", margin: "0 4px" };

  const currentFontKey: FontKey =
    (a.kind === "text-edit" ? (a.fontKey as FontKey | undefined) : undefined) ??
    (a.family === "serif" ? "tinos" : a.family === "mono" ? "cousine" : "arimo");

  const manualFamily = (a as { fontFamilyOverride?: string }).fontFamilyOverride ?? "";
  const currentFontValue = manualFamily ? "__detected" : currentFontKey;
  const detectedFamilyLabel = cssFontFamilyName(manualFamily) || (a.kind === "text-edit" ? a.source?.fontName : "") || "Detected font";
  // Lazy-load the chosen Google Font when the user picks one from the
  // manual override dropdown (system fonts are skipped inside the hook).
  useGoogleFontLoader(manualFamily.split(",")[0]?.replace(/['"]/g, "").trim());

  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };
  // Buttons in the toolbar must NOT steal focus from the active textarea —
  // otherwise the textarea blurs, fires onBlur, and (for an empty new text
  // box) auto-deletes itself. preventDefault on mousedown keeps focus put.
  const keepFocus = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  const isApprox = a.kind === "text-edit" && !!(a as { fontApproximate?: boolean }).fontApproximate;
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => { setHintDismissed(false); }, [a.id]);
  const showHint = isApprox && !hintDismissed;

  return (
    <div
      ref={tbRef}
      data-text-toolbar="1"
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      style={{
        position: "absolute", left, top,
        display: "inline-flex", flexDirection: "column", alignItems: "stretch", gap: 0,
        background: "rgba(20,20,22,0.96)",
        color: "#fff",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        border: "1px solid rgba(255,255,255,0.08)",
        zIndex: 50,
        backdropFilter: "blur(6px)",
        fontFamily: "Helvetica, Arial, sans-serif",
      }}
    >
      {showHint && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 10px",
            fontSize: 11, lineHeight: 1.3,
            color: "rgba(255,255,255,0.72)",
            background: "rgba(245,158,11,0.08)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            borderTopLeftRadius: 8, borderTopRightRadius: 8,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--vault)", flex: "0 0 auto" }} />
          <span style={{ flex: 1 }}>Original font couldn't be matched exactly — pick the closest in the font menu.</span>
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => setHintDismissed(true)}
            title="Dismiss"
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}
          >×</button>
        </div>
      )}
      <div style={{ height: 38, display: "inline-flex", alignItems: "center", gap: 2, padding: "0 8px" }}>
      <select
        value={currentFontValue}
        onChange={(e) => {
          if (e.target.value === "__detected") return;
          const key = e.target.value as FontKey;
          const kind = FONT_META[key]?.kind ?? "sans";
          // Clear any auto-detected CSS override so the bundled family wins,
          // both on screen and in export.
          update({ fontKey: key, family: kind, fontApproximate: false, fontFamilyOverride: undefined } as Partial<Anno>);
          setHintDismissed(true);
        }}
        title={isApprox ? "Approximate match — pick the closest font" : "Font"}
        onMouseDown={stop}
        style={{
          ...btn,
          background: "#1a1a1c", color: "#fff", padding: "0 6px", minWidth: 180,
          border: showHint ? "1px solid var(--vault)" : "1px solid rgba(255,255,255,0.12)",
          boxShadow: showHint ? "0 0 0 2px rgba(245,158,11,0.18)" : "none",
        }}
      >
        {manualFamily && (
          <option value="__detected" style={{ background: "#1a1a1c", color: "#fff" }}>
            {detectedFamilyLabel}
          </option>
        )}
        {TOOLBAR_FONTS.map((f) => (
          <option key={f.key} value={f.key} style={{ background: "#1a1a1c", color: "#fff" }}>
            {f.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={6}
        max={144}
        value={Math.round(a.fontSize)}
        onChange={(e) => {
          const v = Math.max(6, Math.min(144, Number(e.target.value) || a.fontSize));
          update({ fontSize: v } as Partial<Anno>);
        }}
        style={{ ...btn, width: 48, background: "rgba(255,255,255,0.06)", textAlign: "center" }}
      />
      <span style={sep} />
      <button type="button" title="Bold"      onMouseDown={keepFocus} style={a.bold ? activeBtn : btn}      onClick={() => update({ bold: !a.bold } as Partial<Anno>)}><strong>B</strong></button>
      <button type="button" title="Italic"    onMouseDown={keepFocus} style={a.italic ? activeBtn : btn}    onClick={() => update({ italic: !a.italic } as Partial<Anno>)}><em>I</em></button>
      <button type="button" title="Underline" onMouseDown={keepFocus} style={a.underline ? activeBtn : btn} onClick={() => update({ underline: !a.underline } as Partial<Anno>)}><span style={{ textDecoration: "underline" }}>U</span></button>
      <span style={sep} />
      <button type="button" title="Align left"   onMouseDown={keepFocus} style={(a.align ?? "left") === "left" ? activeBtn : btn} onClick={() => update({ align: "left" } as Partial<Anno>)}>⯇</button>
      <button type="button" title="Align center" onMouseDown={keepFocus} style={a.align === "center" ? activeBtn : btn}           onClick={() => update({ align: "center" } as Partial<Anno>)}>≡</button>
      <button type="button" title="Align right"  onMouseDown={keepFocus} style={a.align === "right" ? activeBtn : btn}            onClick={() => update({ align: "right" } as Partial<Anno>)}>⯈</button>
      <span style={sep} />
      {TOOLBAR_COLORS.map((c, i) => {
        const isActive = Math.abs(c.r - a.color.r) < 0.02 && Math.abs(c.g - a.color.g) < 0.02 && Math.abs(c.b - a.color.b) < 0.02;
        return (
          <button
            key={i}
            type="button"
            title="Text color"
            onMouseDown={keepFocus}
            onClick={() => update({ color: c } as Partial<Anno>)}
            style={{
              width: 18, height: 18, borderRadius: 999, padding: 0, margin: "0 2px",
              background: rgbCss(c, 1),
              border: isActive ? "2px solid #fbbf24" : "1px solid rgba(255,255,255,0.25)",
              cursor: "pointer",
            }}
          />
        );
      })}
      </div>
    </div>
  );
}
