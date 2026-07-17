import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Stamp } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { applyTextWatermark, type WatermarkPos } from "@/lib/pdf/watermark";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";

export const Route = createFileRoute("/watermark")({
  head: () => ({
    meta: [
      { title: "Watermark PDF — CounselPDF" },
      {
        name: "description",
        content:
          "Stamp DRAFT, CONFIDENTIAL, or any custom text across every page of a PDF. 100% in your browser.",
      },
      { property: "og:title", content: "Watermark PDF — CounselPDF" },
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
      const result = await applyTextWatermark(file, { text, opacity, size, pos });
      downloadBlob(result.blob, result.filename);
      toast.success("Watermark added");
    } catch (err) {
      console.error(err);
      toast.error("Watermark failed");
    } finally {
      setBusy(false);
    }
  };


  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);
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
            <FileBar file={file} info={`${pageCount} page${pageCount === 1 ? "" : "s"}`} onClose={reset} onReplace={onFile} />

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
