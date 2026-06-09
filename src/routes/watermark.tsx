import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Stamp } from "lucide-react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";

export const Route = createFileRoute("/watermark")({
  head: () => ({
    meta: [
      { title: "Watermark PDF — VaultPDF" },
      {
        name: "description",
        content:
          "Stamp DRAFT, CONFIDENTIAL, or any custom text across every page of a PDF. 100% in your browser.",
      },
      { property: "og:title", content: "Watermark PDF — VaultPDF" },
      {
        property: "og:description",
        content: "Diagonal text watermarks added client-side. No upload.",
      },
      { property: "og:url", content: "/watermark" },
    ],
    links: [{ rel: "canonical", href: "/watermark" }],
  }),
  component: WatermarkPage,
});

type Pos = "diagonal" | "top" | "bottom" | "center";

function WatermarkPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(20);
  const [size, setSize] = useState(72);
  const [pos, setPos] = useState<Pos>("diagonal");
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), {
        ignoreEncryption: true,
      });
      setPageCount(doc.getPageCount());
    } catch {
      toast.error("Couldn't open that PDF.");
      setFile(null);
    }
  }, []);

  const reset = () => {
    setFile(null);
    setPageCount(0);
  };

  const run = async () => {
    if (!file || !text.trim()) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const op = Math.max(0.05, Math.min(1, opacity / 100));
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        const tw = font.widthOfTextAtSize(text, size);
        const th = size;
        let x: number, y: number, rot = 0;
        if (pos === "diagonal") {
          x = width / 2 - tw / 2;
          y = height / 2 - th / 2;
          rot = Math.atan2(height, width) * (180 / Math.PI);
          page.drawText(text, {
            x,
            y,
            font,
            size,
            color: rgb(0.5, 0.5, 0.5),
            opacity: op,
            rotate: degrees(rot),
          });
          continue;
        }
        if (pos === "top") {
          x = width / 2 - tw / 2;
          y = height - th - 36;
        } else if (pos === "bottom") {
          x = width / 2 - tw / 2;
          y = 36;
        } else {
          x = width / 2 - tw / 2;
          y = height / 2 - th / 2;
        }
        page.drawText(text, {
          x,
          y,
          font,
          size,
          color: rgb(0.5, 0.5, 0.5),
          opacity: op,
        });
      }
      const bytes = await doc.save();
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${base}-watermarked.pdf`);
      toast.success("Watermark added");
    } catch (err) {
      console.error(err);
      toast.error("Watermark failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <ToolHeader
        tag="Watermark"
        title="Stamp every page. Diagonally."
        sub="DRAFT, CONFIDENTIAL, or any text. Adjustable size, opacity, and position. Your file never leaves the tab."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to watermark" sublabel="no upload" />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} info={`${pageCount} page${pageCount === 1 ? "" : "s"}`} onClose={reset} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div>
                <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Text</label>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
                />
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Position
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <ModeBtn active={pos === "diagonal"} onClick={() => setPos("diagonal")}>Diagonal</ModeBtn>
                  <ModeBtn active={pos === "center"} onClick={() => setPos("center")}>Center</ModeBtn>
                  <ModeBtn active={pos === "top"} onClick={() => setPos("top")}>Top</ModeBtn>
                  <ModeBtn active={pos === "bottom"} onClick={() => setPos("bottom")}>Bottom</ModeBtn>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground flex justify-between">
                    <span>Font size</span>
                    <span className="font-mono">{size}pt</span>
                  </label>
                  <input
                    type="range"
                    min={12}
                    max={160}
                    value={size}
                    onChange={(e) => setSize(parseInt(e.target.value, 10))}
                    className="mt-2 w-full accent-vault"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground flex justify-between">
                    <span>Opacity</span>
                    <span className="font-mono">{opacity}%</span>
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={opacity}
                    onChange={(e) => setOpacity(parseInt(e.target.value, 10))}
                    className="mt-2 w-full accent-vault"
                  />
                </div>
              </div>

              <Button onClick={run} disabled={busy || !text.trim()} className="bg-vault text-vault-foreground hover:opacity-90 w-full">
                {busy ? "Stamping…" : (
                  <>
                    <Stamp className="h-4 w-4 mr-2" /> Add watermark & download
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
