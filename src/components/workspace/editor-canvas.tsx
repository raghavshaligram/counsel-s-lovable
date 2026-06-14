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
import { FONT_KEYS, FONT_META, mapPdfFontToKey, type FontKey } from "@/lib/editor/fonts";
import { rgbCss, uid, type State, type Action } from "@/lib/editor/state";
import type { Anno, PageOp, RGB, TextSource } from "@/lib/editor/types";

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
  fontKey?: FontKey;
  color: RGB;
  bg: RGB;
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

// Sample the page background by reading a thin RING immediately outside the
// glyph bbox (top + bottom strips, plus left + right strips). We deliberately
// avoid sampling pixels inside the bbox (those are the glyphs themselves) and
// we do NOT filter by luminance — that lets the cover match any background
// color (light, dark, tinted, gradient sampled locally) instead of falling
// back to white on non-white pages.
function samplePageBg(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): RGB {
  try {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const band = Math.max(2, Math.floor(sh * 0.45));
    const bx = Math.max(0, Math.floor(sx));
    const by = Math.max(0, Math.floor(sy));
    const bw = Math.max(1, Math.floor(sw));
    const bh = Math.max(1, Math.floor(sh));

    const strips: ImageData[] = [];
    const read = (x: number, y: number, w: number, h: number) => {
      const cx = Math.max(0, Math.min(x, cw - 1));
      const cy = Math.max(0, Math.min(y, ch - 1));
      const ww = Math.max(1, Math.min(w, cw - cx));
      const hh = Math.max(1, Math.min(h, ch - cy));
      if (ww < 1 || hh < 1) return;
      strips.push(ctx.getImageData(cx, cy, ww, hh));
    };
    // top + bottom strips outside glyph rows
    read(bx, by - band, bw, band);
    read(bx, by + bh, bw, band);
    // left + right strips (smaller — kerning extents)
    read(bx - band, by, band, bh);
    read(bx + bw, by, band, bh);

    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (const img of strips) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
      }
    }
    if (rs.length < 4) return { r: 1, g: 1, b: 1 };
    // Median per channel — robust to occasional outliers (descenders, rules).
    const med = (arr: number[]) => {
      arr.sort((a, b) => a - b);
      return arr[arr.length >> 1];
    };
    return { r: med(rs) / 255, g: med(gs) / 255, b: med(bs) / 255 };
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
  /** Called when the user clicks "Run OCR" in the scanned-page banner.
   * Owner runs OCR on the whole document and replaces the tab file. */
  onRequestOcr?: () => void;
  /** When true, the banner shows a "Running OCR…" disabled state. */
  ocrRunning?: boolean;
}

export function EditorCanvas({
  pageIndex, op, srcBytes, annos, state, dispatch, scale, pdfDoc,
  onRequestOcr, ocrRunning,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
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
        await page.render({ canvasContext: ctx, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise;
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
          const fontKey = mapPdfFontToKey(it.fontName ?? ff, family, ff);
          const x = m[4], y = m[5] - fh;
          const color = sampleTextColor(ctx, x * scale * dpr, y * scale * dpr, it.width * scale * dpr, fh * scale * dpr);
          const bg = samplePageBg(ctx, x * scale * dpr, y * scale * dpr, it.width * scale * dpr, fh * scale * dpr);
          return [{ x, y, w: it.width, h: fh, str: it.str, family, bold, italic, transform: it.transform, fontName: it.fontName, fontKey, color, bg }];
        });
        setTextItems(items);
        setTextLoaded(true);
      } catch (err) {
        console.error("[workspace EditorCanvas] page render failed", err);
        setTextLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      // Free the canvas backing store on unmount (virtualization tear-down).
      const c = canvasRef.current;
      if (c) { c.width = 0; c.height = 0; }
    };
  }, [op, srcBytes, scale, pdfDoc]);


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
      const w = Math.max(120, state.fontSize * 8);
      const id = uid();
      dispatch({ type: "ADD_ANNO", a: {
        id, kind: "text", page: pageIndex,
        x: px, y: py, w, h: state.fontSize * 1.4,
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
        const editFontKey = a.kind === "text-edit" ? (a.fontKey as FontKey | undefined) : undefined;
        const fam = editFontKey && FONT_META[editFontKey]
          ? FONT_META[editFontKey].cssFamily
          : (a.family === "serif" ? `'Times New Roman', Times, serif`
            : a.family === "mono" ? `'Courier New', Courier, monospace`
            : `Helvetica, Arial, sans-serif`);
        const padTop = a.kind === "text-edit" && a.textOffsetY ? a.textOffsetY * scale : 0;
        const padX = a.kind === "text-edit" ? Math.max(2, a.fontSize * 0.15) * scale : 0;
        const align = a.align ?? "left";
        const isBold = !!a.bold;
        const isItalic = !!a.italic;
        const isUnderline = !!a.underline;
        const textStyle: React.CSSProperties = {
          width: "100%", height: "100%",
          background: bg,
          color: rgbCss(a.color, a.opacity),
          fontSize: a.fontSize * scale,
          fontFamily: fam,
          fontWeight: isBold ? 700 : 400,
          fontStyle: isItalic ? "italic" : "normal",
          textDecoration: isUnderline ? "underline" : "none",
          textAlign: align,
          lineHeight: 1.15,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "hidden",
          padding: 0,
          paddingTop: padTop,
          paddingLeft: padX,
          paddingRight: padX,
          boxSizing: "border-box",
          margin: 0,
          border: "none", outline: "none", resize: "none",
          caretColor: rgbCss(a.color),
        };
        const onTextChange = (text: string) =>
          dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { text } as Partial<Anno> });
        inner = isEditing ? (
          <textarea
            autoFocus
            value={a.text}
            onChange={(e) => onTextChange(e.target.value)}
            onBlur={() => {
              if (!a.text.trim() && a.kind === "text") dispatch({ type: "DELETE_ANNO", id: a.id });
              setEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
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
            <div style={{ position: "absolute", inset: -2, border: "1.5px dashed var(--vault)", pointerEvents: "none" }} />
            {!isLocked && <div onMouseDown={onResize} style={{ position: "absolute", right: -6, bottom: -6, width: 12, height: 12, background: "var(--vault)", border: "2px solid white", borderRadius: 2, cursor: "nwse-resize" }} />}
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
    // Cover bbox: expand by a fraction of glyph height (more for bold/heavy
    // originals) so anti-aliased thick strokes don't leak through.
    const coverPad = Math.max(1, it.h * (it.bold ? 0.18 : 0.1));
    const cover = {
      x: it.x - coverPad,
      y: it.y - coverPad,
      w: it.w + coverPad * 2,
      h: it.h + coverPad * 2,
    };
    const padX = Math.max(2, it.h * 0.15);
    const padTop = Math.max(2, it.h * 0.35);
    const padBottom = Math.max(2, it.h * 0.45);
    const id = uid();
    dispatch({ type: "ADD_ANNO", a: {
      id, kind: "text-edit", page: pageIndex,
      x: it.x - padX, y: it.y - padTop,
      w: it.w + padX * 2, h: it.h + padTop + padBottom,
      color: it.color, opacity: 1,
      text: it.str,
      fontSize: it.h,
      bg: it.bg,
      family: it.family,
      fontKey: it.fontKey,
      bold: it.bold, italic: it.italic,
      textOffsetY: padTop,
      cover,
      source: { originalString: it.str, transform: it.transform, fontName: it.fontName },
    } });
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

  // Auto-grow the active text box to fit its content. Position stays locked
  // at (a.x, a.y); only width/height grow from the anchored origin.
  useEffect(() => {
    if (!activeText) return;
    const el = measureRef.current;
    if (!el) return;
    const a = activeText;
    const editFontKey = a.kind === "text-edit" ? (a.fontKey as FontKey | undefined) : undefined;
    const fam = editFontKey && FONT_META[editFontKey]
      ? FONT_META[editFontKey].cssFamily
      : (a.family === "serif" ? `'Times New Roman', Times, serif`
        : a.family === "mono" ? `'Courier New', Courier, monospace`
        : `Helvetica, Arial, sans-serif`);
    const padTop = a.kind === "text-edit" && a.textOffsetY ? a.textOffsetY : 0;
    const padX = a.kind === "text-edit" ? Math.max(2, a.fontSize * 0.15) : 0;
    const padBottom = a.kind === "text-edit" ? Math.max(2, a.fontSize * 0.35) : 0;
    el.style.fontSize = `${a.fontSize * scale}px`;
    el.style.fontFamily = fam;
    el.style.fontWeight = a.bold ? "700" : "400";
    el.style.fontStyle = a.italic ? "italic" : "normal";
    el.style.lineHeight = "1.15";
    el.style.whiteSpace = "pre";
    el.textContent = a.text && a.text.length > 0 ? a.text : " ";
    // Measure widest line + total height; convert px → PDF points.
    const measuredW = el.offsetWidth / scale + padX * 2 + 1;
    const measuredH = el.offsetHeight / scale + padTop + padBottom + 1;
    const minW = a.kind === "text" ? Math.max(40, a.fontSize * 2) : 8;
    const minH = a.fontSize * 1.15 + padTop + padBottom;
    const newW = Math.max(minW, measuredW);
    const newH = Math.max(minH, measuredH);
    if (Math.abs(newW - a.w) > 0.5 || Math.abs(newH - a.h) > 0.5) {
      dispatch({ type: "UPDATE_ANNO", id: a.id, patch: { w: newW, h: newH } as Partial<Anno> });
    }
  }, [activeText, scale, dispatch]);

  return (
    <div className="relative inline-block" style={{ background: "white", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", borderRadius: 6 }}>
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
        {annos.map((a) => {
          if (a.kind !== "text-edit" || !a.cover) return null;
          const tl = toScreen(a.cover.x, a.cover.y);
          const br = toScreen(a.cover.x + a.cover.w, a.cover.y + a.cover.h);
          return (
            <div
              key={`cover-${a.id}`}
              style={{
                position: "absolute",
                left: tl.x, top: tl.y,
                width: br.x - tl.x, height: br.y - tl.y,
                background: rgbCss(a.bg),
                pointerEvents: "none",
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
        {activeText && (
          <TextMiniToolbar
            anno={activeText}
            scale={scale}
            pageW={screenW}
            pageH={screenH}
            dispatch={dispatch}
          />
        )}
      </div>
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
  const tbH = 38;
  const margin = 8;
  const screenLeft = a.x * scale;
  const screenTop = a.y * scale;
  const screenW = a.w * scale;
  let top = screenTop - tbH - margin;
  if (top < 4) top = screenTop + a.h * scale + margin;
  const tbApproxW = 460;
  let left = screenLeft + screenW / 2 - tbApproxW / 2;
  left = Math.max(4, Math.min(left, pageW - tbApproxW - 4));
  if (top + tbH > pageH - 4) top = pageH - tbH - 4;

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

  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  return (
    <div
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      style={{
        position: "absolute", left, top, height: tbH,
        display: "inline-flex", alignItems: "center", gap: 2,
        padding: "0 8px",
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
      <select
        value={currentFontKey}
        onChange={(e) => {
          const key = e.target.value as FontKey;
          const kind = FONT_META[key]?.kind ?? "sans";
          update({ fontKey: key, family: kind } as Partial<Anno>);
        }}
        title="Font"
        style={{ ...btn, background: "#1a1a1c", color: "#fff", padding: "0 6px", minWidth: 110 }}
      >
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
      <button type="button" title="Bold"      style={a.bold ? activeBtn : btn}      onClick={() => update({ bold: !a.bold } as Partial<Anno>)}><strong>B</strong></button>
      <button type="button" title="Italic"    style={a.italic ? activeBtn : btn}    onClick={() => update({ italic: !a.italic } as Partial<Anno>)}><em>I</em></button>
      <button type="button" title="Underline" style={a.underline ? activeBtn : btn} onClick={() => update({ underline: !a.underline } as Partial<Anno>)}><span style={{ textDecoration: "underline" }}>U</span></button>
      <span style={sep} />
      <button type="button" title="Align left"   style={(a.align ?? "left") === "left" ? activeBtn : btn} onClick={() => update({ align: "left" } as Partial<Anno>)}>⯇</button>
      <button type="button" title="Align center" style={a.align === "center" ? activeBtn : btn}           onClick={() => update({ align: "center" } as Partial<Anno>)}>≡</button>
      <button type="button" title="Align right"  style={a.align === "right" ? activeBtn : btn}            onClick={() => update({ align: "right" } as Partial<Anno>)}>⯈</button>
      <span style={sep} />
      {TOOLBAR_COLORS.map((c, i) => {
        const isActive = Math.abs(c.r - a.color.r) < 0.02 && Math.abs(c.g - a.color.g) < 0.02 && Math.abs(c.b - a.color.b) < 0.02;
        return (
          <button
            key={i}
            type="button"
            title="Text color"
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
  );
}
