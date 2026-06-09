import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText, Info } from "lucide-react";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";
import { loadPdfjs } from "@/lib/pdf/worker";

export const Route = createFileRoute("/to-word")({
  head: () => ({
    meta: [
      { title: "PDF to Word (DOCX) — VaultPDF" },
      {
        name: "description",
        content:
          "Convert PDFs to editable Word documents. Text + layout preserved, runs entirely in your browser — your files never upload.",
      },
      { property: "og:title", content: "PDF to Word — VaultPDF" },
      {
        property: "og:description",
        content: "Editable .docx from your PDF, generated locally. No upload.",
      },
      { property: "og:url", content: "/to-word" },
    ],
    links: [{ rel: "canonical", href: "/to-word" }],
  }),
  component: ToWordPage,
});

type Mode = "flow" | "page";

function ToWordPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<Mode>("flow");
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
      const { Document, Packer, Paragraph, TextRun, PageBreak, HeadingLevel } = await import("docx");
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

      const allChildren: any[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const lines = groupIntoLines(content.items as any[]);

        if (mode === "page" && i > 1) {
          allChildren.push(new Paragraph({ children: [new PageBreak()] }));
        }

        if (mode === "page") {
          allChildren.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_3,
              children: [new TextRun({ text: `Page ${i}`, bold: true, color: "888888" })],
            }),
          );
        }

        for (const ln of lines) {
          if (!ln.text.trim()) {
            allChildren.push(new Paragraph({ children: [new TextRun("")] }));
            continue;
          }
          allChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: ln.text,
                  size: Math.max(16, Math.min(36, Math.round(ln.size * 2))),
                }),
              ],
            }),
          );
        }
        setProgress(Math.round((i / doc.numPages) * 100));
      }

      const docx = new Document({
        styles: {
          default: { document: { run: { font: "Calibri", size: 22 } } },
        },
        sections: [{ children: allChildren }],
      });

      const blob = await Packer.toBlob(docx);
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBlob(blob, `${base}.docx`);
      toast.success("Word document downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Conversion failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <ToolHeader
        tag="PDF → Word"
        title="Turn your PDF into an editable Word doc."
        sub="Text and paragraph structure are reconstructed locally. Best for text PDFs — scanned pages need OCR first."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to convert" sublabel="no upload" />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} info={`${pageCount} page${pageCount === 1 ? "" : "s"}`} onClose={reset} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Layout</div>
                <div className="grid grid-cols-2 gap-2">
                  <ModeBtn active={mode === "flow"} onClick={() => setMode("flow")}>
                    Continuous flow
                  </ModeBtn>
                  <ModeBtn active={mode === "page"} onClick={() => setMode("page")}>
                    Page breaks + labels
                  </ModeBtn>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-border bg-background/40 px-3 py-2.5 text-[12px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  Text-only conversion. Images, tables, and complex layouts may not survive cleanly —
                  if your PDF is scanned, run <span className="text-foreground">Make Searchable</span> first.
                </div>
              </div>

              {busy && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-vault transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">Reading pages… {progress}%</div>
                </div>
              )}

              <Button onClick={run} disabled={busy} className="bg-vault text-vault-foreground hover:opacity-90 w-full h-11">
                <FileText className="h-4 w-4 mr-2" />
                {busy ? "Converting…" : "Convert & download .docx"}
              </Button>
              <div className="text-center text-[11px] text-muted-foreground">
                🔒 Converted in your browser. Nothing uploaded.
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Group pdfjs text items into lines using their y-position.
function groupIntoLines(items: any[]): { text: string; size: number; y: number }[] {
  const rows: { y: number; size: number; parts: { x: number; str: string }[] }[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const tr = it.transform as number[];
    const x = tr[4];
    const y = tr[5];
    const size = Math.hypot(tr[2], tr[3]) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, size * 0.4));
    if (!row) {
      row = { y, size, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, str: it.str });
    if (it.hasEOL) {
      row.parts.push({ x: x + 9999, str: "\n__EOL__" });
    }
  }
  rows.sort((a, b) => b.y - a.y);
  const out: { text: string; size: number; y: number }[] = [];
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x);
    const raw = r.parts.map((p) => p.str).join(" ").replace(/\s*\n__EOL__\s*/g, "\n");
    for (const line of raw.split("\n")) {
      out.push({ text: line.replace(/\s+/g, " ").trim(), size: r.size, y: r.y });
    }
  }
  return out;
}
