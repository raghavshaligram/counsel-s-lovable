import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, FileText, Trash2, GripVertical, FilePlus2 } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { ToolHeader, ModeBtn, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";

export const Route = createFileRoute("/images-to-pdf")({
  head: () => ({
    meta: [
      { title: "Images to PDF — JPG / PNG → PDF — VaultPDF" },
      {
        name: "description",
        content:
          "Combine JPG, PNG, or HEIC images into a single PDF. Reorder, choose page size, fit or fill — all in your browser.",
      },
      { property: "og:title", content: "Images to PDF — VaultPDF" },
      {
        property: "og:description",
        content: "Build a clean PDF from photos and scans, locally. No upload.",
      },
      { property: "og:url", content: "/images-to-pdf" },
    ],
    links: [{ rel: "canonical", href: "/images-to-pdf" }],
  }),
  component: ImagesToPdfPage,
});

type Item = {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
};

type PageSize = "auto" | "letter" | "a4";
type Fit = "fit" | "fill";

const PAGE_SIZES: Record<Exclude<PageSize, "auto">, { w: number; h: number; label: string }> = {
  letter: { w: 612, h: 792, label: "US Letter" },
  a4: { w: 595.28, h: 841.89, label: "A4" },
};

function ImagesToPdfPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>("auto");
  const [fit, setFit] = useState<Fit>("fit");
  const [margin, setMargin] = useState(24);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    return () => items.forEach((i) => URL.revokeObjectURL(i.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => /^image\//.test(f.type));
    if (!arr.length) {
      toast.error("Pick image files (JPG or PNG).");
      return;
    }
    const loaded: Item[] = await Promise.all(
      arr.map(
        (file) =>
          new Promise<Item>((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () =>
              resolve({
                id: crypto.randomUUID(),
                file,
                url,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            img.onerror = () => reject(new Error("bad image"));
            img.src = url;
          }),
      ),
    );
    setItems((cur) => [...cur, ...loaded]);
  }, []);

  const removeItem = (id: string) => {
    setItems((cur) => {
      const it = cur.find((x) => x.id === id);
      if (it) URL.revokeObjectURL(it.url);
      return cur.filter((x) => x.id !== id);
    });
  };

  const reset = () => {
    items.forEach((i) => URL.revokeObjectURL(i.url));
    setItems([]);
  };

  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDropOn = (overId: string) => {
    if (!dragId || dragId === overId) return;
    setItems((cur) => {
      const next = cur.slice();
      const fromIdx = next.findIndex((x) => x.id === dragId);
      const toIdx = next.findIndex((x) => x.id === overId);
      if (fromIdx < 0 || toIdx < 0) return cur;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    setDragId(null);
  };

  const run = async () => {
    if (!items.length) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.create();
      for (const it of items) {
        const bytes = await it.file.arrayBuffer();
        const isPng = /png/i.test(it.file.type);
        const embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

        let pw: number, ph: number;
        if (pageSize === "auto") {
          pw = embedded.width;
          ph = embedded.height;
        } else {
          ({ w: pw, h: ph } = PAGE_SIZES[pageSize]);
        }
        const page = doc.addPage([pw, ph]);

        if (pageSize === "auto") {
          page.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });
        } else {
          const aw = pw - margin * 2;
          const ah = ph - margin * 2;
          const scale =
            fit === "fit"
              ? Math.min(aw / embedded.width, ah / embedded.height)
              : Math.max(aw / embedded.width, ah / embedded.height);
          const dw = embedded.width * scale;
          const dh = embedded.height * scale;
          page.drawImage(embedded, {
            x: (pw - dw) / 2,
            y: (ph - dh) / 2,
            width: dw,
            height: dh,
          });
        }
      }
      const bytes = await doc.save();
      const base = items.length === 1 ? items[0].file.name.replace(/\.[^.]+$/, "") : "images";
      downloadBlob(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
        `${base}.pdf`,
      );
      toast.success(`Built PDF from ${items.length} image${items.length === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't build the PDF. JPG and PNG work best.");
    } finally {
      setBusy(false);
    }
  };

  useHotkey("mod+Enter", () => { void run(); }, items.length > 0 && !busy);

  return (
    <AppShell>
      <ToolHeader
        tag="Images → PDF"
        title="Combine images into one PDF."
        sub="Drop JPGs, PNGs, or screenshots. Reorder by drag, pick a page size, then download — locally."
        collapsed={items.length > 0}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${items.length ? "max-w-5xl" : "max-w-3xl"}`}>
        {items.length === 0 ? (
          <ImageDropzone onFiles={addFiles} />
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-8 w-8 place-items-center rounded-md bg-vault/10 text-vault shrink-0">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {items.length} image{items.length === 1 ? "" : "s"}
                  </div>
                  <div className="text-xs text-muted-foreground">Drag tiles to reorder</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <AddMoreButton onFiles={addFiles} />
                <Button variant="ghost" size="sm" onClick={reset} title="Clear all (Esc)">
                  Clear
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Page size</div>
                <div className="grid grid-cols-3 gap-2">
                  <ModeBtn active={pageSize === "auto"} onClick={() => setPageSize("auto")}>
                    Match image
                  </ModeBtn>
                  <ModeBtn active={pageSize === "letter"} onClick={() => setPageSize("letter")}>
                    US Letter
                  </ModeBtn>
                  <ModeBtn active={pageSize === "a4"} onClick={() => setPageSize("a4")}>
                    A4
                  </ModeBtn>
                </div>
              </div>

              {pageSize !== "auto" && (
                <>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Image fit</div>
                    <div className="grid grid-cols-2 gap-2">
                      <ModeBtn active={fit === "fit"} onClick={() => setFit("fit")}>
                        Fit (whole image)
                      </ModeBtn>
                      <ModeBtn active={fit === "fill"} onClick={() => setFit("fill")}>
                        Fill (no borders)
                      </ModeBtn>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
                      <span>Margin</span>
                      <span className="font-mono text-foreground/80">{margin}pt</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={72}
                      step={2}
                      value={margin}
                      onChange={(e) => setMargin(parseInt(e.target.value, 10))}
                      className="w-full accent-vault"
                    />
                  </div>
                </>
              )}

              <Button
                onClick={run}
                disabled={busy}
                className="bg-vault text-vault-foreground hover:opacity-90 w-full h-11"
              >
                {busy ? "Building PDF…" : "Build PDF & download"}
              </Button>
              <div className="text-center text-[11px] text-muted-foreground">
                🔒 Built in your browser. Nothing uploaded.
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map((it, idx) => (
                <div
                  key={it.id}
                  draggable
                  onDragStart={() => onDragStart(it.id)}
                  onDragOver={onDragOver}
                  onDrop={() => onDropOn(it.id)}
                  className={`group relative rounded-lg border bg-card/40 overflow-hidden ${
                    dragId === it.id ? "border-vault ring-2 ring-vault/40" : "border-border"
                  }`}
                >
                  <div className="aspect-[3/4] bg-background/60 grid place-items-center overflow-hidden">
                    <img src={it.url} alt={it.file.name} className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-mono">
                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                    {idx + 1}
                  </div>
                  <button
                    onClick={() => removeItem(it.id)}
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center h-6 w-6 rounded bg-background/90 hover:bg-destructive hover:text-destructive-foreground"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground truncate">{it.file.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ImageDropzone({ onFiles }: { onFiles: (f: FileList) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles(e.dataTransfer.files);
      }}
      className={`block cursor-pointer border-2 border-dashed rounded-2xl p-10 md:p-14 text-center transition-all ${
        drag ? "border-vault bg-vault/10" : "border-border hover:border-vault/60 hover:bg-accent/40"
      }`}
    >
      <input
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => e.target.files && onFiles(e.target.files)}
      />
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-vault/10 text-vault">
        <Upload className="h-6 w-6" />
      </div>
      <div className="text-lg font-medium">Drop images to build a PDF</div>
      <div className="mt-1.5 text-sm text-muted-foreground">
        JPG, PNG, WebP · pick multiple · processed locally
      </div>
      <div className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-vault text-vault-foreground px-3 py-1.5 text-xs font-medium">
        <FilePlus2 className="h-3.5 w-3.5" /> Choose images
      </div>
    </label>
  );
}

function AddMoreButton({ onFiles }: { onFiles: (f: FileList) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs hover:bg-accent cursor-pointer">
      <FilePlus2 className="h-3.5 w-3.5" /> Add more
      <input
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => e.target.files && onFiles(e.target.files)}
      />
    </label>
  );
}
