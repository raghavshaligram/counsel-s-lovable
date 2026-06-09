import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Image as ImageIcon, Download } from "lucide-react";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";
import { loadPdfjs } from "@/lib/pdf/worker";

export const Route = createFileRoute("/to-images")({
  head: () => ({
    meta: [
      { title: "PDF to Images (PNG / JPG) — VaultPDF" },
      {
        name: "description",
        content:
          "Convert every PDF page to a high-resolution PNG or JPG. Choose DPI, download a zip — all in your browser.",
      },
      { property: "og:title", content: "PDF to Images — VaultPDF" },
      {
        property: "og:description",
        content: "Render each page to PNG or JPG locally. No upload, ever.",
      },
      { property: "og:url", content: "/to-images" },
    ],
    links: [{ rel: "canonical", href: "/to-images" }],
  }),
  component: ToImagesPage,
});

type Format = "png" | "jpg";
type Preset = { label: string; dpi: number };
const PRESETS: Preset[] = [
  { label: "Screen 72 dpi", dpi: 72 },
  { label: "Standard 150 dpi", dpi: 150 },
  { label: "Print 300 dpi", dpi: 300 },
];

function ToImagesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [format, setFormat] = useState<Format>("png");
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      setPageCount(doc.numPages);
    } catch {
      toast.error("Couldn't open that PDF.");
      setFile(null);
    }
  }, []);

  const reset = () => {
    setFile(null);
    setPageCount(0);
    setProgress(0);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const scale = dpi / 72;
      const mime = format === "png" ? "image/png" : "image/jpeg";
      const ext = format === "png" ? "png" : "jpg";
      const base = file.name.replace(/\.pdf$/i, "");

      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const pad = String(doc.numPages).length;

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d")!;
        if (format === "jpg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        const blob: Blob = await new Promise((res) =>
          canvas.toBlob((b) => res(b!), mime, format === "jpg" ? quality : undefined),
        );
        zip.file(`${base}-p${String(i).padStart(pad, "0")}.${ext}`, blob);
        setProgress(Math.round((i / doc.numPages) * 100));
      }

      if (doc.numPages === 1) {
        const only = await zip.file(/.*/)[0].async("blob");
        downloadBlob(only, `${base}.${ext}`);
      } else {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `${base}-images.zip`);
      }
      toast.success(`Exported ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast.error("Conversion failed");
    } finally {
      setBusy(false);
    }
  };

  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);
  return (
    <AppShell>
      <ToolHeader
        tag="PDF → Images"
        title="Convert PDF pages to PNG or JPG."
        sub="Render each page at print-ready resolution. Multi-page PDFs come back as a zip."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to convert" sublabel="no upload" />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} info={`${pageCount} page${pageCount === 1 ? "" : "s"}`} onClose={reset} onReplace={onFile} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Format</div>
                <div className="grid grid-cols-2 gap-2">
                  <ModeBtn active={format === "png"} onClick={() => setFormat("png")}>PNG · lossless</ModeBtn>
                  <ModeBtn active={format === "jpg"} onClick={() => setFormat("jpg")}>JPG · smaller</ModeBtn>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Resolution</div>
                <div className="grid grid-cols-3 gap-2">
                  {PRESETS.map((p) => (
                    <ModeBtn key={p.dpi} active={dpi === p.dpi} onClick={() => setDpi(p.dpi)}>
                      {p.label}
                    </ModeBtn>
                  ))}
                </div>
              </div>

              {format === "jpg" && (
                <div>
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    <span>JPG quality</span>
                    <span className="font-mono text-foreground/80">{Math.round(quality * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.4}
                    max={1}
                    step={0.02}
                    value={quality}
                    onChange={(e) => setQuality(parseFloat(e.target.value))}
                    className="w-full accent-vault"
                  />
                </div>
              )}

              {busy && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-vault transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">Rendering pages… {progress}%</div>
                </div>
              )}

              <Button onClick={run} disabled={busy} className="bg-vault text-vault-foreground hover:opacity-90 w-full h-11">
                <ImageIcon className="h-4 w-4 mr-2" />
                {busy ? "Converting…" : pageCount > 1 ? "Convert & download zip" : "Convert & download"}
              </Button>
              <div className="text-center text-[11px] text-muted-foreground">
                🔒 Rendered in your browser. Nothing uploaded.
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
