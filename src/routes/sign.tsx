import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  PenLine,
  Type as TypeIcon,
  ImagePlus,
  Calendar,
  Trash2,
  Download,
  Plus,
} from "lucide-react";
import { PDFDocument, rgb } from "pdf-lib";
import { embedStandardFont } from "@/lib/pdf/fonts-pdfa";
import { loadPdfjs } from "@/lib/pdf/worker";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";

export const Route = createFileRoute("/sign")({
  head: () => ({
    meta: [
      { title: "Sign & Fill PDF — CounselPDF" },
      {
        name: "description",
        content:
          "Draw, type, or upload your signature. Drop it on any page, add text and dates, then flatten. 100% in your browser.",
      },
      { property: "og:title", content: "Sign & Fill PDF — CounselPDF" },
      {
        property: "og:description",
        content:
          "Signatures and form fields placed client-side. Your file never leaves the tab.",
      },
      { property: "og:url", content: "/sign" },
    ],
    links: [{ rel: "canonical", href: "/sign" }],
  }),
  component: SignPage,
});

/* ──────────────────────────────────────────────────────────────────────── */

type RenderedPage = {
  index: number; // 0-based
  width: number; // CSS px (preview width)
  height: number; // CSS px (preview height)
  pdfWidth: number; // PDF user-units
  pdfHeight: number;
  dataUrl: string;
};

type PlacedSignature = {
  id: string;
  kind: "signature";
  page: number; // 0-based
  /** CSS px coordinates in preview space, top-left origin */
  x: number;
  y: number;
  w: number;
  h: number;
  pngDataUrl: string;
};

type PlacedText = {
  id: string;
  kind: "text";
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number; // CSS px in preview space (we'll map to pdf pts on save)
};

type Placed = PlacedSignature | PlacedText;

type ActiveStamp =
  | { kind: "signature"; pngDataUrl: string; aspect: number }
  | { kind: "text"; text: string }
  | null;

const uid = () => Math.random().toString(36).slice(2, 10);
const PREVIEW_WIDTH = 720; // CSS px target width; height derived from aspect

/* ──────────────────────────────────────────────────────────────────────── */

function SignPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [active, setActive] = useState<ActiveStamp>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Signature editor state
  const [sigMode, setSigMode] = useState<"draw" | "type" | "upload">("draw");
  const [typedSig, setTypedSig] = useState("");
  const [savedSignature, setSavedSignature] = useState<{
    pngDataUrl: string;
    aspect: number;
  } | null>(null);

  const reset = () => {
    setFile(null);
    setPages([]);
    setPlaced([]);
    setActive(null);
    setSelectedId(null);
    setSavedSignature(null);
    setTypedSig("");
  };

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    setPlaced([]);
    setActive(null);
    setSelectedId(null);
    setLoading(true);
    try {
      const pdfjs = await loadPdfjs();
      const buf = await f.arrayBuffer();
      const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
      const doc = await task.promise;
      const out: RenderedPage[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = PREVIEW_WIDTH / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D unavailable");
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        out.push({
          index: i,
          width: viewport.width,
          height: viewport.height,
          pdfWidth: baseViewport.width,
          pdfHeight: baseViewport.height,
          dataUrl: canvas.toDataURL("image/jpeg", 0.85),
        });
      }
      setPages(out);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't open that PDF.");
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /* keyboard: Delete removes selection, Esc clears active stamp */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActive(null);
        setSelectedId(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        const target = document.activeElement;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
        )
          return;
        setPlaced((p) => p.filter((x) => x.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectedId]);

  /* Click on a page → drop the active stamp */
  const onPageClick = (
    e: React.MouseEvent<HTMLDivElement>,
    page: RenderedPage,
  ) => {
    if (!active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const id = uid();
    if (active.kind === "signature") {
      const w = 180;
      const h = Math.max(36, Math.round(w / active.aspect));
      setPlaced((p) => [
        ...p,
        {
          id,
          kind: "signature",
          page: page.index,
          x: x - w / 2,
          y: y - h / 2,
          w,
          h,
          pngDataUrl: active.pngDataUrl,
        },
      ]);
    } else {
      const w = 200;
      const h = 32;
      setPlaced((p) => [
        ...p,
        {
          id,
          kind: "text",
          page: page.index,
          x: x - w / 2,
          y: y - h / 2,
          w,
          h,
          text: active.text || "Type here…",
          fontSize: 16,
        },
      ]);
    }
    setSelectedId(id);
    // keep `active` so the user can stamp again; Esc clears it
  };

  /* ─── Apply / flatten ────────────────────────────────────────────────── */
  const applyAndDownload = async () => {
    if (!file) return;
    if (placed.length === 0) {
      toast.error("Nothing placed yet — drop a signature or text first.");
      return;
    }
    setBusy(true);
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const font = await embedStandardFont(doc, "Helvetica");
      const pdfPages = doc.getPages();

      // Cache embedded PNGs by dataUrl
      const pngCache = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();

      for (const item of placed) {
        const pg = pdfPages[item.page];
        if (!pg) continue;
        const previewMeta = pages[item.page];
        if (!previewMeta) continue;
        const scaleX = previewMeta.pdfWidth / previewMeta.width;
        const scaleY = previewMeta.pdfHeight / previewMeta.height;

        const pdfX = item.x * scaleX;
        const pdfW = item.w * scaleX;
        const pdfH = item.h * scaleY;
        // PDF y origin is bottom-left; convert from top-left CSS y
        const pdfY = previewMeta.pdfHeight - item.y * scaleY - pdfH;

        if (item.kind === "signature") {
          let png = pngCache.get(item.pngDataUrl);
          if (!png) {
            png = await doc.embedPng(item.pngDataUrl);
            pngCache.set(item.pngDataUrl, png);
          }
          pg.drawImage(png, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
        } else {
          const fontPt = item.fontSize * scaleY;
          // baseline ≈ top + fontSize * 0.8
          const baselineFromTop = item.fontSize * 0.8;
          const baselinePdfY =
            previewMeta.pdfHeight - (item.y + baselineFromTop) * scaleY;
          pg.drawText(item.text, {
            x: pdfX,
            y: baselinePdfY,
            size: fontPt,
            font,
            color: rgb(0.05, 0.07, 0.16),
          });
        }
      }

      const bytes = await doc.save();
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBlob(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
        `${base}-signed.pdf`,
      );
      toast.success("Signed PDF downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't flatten the PDF.");
    } finally {
      setBusy(false);
    }
  };

  const placeCountByPage = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of placed) m.set(p.page, (m.get(p.page) ?? 0) + 1);
    return m;
  }, [placed]);

  /* ─────────────────────────────────────────────────────────────────── */

  return (
    <AppShell>
      <ToolHeader
        tag="Sign & Fill"
        title="Sign documents you'd never email."
        sub="Draw, type, or upload your signature. Drop it on any page, add text and dates, then flatten. Your file never leaves this tab."
        collapsed={!!file}
      />

      <div className="mx-auto max-w-7xl px-5 md:px-8 py-8">
        {!file ? (
          <div className="max-w-3xl mx-auto">
            <FileDropzone onFile={onFile} label="Drop a PDF to sign" sublabel="no upload" />
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_340px] gap-6">
            {/* LEFT — pages */}
            <div className="min-w-0 space-y-4">
              <FileBar
                file={file}
                info={`${pages.length} page${pages.length === 1 ? "" : "s"} · ${placed.length} placement${placed.length === 1 ? "" : "s"}`}
                onClose={reset}
              onReplace={onFile}
              />

              {loading ? (
                <div className="rounded-lg border border-border bg-card/40 p-12 text-center text-muted-foreground text-sm">
                  Rendering pages…
                </div>
              ) : (
                <div className="space-y-6">
                  {pages.map((page) => (
                    <PageCanvas
                      key={page.index}
                      page={page}
                      placed={placed.filter((p) => p.page === page.index)}
                      active={active}
                      selectedId={selectedId}
                      onPageClick={onPageClick}
                      onSelect={setSelectedId}
                      onUpdate={(id, patch) =>
                        setPlaced((all) =>
                          all.map((p) =>
                            p.id === id ? ({ ...p, ...patch } as Placed) : p,
                          ),
                        )
                      }
                      onDelete={(id) => {
                        setPlaced((all) => all.filter((p) => p.id !== id));
                        setSelectedId((s) => (s === id ? null : s));
                      }}
                      countLabel={placeCountByPage.get(page.index)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT — sidebar */}
            <aside className="lg:sticky lg:top-20 self-start space-y-5">
              {/* Active stamp banner */}
              {active && (
                <div className="rounded-md border border-vault/40 bg-vault/10 px-3 py-2 text-xs flex items-center justify-between">
                  <span className="text-foreground">
                    {active.kind === "signature" ? "Click a page to place signature" : "Click a page to place text"}
                  </span>
                  <button
                    onClick={() => setActive(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Signature creator */}
              <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Your signature
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <ModeBtn active={sigMode === "draw"} onClick={() => setSigMode("draw")}>
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <PenLine className="h-3.5 w-3.5" /> Draw
                    </span>
                  </ModeBtn>
                  <ModeBtn active={sigMode === "type"} onClick={() => setSigMode("type")}>
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <TypeIcon className="h-3.5 w-3.5" /> Type
                    </span>
                  </ModeBtn>
                  <ModeBtn active={sigMode === "upload"} onClick={() => setSigMode("upload")}>
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <ImagePlus className="h-3.5 w-3.5" /> Upload
                    </span>
                  </ModeBtn>
                </div>

                {sigMode === "draw" && (
                  <SignaturePad
                    onSave={(png, aspect) => {
                      setSavedSignature({ pngDataUrl: png, aspect });
                      setActive({ kind: "signature", pngDataUrl: png, aspect });
                      toast.success("Signature ready — click a page to place");
                    }}
                  />
                )}

                {sigMode === "type" && (
                  <TypeSignature
                    value={typedSig}
                    onChange={setTypedSig}
                    onSave={(png, aspect) => {
                      setSavedSignature({ pngDataUrl: png, aspect });
                      setActive({ kind: "signature", pngDataUrl: png, aspect });
                      toast.success("Signature ready — click a page to place");
                    }}
                  />
                )}

                {sigMode === "upload" && (
                  <UploadSignature
                    onSave={(png, aspect) => {
                      setSavedSignature({ pngDataUrl: png, aspect });
                      setActive({ kind: "signature", pngDataUrl: png, aspect });
                      toast.success("Signature ready — click a page to place");
                    }}
                  />
                )}

                {savedSignature && (
                  <div className="rounded-md border border-border bg-background/60 p-2 flex items-center justify-between gap-3">
                    <img
                      src={savedSignature.pngDataUrl}
                      alt="Saved signature"
                      className="h-10 max-w-[160px] object-contain"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      onClick={() =>
                        setActive({
                          kind: "signature",
                          pngDataUrl: savedSignature.pngDataUrl,
                          aspect: savedSignature.aspect,
                        })
                      }
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Place
                    </Button>
                  </div>
                )}
              </div>

              {/* Text & date */}
              <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Add a field
                </div>
                <button
                  onClick={() => setActive({ kind: "text", text: "" })}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background/60 hover:bg-accent px-3 py-2 text-sm transition"
                >
                  <TypeIcon className="h-3.5 w-3.5" /> Text field
                </button>
                <button
                  onClick={() =>
                    setActive({
                      kind: "text",
                      text: new Date().toLocaleDateString(),
                    })
                  }
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background/60 hover:bg-accent px-3 py-2 text-sm transition"
                >
                  <Calendar className="h-3.5 w-3.5" /> Today's date
                </button>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Click to select a placement. Drag to move. Use the handle to resize. Press Delete to remove.
                </p>
              </div>

              {/* Apply */}
              <Button
                onClick={applyAndDownload}
                disabled={busy || placed.length === 0}
                className="w-full bg-vault text-vault-foreground hover:opacity-90"
              >
                {busy ? (
                  "Flattening…"
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" /> Flatten & download
                  </>
                )}
              </Button>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Page canvas with overlay placements                                     */

function PageCanvas({
  page,
  placed,
  active,
  selectedId,
  onPageClick,
  onSelect,
  onUpdate,
  onDelete,
  countLabel,
}: {
  page: RenderedPage;
  placed: Placed[];
  active: ActiveStamp;
  selectedId: string | null;
  onPageClick: (e: React.MouseEvent<HTMLDivElement>, page: RenderedPage) => void;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Placed>) => void;
  onDelete: (id: string) => void;
  countLabel: number | undefined;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Page {page.index + 1}
        </div>
        {countLabel ? (
          <div className="text-[11px] text-muted-foreground">
            {countLabel} placement{countLabel === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>
      <div
        className={`relative inline-block rounded-md border border-border shadow-[var(--shadow-stamp)] overflow-hidden bg-white max-w-full ${
          active ? "cursor-crosshair" : "cursor-default"
        }`}
        style={{ width: page.width, maxWidth: "100%" }}
        onClick={(e) => {
          // ignore clicks bubbling from placements
          if ((e.target as HTMLElement).closest("[data-placement]")) return;
          if (!active) {
            onSelect(null);
            return;
          }
          onPageClick(e, page);
        }}
      >
        <img
          src={page.dataUrl}
          alt={`Page ${page.index + 1}`}
          className="block w-full h-auto select-none pointer-events-none"
          draggable={false}
        />
        {placed.map((p) => (
          <Placement
            key={p.id}
            item={p}
            selected={selectedId === p.id}
            pageWidth={page.width}
            pageHeight={page.height}
            onSelect={() => onSelect(p.id)}
            onUpdate={(patch) => onUpdate(p.id, patch)}
            onDelete={() => onDelete(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Placement (draggable, resizable, editable)                              */

function Placement({
  item,
  selected,
  pageWidth,
  pageHeight,
  onSelect,
  onUpdate,
  onDelete,
}: {
  item: Placed;
  selected: boolean;
  pageWidth: number;
  pageHeight: number;
  onSelect: () => void;
  onUpdate: (patch: Partial<Placed>) => void;
  onDelete: () => void;
}) {
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    aspect: number;
  } | null>(null);

  const onPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    mode: "move" | "resize",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: item.x,
      origY: item.y,
      origW: item.w,
      origH: item.h,
      aspect: item.w / Math.max(1, item.h),
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === "move") {
      const nx = Math.max(0, Math.min(pageWidth - item.w, d.origX + dx));
      const ny = Math.max(0, Math.min(pageHeight - item.h, d.origY + dy));
      onUpdate({ x: nx, y: ny });
    } else {
      // proportional resize for signatures, free for text width-only
      if (item.kind === "signature") {
        const nw = Math.max(40, Math.min(pageWidth - item.x, d.origW + dx));
        const nh = Math.max(20, nw / d.aspect);
        onUpdate({ w: nw, h: nh });
      } else {
        const nw = Math.max(60, Math.min(pageWidth - item.x, d.origW + dx));
        const scale = nw / d.origW;
        onUpdate({
          w: nw,
          h: Math.max(16, d.origH * scale),
          fontSize: Math.max(8, (item as PlacedText).fontSize * scale),
        });
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      data-placement
      onPointerDown={(e) => onPointerDown(e, "move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`absolute group ${
        selected
          ? "ring-2 ring-vault"
          : "ring-1 ring-transparent hover:ring-vault/50"
      }`}
      style={{
        left: item.x,
        top: item.y,
        width: item.w,
        height: item.h,
        cursor: "move",
        touchAction: "none",
      }}
    >
      {item.kind === "signature" ? (
        <img
          src={item.pngDataUrl}
          alt="Signature"
          className="w-full h-full object-contain pointer-events-none select-none"
          draggable={false}
        />
      ) : (
        <input
          value={item.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onFocus={onSelect}
          spellCheck={false}
          className="w-full h-full bg-transparent border-0 outline-none text-[#0d1226] px-0 py-0"
          style={{ fontSize: item.fontSize, fontFamily: "Helvetica, Arial, sans-serif" }}
        />
      )}

      {selected && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute -top-3 -right-3 h-6 w-6 grid place-items-center rounded-full bg-destructive text-destructive-foreground shadow-md hover:scale-105 transition"
            aria-label="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <div
            onPointerDown={(e) => onPointerDown(e, "resize")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-sm bg-vault border border-background"
            style={{ cursor: "nwse-resize", touchAction: "none" }}
          />
        </>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Signature creators                                                     */

function SignaturePad({
  onSave,
}: {
  onSave: (pngDataUrl: string, aspect: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const bounds = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const getCtx = () => canvasRef.current?.getContext("2d") ?? null;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0d1226";
      ctx.lineWidth = 2.2;
    }
  }, []);

  const localPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = localPoint(e);
    const ctx = getCtx();
    if (!ctx || !last.current) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(last.current.x + 0.01, last.current.y + 0.01);
    ctx.stroke();
    updateBounds(last.current.x, last.current.y);
    setHasInk(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = localPoint(e);
    const ctx = getCtx();
    if (!ctx || !last.current) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    updateBounds(p.x, p.y);
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const updateBounds = (x: number, y: number) => {
    if (!bounds.current) {
      bounds.current = { minX: x, minY: y, maxX: x, maxY: y };
      return;
    }
    bounds.current.minX = Math.min(bounds.current.minX, x);
    bounds.current.minY = Math.min(bounds.current.minY, y);
    bounds.current.maxX = Math.max(bounds.current.maxX, x);
    bounds.current.maxY = Math.max(bounds.current.maxY, y);
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    bounds.current = null;
    setHasInk(false);
  };

  const save = () => {
    const c = canvasRef.current;
    if (!c || !bounds.current || !hasInk) {
      toast.error("Draw something first");
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const pad = 8;
    const cssMinX = Math.max(0, bounds.current.minX - pad);
    const cssMinY = Math.max(0, bounds.current.minY - pad);
    const cssMaxX = Math.min(c.clientWidth, bounds.current.maxX + pad);
    const cssMaxY = Math.min(c.clientHeight, bounds.current.maxY + pad);
    const cropW = Math.max(1, cssMaxX - cssMinX);
    const cropH = Math.max(1, cssMaxY - cssMinY);

    const off = document.createElement("canvas");
    off.width = Math.round(cropW * dpr);
    off.height = Math.round(cropH * dpr);
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.drawImage(
      c,
      cssMinX * dpr,
      cssMinY * dpr,
      cropW * dpr,
      cropH * dpr,
      0,
      0,
      off.width,
      off.height,
    );
    const dataUrl = off.toDataURL("image/png");
    onSave(dataUrl, off.width / off.height);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="block w-full h-32 rounded-md border border-dashed border-border bg-white touch-none"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={clear} className="flex-1 text-xs">
          Clear
        </Button>
        <Button size="sm" onClick={save} disabled={!hasInk} className="flex-1 text-xs bg-vault text-vault-foreground hover:opacity-90">
          Use signature
        </Button>
      </div>
    </div>
  );
}

function TypeSignature({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: (pngDataUrl: string, aspect: number) => void;
}) {
  const render = () => {
    if (!value.trim()) {
      toast.error("Type your name first");
      return;
    }
    // Render text to canvas with a script-y font fallback
    const font = `48px "Snell Roundhand", "Apple Chancery", "Brush Script MT", cursive`;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    measure.font = font;
    const m = measure.measureText(value);
    const w = Math.ceil(m.width) + 24;
    const h = 80;
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement("canvas");
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.font = font;
    ctx.fillStyle = "#0d1226";
    ctx.textBaseline = "middle";
    ctx.fillText(value, 12, h / 2);
    const dataUrl = c.toDataURL("image/png");
    onSave(dataUrl, w / h);
  };

  return (
    <div className="space-y-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your name"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
      />
      {value && (
        <div
          className="rounded-md border border-dashed border-border bg-white px-3 py-3 text-center text-[#0d1226]"
          style={{
            fontFamily: `"Snell Roundhand", "Apple Chancery", "Brush Script MT", cursive`,
            fontSize: 32,
          }}
        >
          {value}
        </div>
      )}
      <Button
        size="sm"
        onClick={render}
        disabled={!value.trim()}
        className="w-full text-xs bg-vault text-vault-foreground hover:opacity-90"
      >
        Use signature
      </Button>
    </div>
  );
}

function UploadSignature({
  onSave,
}: {
  onSave: (pngDataUrl: string, aspect: number) => void;
}) {
  const handle = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Re-encode to PNG, preserve aspect
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        onSave(c.toDataURL("image/png"), img.naturalWidth / img.naturalHeight);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  return (
    <label className="block rounded-md border border-dashed border-border bg-background/60 px-3 py-6 text-center text-xs text-muted-foreground cursor-pointer hover:bg-accent/40 transition">
      <ImagePlus className="h-5 w-5 mx-auto mb-2 text-vault" />
      Choose PNG or JPG
      <input
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}
