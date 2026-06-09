import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Hash, Lock } from "lucide-react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ToolHeader, FileBar, ModeBtn, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";

export const Route = createFileRoute("/bates")({
  head: () => ({
    meta: [
      { title: "Bates Numbering — VaultPDF" },
      {
        name: "description",
        content:
          "Stamp sequential Bates numbers (e.g. SMITH_000001) on every page of a PDF. Court-ready, 100% in your browser.",
      },
      { property: "og:title", content: "Bates Numbering — VaultPDF" },
      {
        property: "og:description",
        content: "Add Bates stamps to discovery PDFs — prefix, padding, position. Your file never leaves the tab.",
      },
      { property: "og:url", content: "/bates" },
    ],
    links: [{ rel: "canonical", href: "/bates" }],
  }),
  component: BatesPage,
});

type Position = "tl" | "tc" | "tr" | "bl" | "bc" | "br";

function BatesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [prefix, setPrefix] = useState("SMITH_");
  const [start, setStart] = useState(1);
  const [padding, setPadding] = useState(6);
  const [position, setPosition] = useState<Position>("br");
  const [fontSize, setFontSize] = useState(10);
  const [color, setColor] = useState<"black" | "red" | "blue">("black");
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
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

  const sample = `${prefix}${String(start).padStart(padding, "0")}`;
  const last = `${prefix}${String(start + Math.max(0, pageCount - 1)).padStart(padding, "0")}`;

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const font = await src.embedFont(StandardFonts.HelveticaBold);
      const fill =
        color === "red" ? rgb(0.8, 0.05, 0.05) :
        color === "blue" ? rgb(0.05, 0.15, 0.6) : rgb(0, 0, 0);
      const margin = 24;
      const pages = src.getPages();
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();
        const stamp = `${prefix}${String(start + i).padStart(padding, "0")}`;
        const tw = font.widthOfTextAtSize(stamp, fontSize);
        const th = fontSize;
        let x = margin;
        let y = margin;
        switch (position) {
          case "tl": x = margin; y = height - margin - th; break;
          case "tc": x = (width - tw) / 2; y = height - margin - th; break;
          case "tr": x = width - margin - tw; y = height - margin - th; break;
          case "bl": x = margin; y = margin; break;
          case "bc": x = (width - tw) / 2; y = margin; break;
          case "br": x = width - margin - tw; y = margin; break;
        }
        // Subtle white halo for readability over dark scans
        page.drawRectangle({
          x: x - 4, y: y - 3, width: tw + 8, height: th + 6,
          color: rgb(1, 1, 1), opacity: 0.75,
        });
        page.drawText(stamp, { x, y, size: fontSize, font, color: fill });
      }
      const bytes = await src.save();
      const base = file.name.replace(/\.pdf$/i, "");
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      downloadBlob(new Blob([ab], { type: "application/pdf" }), `${base}-bates.pdf`);
      toast.success(`Stamped ${pages.length} page${pages.length === 1 ? "" : "s"}`, {
        description: `${sample} → ${last}`,
      });
    } catch (err) {
      console.error(err);
      toast.error("Couldn't stamp this PDF.");
    } finally {
      setBusy(false);
    }
  };

  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);

  return (
    <AppShell>
      <ToolHeader
        tag="Bates"
        title="Bates-stamp every page."
        sub="Add sequential discovery numbers like SMITH_000001 to a PDF. Prefix, padding, position — all in your browser."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to Bates-stamp" sublabel="no upload, no page limit" />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} info={`${pageCount} page${pageCount === 1 ? "" : "s"}`} onClose={reset} onReplace={onFile} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Prefix">
                  <input
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="SMITH_"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-vault/40"
                  />
                </Field>
                <Field label="Start number">
                  <input
                    type="number"
                    min={0}
                    value={start}
                    onChange={(e) => setStart(Math.max(0, parseInt(e.target.value || "0", 10)))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-vault/40"
                  />
                </Field>
                <Field label="Padding (digits)">
                  <input
                    type="number"
                    min={1} max={10}
                    value={padding}
                    onChange={(e) => setPadding(Math.min(10, Math.max(1, parseInt(e.target.value || "1", 10))))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-vault/40"
                  />
                </Field>
              </div>

              <Field label="Position">
                <div className="grid grid-cols-3 gap-2">
                  {(["tl","tc","tr","bl","bc","br"] as Position[]).map((p) => (
                    <ModeBtn key={p} active={position === p} onClick={() => setPosition(p)}>
                      {posLabel(p)}
                    </ModeBtn>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Font size">
                  <input
                    type="number"
                    min={6} max={32}
                    value={fontSize}
                    onChange={(e) => setFontSize(Math.min(32, Math.max(6, parseInt(e.target.value || "10", 10))))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-vault/40"
                  />
                </Field>
                <Field label="Color">
                  <div className="grid grid-cols-3 gap-2">
                    <ModeBtn active={color === "black"} onClick={() => setColor("black")}>Black</ModeBtn>
                    <ModeBtn active={color === "red"} onClick={() => setColor("red")}>Red</ModeBtn>
                    <ModeBtn active={color === "blue"} onClick={() => setColor("blue")}>Blue</ModeBtn>
                  </div>
                </Field>
              </div>

              <div className="rounded-md border border-border bg-background/60 px-4 py-3 text-sm">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Preview</div>
                <div className="font-mono text-foreground">
                  {sample} <span className="text-muted-foreground">…</span> {last}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {pageCount} stamp{pageCount === 1 ? "" : "s"} · {posLabel(position).toLowerCase()}
                </div>
              </div>

              <Button
                onClick={run}
                disabled={busy || !prefix}
                className="bg-vault text-vault-foreground hover:opacity-90 w-full"
              >
                {busy ? "Stamping…" : (
                  <>
                    <Hash className="h-4 w-4 mr-2" /> Stamp &amp; download
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <Lock className="h-3 w-3 text-vault" /> Stays in your browser. Original text layer preserved.
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function posLabel(p: Position): string {
  return {
    tl: "Top left", tc: "Top center", tr: "Top right",
    bl: "Bottom left", bc: "Bottom center", br: "Bottom right",
  }[p];
}
